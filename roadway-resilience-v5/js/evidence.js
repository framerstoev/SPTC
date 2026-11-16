/* One presentation host; all data/chart calculations remain in their original modules. */
(function(root){
  "use strict";
  const render=(...args)=>V4J.evidence(...args);
  const inspector=(data,store,host,row,current,receive,rerender)=>render(data,store,host,row,false,current,receive,rerender,true);
  root.V4Evidence=Object.freeze({render,inspector});
})(window);
