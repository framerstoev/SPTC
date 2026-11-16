/* One lazy, shared Beryl contextual overlay; no analytical metric or route model. */
(function(root){
  "use strict";
  let cached=null;
  function load(){
    if(!cached)cached=V4Data.json("./data/beryl/evacuation/manifest.json").then(async manifest=>{
      const geometry=await V4Data.json("./data/beryl/evacuation/routes.geojson",document.baseURI,manifest.file);
      if(manifest.input_CRS!=="EPSG:3857"||manifest.output_CRS!=="EPSG:4326"||geometry.features.length!==207)throw new Error("Evacuation source contract mismatch");
      return {geometry,manifest};
    }).catch(error=>{cached=null;throw error;});
    return cached;
  }
  function sync(entries,data,store){
    const enabled=Boolean(data.beryl&&store.get().evacuationVisible);
    const setStatus=message=>document.querySelectorAll("[data-evacuation-status]").forEach(status=>status.textContent=message);
    document.querySelectorAll('[data-overlay="evacuation"]').forEach(toggle=>toggle.checked=enabled);
    document.querySelectorAll("[data-evacuation-key]").forEach(key=>key.hidden=!enabled);
    entries.forEach(entry=>{if(entry.evacuation&&!enabled){entry.map.removeLayer(entry.evacuation);if(!data.beryl){entry.evacuation=null;entry.evacuationStroke=null;entry.evacuationCasing=null;}}});
    if(!enabled){setStatus("");return;}
    setStatus("Loading verified route reference…");
    load().then(({geometry})=>{
      if(!data.beryl||!store.get().evacuationVisible)return;
      entries.forEach(entry=>{
        if(!entry.evacuation){
          const map=entry.map;
          for(const [name,zIndex] of [["evacuationCasing",404],["evacuationContext",405]]){
            if(!map.getPane(name))map.createPane(name);map.getPane(name).style.zIndex=String(zIndex);map.getPane(name).style.pointerEvents="none";
          }
          const routeStyle=()=>({color:"#7C3AED",weight:map.getZoom()>=10?2.8:map.getZoom()>=7?2.4:2,opacity:.96,dashArray:"6 8",lineCap:"butt",interactive:false});
          const casingStyle=()=>({...routeStyle(),color:"#FFFFFF",weight:routeStyle().weight+1.4,opacity:.9});
          entry.evacuationStroke=L.geoJSON(geometry,{pane:"evacuationContext",renderer:L.canvas({pane:"evacuationContext"}),interactive:false,style:routeStyle});
          entry.evacuationCasing=L.geoJSON(geometry,{pane:"evacuationCasing",renderer:L.canvas({pane:"evacuationCasing"}),interactive:false,style:casingStyle});
          entry.evacuation=L.featureGroup([entry.evacuationCasing,entry.evacuationStroke]);
          if(!entry.evacuationZoom){entry.evacuationZoom=()=>{entry.evacuationStroke?.setStyle(routeStyle);entry.evacuationCasing?.setStyle(casingStyle);};map.on("zoomend",entry.evacuationZoom);}
        }
        if(!entry.map.hasLayer(entry.evacuation))entry.evacuation.addTo(entry.map);
      });
      setStatus("");document.querySelectorAll('[data-overlay="evacuation"]').forEach(toggle=>toggle.title="207 source reference features; no July 2024 operating-status claim");
    }).catch(()=>{if(data.beryl&&store.get().evacuationVisible){setStatus("Route reference could not be verified. Turn off and retry; score evidence is unchanged.");document.querySelectorAll("[data-evacuation-key]").forEach(key=>key.hidden=true);}});
  }
  root.V4Evacuation=Object.freeze({sync});
})(window);
