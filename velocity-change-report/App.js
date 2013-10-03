Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {
        this.rows = [];
        this.showTable();
        getIterations(this);
    },
    
    _toDate : function(ds) {
        return new Date(Date.parse(ds));
    }
});
