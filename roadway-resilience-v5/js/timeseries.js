/* One native Time Series host and dialog for every event. */
(function(root){
  "use strict";
  function create(data,store){
    const dialog=document.getElementById("seriesDialog"),body=document.getElementById("timeSeriesBody"),expanded=document.getElementById("expandedSeriesBody");
    let generation=0,charts=[],resizeToken=0;
    function render(){
      const token=++generation;charts.forEach(chart=>chart.destroy());charts=[];
      const current=()=>token===generation,receive=chart=>charts.push(chart),row=data.byId.get(store.get().selectedId);
      if(store.get().panel==="timeseries")root.V4Evidence.render(data,store,body,row,false,current,receive,render);else body.replaceChildren();
      if(dialog.open){document.getElementById("seriesDialogTitle").textContent="Traffic Performance Over Time";root.V4Evidence.render(data,store,expanded,row,true,current,receive,render);}else expanded.replaceChildren();
    }
    document.getElementById("closeSeries").addEventListener("click",()=>dialog.close());dialog.addEventListener("close",render);
    new ResizeObserver(()=>{cancelAnimationFrame(resizeToken);resizeToken=requestAnimationFrame(()=>charts.forEach(chart=>chart.resize()));}).observe(document.getElementById("contextPanel"));
    return {render};
  }
  root.V4TimeSeries=Object.freeze({create});
})(window);
