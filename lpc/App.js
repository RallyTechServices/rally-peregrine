Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    _debug: true,
    _release_combo_box: null,
    _target_backlog_number_box: null,
    _release: null,
    _iterations: [],
    _current_iteration: null,
    _current_iteration_index: null,
    _release_flow_hash: {},
    _asynch_return_flags: {},
    _velocities: {},
    _trend_data: {},
    _target_backlog: 0,
    _really_big_number: 1000000000000,
    _chart_data: null,
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
        this.down('#selector_box').add(this._release_combo_box);
    },

    _addTargetBacklogBox: function() {
        var me = this;

        me._target_backlog_number_box = Ext.create('Rally.ui.NumberField', {
            xtype: 'rallynumberfield',
            fieldLabel: 'Target Backlog (Story Points)',
            value: 0.0
        });

        this.down('#selector_box').add(me._target_backlog_number_box);
        this.down('#selector_box').add({
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
        var me = this;
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
                    var current_iteration = records[0];

                    var this_release = this._release;
                    var this_release_date = this_release.get('ReleaseDate');
                    var current_iteration_end_date;
                    if (current_iteration) {
                        current_iteration_end_date = current_iteration.get('EndDate');

                        // If we're past the ReleaseDate, then pick the last iteration in the
                        // selected Release to be the "current" iteration.
                        if (current_iteration_end_date > this_release_date) {
                            current_iteration = me._iterations[me._iterations.length-1];
                        }
                    } else {
                        // Current iteration not found. This can happen if we're between iterations
                        // within our current release (like on a weekend). Find the closest
                        // iteration to "now".
                        var today = new Date().getTime();
                        // Times are in milliseconds - use our really big number to make
                        // sure we get a difference less than our "infinity"
                        var min_time_delta = this._really_big_number;
                        var closest_iteration;
                        Ext.Array.each(me._iterations, function(iteration) {
                            var this_iteration_end_date = iteration.get('EndDate');
                            var time_delta = Math.abs(this_iteration_end_date.getTime() - today);
                            if (time_delta < min_time_delta) {
                                closest_iteration = iteration;
                                min_time_delta = time_delta;
                            }
                        });
                        current_iteration = closest_iteration;
                        current_iteration_end_date = current_iteration.get('EndDate');
                    }

                    me._current_iteration = current_iteration;

                    // Calculate array index of current_iteration
                    var index = 0;
                    var index_of_current = 0;
                    Ext.Array.each(me._iterations, function(iteration) {
                        var this_iteration_end_date = iteration.get('EndDate');
                        if (this_iteration_end_date === current_iteration_end_date) {
                            index_of_current = index;
                        }
                        index++;
                    });
                    me._current_iteration_index = index_of_current;
                    /* --
                    console.log('me._current_iteration: ', me._current_iteration);
                    console.log('me.current_iteration_index: ', me._current_iteration_index);
                    -- */

                    me._asynch_return_flags["current_iteration"] = true;
                    me._findTodaysReleaseBacklog();
                    me._makeChart();
                }
            }
        });

    },

    _findIterationsBetweenDates: function(  ) {
        
        var me = this;

        if ( this._chart ) {
            this._chart.destroy();
        }

        // Initialize release flow hash
        this._release_flow_hash = {}; // key is date (NOT date/time)

        // dates are given in JS, but we need them to be ISO
        // Rally.util.DateTime.toIsoString(date, true); will return a date in UTC
        var start_date_iso = Rally.util.DateTime.toIsoString(this._release.get('ReleaseStartDate'), true);
        var end_date_iso = Rally.util.DateTime.toIsoString(this._release.get('ReleaseDate'), true);
        this._log('Find iterations between ' + start_date_iso + ' and ' + end_date_iso );

        var iteration_query = [
            { property: "StartDate", operator:">=", value: start_date_iso },
            { property: "EndDate", operator:"<=", value: end_date_iso }
        ];
        
        var iteration_store = Ext.create('Rally.data.WsapiDataStore',{
            model: 'Iteration',
            autoLoad: true,
            filters: iteration_query,
            sorters: [
                {
                    property: 'EndDate',
                    direction: 'ASC'
                }
            ],
            fetch: ['Name','PlannedVelocity','EndDate'],
            context: { projectScopeDown: false },
            listeners: {
                scope: this,
                load: function(store, records) {
                    me._iterations = records;
                    console.log('me._iterations: ', me._iterations);
                    if (me._iterations.length > 0) {
                        me._asynch_return_flags["iterations"] = true;
                        me._findReleaseBacklogAtEachIteration();
                        me._findAcceptedItemsInEachIteration();
                        me._findCurrentIteration();
                        me._makeChart();
                    } else {
                        me._noIterationsNotify();
                    }
                }
            }
        });
    },

    _findAcceptedItemsInEachIteration: function() {
        var me = this;

        console.log("_findAcceptedItemsInEachIteration: me._iterations: ", me._iterations);

        var iteration_query = [
            { property: "ScheduleState", operator: ">=", value: "Accepted" },
            { property: "Release.Name", operator: "=", value: this._release.get("Name") }
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
                    Ext.Array.each(records, function(record) {
                        if ( record.get('Iteration') ) {
                            var iteration_name = record.get('Iteration').Name;
                            if ( record.get('PlanEstimate') ) {
                                if (typeof(me._velocities[iteration_name]) == 'undefined') {
                                    console.log("clearing velocity for " + iteration_name);
                                    me._velocities[iteration_name] = 0;
                                }
                                me._velocities[iteration_name] += parseInt(record.get('PlanEstimate'), 10);
                            }
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
                        if ( record.get('Iteration') ) {
                            var iteration_name = record.get('Iteration').Name;
                            if ( record.get('PlanEstimate') ) {
                                if (typeof(me._velocities[iteration_name]) == 'undefined') {
                                    me._log("clearing velocity for " + iteration_name);
                                    me._velocities[iteration_name] = 0;
                                }
                                me._velocities[iteration_name] += parseInt(record.get('PlanEstimate'), 10);
                            }
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
            ProjectedFinishOptimisticIndex: -1,
            ProjectedFinishPessimisticIndex: -1,
            MostRecentBacklog: 0,
            BestHistoricalActualVelocity: 0,
            WorstHistoricalActualVelocity: 0
        };

        // Get timebox info
        var current_iteration = this._current_iteration;
        var current_iteration_end_date;

        var current_release = this._release;
        var release_date = current_release.get('ReleaseDate');

        var today = new Date();

        if (current_iteration) {
            current_iteration_end_date = this._current_iteration.get('EndDate');
        }

        var planned_velocity_adder = 0;
        var actual_velocity_adder = 0;
        var best_historical_actual_velocity = 0;
        var worst_historical_actual_velocity = this._really_big_number;
        var most_recent_backlog = 0;

        // Assemble Actual and Planned velocity data
        // Assemble backlog data

        // Number of historical iterations in data set
        var number_iterations = me._iterations.length;
        var iteration_index = 0;
        var current_iteration_index = me._current_iteration_index;

        Ext.Array.each(me._iterations, function(iteration) {
            
            var this_end_date = iteration.get('EndDate');
            data.IterationEndDate.push(this_end_date);

            var backlog = me._getBacklogOnEndOfIteration(iteration);
            if (backlog) {
                most_recent_backlog = backlog;
            }
            data.TotalBacklog.push(backlog);

            var planned_velocity = iteration.get('PlannedVelocity') || 0;
            planned_velocity_adder += planned_velocity;
            
            var actual_velocity = me._velocities[iteration.get('Name')] || 0;
            actual_velocity_adder += actual_velocity;

            // Only consider data from most recent three iterations if at least three
            // If we have less than 3 completed iterations, consider all data
            if (current_iteration_index - iteration_index < 3 || current_iteration_index < 3) {
                if (actual_velocity && actual_velocity > 0) {
                    if (actual_velocity > best_historical_actual_velocity) {
                        best_historical_actual_velocity = actual_velocity;
                    }
                    if (actual_velocity < worst_historical_actual_velocity) {
                        worst_historical_actual_velocity = actual_velocity;
                    }
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

            iteration_index++;

        });

        if (worst_historical_actual_velocity === this._really_big_number) {
            worst_historical_actual_velocity = 0;
        }

        data.MostRecentBacklog = most_recent_backlog;
        data.BestHistoricalActualVelocity = best_historical_actual_velocity;
        data.WorstHistoricalActualVelocity = worst_historical_actual_velocity;

        me._chart_data = data;
    },

    _assembleProjectedData: function() {

        var me = this;
        var data = this._chart_data;

        // Get timebox info
        var current_iteration = this._current_iteration;
        var current_iteration_end_date;

        var current_release = this._release;
        var release_date = current_release.get('ReleaseDate');

        var today = new Date();

        if (current_iteration) {
            current_iteration_end_date = this._current_iteration.get('EndDate');
        }

        // Add in the backlog target line and projected finish lines
        if (me._target_backlog === 0) {
            console.log("MRB", data.MostRecentBacklog);
            me._target_backlog = data.MostRecentBacklog;
            me._target_backlog_number_box.setValue(data.MostRecentBacklog);
        }

        // Calculate projected finish based on optimistic/pessimistic velocities
        var number_sprints_optimistic = Math.floor(me._target_backlog/data.BestHistoricalActualVelocity);
        var number_sprints_pessimistic = Math.floor(me._target_backlog/data.WorstHistoricalActualVelocity);

        console.log('number_sprints_optimistic: ', number_sprints_optimistic);
        console.log('number_sprints_pessimistic: ', number_sprints_pessimistic);

        data.ProjectedFinishOptimisticIndex = number_sprints_optimistic;
        data.ProjectedFinishPessimisticIndex = number_sprints_pessimistic;

        // If projections extend past our Release date, we need to
        // "pad" the data with fake iterations to plot projection
        var number_iterations_in_release = this._iterations.length;
        if (number_sprints_pessimistic > number_iterations_in_release) {

            var extra_sprints = number_sprints_pessimistic - number_iterations_in_release;

            var ending_cumulative_planned_velocity = data.CumulativePlannedVelocity[number_iterations_in_release-1];
            var ending_planned_velocity = data.PlannedVelocity[number_iterations_in_release-1];
            var planned_velocity_adder = ending_cumulative_planned_velocity;

            var sprint_base_name = "Release + ";

            for (var i=0; i<=extra_sprints; i++) {
                var new_sprint_name = sprint_base_name + (i + 1);
                planned_velocity_adder += ending_planned_velocity;
                data.Name.push(new_sprint_name);
                data.TotalBacklog.push(null);
                data.PlannedVelocity.push(ending_planned_velocity);
                data.ActualVelocity.push(null);
                data.CumulativeActualVelocity.push(null);
                data.CumulativePlannedVelocity.push(planned_velocity_adder);
            }
        }

        // Now add in Optimistic/Pessimistic projected velocity data
        var optimistic_velocity_adder = 0;
        var pessimistic_velocity_adder = 0;

        Ext.Array.each(data.Name, function(iteration_name) {
            pessimistic_velocity_adder += data.WorstHistoricalActualVelocity;
            optimistic_velocity_adder += data.BestHistoricalActualVelocity;

            // Only show projections if we haven't released
            if (today < release_date) {
                data.OptimisticProjectedVelocity.push(optimistic_velocity_adder);
                data.PessimisticProjectedVelocity.push(pessimistic_velocity_adder);
            } else {
                data.OptimisticProjectedVelocity.push(null);
                data.PessimisticProjectedVelocity.push(null);
            }
        });

        me._chart_data = data;
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
                this._assembleSprintData();
                this._assembleProjectedData();

                var chart_hash = this._chart_data;
                
                this._log(chart_hash);
                this._chart = this.down('#chart_box').add({
                    xtype: 'rallychart',
                    chartData: {
                        categories: chart_hash.Name,
                        
                        series: [
                            {
                                type: 'column',
                                data: chart_hash.CumulativePlannedVelocity,
                                name: 'Planned Velocity',
                                visible: true
                            },
                            /* --
                            {
                                type: 'line',
                                data: chart_hash.TotalBacklog,
                                name: 'Total Backlog',
                                visible: true
                            },
                            -- */
                            {
                                type: 'column',
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
                                visible: false,
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
                        yAxis: [{
                            plotLines: [
                                {
                                    color: '#000',
                                    width: 2,
                                    value: this._target_backlog
                                }
                            ]
                        }],
                        xAxis: [{
                            categories: chart_hash.Name,
                            plotLines: [
                                {
                                    color: '#a00',
                                    width: 2,
                                    value: chart_hash.ProjectedFinishPessimisticIndex,
                                    label: {
                                        text: 'Pessimistic Projected Finish',
                                        style: {
                                            color: '#a00'
                                        }
                                    }
                                },
                                {
                                    color: '#0a0',
                                    width: 2,
                                    value: chart_hash.ProjectedFinishOptimisticIndex,
                                    label: {
                                        text: 'Optimistic Projected Finish',
                                        style: {
                                            color: '#0a0'
                                        }
                                    }
                                }
                            ]
                        }]
                    }
                });
            }
        }
    },

    _noIterationsNotify: function() {
        this._chart = this.down('#chart_box').add({
            html: "No Iterations Defined for Release at this Scoping."
        });
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