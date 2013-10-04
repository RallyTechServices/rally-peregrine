Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.logger(),
    launch: function() {
        var me = this;
        var this_year = new Date().getFullYear();
        var this_month = new Date().getMonth();
        var this_quarter = Math.floor( (this_month+3)/3 );
        
        var this_quarter_begins = new Date(this_year, Math.floor((this_quarter-1) * 3), 1,0,0,0);
        var quarter_start = Rally.util.DateTime.add(this_quarter_begins,'year',-1);
        var quarter = this_quarter;
        
        this.quarter_starts = [];
        this.quarters = [];

        Ext.Array.each([1,2,3,4], function(x){
            quarter = quarter + 1;
            if ( quarter > 4 ) { quarter = 1 };
            
            quarter_start = Rally.util.DateTime.add(quarter_start,'month',3);
            me.quarter_starts.push(quarter_start);
            me.quarters.push(quarter);
        });
                
        this._getTeams();
    },
    items: [{xtype:'container',itemId:'grid_box'}],
    _getTeams: function() {
        var me = this;
        var project_oid = this.getContext().getProject().ObjectID;
        
        var filters = Ext.create('Rally.data.QueryFilter',{ property: 'ObjectID',value:project_oid });
        filters = filters.or(Ext.create('Rally.data.QueryFilter',{property:'Parent.ObjectID',value:project_oid}));
        
        var store = Ext.create('Rally.data.WsapiDataStore',{
            model: 'Project',
            autoLoad: true,
            filters: filters,
            listeners: {
                load: function(store,records,success){
                    Ext.Array.each(records,function(record){
                        me._getProjectData(record);
                    });
                }
            }
        });
        this._makeGrid(store);
    },
    _getProjectData:function(project){
        var me = this;

        var start_date = Rally.util.DateTime.toIsoString(this.quarter_starts[0]);
        var end_date = Rally.util.DateTime.toIsoString(new Date());
        
        var filters = [
            {property:'Iteration.EndDate',operator:'>',value:start_date},
            {property:'Iteration.EndDate',operator:'<',value:end_date},
            {property:'ScheduleState',operator:'>',value:'Completed'},
            {property:'Project.ObjectID',value:project.get('ObjectID')}
        ];
        var fetch = ['Iteration','EndDate','PlanEstimate','ObjectID','FormattedID'];
        Ext.create('Rally.data.WsapiDataStore',{
            model: 'Defect',
            filters: filters,
            fetch:fetch,
            autoLoad: true,
            listeners: {
                load: function(store,defects){
                    Ext.create('Rally.data.WsapiDataStore',{
                        model:'UserStory',
                        filters: filters,
                        fetch:fetch,
                        autoLoad: true,
                        listeners: {
                            load: function(store,stories) {
                                var work_items = Ext.Array.push(defects,stories);
                                me._calculateVelocities(project,work_items);
                            }
                        }
                    });
                }
            }
        });
    },
    _calculateVelocities: function(project,work_items){
        var me = this;
        var velocities = [{}, {}, {}, {} ];
        
        Ext.Array.each(work_items,function(work_item){
            
            var quarter_counter = me._getQuarter(work_item.get('Iteration').EndDate,me.quarter_starts);
                        
            var iteration_oid = work_item.get('Iteration').ObjectID;
            var plan_estimate = work_item.get('PlanEstimate') || 0;
            
            if ( !velocities[quarter_counter][iteration_oid] ) {
                velocities[quarter_counter][iteration_oid]  = 0;
            }
            velocities[quarter_counter][iteration_oid] += plan_estimate;
        });
                
        var quarter_averages = [];
        Ext.Array.each(velocities,function(quarter_velocities){
            var velocity_array = [];
            Ext.Object.each(quarter_velocities,function(iteration,velocity){
                velocity_array.push(velocity);
            });
            quarter_averages.push(parseInt(Ext.Array.mean(velocity_array),10));
        });
        
        project.set('q0_avg',quarter_averages[0]);
        project.set('q1_avg',quarter_averages[1]);
        project.set('q2_avg',quarter_averages[2]);
        project.set('q3_avg',quarter_averages[3]);
    },
    _getQuarter:function(end_date,quarter_starts) {
        var me = this;

        var quarter = -1;
        Ext.Array.each(quarter_starts,function(quarter_start,index){
            var iso_quarter = Rally.util.DateTime.toIsoString(quarter_start);

            if ( end_date > iso_quarter ) {
                quarter = index;
            }
        });
        
        return quarter;
    },
    _renderNumber: function(value){
        if (isNaN(value)) { 
            return "";
        } 
        return value;
    },
    _makeGrid: function(store) {
        var me = this;
        this.down('#grid_box').add(Ext.create('Rally.ui.grid.Grid',{
            store: store,
            columnCfgs: [
                {text:'Name',dataIndex:'Name', flex: 1},
                {text:'Q' + me.quarters[1], columns: [
                    {text:'Avg', dataIndex:'q1_avg',renderer:me._renderNumber},
                    {text:'%',   dataIndex:'q1_percent'}
                ]},
                {text:'Q' + me.quarters[2], columns: [
                    {text:'Avg', dataIndex:'q2_avg',renderer:me._renderNumber},
                    {text:'%',   dataIndex:'q2_percent'}
                ]},
                {text:'Q' + me.quarters[3], columns: [
                    {text:'Avg', dataIndex:'q3_avg',renderer:me._renderNumber},
                    {text:'%',   dataIndex:'q3_percent'}
                ]}
            ]
        }));
    },
    _toDate : function(ds) {
        return new Date(Date.parse(ds));
    }
});
