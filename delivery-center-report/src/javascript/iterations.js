

function addIterationTimeBox (app) {
    var timeboxScope = app.getContext().getTimeboxScope();
    if(timeboxScope) {
        var record = timeboxScope.getRecord();
        var name = record.get('Name');
        app.iterationSelected(name);
    } else {
        var container = Ext.create('Ext.container.Container', {
            itemId : 'iterationDropDown',
            columnWidth : 2
        });
        app.add( container );
        // add the iteration dropdown selector
        app.down("#iterationDropDown").add( {
            xtype: 'rallyiterationcombobox',
            itemId : 'iterationSelector',
            listeners: {
                    select: function(a,b,c) {
                        this.iterationSelected(b[0].get("Name"));
                    },
                    scope : app
            }
        });
    }
}

function getIterations(app) {
    
    Ext.create('Rally.data.WsapiDataStore', {
        limit : 'Infinity',
        autoLoad : true,
        model: 'Iteration',
        context: { project: null },
        listeners: {
            load: function(store, data, success) {
                //this.processIterations(data);
                this.leafNodeProjectIterations(data);
            },
            scope : app
        },
        fetch: ['Name', 'Project', 'ObjectID','PlannedVelocity','StartDate','EndDate']
    });
    
}
