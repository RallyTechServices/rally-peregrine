
var    FIELD_DELIVERY_SATISFACTION = "Deliverysatisfactionscore110";
var    FIELD_REMARKS = "c_Managementinformationrequest";
var    FIELD_STATUS = "Teamstatus";

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
    },
    
    processIterations : function(data) {
        var that = this;
        var today = new Date();

        var projectIterations = _.groupBy(data, function(iteration) {
            var project = iteration.get("Project");
            var name = project.Name;
            return name;
        });
        
        _.each( _.keys(projectIterations), function(key) {
            //console.log("team",key);
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

            async.map(iterations, that.getIterationWorkItems, function(err,work_items){
                // console.log("results",results);
                async.map(iterations,that.getSpecialStory,function(err,special_stories){
                  that.processWorkItems(key,iterations,work_items,special_stories);
                });
            });
            
//            async.map(iterations, that.getIterationResults, function(err,results){
//                // console.log("results",results);
//                // that.process(key,iterations,results);
//                async.map(iterations,that.getSpecialStory,function(err,stories){
//                  that.processCFD(key,iterations,results,stories);
//                });
//            });
        });

    },
    
    // The 'special' story is one which is in the iteration with a parent named
    // 'Iteration Reporting Parent'
    
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
                    property: 'Parent.Name',
                    operator : "contains",
                    value: 'Iteration Reporting Parent'
                }
            ],
            listeners: {
                load: function(store, data, success) {
                    console.log(data);
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
            fetch: ['FormattedID', 'Name', 'PlanEstimate',
            'ScheduleState','CreationDate',
            FIELD_DELIVERY_SATISFACTION, 
            FIELD_REMARKS, 
            FIELD_STATUS]
        });
        
    },

    getIterationWorkItems: function(iteration,callback){
        var that = this;
        Ext.create('Rally.data.WsapiDataStore',{
            limit:'Infinity',
            autoLoad: true,
            model:'UserStory',
            filters:[{
                property: 'Iteration.ObjectID',
                operator : "=",
                value: iteration.get("ObjectID")
            }],
            listeners: {
                load: function(store,stories,success){
                    Ext.create('Rally.data.WsapiDataStore',{
                        limit:'Infinity',
                        autoLoad: true,
                        model:'Defect',
                        filters:[{
                            property: 'Iteration.ObjectID',
                            operator : "=",
                            value: iteration.get("ObjectID")
                        }],
                        listeners:{
                            load: function(store,defects,success){
                                var items = Ext.Array.push(stories,defects);
                                callback(null,items);
                            },
                            scope: this
                        }
                    });
                },
                scope: this
            }
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
    
    sumCFDForState : function(cfdRecs,state) {
        var recs = state == "*" ? cfdRecs :
            _.filter(cfdRecs, function(cfd) {
               return cfd.get("CardState")==state;
            }) ;
            
        var sum = _.reduce( recs, function(memo,cfd) { return memo + cfd.get("CardEstimateTotal");},0);
        return sum;
    },
    
        
    sumWIForState : function(items,state) {
        var recs = state == "*" ? items :
            _.filter(items, function(item) {
               return item.get("ScheduleState")==state;
            }) ;
            
        var sum = _.reduce( recs, function(memo,item) { return memo + item.get("PlanEstimate");},0);
        return sum;
    },
    
    countWIForState : function(items,state) {
        var recs = state == "*" ? items :
            _.filter(items, function(item) {
               return item.get("ScheduleState")==state;
            }) ;
            
        var count = recs.length;
        return count;
    },
    
    countCFDForState : function(cfdRecs,state) {
        var recs = state == "*" ? cfdRecs :
            _.filter(cfdRecs, function(cfd) {
               return cfd.get("ScheduleState")==state;
            }) ;
            
        var count = _.reduce( recs, function(memo,cfd) { return memo + cfdRecs.get("CardEstimateTotal");},0);
        return count;
    },
    processWorkItems: function(team,iterations,work_items,special_stories){
        var that = this;
        
        _.each(iterations,function(iteration,index) {
            var iteration_work_items = work_items[index];
            
            var accepted = that.sumWIForState(iteration_work_items,"Accepted");
            //var completed = that.sumWIForState(iteration_work_items,"Completed");
            var completed = accepted + that.sumWIForState(iteration_work_items,"Completed");
            var backlog = that.sumWIForState(iteration_work_items,"Backlog");
            var defined = that.sumWIForState(iteration_work_items,"Defined");
            var inprogress = that.sumWIForState(iteration_work_items,"In-Progress");
            var total = that.sumWIForState(iteration_work_items,"*");
            var totalCount = that.countWIForState(iteration_work_items,"*");
            var acceptedCount = that.countWIForState(iteration_work_items,"Accepted");
            //var completedCount = that.countWIForState(iteration_work_items,"Completed");
            var completedCount = acceptedCount + that.countWIForState(iteration_work_items,"Completed");
            
            var specialStory = special_stories[index] !== null && special_stories[index].length > 0 ? special_stories[index][0] : null;
            
            var plannedVelocity = iteration.get("PlannedVelocity");
            //var velocityUtilization = plannedVelocity > 0 ? Math.round((total / plannedVelocity) * 100) : 0;
            var velocityUtilization = plannedVelocity > 0 ? Math.round((accepted / total) * 100) : 0;
            //console.log("pv",plannedVelocity);
            
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
                        status          : specialStory !== null ? specialStory.get(FIELD_STATUS) : "",
                        accepted        : accepted,
                        velocityUtilization : velocityUtilization
            };
            that.rows.push(row);
            that.store.load();
            
        });
    },
    
    // Team Name, Iteration Name, Total Points, Completed Count, Accepted Count, Planned Velocity, Velocity
    // Del Sat, Rem, Status
    
    processCFD : function( team, iterations, cfd_records, stories) {
        var that = this;
        //console.log("stories",stories);
        
        _.each(iterations,function(iteration,x) {
            // group the cumulative flow records by creation date (we want to get the last da)
            var gcfd = _.groupBy(cfd_records[x],function(cfd){return cfd.get("CreationDate");});
            // get records for the last day
            var lcfd = gcfd[ _.last(_.keys(gcfd))];
            // sum by state
            
            var completed = that.sumCFDForState(lcfd,"Completed");
            var accepted = that.sumCFDForState(lcfd,"Accepted");
            var backlog = that.sumCFDForState(lcfd,"Backlog");
            var defined = that.sumCFDForState(lcfd,"Defined");
            var inprogress = that.sumCFDForState(lcfd,"In-Progress");
            var total = that.sumCFDForState(lcfd,"*");
            var totalCount = that.countCFDForState(lcfd,"*");
            var acceptedCount = that.countCFDForState(lcfd,"Accepted");
            var completedCount = that.countCFDForState(lcfd,"Completed");
            
            //console.log(team,iteration.get("Name"),cfd_records[x].length,totalCount,total,backlog,defined,inprogress,completed,accepted);
            
            var specialStory = stories[x] !== null && stories[x].length > 0 ? stories[x][0] : null;
            
            var plannedVelocity = iteration.get("PlannedVelocity");
            var velocityUtilization = plannedVelocity > 0 ? Math.round((total / plannedVelocity) * 100) : 0;
            //console.log("pv",plannedVelocity);
            
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
                        status          : specialStory !== null ? specialStory.get(FIELD_STATUS) : "",
                        accepted        : accepted,
                        velocityUtilization : velocityUtilization
            };
            that.rows.push(row);
            that.store.load();
        });
    },
    
    showTable : function() {

        var me = this;
        this.store = Ext.create('Rally.data.custom.Store', {
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
                    { name : "status",         type : "string"},
                    { name : "accepted",           type : "number"},
                    { name : "velocityUtilization",type : "number"}
            ],
            data : this.rows
        });

        // create the grid
        this.grid = Ext.create('Rally.ui.grid.Grid', {
            // title: 'Defect Density',
            store: this.store,
            height: me.getHeight(),
            columnCfgs: [
                { text : 'Team',           dataIndex: 'team'},
                { text : "Iteration",      dataIndex : "iteration", flex: 1.1 },
                { text : "User Stories Completed",    dataIndex : "completedCount",   align : "center"}, 
                { text : "User Stories Accepted",     dataIndex : "acceptedCount",    align : "center"}, 
                { text : "Planned Story Points",   dataIndex : "totalPoints",      align : "center"}, 
                { text : "Target Velocity",dataIndex : "plannedVelocity",  align : "center"},
                { text : "Accepted Points",dataIndex : "accepted",  align : "center"}, 
                { text : "Target <br/>Utilization (%)",       dataIndex : "velocity",         align : "center", renderer: this.renderVelocity }, 
                { text : "Velocity (%)",dataIndex : "velocityUtilization",  align : "center"}, 
                { text : "Delivery Satisfaction",dataIndex : "deliverySatisfaction", align : "center", renderer: this.renderSatisfaction}, 
                { text : "Management information/request", dataIndex : "remarks", align : "center", tdCls: 'wrap', flex: 1}, 
                { text : "Status",         dataIndex : "status",           align : "center", renderer: this.renderStatus } 
            ]
        });
        // add it to the app
        this.add(this.grid);    
    },
    
    renderVelocity : function( value, meta ) {
        if (value < 80) { 
            meta.style = 'background-color:red;color:white;'; 
            return value; 
        } else {
            meta.style = 'background-color:green;color:white;'; 
            return value; 
        }
    },
    
    renderStatus : function( value, meta ) {
        if (value == "Green") { 
            meta.style = 'background-color:green;color:white;'; 
            return value; 
        }
        if (value == "Red") {
            meta.style = 'background-color:red;color:white'; 
            return value; 
        }
        if (value == "Yellow") {
            meta.style = 'background-color:yellow'; 
            return value; 
        }
    },
    
    renderSatisfaction : function( value, meta ) {
        if (value >= 1 && value <= 7) { 
            meta.style = 'background-color:red;color:white;'; 
            return value; 
        } else 
            if (value > 7)
            {
                meta.style = 'background-color:green;color:white'; 
                return value; 
            }
    }

});
