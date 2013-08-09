Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    _debug: true,
    _release: null,
    _iterations: [],
    _current_iteration: null,
    _release_flow_hash: {},
    _asynch_return_flags: {},
    _velocities: {}, 
    defaults: { padding: 10 },
    items: [
        {
            xtype: 'container', 
            itemId: 'release_selector_box'
        },
        {
            xtype: 'container',
            itemId: 'chart_box'
        }
    ],

    launch: function() {
        this._addReleaseSelector();
    },

    _addReleaseSelector: function() {
        this._iterations = [];
        this.down('#release_selector_box').add({
            xtype:'rallyreleasecombobox',
            listeners: {
                scope: this,
                change: function(rb, new_value, old_value) {
                    this._asynch_return_flags = {};
                    this._release = rb.getRecord();
                    this._findIterationsBetweenDates();
                },
                ready: function(rb) {
                    this._asynch_return_flags = {};
                    this._release = rb.getRecord();
                    this._findIterationsBetweenDates();
                    this._findCurrentIteration();
                }
            }
        });
    },

    _findCurrentIteration: function() {
        var today_date = new Date();

        var today_iso_string = Rally.util.DateTime.toIsoString(today_date).replace(/T.*$/,"");
        this._log('Find iterations where StartDate <= ' + today_iso_string + ' and EndDate >= ' + today_iso_string );

        var iteration_query = [
            { property: "StartDate", operator:"<=", value: today_iso_string },
            { property: "EndDate", operator:">=", value: today_iso_string }
        ];
        
        var current_iteration_store = Ext.create('Rally.data.WsapiDataStore',{
            model: 'Iteration',
            autoLoad: true,
            filters: iteration_query,
            fetch: ['Name', 'PlannedVelocity', 'StartDate', 'EndDate'],
            context: { projectScopeDown: false },
            listeners: {
                scope: this,
                load: function(store, records) {
                    // This will be not be correct if we have overlapping iterations for some reason
                    current_iteration = records[0].data;
                    this._current_iteration = current_iteration;
                    this._asynch_return_flags["current_iteration"] = true;
                    this._makeChart();
                }
            }
        });
    },    

    _findIterationsBetweenDates: function(  ) {
        if ( this._chart ) { this._chart.destroy(); }
        // dates are given in JS, but we need them to be ISO
        var start_date_iso = Rally.util.DateTime.toIsoString(this._release.get('ReleaseStartDate'));
        var end_date_iso = Rally.util.DateTime.toIsoString(this._release.get('ReleaseDate'));
        this._log('Find iterations between ' + start_date_iso + ' and ' + end_date_iso );

        var iteration_query = [
            { property:"StartDate", operator:">=", value:start_date_iso },
            { property:"EndDate", operator:"<=", value:end_date_iso }
        ];
        
        var iteration_store = Ext.create('Rally.data.WsapiDataStore',{
            model: 'Iteration',
            autoLoad: true,
            filters: iteration_query,
            fetch: ['Name','PlannedVelocity','EndDate'],
            context: { projectScopeDown: false },
            listeners: {
                scope: this,
                load: function(store, records) {
                    this._iterations = records;
                    this._findReleaseBacklogAtEachIteration();
                    this._findAcceptedItemsInEachIteration();
                    this._asynch_return_flags["iterations"] = true;
                    this._makeChart();
                }
            }
        });
    },

    _findAcceptedItemsInEachIteration: function() {
        var me = this;

        var iteration_query = [
            { property: "ScheduleState", operator: ">=", value: "Accepted"},
            { property: "Release.Name", operator: "=", value:this._release.get("Name") }
        ];
        
        this._velocities = {}; // key will be iteration name

        Ext.create('Rally.data.WsapiDataStore',{
            model:'UserStory',
            autoLoad: true,
            filters: iteration_query,
            fetch:['Name', 'PlanEstimate', 'Iteration'],
            context: { projectScopeDown: false },
            listeners:{
                scope: this,
                load: function(store, records) {
                    Ext.Array.each(records,function(record){
                        var iteration_name = record.get('Iteration').Name;
                        if ( record.get('PlanEstimate') ) {
                            if (typeof(me._velocities[iteration_name]) == 'undefined') {
                                me._log("clearing velocity for " + iteration_name);
                                me._velocities[iteration_name] = 0;
                            }
                            me._velocities[iteration_name] += parseInt(record.get('PlanEstimate'), 10);
                        }
                    });
                    this._asynch_return_flags["story_velocity"] = true;
                    this._makeChart();
                }
            }
        });

        Ext.create('Rally.data.WsapiDataStore',{
            model:'Defect',
            autoLoad: true,
            filters: iteration_query,
            fetch:['Name', 'PlanEstimate', 'Iteration'],
            context: { projectScopeDown: false },
            listeners:{
                scope: this,
                load: function(store, records) {
                    Ext.Array.each(records,function(record){
                        var iteration_name = record.get('Iteration').Name;
                        if ( record.get('PlanEstimate') ) {
                            if (typeof(me._velocities[iteration_name]) == 'undefined') {
                                me._log("clearing velocity for " + iteration_name);
                                me._velocities[iteration_name] = 0;
                            }
                            me._velocities[iteration_name] += parseInt(record.get('PlanEstimate'), 10);
                        }
                    });
                    this._asynch_return_flags["defect_velocity"] = true;
                    this._makeChart();
                }
            }
        });

    },

    _findReleaseBacklogAtEachIteration: function() {
        var me = this;
        this._release_flow = []; // in order of sprint end
        var release_check = Ext.create('Rally.data.QueryFilter',{
            property:'ReleaseObjectID',
            value:this._release.get('ObjectID')
        });
        
        Ext.create('Rally.data.WsapiDataStore',{
            model: 'ReleaseCumulativeFlowData',
            autoLoad: true,
            filters: release_check,
            limit: 5000,
            listeners: {
                scope: this,
                load: function(store, cards) {
                    me._release_flow_hash = {}; // key is date (NOT date/time)
                    // each record is a sum of items in a particular state for the release on a given date
                    // could be 4-6 records for each day (one for each schedule state)
                    Ext.Array.each(cards, function(card) {
                        var capture_date = Rally.util.DateTime.toIsoString(
                            card.get('CreationDate')
                        ).replace(/T.*$/,"");

                        me._doubleLineLog("capture_date:", capture_date);

                        var plan_estimate = card.get('CardEstimateTotal');

                        me._doubleLineLog("plan_estimate", plan_estimate)
                        
                        if ( !me._release_flow_hash[capture_date] ) {
                            me._release_flow_hash[capture_date] = 0;
                        }

                        me._release_flow_hash[capture_date] += plan_estimate;
                    });
                    me._doubleLineLog("this._release_flow_hash::", me._release_flow_hash);
                    this._asynch_return_flags["flows"] = true;
                    me._makeChart();
                }
            }
        });
    },

    _finished_all_asynchronous_calls: function() {
        var proceed = true;
        if (!this._asynch_return_flags["flows"]) {
            this._log("Not yet received the release cumulative flow data");
            proceed = false;
        }
        if (!this._asynch_return_flags["iterations"]) {
            this._log("Not yet received the iteration timebox data");
            proceed = false;
        }
        if (!this._asynch_return_flags["story_velocity"]) {
            this._log("Not yet received the story velocity data");
            proceed = false;
        }
        if (!this._asynch_return_flags["defect_velocity"]) {
            this._log("Not yet received the defect velocity data");
            proceed = false;
        }
        if (!this._asynch_return_flags["current_iteration"]) {
            this._log("Not yet received the Current Iteration");
            proceed = false;
        }
        return proceed;
    },

    _makeChart: function() {

        this._doubleLineLog("this._release_flow_hash:", this._release_flow_hash)
        this._log(this._velocities);
        if ( this._finished_all_asynchronous_calls() ) {
            if (this._iterations.length == 0) {
                this._chart = this.down('#chart_box').add({
                    xtype: 'container',
                    html: 'No iterations defined in the release bounds...'
                });
            } else {
                var chart_hash = this._assembleSprintData();
                
                this._log(chart_hash);
                this._chart = this.down('#chart_box').add({
                    xtype: 'rallychart',
                    chartData: {
                        categories: chart_hash.Name,
                        series: [
                            {
                                type: 'line',
                                data: chart_hash.CumulativePlannedVelocity,
                                name: 'Planned Velocity',
                                visible: true
                            },
                            {
                                type: 'line',
                                data: chart_hash.TotalBacklog,
                                name: 'Total Backlog',
                                visible: true
                            },
                            {
                                type: 'line',
                                data: chart_hash.CumulativeActualVelocity,
                                name: 'Actual Velocity', 
                                visible: true
                            }
                        ]
                    },
                    height: 350,
                    chartConfig: {
                        chart: {},
                        title: {
                            text: 'LPC',
                            align: 'center'
                        },
                        yAxis: [
                            {
                                title: {
                                    text: ""
                                },
                                min: 0
                            }
                        ]
                    }
                });
            }
        }
    },

    _assembleSprintData: function(){
        var me = this;

        var data = {
            Name: [],
            TotalBacklog: [],
            PlannedVelocity: [],
            ActualVelocity: [],
            CumulativePlannedVelocity: [],
            CumulativeActualVelocity: []
        }

        var current_iteration = this._current_iteration;
        var current_iterationDate;

        if (current_iteration) {
            current_iterationEndDate = this._current_iteration.EndDate;
        }

        var planned_velocity_adder = 0;
        var actual_velocity_adder = 0;

        Ext.Array.each(this._iterations, function(iteration) {
            
            var this_end_date = iteration.get('EndDate');

            var planned_velocity = iteration.get('PlannedVelocity') || 0;
            planned_velocity_adder += planned_velocity;
            
            var backlog = me._getBacklogOnEndOfIteration(iteration);
            
            var actual_velocity = me._velocities[iteration.get('Name')] || 0;
            actual_velocity_adder += actual_velocity;
            
            data.Name.push(iteration.get('Name'));
            data.PlannedVelocity.push(planned_velocity);
            data.ActualVelocity.push(actual_velocity);
            
            data.CumulativePlannedVelocity.push(planned_velocity_adder);
            // Show null value for Cumulative Actual Velocity for sprints that have not yet occurred
            if (current_iterationDate && this_end_date > current_iterationEndDate) {
                actual_velocity_adder = null;
            }
            data.CumulativeActualVelocity.push(actual_velocity_adder);
            data.TotalBacklog.push(backlog);

            me._log("data as pushed:");
            me._doubleLineLog("name", iteration.get('Name'));
            me._doubleLineLog("this_end_date", this_end_date);            
            me._doubleLineLog("planned_velocity", planned_velocity);
            me._doubleLineLog("actual_velocity", actual_velocity);
            me._doubleLineLog("backlog", backlog);

        });

        return data;
    },

    _getBacklogOnEndOfIteration: function(iteration) {
        var backlog = null;
        var iteration_end = Rally.util.DateTime.toIsoString(iteration.get('EndDate')).replace(/T.*$/,"");
        this._doubleLineLog("iteration_end", iteration_end);
        if (this._release_flow_hash[iteration_end]) {
            backlog = this._release_flow_hash[iteration_end];
            this._doubleLineLog("backlog", backlog);
        }
        return backlog;
    },

    _log: function(msg) {
        window.console && console.log(msg);
    },

    _doubleLineLog: function(msg, variable) {
        if (this._debug) {
            console.log(msg);
            console.log(variable);
        }
    }

});