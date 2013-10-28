var TARGETS = {
    left: 0,
    middle: 15,
    right: 5
};

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.logger(),
    targets: TARGETS,
    items: [
        {xtype:'container',itemId:'grid_box'},
        {
            xtype:'container', 
            itemId:'selector_box', 
            padding: 5, 
            tpl: 'Target increases by age: 0-6 sprints: {left}, 7-12 sprints: {middle}, >12 sprints: {right}'
        }
    ],
    
    launch: function() {
        var me = this;
        this._showTargets();
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
        
        Rally.data.ModelFactory.getModel({
            type:'Project',
            success: function(model){
                me.grid_store = Ext.create('Rally.data.custom.Store',{
                    model:model
                });
                
                me._makeGrid(me.grid_store);
            }
        })
        
        this._getTeams(this.getContext().getProject().ObjectID);
    },
    _showTargets: function() {
        this.down('#selector_box').update(this.targets);
    },
    _setSelectors: function(){
        var me = this;
        Ext.Object.each(me.targets, function(target,value){
            var selector = me.down('#'+target);
            selector.setValue(value);
            selector.on('change', function(box,new_value,old_value) {
                me.targets[target] = new_value;
                if ( me.grid ) {
                    me.logger.log(this,'update grid',me.targets);
                    
                    me.grid.show();
                }
            }, me );
        });
    },
    _getTeams: function(parent_project_oid) {
        var me = this;
        this.logger.log(this,'_getTeams',parent_project_oid);
        
        var filters = Ext.create('Rally.data.QueryFilter',{ property: 'ObjectID',value:parent_project_oid });
        var child_filters = Ext.create('Rally.data.QueryFilter',{property:'Parent.ObjectID',value:parent_project_oid});
        filters = filters.or(child_filters);
        
        Ext.create('Rally.data.WsapiDataStore',{
            model: 'Project',
            autoLoad: true,
            filters: filters,
            fetch: ['Name','ObjectID','Children:summary','Iterations:summary'],
            listeners: {
                load: function(store,records,success){
                    Ext.Array.each(records,function(record){
                        var child_info = record.get('Summary').Children;
                        if (child_info.Count === 0 ) {
                            me.grid_store.add(record);
                            me._getProjectData(record);
                        } else {
                            if ( record.get('ObjectID') !== parent_project_oid ) {
                                // recurse
                                me.logger.log(this,record.get('ObjectID'), record.get('Name'));
                                me._getTeams(record.get('ObjectID'));
                            }
                        }
                    });
                }
            }
        });
        // this._makeGrid(store);
    },
    _getProjectData:function(project){
        var iteration_info = project.get('Summary').Iterations;

        project.set('age', iteration_info.Count);
        this._getProjectVelocityData(project);
    },
    _getProjectVelocityData:function(project){
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
        var count_sprints_with_velocities = 0;
        
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
                if ( velocity > 0 ) { count_sprints_with_velocities += 1; }
                velocity_array.push(velocity);
            });
            quarter_averages.push(parseInt(Ext.Array.mean(velocity_array),10));
        });
        
                
        project.set('q0_avg',quarter_averages[0]);
        project.set('q1_avg',quarter_averages[1]);
        project.set('q2_avg',quarter_averages[2]);
        project.set('q3_avg',quarter_averages[3]);
        
        project.set('q1_percent',me._getVelocityChange(quarter_averages[0],quarter_averages[1]));
        project.set('q2_percent',me._getVelocityChange(quarter_averages[1],quarter_averages[2]));
        project.set('q3_percent',me._getVelocityChange(quarter_averages[2],quarter_averages[3]));

        project.set('age_with_velocity', count_sprints_with_velocities);

    },
    _getVelocityChange: function(first_velocity,second_velocity) {
        if ( !isNaN(first_velocity) & !isNaN(second_velocity) && first_velocity !== 0 && second_velocity !== 0 ) {
            return (second_velocity - first_velocity)/first_velocity ;
        } else {
            return "none";
        }
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
    _renderNumber: function(value,metaData){
        if (isNaN(value) || value === 0) { 
            var color = "#D0D0D0";
            metaData.style = "background-color: " + color;
            return "<div style='text-align:center;background-color:" + color + "'>&nbsp;</div>";
        } 
        return value;
    },
    _renderPercent: function(value,metaData,record,rowIndex,colIndex,store,view){
        if (isNaN(value)){
            var color = "#D0D0D0";
            metaData.style = "background-color: " + color;
            return "<div style='text-align:center;background-color:" + color + "'>&nbsp;</div>";
        } 
        
        var target_ranges = store.targets;
        var age = record.get('age');
        value = parseInt( 100 * value , 10 );
        
        var green = '#99FF99';
        var red = '#FF99CC';
        
        var color = green;
        
        if ( age <= 6 && value < target_ranges['left'] ) {
            color = red;
        } else if ( age > 6  && value < target_ranges['middle'] ) {
            color = red;
        } else if ( age > 12 && value < target_ranges['right']){
            color = red;
        }
        
        metaData.style = "background-color: " + color;

        return  value + "%";
    },
    _makeGrid: function(store) {
        var me = this;
        store.targets = me.targets;
        this.grid = this.down('#grid_box').add(Ext.create('Rally.ui.grid.Grid',{
            store: store,
            columnCfgs: [
                {text:'Name',dataIndex:'Name', flex: 1},
                {text:'Age',dataIndex:'age'},
                {text:'Q' + me.quarters[1], columns: [
                    {text:'Avg', dataIndex:'q1_avg',renderer:me._renderNumber},
                    {text:'%',   dataIndex:'q1_percent',renderer:me._renderPercent}
                ]},
                {text:'Q' + me.quarters[2], columns: [
                    {text:'Avg', dataIndex:'q2_avg',renderer:me._renderNumber},
                    {text:'%',   dataIndex:'q2_percent',renderer:me._renderPercent}
                ]},
                {text:'Q' + me.quarters[3], columns: [
                    {text:'Avg', dataIndex:'q3_avg',renderer:me._renderNumber},
                    {text:'%',   dataIndex:'q3_percent',renderer:me._renderPercent}
                ]}
            ]
        }));
    },
    _toDate : function(ds) {
        return new Date(Date.parse(ds));
    }
});
