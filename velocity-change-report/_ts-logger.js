/*
 */
Ext.define('Rally.technicalservices.logger',{
    constructor: function(config){
        Ext.apply(this,config);
    },
    log: function(args){
        var output_args = [];
        if (arguments.length === 0 ) {
            window.console && console.log(arguments);
            return;
        }
        if (arguments.length === 1 ) {
            output_args = arguments;
        } else {
            var src_class = arguments[0];
            var class_name = "";
            if ( typeof(src_class) === "string" ) {
                class_name = src_class;
            } else if ( typeof src_class.getName === "function") { 
                class_name = src_class.getName();
            } else if (typeof src_class.self.getName === 'function'){
                class_name = src_class.self.getName();
            }
            //window.console && console.log(class_name,"--",message);
            output_args = Ext.Array.push(output_args,[class_name,"--"]);
            output_args = Ext.Array.push(output_args,Ext.Array.slice(arguments,1));
        }
        window.console && console.log.apply(console,output_args);
    }

});