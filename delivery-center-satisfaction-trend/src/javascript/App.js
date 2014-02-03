var    FIELD_DELIVERY_SATISFACTION = "c_Deliverysatisfactionscore110";
var    FIELD_REMARKS = "Notes";
var    FIELD_STATUS = "Teamstatus";

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    defaults: { padding: 10, margin: 5 },
    items: [
        {
            xtype: 'container',
            itemId: 'selector_box',
            layout: { type: 'hbox' },
            defaults: { margin: 5 }
        },
        {
            xtype: 'container',
            itemId: 'message_box',
            html: ''
        },
        {
            xtype:'container',
            itemId:'chart_box',
            defaults: {margin:5}
        }
    ],

    _projects: [],
    _sprint_names: [],
    
    launch: function() {
        this._addReleaseSelector();
    },
    
    _addReleaseSelector: function() {
        this.down('#selector_box').add(
            Ext.create('Rally.ui.combobox.ReleaseComboBox', {
                itemId: 'release_cb',
                xtype:'rallyreleasecombobox',
                listeners: {
                    scope: this,
                    change: function(rb, new_value, old_value) {
                        if ( rb.getValue() ) {
                            this._findIterationsForRelease();
                        }
                    },
                    ready: function(rb) {
                        if ( rb.getValue() ) {
                            this._findIterationsForRelease();
                        }
                    }
                }
            })
        );
    },
    
    _findIterationsForRelease: function() {
        var me = this;

        this.down('#chart_box').removeAll();
        this.down('#message_box').removeAll();
        
        var release_box = this.down('#release_cb');
        var release = release_box.getRecord();

        // dates are given in JS, but we need them to be ISO
        // Rally.util.DateTime.toIsoString(date, true); will return a date in UTC
        var start_date_iso = Rally.util.DateTime.toIsoString(release.get('ReleaseStartDate'), true);
        var end_date_iso = Rally.util.DateTime.toIsoString(release.get('ReleaseDate'), true);

        var start_query = Ext.create('Rally.data.QueryFilter',{ 
                property: "StartDate", operator:">=", value: start_date_iso
            }).and( Ext.create('Rally.data.QueryFilter',{
                property: "StartDate", operator:"<=", value: end_date_iso
            })
        );
        var end_query = Ext.create('Rally.data.QueryFilter',{ 
                property: "EndDate", operator:">=", value: start_date_iso 
            }).and( Ext.create('Rally.data.QueryFilter',{
                property: "EndDate", operator:"<=", value: end_date_iso
            })
        );
        var iteration_query = start_query.or(end_query);
        this._log(["filter",iteration_query.toString()]);

        Ext.create('Rally.data.WsapiDataStore', {
            limit : 'Infinity',
            model: 'Iteration',
            autoLoad: true,
            filters: iteration_query,
            fetch: ['Name', 'Project', 'ObjectID','PlannedVelocity','StartDate','EndDate', 'Children'],
            sorters: [
                {
                    property: 'EndDate',
                    direction: 'ASC'
                }
            ],
            listeners: {
                scope: this,
                load: function(store, records) {
                    this._processIterations(records);
                }
            }
        });
    },
    
    _processIterations: function(records){
        var me = this;
        // remove iterations that belong to projects with children (only show leaves)
        var filtered_iterations = [];
        Ext.Array.each(records, function(iteration){
            if ( iteration.get('Project').Children.Count === 0 ) {
                filtered_iterations.push(iteration);
            }
        });
        // group the iterations we got back by their projects
        // gives a hash where key is project name
        this.project_iterations = _.groupBy(filtered_iterations,function(iteration){
            var project = iteration.get('Project');
            var name = project.Name;
            return name;
        });
        
        this.project_hash = {};
        // that gave us a hash of arrays. let's make it a hash of hashes
        _.each(_.keys(me.project_iterations),function(key){
            me.project_hash[key] = {
                iterations: me.project_iterations[key],
                series: null
            };
        });
        
        this._sprint_names = [];
        // for the project that we're on, use it to set sprint names
//        _.each(me.project_iterations[this.getContext().getProject().Name], function(iteration){
//            me._sprint_names.push(iteration.get('Name'));
//        });
        // use the first found child project to get the applicable sprints
        var project_keys = Ext.Object.getKeys(me.project_iterations);
        var key_project = project_keys[0];
        me._log(['using key',key_project]);
        
        _.each(me.project_iterations[key_project], function(iteration){
            me._sprint_names.push(iteration.get('Name'));
        });
        if ( this._sprint_names.length == 0 ) {
            this.down('#chart_box').add({
                xtype:'container',
                html:'No sprints in this release'
            });
        }
        this._log(['sprint names:',me._sprint_names]);
        
        this._log(['project_iterations',this.project_iterations]);
        
        // cycle over the projects (keys) and find the 
        // special stories
        this.waiter = {};
        
        _.each(_.keys(me.project_hash),function(key){
            me.waiter[key] = 1;
            me._testForSpecialStoryOutOfBounds(key,me);
            var iterations = me.project_hash[key].iterations;
            // use the special stories to build a store for the chart
            async.map(iterations,function( iteration, callback) {
                me._getSpecialStory(iteration,callback,me);
            },function(err,stories){
              me._buildTeamData(key,iterations,stories);
            });
        });
    },
    _testForSpecialStoryOutOfBounds: function(project_name,scope){
        scope._log('testing '+project_name);
        var release = scope.down('#release_cb').getRecord();
        var base_filter = Ext.create('Rally.data.QueryFilter',{
            property: 'Parent.Name',
            operator : "contains",
            value: 'Iteration Reporting Parent'
        });
        base_filter = base_filter.and(Ext.create('Rally.data.QueryFilter', {
            property: 'Project.Name',
            value: project_name
        }));
        base_filter = base_filter.and(Ext.create('Rally.data.QueryFilter', {
            property: 'Release.Name',
            value: release.get('Name')
        }));
        var is_after_filter = Ext.create('Rally.data.QueryFilter',{
            property: 'Iteration.StartDate',
            operator: '>',
            value: Rally.util.DateTime.toIsoString(release.get('ReleaseDate'))
        });
        var is_before_filter = Ext.create('Rally.data.QueryFilter',{
            property: 'Iteration.EndDate',
            operator: '<',
            value: Rally.util.DateTime.toIsoString(release.get('ReleaseStartDate'))
        });
        
        var date_filters = is_after_filter.or(is_before_filter);
        var filters = base_filter.and(date_filters);
        
        Ext.create('Rally.data.WsapiDataStore', {
            limit : 1,
            pageSize: 1,
            autoLoad : true,
            model: 'HierarchicalRequirement',
            filters: filters,
            listeners: {
                load: function(store, records, success) {
                    scope._log("count " + records.length);
                    if ( records.length ) {
                        scope.down('#message_box').add({
                            xtype: 'container',
                            html: '* ' + project_name + ' has at least one special story outside the timebox'
                        });
                    }
                },
                scope : scope
            },
            fetch: ['FormattedID']
        });
    },
    // The 'special' story is one which is in the iteration with a parent named
    // 'Iteration Reporting Parent'
    
    _getSpecialStory : function( iteration, callback, that) {
        var release = that.down('#release_cb').getRecord();
        
        Ext.create('Rally.data.WsapiDataStore', {
            limit : 'Infinity',
            autoLoad : true,
            model: 'HierarchicalRequirement',
            filters: [
                {
                    property: 'Iteration.ObjectID',
                    operator : "=",
                    value: iteration.get("ObjectID")
                },
                {
                    property: 'Parent.Name',
                    operator : "contains",
                    value: 'Iteration Reporting Parent'
                },
                {
                    property: 'Release.Name',
                    value: release.get('Name')
                }
            ],
            listeners: {
                load: function(store, data, success) {
                    callback(null,data);
                },
                scope : that
            },
            sorters: [
                {
                    property: 'CreationDate',
                    direction: 'ASC'
                }
            ],
            fetch: ['FormattedID', 'Name', 'PlanEstimate',
            'ScheduleState','CreationDate',
            FIELD_DELIVERY_SATISFACTION, 
            FIELD_REMARKS, 
            FIELD_STATUS]
        });
        
    },
    
    // create serieses for the chart
    _buildTeamData: function(team,iterations,stories)
    {
        this._log(["_buildTeamData",team,iterations,stories]);
        var me = this;
        
        var data_array = [];

        // prepopulate series_array in case the project's missing an iteration
        _.each(me._sprint_names,function(name){
            data_array.push(null);
        });
        
        _.each(iterations,function(iteration,index){
            var specialStory = stories[index] !== null && stories[index].length > 0 ? stories[index][0] : null;
            var satisfaction = null;
            if ( specialStory !== null ) {
                satisfaction = specialStory.get(FIELD_DELIVERY_SATISFACTION);
                if ( satisfaction === "" ) {
                    satisfaction = null;
                }
                if (satisfaction && iteration.get('EndDate') < new Date()) {
                    satisfaction = parseFloat(satisfaction,10);
                } else { 
                    satisfaction = null;
                }
            }

            iteration.set('_satisfaction',satisfaction);
            var x_index = Ext.Array.indexOf(me._sprint_names,iteration.get('Name'));
            
            if ( x_index > -1 ) {
                data_array[x_index] = satisfaction;
            }
            
        });
        
        var series_definition = {
            type: 'line',
            data: data_array,
            name: team,
            visible: true,
            marker: {
                enabled: true
            }
        };
        me.project_hash[team].series = series_definition;
        
        delete me.waiter[team];
        
        this._defineChart();
    },
    
    _defineAverage: function() {
        var me = this;
        this._log(["_defineAverage with project_hash:",this.project_hash]);
        var project_names = Ext.Object.getKeys(this.project_hash);
        if (project_names.length > 1 ) {
            var averages = [];
            
            var key_project_name = project_names[0];
            var data_length = this.project_hash[key_project_name].series.data.length;
            for ( var i=0;i<data_length;i++ ) {
                this._log("pass " + i);
                var counter = 0;
                var total = 0;
                Ext.Array.each( project_names, function(project_name) {
                    var score = me.project_hash[project_name].series.data[i];
                    if ( score > 0 ) {
                        counter += 1;
                        total += score;
                    }
                });
                if ( counter > 0 ) {
                    averages.push(total/counter);
                } else {
                    averages.push(null);
                }
            }
            
            var average = { 
                series: {
                    name: 'Average',
                    visible: true,
                    type: 'line',
                    data: averages,
                    marker: { enabled: true }
                }
            };
            this.project_hash["Average"] = average;
        } else {
            this._log("Not enough projects to make an average with");
        }
    },
    
    _defineChart: function() {
        var me = this;
        this._log(["_defineChart",this.project_hash, this._sprint_names]);
        // only go on if ready
        if ( _.keys(this.waiter).length > 0 ) {
            me._log("Waiting for " + _.keys(me.waiter).join(','));
            return;
        }
        
        this._defineAverage();
        
        var series = [];
        
        _.each(_.keys(me.project_hash),function(key){
            var iterations = me.project_hash[key].iterations;
            series.push(me.project_hash[key].series);
        });
        
        this._log(["series:",series]);
        
        this.down('#chart_box').removeAll();
        
        
        this.down('#chart_box').add({
            xtype: 'rallychart',
            chartData: {
                series: series
            },
            height: 350,
            chartConfig: {
                chart: {},
                title: {
                    text: '',
                    align:'center'
                },
                yAxis: [{
                    title: {
                        enabled: true,
                        text: 'Delivery Satisfaction'
                    }
                }],
                xAxis: [{
                    categories: me._sprint_names,
                    minorTickInterval: null,
                    tickLength: 0,
                    labels: {
                        rotation: -45,
                        align: 'right'
                    }
                }]
            }
        });
        
    },
    
    _log: function(msg) {
        window.console && console.log(msg);
    }
});
