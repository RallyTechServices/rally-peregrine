Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    _iterations: [],
    _release_flow_hash: {},
    _asynch_return_flags: {},
    defaults: { padding: 10 },
    items: [
        {xtype:'container',itemId:'release_selector_box'},
        {xtype:'container',itemId:'chart_box'}
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
                change: function(rb,new_value,old_value){
                    this._asynch_return_flags = {};
                    this._findIterationsBetweenDates(rb.getRecord().get(rb.getStartDateField()),rb.getRecord().get(rb.getEndDateField()));
                    this._release = rb.getRecord();
                },
                ready: function(rb) {
                    this._asynch_return_flags = {};
                    this._findIterationsBetweenDates(rb.getRecord().get(rb.getStartDateField()),rb.getRecord().get(rb.getEndDateField()));
                    this._release = rb.getRecord();
                }
            }
        });
    },
    _findIterationsBetweenDates: function( start_date, end_date ) {
        this._log('Find iterations between ' + start_date + ' and ' + end_date );
        if ( this._chart ) { this._chart.destroy(); }
        // dates are given in JS, but we need them to be ISO
        var start_date_iso = Rally.util.DateTime.toIsoString(start_date);
        var end_date_iso = Rally.util.DateTime.toIsoString(end_date);
        
        var iteration_query = [
            {property:"StartDate",operator:">=",value:start_date_iso},
            {property:"EndDate",operator:"<=",value:end_date_iso}
        ];
        
        var iteration_store = Ext.create('Rally.data.WsapiDataStore',{
            model:'Iteration',
            autoLoad: true,
            filters: iteration_query,
            fetch:['Name','PlannedVelocity','EndDate'],
            context: { projectScopeDown: false },
            listeners:{
                scope: this,
                load: function(store,records) {
                    this._iterations = records;
                    this._findReleaseBacklogAtEachIteration();
                    this._asynch_return_flags["iterations"] = true;
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
            model:'ReleaseCumulativeFlowData',
            autoLoad:true,
            filters:release_check,
            limit: 5000,
            listeners:{
                scope:this,
                load:function(store,cards){
                    me._release_flow_hash = {}; // key is date (NOT date/time)
                    // each record is a sum of items in a particular state for the release on a given date
                    // could be 4-6 records for each day (one for each schedule state)
                    Ext.Array.each(cards,function(card){
                        var capture_date = Rally.util.DateTime.toIsoString( card.get('CreationDate') ).replace(/T.*$/,"");
                        var plan_estimate = card.get('CardEstimateTotal');
                        
                        if ( !me._release_flow_hash[capture_date] ) { me._release_flow_hash[capture_date] = 0; }
                        me._release_flow_hash[capture_date] += plan_estimate;
                    });
                    me._log(me._release_flow_hash);
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
        return proceed;
    },
    _makeChart: function() {
        if ( this._finished_all_asynchronous_calls() ) {
            if (this._iterations.length == 0) {
                this._chart = this.down('#chart_box').add({
                    xtype:'container',
                    html:'No iterations defined in the release bounds...'
                });
            } else {
                var chart_hash = this._assembleSprintData();
                
                this._log(chart_hash);
                this._chart = this.down('#chart_box').add({
                    xtype: 'rallychart',
                    chartData: {
                        categories: chart_hash.Name,
                        series: [
                            {type:'line',data:chart_hash.CumulativePlannedVelocity,name:'Planned Velocity',visible:true},
                            {type:'line',data:chart_hash.TotalBacklog,name:'Total Backlog',visible:true}
                        ]
                    },
                    height: 350,
                    chartConfig: {
                        chart: {},
                        title: {text:'LPC',align:'center'},
                        yAxis:[{title:{text:""},min:0}]
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
            CumulativePlannedVelocity: []
        }
        var planned_velocity_adder = 0;
        Ext.Array.each(this._iterations,function(iteration){
            
            var planned_velocity = iteration.get('PlannedVelocity') || 0;
            planned_velocity_adder += planned_velocity;
            
            var backlog = me._getBacklogOnEndOfIteration(iteration);

            data.Name.push(iteration.get('Name'));
            data.PlannedVelocity.push(planned_velocity);
            data.CumulativePlannedVelocity.push(planned_velocity_adder);
            data.TotalBacklog.push(backlog);
            
        });
        return data;
    },
    _getBacklogOnEndOfIteration:function(iteration){
        var backlog = null;
        var iteration_end = Rally.util.DateTime.toIsoString(iteration.get('EndDate')).replace(/T.*$/,"");
        if (this._release_flow_hash[iteration_end]) {
            backlog = this._release_flow_hash[iteration_end];
        }
        return backlog;
    },
    _log: function(msg) {
        window.console && console.log(msg);
    }
});
