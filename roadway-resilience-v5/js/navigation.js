/* Existing native module navigation; Overview and Layers share the original left-side panel. */
(function(root){
  "use strict";
  const modules=[
    ["overview","Overview","M4 4h16v16H4z M4 10h16 M10 10v10"],
    ["analysis","Analysis","M5 20V12 M12 20V5 M19 20V9"],
    ["layers","Layers","m3 8 9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5"],
    ["timeseries","Time Series","M3 4v16h18 M5 14l4-5 4 7 6-11"],
    ["forecast","Forecast","M4 18l5-6 4 3 7-10 M15 5h5v5"],
    ["data","Data","M4 5h16v14H4z M4 10h16 M4 14h16 M10 5v14"],
    ["about","About","M12 10v7 M12 6v1 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"]
  ];
  function create(data,store,actions){
    const T=V4Inspector.text,$=id=>document.getElementById(id),rail=$("moduleRail");let opener=null;
    function button(host,label,handler){const b=T("button",label,"outline-button");b.type="button";b.addEventListener("click",handler);host.append(b);return b;}
    function link(host,label,anchor){const a=T("a",label,"text-action");a.href=V4J.methodLink(data,anchor);host.append(a);return a;}
    function open(id){if(id!==null&&!modules.some(m=>m[0]===id))return;if(id&&store.get().panel!==id)opener=document.activeElement;store.set({panel:id});if(id==="layers")requestAnimationFrame(()=>$("collapsePanel").focus());}
    modules.forEach(([id,label,path])=>{const b=T("button");b.type="button";b.dataset.module=id;b.title=label;b.setAttribute("aria-label",label);b.setAttribute("aria-controls","contextPanel");b.setAttribute("aria-expanded","false");const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),line=document.createElementNS(svg.namespaceURI,"path");svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");line.setAttribute("d",path);svg.append(line);b.append(svg,T("span",label));b.addEventListener("click",()=>open(store.get().panel===id?null:id));rail.append(b);});
    $("collapsePanel").addEventListener("click",()=>{const previous=store.get().panel;open(null);(opener?.isConnected?opener:rail.querySelector(`[data-module="${previous}"]`))?.focus();});
    $("contextPanel").addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();$("collapsePanel").click();}});
    $("layerGroups").addEventListener("keydown",e=>{if(!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;const owner=e.target.closest("fieldset");if(!owner)return;const buttons=[...owner.querySelectorAll("button:not(:disabled)")].filter(b=>b.getClientRects().length),i=buttons.indexOf(e.target);if(i<0)return;e.preventDefault();const n=e.key==="Home"?0:e.key==="End"?buttons.length-1:(i+(["ArrowDown","ArrowRight"].includes(e.key)?1:-1)+buttons.length)%buttons.length;buttons[n].click();buttons[n].focus();});
    function analysis(){const h=$("module-analysis");h.replaceChildren(T("h2","Explore the result","module-title"));button(h,"Choose map layers",()=>open("layers"));button(h,"View traffic history",()=>open("timeseries"));button(h,"View mobility impact",actions.impact);link(h,"How to interpret the comparison","compare");}
    function about(){const h=$("module-about");h.replaceChildren(T("h2","Roadway Resilience Explorer","module-title"),T("p","SPTC \u00b7 Texas A&M Transportation Institute \u00b7 Texas A&M University.","panel-lead"));link(h,"Project, sources and limitations","introduction");}
    function forecast(){const h=$("module-forecast");h.replaceChildren(T("h2","Forecast","module-title"),T("p","Planned. No forecast model is available.","panel-lead"));const b=button(h,"Forecast unavailable",()=>{});b.disabled=true;link(h,"Research roadmap","forecast");}
    function overview(){const s=store.get();const selected=data.byId.get(s.selectedId),selection=$("overviewSelection");selection.replaceChildren(T("h2",selected?`CS_${selected.id}`:"Select a road","module-title"));if(selected){selection.append(T("p",`${selected.county_name} County`,"panel-lead"));button(selection,"Open road details",()=>actions.inspect("observed"));}else selection.append(T("p","Click a road or search by ID, route or county.","panel-lead"));}
    function dataPanel(){const h=$("module-data");h.replaceChildren(T("h2","Data Availability","module-title"));const dl=T("dl","","coverage-list");for(const [label,value] of [["Road sections",data.rows.length],["Traffic histories",data.rows.filter(r=>r.has_curve).length],["Primary performance values",data.rows.filter(r=>V4Core.mapValue(r,V4J.primary(data))!==null).length],["Counties",data.counties.length]])dl.append(T("dt",label),T("dd",value.toLocaleString("en-US")));h.append(dl);const detail=T("details","","research-details");detail.append(T("summary","Advanced / Sources and Provenance"),T("p",V4Data.label(data)+" \u00b7 "+V4Data.reviewLabel(data),"evidence-note"),T("pre",JSON.stringify({manifest:data.manifest,coverage:data.beryl?data.evidence:null,o1_contract:data.o1Manifest,focus:data.focusManifest},null,2),"source-fields"));h.append(detail);link(h,"Sources, attribution and limitations","sources");}
    function build(){analysis();V4J.layers(data,store,actions);about();forecast();dataPanel();}
    build();
    function render(state,previous={}){
      if(state.eventId!==previous.eventId)build();
      $("contextPanel").hidden=state.panel===null;$("appLayout").classList.toggle("panel-open",state.panel!==null);
      modules.forEach(([id,label])=>{const active=state.panel===id,b=rail.querySelector(`[data-module="${id}"]`);b.setAttribute("aria-expanded",String(active));b.classList.toggle("active",active);$("module-"+id).hidden=!active;if(active){$("panelTitle").textContent=label;$("panelEyebrow").textContent="EXPLORER";}});
      document.querySelectorAll("[data-layer]").forEach(b=>{const key=b.dataset.layer;b.setAttribute("aria-checked",String(key===state[V4J.side(V4Core.metrics[key])]));});
      if(["area","layer","selectedId","eventId"].some(k=>state[k]!==previous[k]))overview();
      if(state.panel!==previous.panel)$("contextPanel").querySelector(".context-scroll").scrollTop=0;
    }
    return {open,render,modules};
  }
  root.V4Navigation=Object.freeze({create,modules});
})(window);
