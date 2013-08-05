Ext.override(Rally.ui.chart.Chart,{
    onRender: function () {
        this.callParent(arguments);
        this._unmask();
    }
});