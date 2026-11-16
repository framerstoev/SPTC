/* Shared chart styling and visualization-only ranges; source arrays remain intact. */
(function(root){
  "use strict";
  const clock = stamp => Date.parse(stamp.slice(0,19)+"Z");
  const dateLabel = value => new Date(value).toISOString().slice(5,16).replace("T"," ");
  const phaseStyles = [{field:"onset_time",color:"#ba8b45",label:"Phase onset"},{field:"min_time",color:"#a54f52",label:"Phase minimum"},{field:"recovery_end_time",color:"#547da0",label:"Return / censor endpoint"}];
  const phaseLines={id:"phaseLines",beforeDatasetsDraw(chart,args,options){
    if(!options.core)return;
    const {ctx,chartArea,scales}=chart;
    const left=Math.max(chartArea.left,scales.x.getPixelForValue(clock(options.core.start)));
    const right=Math.min(chartArea.right,scales.x.getPixelForValue(clock(options.core.end)));
    if(right<=left)return;
    ctx.save();ctx.fillStyle="#d7d9d538";ctx.fillRect(left,chartArea.top,right-left,chartArea.bottom-chartArea.top);ctx.restore();
  },afterDatasetsDraw(chart,args,options){
    const {ctx,chartArea,scales}=chart;
    for(const marker of options.markers||[]){
      if(!marker.time)continue;
      const x=scales.x.getPixelForValue(clock(marker.time));
      if(x<chartArea.left||x>chartArea.right)continue;
      ctx.save();ctx.strokeStyle=marker.color;ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(x,chartArea.top);ctx.lineTo(x,chartArea.bottom);ctx.stroke();ctx.restore();
    }
  }};
  function draw(canvas,payload,row,options={}){
    const series=payload.series,meta=payload.metadata||{},labels=series.timestamp,times=labels.map(clock);
    const data=options.data||{beryl:payload.clock==="UTC",manifest:{windows:{}}};
    const windows=data.manifest.windows||{};
    const core=data.beryl ? {start:meta.core_start,end:meta.core_end} : {start:windows.meteorological_event_start,end:windows.meteorological_event_end};
    const valid=options.phaseValid ?? V4Presentation.phaseValid(data,row);
    const markers=valid ? phaseStyles.map(style=>({time:meta[style.field],color:style.color,label:style.label})) : [];
    let min=times[0],max=times.at(-1);
    const day=24*3600000;
    if(options.range==="event"&&core.start&&core.end){min=Math.max(min,clock(core.start)-day);max=Math.min(max,clock(core.end)+day);}
    if(options.range==="phase"&&valid){const a=clock(meta.onset_time),b=clock(meta.recovery_end_time);if(Number.isFinite(a)&&Number.isFinite(b)){min=Math.max(min,a-day);max=Math.min(max,b+day);}}
    const points=values=>times.map((x,i)=>({x,y:values[i],timestamp:labels[i]}));
    const line=(label,values,color,width)=>({label,data:points(values),borderColor:color,borderWidth:width,pointRadius:0,spanGaps:false,segment:{borderColor:context=>context.p1.parsed.x-context.p0.parsed.x>3600000?"transparent":color}});
    const datasets=[line("Raw Q(t)",series.q,"#a5b2b675",1),line("Accepted smoothed Q(t)",series.q_smoothed,"#176663",2),
      {label:"Q=1 baseline",data:[{x:times[0],y:1},{x:times.at(-1),y:1}],borderColor:"#8b9690",borderDash:[3,3],borderWidth:1,pointRadius:0}];
    if(Number.isFinite(meta.q0))datasets.push({label:"Detection threshold",data:[{x:times[0],y:.9*meta.q0},{x:times.at(-1),y:.9*meta.q0}],borderColor:"#b28d57",borderDash:[4,3],borderWidth:1,pointRadius:0});
    return new Chart(canvas,{type:"line",plugins:[phaseLines],data:{labels,datasets},options:{animation:false,responsive:true,maintainAspectRatio:false,normalized:false,
      interaction:{mode:"nearest",axis:"x",intersect:false},plugins:{legend:{display:false},phaseLines:{markers,core:core.start&&core.end?core:null},
      tooltip:{callbacks:{title:items=>(items[0].raw.timestamp?.replace("T"," ")||dateLabel(items[0].parsed.x))+(payload.clock==="UTC"?" · UTC":" · delivered TMC-local")}}},
      scales:{x:{type:"linear",min,max,ticks:{maxTicksLimit:5,maxRotation:0,font:{size:9},callback:value=>dateLabel(value).slice(0,5).replace("-","/")},grid:{display:false}},
      y:{min:0,max:1.5,title:{display:true,text:"Q(t)",font:{size:10}},ticks:{font:{size:9},maxTicksLimit:4},grid:{color:"#e5e9e4"}}}}});
  }
  root.V4Charts=Object.freeze({draw,clock,phaseStyles});
})(window);
