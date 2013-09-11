//     <script type="text/javascript" src="//cdnjs.cloudflare.com/ajax/libs/async/0.2.7/async.min.js"></script>

var FIELD_DELIVERY_SATISFACTION = "DeliverySatisfaction";
var FIELD_REMARKS               = "Remarks";
var FIELD_STATUS                = "Status";

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {
        // addIterationTimeBox(this);
        this.rows = [];
        this.showTable();
        getIterations(this);
    },
    
    iterationSelected : function(name) {
        console.log(name);
    },
    
    _toDate : function(ds) {
        return new Date(Date.parse(ds));
    },
    
    iterations : function(data) {
        var that = this;
        var today = new Date();
        console.log("iterations",data.length);

        var projectIterations = _.groupBy(data, function(iteration) {
            var project = iteration.get("Project");
            var name = project.Name;
            return name;
        });
        
        _.each( _.keys(projectIterations), function(key) {
            console.log("team",key);
            var iterations = projectIterations[key];
            // filter to just those ones ended before today
            iterations = _.filter(iterations, function(iteration) {
                var enddate = that._toDate(iteration.get("EndDate"));
                return( enddate < today );
            });
            
            // now sort descending by enddate
            iterations = _.sortBy(iterations, function(iteration) {
                return that._toDate(iteration.get("EndDate"));
            });
            // we only want the last 3
            iterations = iterations.length <= 3 ? iterations :
                iterations.slice(-3);
            
            // finally reverse so the latest is at the top.
            iterations = iterations.reverse();

            var iterationIds = _.pluck(iterations,function(i){return i.get("ObjectID");});
            
            async.map(iterations, that.getIterationResults, function(err,results){
                // console.log("results",results);
                // that.process(key,iterations,results);
                async.map(iterations,that.getSpecialStory,function(err,stories){
                  that.process(key,iterations,results,stories);
                });
            });
        });

    },
    
    getSpecialStory : function( iteration, callback) {
        var that = this;
        Ext.create('Rally.data.WsapiDataStore', {
            limit : 'Infinity',
            autoLoad : true,
            model: 'HierarchicalRequirement',
            filters: [
                {
                    property: 'Iteration.ObjectID',
                    operator : "=",
                    value: iteration.get("ObjectID")
                },
                {
                    property: 'Tags.Name',
                    operator : "contains",
                    value: 'Special'
                }
            ],
            listeners: {
                load: function(store, data, success) {
                    callback(null,data);
                },
                scope : that
            },
            sorters: [
                {
                    property: 'CreationDate',
                    direction: 'ASC'
                }
            ],
            fetch: ['FormattedID', 'Name', 'PlanEstimate','ScheduleState','CreationDate']
        });
        
    },

    getIterationResults : function(iteration,callback) {
        var that = this;
        Ext.create('Rally.data.WsapiDataStore', {
            limit : 'Infinity',
            autoLoad : true,
            model: 'IterationCumulativeFlowData',
            filters: [
            {
                property: 'IterationObjectID',
                operator : "=",
                value: iteration.get("ObjectID")
            }
            ],
            listeners: {
                load: function(store, data, success) {
                    callback(null,data);
                },
                scope : that
            },
            sorters: [
                {
                    property: 'CreationDate',
                    direction: 'ASC'
                }
            ],
            fetch: ['IterationObjectID', 'CardCount', 'CardEstimateTotal','CardState','CreationDate']
        });
    },
    
    sumForState : function(cfdRecs,state) {
        var recs = state == "*" ? cfdRecs :
            _.filter(cfdRecs, function(cfd) {
               return cfd.get("CardState")==state;
            }) ;
            
        var sum = _.reduce( recs, function(memo,cfd) { return memo + cfd.get("CardEstimateTotal");},0);
        return sum;
    },
    
    countForState : function(cfdRecs,state) {
        var recs = state == "*" ? cfdRecs :
            _.filter(cfdRecs, function(cfd) {
               return cfd.get("CardState")==state;
            }) ;
            
        var count = _.reduce( recs, function(memo,cfd) { return memo + cfd.get("CardCount");},0);
        return count;
    },

    
    // Team Name, Iteration Name, Total Points, Completed Count, Accepted Count, Planned Velocity, Velocity
    // Del Sat, Rem, Status

    process : function( team, iterations, results, stories) {
        var that = this;
        console.log("stories",stories);
        
        _.each(iterations,function(iteration,x) {
            // group the cumulative flow records by creation date (we want to get the last da)
            var gcfd = _.groupBy(results[x],function(cfd){return cfd.get("CreationDate");});
            // get records for the last day
            var lcfd = gcfd[ _.last(_.keys(gcfd))];
            // sum by state
            
            var completed = that.sumForState(lcfd,"Completed");
            var accepted = that.sumForState(lcfd,"Accepted");
            var backlog = that.sumForState(lcfd,"Backlog");
            var defined = that.sumForState(lcfd,"Defined");
            var inprogress = that.sumForState(lcfd,"In-Progress");
            var total = that.sumForState(lcfd,"*");
            var totalCount = that.countForState(lcfd,"*");
            var acceptedCount = that.countForState(lcfd,"Accepted");
            var completedCount = that.countForState(lcfd,"Completed");
            
            console.log(team,iteration.get("Name"),results[x].length,totalCount,total,backlog,defined,inprogress,completed,accepted);
            
            var specialStory = stories[x] !== null && stories[x].length > 0 ? stories[x][0] : null;
            
            var plannedVelocity = iteration.get("PlannedVelocity");
            console.log("pv",plannedVelocity);
            
            // add a row for each team, iteration combination
            var row = { team            : team, 
                        iteration       : iteration.get("Name"), 
                        totalPoints     : total, 
                        completedCount  : completedCount,
                        plannedVelocity : plannedVelocity, 
                        acceptedCount   : acceptedCount,
                        velocity        : plannedVelocity > 0 ? Math.round(( accepted / plannedVelocity ) * 100) : 0,
                        deliverySatisfaction : specialStory !== null ? specialStory.get(FIELD_DELIVERY_SATISFACTION) : "",
                        remarks         : specialStory !== null ? specialStory.get(FIELD_REMARKS) : "",
                        status          : specialStory !== null ? specialStory.get(FIELD_STATUS) : ""
            };
            that.rows.push(row);
            that.store.load();
        });
    },
    
    showTable : function() {
        console.log("rows",this.rows);
        // a store from the array of items
        this.store = Ext.create('Ext.data.Store', {
            fields: [
                    { name : "team" ,          type : "string"},
                    { name : "iteration" ,     type : "string"},
                    { name : "totalPoints",    type : "number"}, 
                    { name : "completedCount", type  : "number"},
                    { name : "plannedVelocity",type : "number"}, 
                    { name : "acceptedCount",  type : "number"},
                    { name : "velocity",       type : "number"},
                    { name : "deliverySatisfaction", type : "string"},
                    { name : "remarks",        type : "string"},
                    { name : "status",         type : "string"}
            ],
            data : this.rows
        });

        // create the grid
        this.grid = Ext.create('Ext.grid.Panel', {
            // title: 'Defect Density',
            store: this.store,
            columns: [
                { header : 'Team',           dataIndex: 'team'},
                { header : "Iteration",      dataIndex : "iteration"       },
                { header : "Story Points",   dataIndex : "totalPoints",      align : "center"}, 
                { header : "# Completed",    dataIndex : "completedCount",   align : "center"}, 
                { header : "Target Velocity",dataIndex : "plannedVelocity",  align : "center"}, 
                { header : "# Accepted",     dataIndex : "acceptedCount",    align : "center"}, 
                { header : "Velocity",       dataIndex : "velocity",         align : "center"}, 
                { header : "Delivery Satisfaction",dataIndex : "deliverySatisfaction", align : "center"}, 
                { header : "Remarks",        dataIndex : "remarks",          align : "center"}, 
                { header : "Status",         dataIndex : "status",           align : "center"}, 
            ]
        });
        
        // add it to the app
        this.add(this.grid);    
    }

});
