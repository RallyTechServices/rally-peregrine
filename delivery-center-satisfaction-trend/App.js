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
            fetch: ['Name', 'Project', 'ObjectID','PlannedVelocity','StartDate','EndDate'],
            sorters: [
                {
                    property: 'EndDate',
                    direction: 'ASC'
                }
            ],
            listeners: {
                scope: this,
                load: function(store, records) {
                    this._log(['_iterations: ', records]);
                    this._processIterations(records);
                }
            }
        });
    },
    
    _processIterations: function(records){
        var me = this;
        // group the iterations we got back by their projects
        // gives a hash where key is project name
        this.project_iterations = _.groupBy(records,function(iteration){
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
        _.each(me.project_iterations[this.getContext().getProject().Name], function(iteration){
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
            var iterations = me.project_hash[key].iterations;
            
            // use the special stories to build a store for the chart
            async.map(iterations,function( iteration, callback) {
                me._getSpecialStory(iteration,callback,me);
            },function(err,stories){
              me._buildTeamData(key,iterations,stories);
            });
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
                me._log(["found story",specialStory]);
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
            me._log(satisfaction);

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
    
    _defineChart: function() {
        var me = this;
        this._log(["_defineChart",this.project_hash, this._sprint_names]);
        // only go on if ready
        if ( _.keys(this.waiter).length > 0 ) {
            me._log("Waiting for " + _.keys(me.waiter).join(','));
            return;
        }
        
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
