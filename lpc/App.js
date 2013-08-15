Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    _debug: false,
    _release_combo_box: null,
    _target_backlog_number_box: null,
    _release: null,
    _iterations: [],
    _current_iteration: null,
    _release_flow_hash: {},
    _asynch_return_flags: {},
    _velocities: {},
    _trend_data: {},
    _target_backlog: 0,
    _really_big_number: 1000000,
    defaults: { padding: 10 },
    items: [
        {
            xtype: 'container',
            itemId: 'release_selector_box'
        },
        {
            xtype: 'container',
            itemId: 'target_backlog_number_box',
            layout: { type: 'hbox' },
            defaults: {
                padding: 5
            }
        },
        {
            xtype: 'container',
            itemId: 'chart_box'
        }
    ],

    launch: function() {
        this._addReleaseSelector();
        this._addTargetBacklogBox();
    },

    // Clears the asynch return flags and kicks off the data collection/charting process chain
    _kickOff: function() {
        this._asynch_return_flags = {};
        this._release = this._release_combo_box.getRecord();
        this._findIterationsBetweenDates();
    },

    _addReleaseSelector: function() {
        this._iterations = [];
        this._release_combo_box = Ext.create('Rally.ui.combobox.ReleaseComboBox', {
            xtype:'rallyreleasecombobox',
            listeners: {
                scope: this,
                change: function(rb, new_value, old_value) {
                    this._kickOff();
                },
                ready: function(rb) {
                    this._kickOff();
                }
            }
        });
        this.down('#release_selector_box').add(this._release_combo_box);
    },

    _addTargetBacklogBox: function() {

        var me = this;

        me._target_backlog_number_box = Ext.create('Rally.ui.NumberField', {
            xtype: 'rallynumberfield',
            fieldLabel: 'Target Backlog (Story Points)',
            value: 0.0,
        });

        this.down('#target_backlog_number_box').add(me._target_backlog_number_box);
        this.down('#target_backlog_number_box').add({
            xtype: 'rallybutton',
            text: 'Refresh',
            handler: function() {
                // Update target backlog from dialog
                me._target_backlog = me._target_backlog_number_box.getValue();
                me._kickOff();
            }
        });
    },

    _findCurrentIteration: function() {
        var today_date = new Date();

        var today_iso_string = Rally.util.DateTime.toIsoString(today_date, true).replace(/T.*$/,"");
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
                    current_iteration = records[0];
                    this._current_iteration = current_iteration;
                    this._asynch_return_flags["current_iteration"] = true;
                    this._findTodaysReleaseBacklog();
                    this._makeChart();
                }
            }
        });
    },

    _findIterationsBetweenDates: function(  ) {
        if ( this._chart ) { this._chart.destroy(); }

        // Initialize release flow hash
        this._release_flow_hash = {}; // key is date (NOT date/time)

        // dates are given in JS, but we need them to be ISO
        // Rally.util.DateTime.toIsoString(date, true); will return a date in UTC
        var start_date_iso = Rally.util.DateTime.toIsoString(this._release.get('ReleaseStartDate'), true);
        var end_date_iso = Rally.util.DateTime.toIsoString(this._release.get('ReleaseDate'), true);
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

        this._findCurrentIteration();
    },

    _findAcceptedItemsInEachIteration: function() {
        var me = this;

        var iteration_query = [
            { property: "ScheduleState", operator: ">=", value: "Accepted" },
            { property: "Release.Name", operator: "=", value:this._release.get("Name") }
        ];
        
        this._velocities = {}; // key will be iteration name

        Ext.create('Rally.data.WsapiDataStore', {
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
                    Ext.Array.each(records, function(record){
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

    // This function finds items that were added to the backlog today and are not yet
    // captured in ReleaseCumulativeFlow data
    _findTodaysReleaseBacklog: function() {
        
        var me = this;
        var this_release = this._release.get('ObjectID');
        var this_iteration = this._current_iteration;

        if (!this_iteration) {
            this._asynch_return_flags["story_backlog_today"] = true;
            this._asynch_return_flags["defect_backlog_today"] = true;
        } else {
            var this_iteration_end_date = this_iteration.get('EndDate');
            var this_iteration_end_iso_string = Rally.util.DateTime.toIsoString(this_iteration_end_date, true).replace(/T.*$/,"");

            // Initialize today's cumulative flow data with yesterday's
            me._release_flow_hash[this_iteration_end_iso_string] = 0;

            var release_today_query = [
                { property: "Release.ObjectID", operator: "=", value: this_release }
            ];

            // Do a non-flow query for Work Products assigned to the Release 
            // include them on the backlog line
            Ext.create('Rally.data.WsapiDataStore', {
                model:'UserStory',
                autoLoad: true,
                filters: release_today_query,
                fetch:['Name', 'PlanEstimate', 'Release', 'CreationDate'],
                context: { projectScopeDown: false },
                listeners:{
                    scope: this,
                    load: function(store, records) {
                        Ext.Array.each(records, function(record) {
                            if ( record.get('PlanEstimate') ) {
                                me._release_flow_hash[this_iteration_end_iso_string] += parseInt(record.get('PlanEstimate'), 10);
                            }
                        });
                        this._asynch_return_flags["story_backlog_today"] = true;
                        this._makeChart();
                    }
                }
            });

            Ext.create('Rally.data.WsapiDataStore',{
                model:'Defect',
                autoLoad: true,
                filters: release_today_query,
                fetch:['Name', 'PlanEstimate', 'Release', 'CreationDate'],
                context: { projectScopeDown: false },
                listeners:{
                    scope: this,
                    load: function(store, records) {
                        Ext.Array.each(records, function(record) {
                            if ( record.get('PlanEstimate') ) {
                                me._release_flow_hash[this_iteration_end_iso_string] += parseInt(record.get('PlanEstimate'), 10);
                            }
                        });
                        this._asynch_return_flags["defect_backlog_today"] = true;
                        this._makeChart();
                    }
                }
            });
        }
    },

    // Adjusts for Rally "zero'ing" the card creation time for cumulative flow cards
    // Example:
    // Actual card creation time: 2013-08-11T23:59:59
    // WSAPI-Reported card creation time: 2013-08-11T00:00:00
    // Adjusted card creation time: 2013-08-11T23:59:59
    _adjustCardTime: function(card_date) {
        var adjusted_date = Rally.util.DateTime.add(card_date, "hour", 23);
        adjusted_date = Rally.util.DateTime.add(adjusted_date, "minute", 59);
        adjusted_date = Rally.util.DateTime.add(adjusted_date, "second", 59);
        return adjusted_date;
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
                    // each record is a sum of items in a particular state for the release on a given date
                    // could be 4-6 records for each day (one for each schedule state)
                    Ext.Array.each(cards, function(card) {
                        var card_creation_date = card.get('CreationDate');
                        var adjusted_card_creation_date = me._adjustCardTime(card_creation_date);
                        var capture_date = Rally.util.DateTime.toIsoString(
                            adjusted_card_creation_date, true
                        ).replace(/T.*$/,"");
                        // me._doubleLineLog("capture_date:", capture_date);

                        var plan_estimate = card.get('CardEstimateTotal');
                        // me._doubleLineLog("plan_estimate", plan_estimate)
                        
                        if ( !me._release_flow_hash[capture_date] ) {
                            me._release_flow_hash[capture_date] = 0;
                        }

                        me._release_flow_hash[capture_date] += plan_estimate;
                    });
                    // me._doubleLineLog("this._release_flow_hash::", me._release_flow_hash);
                    this._asynch_return_flags["flows"] = true;
                    me._makeChart();
                }
            }
        });
    },

    _assembleSprintData: function(){
        var me = this;

        var data = {
            Name: [],
            IterationEndDate: [],
            TotalBacklog: [],
            TargetBacklog: [],
            PlannedVelocity: [],
            ActualVelocity: [],
            CumulativePlannedVelocity: [],
            CumulativeActualVelocity: [],
            OptimisticProjectedVelocity: [],
            PessimisticProjectedVelocity: [],
            BestHistoricalActualVelocity: 0
        };

        var current_iteration = this._current_iteration;
        var current_iteration_end_date;

        if (current_iteration) {
            current_iteration_end_date = this._current_iteration.get('EndDate');
        }

        var planned_velocity_adder = 0;
        var actual_velocity_adder = 0;
        var best_historical_actual_velocity = 0;
        var worst_historical_actual_velocity = this._really_big_number;

        // Assemble Actual and Planned velocity data
        // Assemble backlog data
        Ext.Array.each(this._iterations, function(iteration) {
            
            var this_end_date = iteration.get('EndDate');
            data.IterationEndDate.push(this_end_date);

            var planned_velocity = iteration.get('PlannedVelocity') || 0;
            planned_velocity_adder += planned_velocity;
            
            var backlog = me._getBacklogOnEndOfIteration(iteration);
            
            var actual_velocity = me._velocities[iteration.get('Name')] || 0;
            actual_velocity_adder += actual_velocity;
            if (actual_velocity && actual_velocity > 0) {
                if (actual_velocity > best_historical_actual_velocity) {
                    best_historical_actual_velocity = actual_velocity;
                }

                if (actual_velocity < worst_historical_actual_velocity) {
                    worst_historical_actual_velocity = actual_velocity;
                }
            }
            
            data.Name.push(iteration.get('Name'));
            data.PlannedVelocity.push(planned_velocity);
            data.ActualVelocity.push(actual_velocity);
            
            data.CumulativePlannedVelocity.push(planned_velocity_adder);
            // Show null value for Cumulative Actual Velocity for sprints that have not yet occurred
            if (this_end_date > current_iteration_end_date) {
                actual_velocity_adder = null;
            }
            data.CumulativeActualVelocity.push(actual_velocity_adder);
            data.TotalBacklog.push(backlog);

            /* --
                me._log("data as pushed:");
                me._doubleLineLog("name", iteration.get('Name'));
                me._doubleLineLog("this_end_date", this_end_date);            
                me._doubleLineLog("planned_velocity", planned_velocity);
                me._doubleLineLog("actual_velocity", actual_velocity);
                me._doubleLineLog("backlog", backlog);
            -- */

        });
        
        // Now add in Optimistic/Pessimistic projected velocity data
        var optimistic_velocity_adder = 0;
        var pessimistic_velocity_adder = 0;

        if (worst_historical_actual_velocity === this._really_big_number) { worst_historical_actual_velocity = 0;}

        Ext.Array.each(this._iterations, function(iteration) {
            pessimistic_velocity_adder += worst_historical_actual_velocity;
            optimistic_velocity_adder += best_historical_actual_velocity;
            data.OptimisticProjectedVelocity.push(optimistic_velocity_adder);
            data.PessimisticProjectedVelocity.push(pessimistic_velocity_adder);
        });

        // Add in the backlog target line
        Ext.Array.each(this._iterations, function(iteration) {
            if (me._target_backlog !== 0) {
                data.TargetBacklog.push(me._target_backlog);
            } else {
                data.TargetBacklog.push(null);
            }
        });

        return data;
    },

    _getBacklogOnEndOfIteration: function(iteration) {
        var backlog = null;
        var iteration_end = Rally.util.DateTime.toIsoString(iteration.get('EndDate'), true).replace(/T.*$/,"");
        // this._doubleLineLog("iteration_end", iteration_end);
        // this._doubleLineLog("release_flow_hash", this._release_flow_hash);
        if (this._release_flow_hash[iteration_end]) {
            backlog = this._release_flow_hash[iteration_end];
            // this._doubleLineLog("backlog", backlog);
        }
        return backlog;
    },

    // Function to find best historical sprint velocity for use in forecasting
    _findBestHistoricalActualVelocity: function() {

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
        if (!this._asynch_return_flags["story_backlog_today"]) {
            this._log("Not yet received today's story backlog");
            proceed = false;
        }
        if (!this._asynch_return_flags["defect_backlog_today"]) {
            this._log("Not yet received today's defect backlog");
            proceed = false;
        }
        return proceed;
    },

    _makeChart: function() {

        // this._doubleLineLog("this._release_flow_hash:", this._release_flow_hash)
        // this._doubleLineLog("this._velocities", this._velocities);
        if ( this._finished_all_asynchronous_calls() ) {
            if (this._iterations.length === 0) {
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
                            },
                            {
                                type: 'line',
                                data: chart_hash.OptimisticProjectedVelocity,
                                name: 'Optimistic Projected Velocity',
                                visible: true,
                                marker: {
                                    enabled: false
                                }
                            },
                            {
                                type: 'line',
                                data: chart_hash.PessimisticProjectedVelocity,
                                name: 'Pessimistic Projected Velocity',
                                visible: true,
                                marker: {
                                    enabled: false
                                }
                            },
                            {
                                type: 'line',
                                data: chart_hash.TargetBacklog,
                                name: 'Backlog Target',
                                visible: true,
                                marker: {
                                    enabled: false
                                }
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