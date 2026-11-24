(function (root) {
  "use strict";
  const C = root.V4Core;
  function create(data, store, select) {
    const entries = new Map(), countyBounds = new Map();
    let allBounds = C.bounds(data.geometry.features), breaks = C.scoreBreaks(data.rows);
    let synchronizing = false, resizing = false, fitGeneration = 0;
    const activeNames = () => [store.get().planningVisible ? "planning" : null, store.get().observationVisible ? "observed" : null].filter(Boolean);
    const featureById = new Map(data.geometry.features.map(f => [String(f.properties.id), f]));
    function visible(row) { return store.get().area === "texas" || row.county_fips === store.get().area; }
    function currentMetric(name) { const s = store.get(); return name === "explore" ? s.layer : name === "planning" ? s.planningLayer : s.observedLayer; }
    function limits(key) {
      const metric = C.metrics[key];
      if (metric.kind === "category") return [0, 1];
      if (metric.breaks) return metric.breaks;
      if (metric.quantile) return breaks;
      if (metric.range) return Array.from({ length: 6 }, (_, i) => metric.range[0] + (metric.range[1] - metric.range[0]) * i / 5);
      const values = data.rows.map(r => C.mapValue(r, key, store.get().temperatureWindow)).filter(v => v !== null);
      if (!values.length) return [0, .2, .4, .6, .8, 1];
      const lo = Math.min(...values), hi = Math.max(...values);
      return Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) || 1) * i / 5);
    }
    function style(row, name, range) {
      if (!visible(row)) return { opacity: 0, weight: 0 };
      const key = currentMetric(name), n = C.mapValue(row, key, store.get().temperatureWindow);
      const selected = store.get().selectedId === row.id;
      const metric = C.metrics[key];
      if(data.beryl&&store.get().impactFocus){
        if(!row.impactFocus.focus)return {color:selected?"#112d31":"#b7bfc4",opacity:selected?1:.5,weight:selected?5:1.1,dashArray:"2 6"};
        if(metric.kind!=="category"&&n===null)return {color:"#112d31",opacity:selected?1:0,weight:selected?5:2,dashArray:"5 3"};
      }
      if(data.beryl&&store.get().commonSupport&&C.metrics[store.get().observedLayer].kind!=="category"&&!V4Presentation.pairSupported(row,store))return {color:selected ? "#112d31" : "#aab1b7",opacity:.72,weight:selected ? 5 : 1.4,dashArray:"2 6"};
      if (metric.kind === "category") { const category=metric.categories.find(item=>item.value===V4Metrics.mapRaw(row,metric)); return {color:selected ? "#112d31" : category?.color || "#112d31",opacity:selected || category ? .95 : 0,weight:selected ? 5 : 2,dashArray:selected ? null : category?.dash || null}; }
      return { color: selected ? "#112d31" : n === null ? "#112d31" : C.metrics[key].ramp[C.bucket(n, range)], opacity: selected ? 1 : n === null ? 0 : .95, weight: selected ? 5 : 1.65, dashArray: !selected && n === null ? "2 4" : null };
    }
    function legend(name) {
      const key = currentMetric(name), metric = C.metrics[key], s = store.get();
      const rows = data.rows.filter(row => visible(row) && (!data.beryl || !s.impactFocus || row.impactFocus.focus) &&
        (!data.beryl || !s.commonSupport || C.metrics[s.observedLayer].kind === "category" || V4Presentation.pairSupported(row, store)));
      const value = row => metric.kind === "category" ? V4Metrics.mapRaw(row, metric) : C.mapValue(row, key, s.temperatureWindow);
      const maskNote = data.beryl && s.impactFocus ? "Impact Focus is a display screen, not proof of hurricane-caused damage. Other roads remain contextual references." :
        data.beryl && s.commonSupport ? "Common Support shows numerical pairs only; other roads are contextual references." : "";
      V4L.renderLegend(document.getElementById(`${name}Legend`), { metric, range: limits(key), rows, value, maskNote });
    }
    function add(name, target) {
      const map = L.map(target, { preferCanvas: true, zoomControl: false, attributionControl: true, zoomSnap: .25, minZoom: 3 }).setView([31.1, -99.5], 6);
      L.control.zoom({ position: "topright" }).addTo(map);
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 18 }).addTo(map);
      const byId = new Map(), renderer = L.canvas({ padding: .5, tolerance: 8 }), range = limits(currentMetric(name));
      const layer = L.geoJSON(data.geometry, { renderer, style: f => style(data.byId.get(String(f.properties.id)), name, range), onEachFeature(f, path) {
        const row = data.byId.get(String(f.properties.id)); byId.set(row.id, path);
        path.on("click", () => { if (visible(row)) select(row.id); });
        path.bindTooltip(() => {
          const el = document.createElement("div"); const strong = document.createElement("strong"); strong.textContent = `CS_${row.id} · ${row.route || "Roadway"}`;
          const small = document.createElement("small"); small.textContent = `${row.county_name} County · ${C.format(C.mapValue(row, currentMetric(name), store.get().temperatureWindow))} ${C.metrics[currentMetric(name)].unit}`; el.append(strong, small); const metric=C.metrics[currentMetric(name)];if(metric.kind==="category")small.textContent=`${row.county_name} County · ${metric.categories.find(item=>item.value===V4Metrics.mapRaw(row,metric))?.label || "Unavailable"}`;else if(metric.family==="o1a"&&C.mapValue(row,metric.key)===null)small.textContent=`${row.county_name} County · ${root.V5R.support(row)}`; if (data.beryl && ["potential","o1a"].includes(metric.key)) {
            const value = C.mapValue(row, metric.key, store.get().temperatureWindow);
            const bucket = C.bucket(value, limits(metric.key));
            const description = bucket === null ? (metric.key==="o1a" ? root.V5R.support(row) : "Planning score unavailable") :
              metric.label + " · Fixed map class " + (bucket + 1);
            small.textContent = row.county_name + " County · " + description;
          } if (currentMetric(name) === "recovery") { const p=document.createElement("small"), evidence=V4Presentation.recoveryEvidence(data,row); const interval = C.value(row,"recovery"); p.textContent = evidence.status ||
              (interval === null ? "No supported endpoint interval" : `${C.format(interval)} h to threshold return`);el.append(p); } return el;
        }, { sticky: true });
        path.on("mouseover", () => { if (visible(row)) path.setStyle({ weight: 4, opacity: 1 }); });
        path.on("mouseout", () => path.setStyle(style(row, name, limits(currentMetric(name)))));
      } }).addTo(map);
      if(!map.getPane("selectedCS")){map.createPane("selectedCS");map.getPane("selectedCS").style.zIndex="408";map.getPane("selectedCS").style.pointerEvents="none";}
      const highlight=L.geoJSON(null,{pane:"selectedCS",renderer:L.canvas({pane:"selectedCS"}),interactive:false,style:{color:"#112d31",weight:5,opacity:1}}).addTo(map);
      const entry = { map, layer, byId, highlight, tiles, tileLoaded: 0, tileErrors: 0, view: { center: map.getCenter(), zoom: map.getZoom() } };
      entries.set(name, entry);
      tiles.on("tileload", () => { entry.tileLoaded++; if (entry.tileWarning) { map.removeControl(entry.tileWarning); entry.tileWarning=null; } });
      tiles.on("tileerror", () => { entry.tileErrors++; setTimeout(() => { if (!entry.tileLoaded && !entry.tileWarning) { const warning=L.control({position:"bottomright"}); warning.onAdd=()=>{const el=document.createElement("div");el.className="basemap-failure";el.textContent="Basemap unavailable · check connection. Roadway evidence remains available.";return el;};warning.addTo(map);entry.tileWarning=warning;} }, 5000); });
      map.on("moveend", () => {
        if (!resizing) entry.view = { center: map.getCenter(), zoom: map.getZoom() };
        if (!store.get().planningVisible || !store.get().observationVisible || synchronizing) return;
        const other = entries.get(name === "planning" ? "observed" : "planning");
        // Beryl resets the target pixel origin: rounded pan offsets can otherwise differ by one pixel at fractional zoom.
        if (other) { synchronizing = true; other.map.stop(); other.map.setView(map.getCenter(), map.getZoom(), { animate: false, ...(data.beryl ? {reset:true} : {}) }); synchronizing = false; }
      });
      legend(name);
      root.V4Track.sync(entries, data, store, fit);
    }
    function areaBounds() {
      const area = store.get().area;
      if (area === "texas") return allBounds;
      if (!countyBounds.has(area)) countyBounds.set(area, C.bounds(data.geometry.features.filter(f => data.byId.get(String(f.properties.id)).county_fips === area)));
      return countyBounds.get(area);
    }
    function fit() {
      const token = ++fitGeneration;
      entries.forEach(e => e.map.stop());
      requestAnimationFrame(() => {
        if (token !== fitGeneration) return;
        const names = activeNames();
        synchronizing = true;
        if(data.beryl)fitNames(areaBounds(),{padding:[30,30]});
        else names.forEach(name => { const e = entries.get(name); if (e) { e.map.stop(); e.map.invalidateSize({ animate: false }); e.map.fitBounds(areaBounds(), { animate: false, padding: [30, 30] }); } });
        synchronizing = false;
      });
    }
    function fitNames(bounds,options={}){
      const active=activeNames().map(name=>entries.get(name)).filter(Boolean);if(!active.length)return;
      active.forEach(e=>{e.map.stop();e.map.invalidateSize({animate:false,pan:false});});
      active[0].map.fitBounds(bounds,{animate:false,...options});
      const center=active[0].map.getCenter(),zoom=active[0].map.getZoom();
      active.forEach(e=>{e.map.setView(center,zoom,{animate:false,reset:true});e.view={center,zoom};});
    }
    function fitTrack(){
      if(!data.beryl)return;
      const source=entries.get(activeNames()[0]);if(!source?.storm)return;
      synchronizing=true;fitNames(source.storm.getBounds(),{padding:[30,30]});synchronizing=false;
    }
    function render() {
      root.V4Track.sync(entries, data, store, fit);
      root.V4Evacuation.sync(entries,data,store);
      entries.forEach((e, name) => { const range = limits(currentMetric(name)); e.byId.forEach((layer, id) => { layer.closeTooltip(); layer.options.interactive = visible(data.byId.get(id)); layer.setStyle(style(data.byId.get(id), name, range)); }); const selected = e.byId.get(store.get().selectedId); selected?.bringToFront(); legend(name); });
      entries.forEach(entry=>{entry.highlight.clearLayers();const row=data.byId.get(store.get().selectedId),feature=row&&visible(row)?featureById.get(row.id):null;if(feature)entry.highlight.addData(feature);});
    }
    function activate(previous = {}) {
      if (activeNames().length === 2 && (previous.planningVisible === false || previous.observationVisible === false)) {
        const source = entries.get(previous.planningVisible === false ? "observed" : "planning");
        if(source){const view=source.view;synchronizing=true;entries.forEach(entry=>{entry.view={...view};entry.map.setView(view.center,view.zoom,{animate:false,...(data.beryl?{reset:true}:{})});});synchronizing=false;}
      }
      root.V4Track.sync(entries, data, store, fit);
      root.V4Evacuation.sync(entries,data,store);
      resize();
    }
    function resize() {
      // Preserve geographic center when the rail panel changes available width.
      synchronizing = true;
      resizing = true;
      entries.forEach(e => {
        if (!e.map.getContainer().getClientRects().length) return;
        // Retain the last deliberate view across fractional-pixel resize steps.
        const { center, zoom } = e.view;
        e.map.stop(); e.map.invalidateSize({ animate: false, pan: false });
        e.map.setView(center, zoom, { animate: false, ...(data.beryl ? {reset:true} : {}) });
      });
      resizing = false;
      synchronizing = false;
    }
    function focus(id) {
      const f = featureById.get(id); if (!f) return;
      const names = activeNames();
      synchronizing = true;
      if(data.beryl)fitNames(C.bounds([f]),{maxZoom:12,padding:[45,45]});
      else names.forEach(name => { const e = entries.get(name); if (e) { e.map.stop(); e.map.fitBounds(C.bounds([f]), { animate: false, maxZoom: 12, padding: [45, 45] }); } });
      synchronizing = false;
    }
    add("planning", "planningMap"); add("observed", "observedMap");
    function refresh() {
      ++fitGeneration;
      allBounds = C.bounds(data.geometry.features); breaks = C.scoreBreaks(data.rows); countyBounds.clear();
      featureById.clear(); data.geometry.features.forEach(f => featureById.set(String(f.properties.id), f));
      entries.forEach(e => { e.map.closePopup(); e.layer.clearLayers(); e.byId.clear(); e.layer.addData(data.geometry); });
      render();
    }
    return { activate, render, fit, fitTrack, focus, resize, entries, limits, areaBounds, refresh };
  }
  root.V4Maps = Object.freeze({ create });
})(window);
