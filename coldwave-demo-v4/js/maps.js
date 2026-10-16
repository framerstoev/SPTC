(function (root) {
  "use strict";
  const C = root.V4Core;
  function create(data, store, select) {
    const entries = new Map(), countyBounds = new Map();
    const allBounds = C.bounds(data.geometry.features), breaks = C.scoreBreaks(data.rows);
    let synchronizing = false, fitGeneration = 0;
    const featureById = new Map(data.geometry.features.map(f => [String(f.properties.id), f]));
    function visible(row) { return store.get().area === "texas" || row.county_fips === store.get().area; }
    function currentMetric(name) { const s = store.get(); return name === "explore" ? s.layer : name === "planning" ? s.planningLayer : s.observedLayer; }
    function limits(key) {
      const metric = C.metrics[key];
      if (metric.quantile) return breaks;
      if (metric.range) return Array.from({ length: 6 }, (_, i) => metric.range[0] + (metric.range[1] - metric.range[0]) * i / 5);
      const values = data.rows.map(r => C.value(r, key, store.get().temperatureWindow)).filter(v => v !== null);
      if (!values.length) return [0, .2, .4, .6, .8, 1];
      const lo = Math.min(...values), hi = Math.max(...values);
      return Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) || 1) * i / 5);
    }
    function style(row, name, range) {
      if (!visible(row)) return { opacity: 0, weight: 0 };
      const key = currentMetric(name), n = C.value(row, key, store.get().temperatureWindow);
      const selected = store.get().selectedId === row.id;
      return { color: selected ? "#112d31" : n === null ? "#b3bbba" : C.metrics[key].ramp[C.bucket(n, range)], opacity: selected ? 1 : .88, weight: selected ? 5 : 1.65 };
    }
    function legend(name) {
      const key = currentMetric(name), metric = C.metrics[key], range = limits(key);
      const box = document.getElementById(`${name}Legend`);
      box.replaceChildren();
      const head = document.createElement("div"); head.className = "legend-head";
      const title = document.createElement("span"); title.textContent = name === "explore" ? "Map legend" : metric.label;
      const unit = document.createElement("span"); unit.className = "legend-unit"; unit.textContent = metric.unit; head.append(title, unit);
      const ramp = document.createElement("div"); ramp.className = "legend-ramp";
      metric.ramp.forEach((color, i) => { const swatch = document.createElement("i"); swatch.style.background = color; swatch.title = `${C.format(range[i])}–${C.format(range[i + 1])} ${metric.unit}`; ramp.append(swatch); });
      const labels = document.createElement("div"); labels.className = "legend-labels";
      [range[0], range.at(-1)].forEach(n => { const span = document.createElement("span"); span.textContent = C.format(n); labels.append(span); });
      const note = document.createElement("p"); note.className = "legend-note"; note.textContent = metric.quantile ? "Event-sample quantiles · Very Low → Very High" : metric.temp ? "Experimental · original PRISM date labels" : metric.note;
      const missing = document.createElement("div"); missing.className = "legend-missing"; const line = document.createElement("i"); missing.append(line, document.createTextNode("Unavailable / no supported value"));
      box.append(head, ramp, labels, note, missing);
    }
    function add(name, target) {
      const map = L.map(target, { preferCanvas: true, zoomControl: false, attributionControl: true, zoomSnap: .25, minZoom: 3 }).setView([31.1, -99.5], 6);
      L.control.zoom({ position: "topright" }).addTo(map);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 18 }).addTo(map);
      const byId = new Map(), renderer = L.canvas({ padding: .5, tolerance: 8 }), range = limits(currentMetric(name));
      const layer = L.geoJSON(data.geometry, { renderer, style: f => style(data.byId.get(String(f.properties.id)), name, range), onEachFeature(f, path) {
        const row = data.byId.get(String(f.properties.id)); byId.set(row.id, path);
        path.on("click", () => { if (visible(row)) select(row.id); });
        path.bindTooltip(() => {
          const el = document.createElement("div"); const strong = document.createElement("strong"); strong.textContent = `CS_${row.id} · ${row.route || "Roadway"}`;
          const small = document.createElement("small"); small.textContent = `${row.county_name} County · ${C.format(C.value(row, currentMetric(name), store.get().temperatureWindow))} ${C.metrics[currentMetric(name)].unit}`; el.append(strong, small); return el;
        }, { sticky: true });
        path.on("mouseover", () => { if (visible(row)) path.setStyle({ weight: 4, opacity: 1 }); });
        path.on("mouseout", () => path.setStyle(style(row, name, limits(currentMetric(name)))));
      } }).addTo(map);
      entries.set(name, { map, layer, byId });
      map.on("moveend", () => {
        if (name === "explore" || store.get().workspace !== "compare" || synchronizing) return;
        const other = entries.get(name === "planning" ? "observed" : "planning");
        if (other) { synchronizing = true; other.map.stop(); other.map.setView(map.getCenter(), map.getZoom(), { animate: false }); synchronizing = false; }
      });
      legend(name);
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
        const names = store.get().workspace === "compare" ? ["planning", "observed"] : ["explore"];
        synchronizing = true;
        names.forEach(name => { const e = entries.get(name); if (e) { e.map.stop(); e.map.invalidateSize({ animate: false }); e.map.fitBounds(areaBounds(), { animate: false, padding: [30, 30] }); } });
        synchronizing = false;
      });
    }
    function render() {
      entries.forEach((e, name) => { const range = limits(currentMetric(name)); e.byId.forEach((layer, id) => { layer.closeTooltip(); layer.options.interactive = visible(data.byId.get(id)); layer.setStyle(style(data.byId.get(id), name, range)); }); const selected = e.byId.get(store.get().selectedId); selected?.bringToFront(); legend(name); });
    }
    function activate(workspace) {
      if (workspace === "compare" && !entries.has("planning")) { add("planning", "planningMap"); add("observed", "observedMap"); }
      if (workspace !== "methods") fit();
    }
    function focus(id) {
      const f = featureById.get(id); if (!f) return;
      const names = store.get().workspace === "compare" ? ["planning", "observed"] : ["explore"];
      synchronizing = true;
      names.forEach(name => { const e = entries.get(name); if (e) { e.map.stop(); e.map.fitBounds(C.bounds([f]), { animate: false, maxZoom: 12, padding: [45, 45] }); } });
      synchronizing = false;
    }
    add("explore", "exploreMap");
    return { activate, render, fit, focus, entries, limits, areaBounds };
  }
  root.V4Maps = Object.freeze({ create });
})(window);
