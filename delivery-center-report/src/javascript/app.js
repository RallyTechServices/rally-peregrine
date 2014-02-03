var    FIELD_DELIVERY_SATISFACTION = "Deliverysatisfactionscore110";
var    FIELD_REMARKS = "c_Managementinformationrequest";
var    FIELD_STATUS = "Teamstatus";
var	   FIELD_LPC_VELOCITY = "LPCVelocity";
var    FIELD_TEAM_LIFECYCLE = "TeamLifecycle";
var	   TEAM_LIFECYCLE_TO_HIDE = ["Temporary", "Not Started", "Inactive"];
var    THRESHOLD_VELOCITY = 80;
var    THRESHOLD_SATISFACTION = 7;

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    
    logger: new Rally.technicalservices.Logger(),
    // Title/version
    title: 'Delivery Center Status Report',
    version: '0.50',

    launch: function() {
        this.logger.log("launch");
        this.rows = [];
        this.showTable();
        getIterations(this);
    },
    
    _toDate : function(ds) {
        return new Date(Date.parse(ds));
    },
    
    leafNodeProjectIterations : function(iterations) {
        var that = this;
        var projectOids = _.pluck(iterations,function(i) { return i.get("Project").ObjectID;});
        projectOids = _.uniq(projectOids);
        async.map(projectOids, that.readProject, function(err,projects){
            // filter the iterations to just those with no children
            iterations = _.filter(iterations,function(i) {
                // find the project associated with this iteration
                var p = _.find(projects,function(project) { return project.get("ObjectID")==i.get("Project").ObjectID;});
                return p.get("Children") == null || p.get("Children").Count == 0;
            });
            // iterations = _.sortBy(iterations, function(i) {return i.get("Name");});
            that.processIterations(iterations);
        });
    },
    
    processIterations : function(data) {
        var that = this;
        var today = new Date();

        var projectIterations = _.groupBy(data, function(iteration) {
            var project = iteration.get("Project");
            var name = project.Name;
            return name;
        });
        
        var keys = _.keys(projectIterations); // iteration names.
        keys = _.sortBy(keys,function(k) {return k;});
        this.logger.log("keys",keys);
        
        _.each( keys, function(key) {
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
                async.map(iterations,that.getSpecialStory,function(err,special_stories){
                  that.processWorkItems(key,iterations,work_items,special_stories);
                });
                // that.store.load();
            });
            
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
            FIELD_STATUS,
            FIELD_LPC_VELOCITY, 
            FIELD_TEAM_LIFECYCLE]
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
    
    readProject : function(pOid,callback){
        var that = this;
        Ext.create('Rally.data.WsapiDataStore',{
            limit:'Infinity',
            autoLoad: true,
            fetch : true,
            model:'Project',
            filters:[{
                property: 'ObjectID',
                operator : "=",
                value: pOid
            }],
            listeners: {
                load: function(store,projects,success){
                    callback(null,projects[0]);
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
            var specialStory = special_stories[index] !== null && special_stories[index].length > 0 ? special_stories[index][0] : null;
            var teamLifecycle = specialStory !== null ? specialStory.get(FIELD_TEAM_LIFECYCLE) : "";
            that.logger.log("specialStory: ", specialStory);
            that.logger.log("teamLifecycle: ", teamLifecycle);
            // do not show inactive, not started or temporary teams
            if(TEAM_LIFECYCLE_TO_HIDE.indexOf(teamLifecycle) == -1) {
                var accepted = that.sumWIForState(iteration_work_items,"Accepted");
                //var completed = that.sumWIForState(iteration_work_items,"Completed");
                var completed = accepted + that.sumWIForState(iteration_work_items,"Completed");
                var backlog = that.sumWIForState(iteration_work_items,"Backlog");
                var defined = that.sumWIForState(iteration_work_items,"Defined");
                var inprogress = that.sumWIForState(iteration_work_items,"In-Progress");
                var totalCount = that.countWIForState(iteration_work_items,"*");
                var acceptedCount = that.countWIForState(iteration_work_items,"Accepted");
                //var completedCount = that.countWIForState(iteration_work_items,"Completed");
                var completedCount = acceptedCount + that.countWIForState(iteration_work_items,"Completed");
                
                var lpcVelocity = specialStory !== null ? specialStory.get(FIELD_LPC_VELOCITY) : 0;
                
                var plannedVelocity = iteration.get("PlannedVelocity") != null ? iteration.get("PlannedVelocity") : 0;
                var targetUtilization = lpcVelocity > 0 ? Math.round(( plannedVelocity/lpcVelocity ) * 100) : 0; 
                //var velocityUtilization = plannedVelocity > 0 ? Math.round((total / plannedVelocity) * 100) : 0;
                var velocityUtilization = plannedVelocity > 0  ? Math.round((accepted / plannedVelocity) * 100) : 0;

                // add a row for each team, iteration combination
                var row = { team            : team, 
                            iteration       : iteration.get("Name"), 
                            enddate         : iteration.get("EndDate"),
                            lpcVelocity     : lpcVelocity, 
                            completedCount  : completedCount,
                            plannedVelocity : plannedVelocity, 
                            acceptedCount   : acceptedCount,
                            targetUtilization        : targetUtilization,
                            deliverySatisfaction : specialStory !== null ? specialStory.get(FIELD_DELIVERY_SATISFACTION) : "",
                            remarks         : specialStory !== null ? specialStory.get(FIELD_REMARKS) : "",
                            status          : specialStory !== null ? specialStory.get(FIELD_STATUS) : "",
                            accepted        : accepted,
                            velocityUtilization : velocityUtilization
                };
                that.rows.push(row);
                that.store.load();
                that.store.sort([
                    {
                        property : 'team',
                        direction: 'ASC'
                    },
                    {
                        property : 'enddate',
                        direction: 'DESC'
                    }
                ]);            	
            }
            
            
        });
    },
    
    showTable : function() {
        var me = this;
        var height = 500;
        this.store = Ext.create('Rally.data.custom.Store', {
            fields: [
                    { name : "team" ,          type : "string"},
                    { name : "iteration" ,     type : "string"},
                    { name : "enddate",        type : "date"},
                    { name : "lpcVelocity",    type : "number"}, 
                    { name : "completedCount", type  : "number"},
                    { name : "plannedVelocity",type : "number"}, 
                    { name : "acceptedCount",  type : "number"},
                    { name : "targetUtilization",       type : "number"},
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
            height: height,
            columnCfgs: [
                { text : 'Team',           dataIndex: 'team'},
                { text : "Iteration",      dataIndex : "iteration", flex: 1.1 },
                { text : "End Date",       dataIndex : "enddate", flex: 1.1,renderer: Ext.util.Format.dateRenderer() },
//                { text : "User Stories Completed",    dataIndex : "completedCount",   align : "center"}, 
//                { text : "User Stories Accepted",     dataIndex : "acceptedCount",    align : "center"}, 
                { text : "LPC Velocity",   dataIndex : "lpcVelocity",      align : "center"}, 
                { text : "Target Velocity",dataIndex : "plannedVelocity",  align : "center"},
                { text : "Accepted Points",dataIndex : "accepted",  align : "center"}, 
                { text : "Target <br/>Utilization (%)", dataIndex : "targetUtilization", align : "center", renderer: this.renderVelocity }, 
                { text : "Velocity (%)",dataIndex : "velocityUtilization",  align : "center", renderer: this.renderVelocity }, 
                { text : "Delivery Satisfaction",dataIndex : "deliverySatisfaction", align : "center", renderer: this.renderSatisfaction}, 
                { text : "Management information/request", dataIndex : "remarks", align : "center", tdCls: 'wrap', flex: 1}, 
                { text : "Status",         dataIndex : "status",           align : "center", renderer: this.renderStatus } 
            ],
            listeners: {
                afterrender: function(grid) {
                    grid.setHeight(me.getHeight()-20);
                }
            }
        });
        // add it to the app
        this.add(this.grid);
    },
    
    renderVelocity : function( value, meta ) {
        
        //if (value < 80) { 
        if (value < THRESHOLD_VELOCITY) { 
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
        if (value >= 1 && value <= THRESHOLD_SATISFACTION) { 
            meta.style = 'background-color:red;color:white;'; 
            return value; 
        } else 
            if (value > THRESHOLD_SATISFACTION)
            {
                meta.style = 'background-color:green;color:white'; 
                return value; 
            }
    }

});
