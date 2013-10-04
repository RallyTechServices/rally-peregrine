Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.logger(),
    launch: function() {
        this._getTeams();
    },
    items: [{xtype:'container',itemId:'grid_box'}],
    _getTeams: function() {
        var me = this;
        this.logger.log(this,this.getContext().getProject());
        var project_oid = this.getContext().getProject().ObjectID;
        
        var filters = Ext.create('Rally.data.QueryFilter',{ property: 'ObjectID',value:project_oid });
        filters = filters.or(Ext.create('Rally.data.QueryFilter',{property:'Parent.ObjectID',value:project_oid}));
        
        Ext.create('Rally.data.WsapiDataStore',{
            model: 'Project',
            autoLoad: true,
            filters: filters,
            listeners: {
                load: function(store,records,success){
                    me.logger.log(this,records);
                    me._makeGrid(store);
                }
            }
        });
        
    },
    _makeGrid: function(store) {
        this.down('#grid_box').add(Ext.create('Rally.ui.grid.Grid',{
            store: store,
            columnCfgs: [
                {text:'Name',dataIndex:'Name', flex: 1},
                {text:'Q1', columns: [
                    {text:'Avg', dataIndex:'q1_avg'},
                    {text:'%',   dataIndex:'q1_percent'}
                ]},
                {text:'Q2', columns: [
                    {text:'Avg', dataIndex:'q2_avg'},
                    {text:'%',   dataIndex:'q2_percent'}
                ]},
                {text:'Q3', columns: [
                    {text:'Avg', dataIndex:'q3_avg'},
                    {text:'%',   dataIndex:'q3_percent'}
                ]}
            ]
        }));
    },
    _toDate : function(ds) {
        return new Date(Date.parse(ds));
    }
});
