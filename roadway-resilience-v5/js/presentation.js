/* Shared registry consumers: metric cards, selectors and source-support captions. */
(function (root) {
  "use strict";
  const C = V4Core, T = (...args) => V4Inspector.text(...args);
  function phaseValid(data, row) { return Boolean(row && (data.beryl ? row.candidate_b?.valid : row.has_curve && row.status !== "no_sustained_drop" && C.number(row.observed_curve_resilience_score_v0) !== null)); }
  function recoveryEvidence(data, row, meta = {}) {
    const p = data.beryl ? row.candidate_b || {} : meta;
    if (!phaseValid(data, row)) return { status: "Unavailable", note: "No valid selected phase" };
    if (row.status === "recovery_endpoint_censored" || p.method_warning_text?.includes("censored") || p.recovery_evidence_class?.includes("censored")) return { status: "Return Not Confirmed", note: "Stored interval to last supported observation; not a confirmed return" };
    if (p.recovery_evidence_class?.includes("ambiguous")) return { status: "Return Not Confirmed", note: "Observed-row return; three contiguous clock hours are not established" };
    if (p.q0_method === "full_period_median_q_fallback" || p.recovery_evidence_class?.includes("uncertain")) return { status: "Reference Uncertain", note: "Full-period reference fallback; endpoint interval remains qualified" };
    return { status: null, note: "Threshold-return interval; not confirmed physical recovery" };
  }
  function metricCard(data, row, key, windowId = "legacy_labels", meta = {}, standard = false) {
    const metric = C.metrics[key], value = metric.contextField ? C.number(data.networkContext?.[row.id]?.[metric.contextField]) : C.value(row, key, windowId);
    const node = V4Inspector.card(standard ? metric.cardLabel || metric.label : metric.label, value, metric.unit, { money: metric.money, compact: metric.money });
    node.dataset.metric = key; node.dataset.sourceValue = value === null ? "" : String(value);
    node.title = `${metric.label} · ${metric.unit}`;
    if (key === "recovery") {
      const evidence = recoveryEvidence(data, row, meta);
      if (evidence.status) node.querySelector("strong").textContent = evidence.status;
      node.querySelector("small").textContent = value === null ? evidence.note : `${C.format(value)} hours · return evidence in Methods`;
      node.querySelector("strong").title = value === null ? "Unavailable" : `${value} h · ${evidence.note}`;
    }
    if (metric.kind === "boolean") node.querySelector("strong").textContent = value === null ? "Unavailable" : value === 1 ? "Available" : "Unavailable";
    if (metric.role === "support") node.querySelector("small").textContent = metric.kind === "boolean" ? "Traffic history" : "Data availability";
    return node;
  }
  function phaseCards(data, row, meta = {}) {
    const host = T("div", "", "metric-pair phase-cards");
    V4Metrics.phaseKeys(data.eventId).forEach(key => host.append(metricCard(data, row, key, "legacy_labels", meta, true)));
    return host;
  }
  function scopeRows(data, area) { return data.rows.filter(row => area === "texas" || row.county_fips === area); }
  function counts(data, area, key, windowId) {
    const rows = scopeRows(data, area);
    return { sections: rows.length, q: rows.filter(r => r.has_curve).length,
      coreQ: data.beryl ? rows.filter(r => C.number(r.core_mean_q) !== null).length : null,
      phases: rows.filter(r => phaseValid(data, r)).length,
      economic: rows.filter(r => C.number(r.total_vehicle_delay_hours) !== null).length,
      quality: data.beryl ? rows.filter(r => r.comparison_quality_screen).length : null,
      metric: rows.filter(r => C.metrics[key].kind === "category" ? V4Metrics.mapRaw(r,C.metrics[key]) !== null : C.mapValue(r, key, windowId) !== null).length,
      sourceMetric: rows.filter(r => C.value(r,key,windowId)!==null).length };
  }
  function caption(data, area, key, windowId) {
    const n = counts(data, area, key, windowId), f = value => value.toLocaleString("en-US");
    return `${f(n.sections)} study sections · ${data.beryl ? f(n.coreQ) + " with core Q" : f(n.q) + " with Q(t)"} · ${f(n.phases)} phase scores · ${f(n.economic)} economic. ${C.metrics[key].label}: ${f(n.metric)} ${data.beryl ? "eligible source values (display mask may narrow support)" : "displayed"+(C.metrics[key].mapEvidence ? " / "+f(n.sourceMetric)+" source intervals" : " source values")}.`;
  }
  function compareSelectors(data) { /* Headers are read-only; Layers owns metric selection. */ }
  function syncSelectors(data,store){
    for(const side of ["planning","observed"]){
      const key=store.get()[side+"Layer"],header=document.getElementById(side+"Map").closest("article").querySelector("header");
      header.querySelector("h3").textContent=(side==="planning"?"Planning":"Observation")+" — "+V4J.title(data,key);
      header.title=side==="observed"&&key===V4J.primary(data)?(data.beryl?"Hurricane-period traffic conditions":"Selected slowdown period"):V4Core.metrics[key].unit;
    }
  }
  function tabFor(key) { const metric = C.metrics[key]; return metric.temp || metric.categoryId === "hazard" ? "weather" : ["planning", "network"].includes(metric.categoryId) ? "planning" : metric.categoryId === "impact" ? "impact" : "observed"; }
  function pairSupported(row,store){
    const s=store.get(),p=C.metrics[s.planningLayer],o=C.metrics[s.observedLayer];
    return p.kind!=="category"&&o.kind!=="category"&&C.mapValue(row,p.key,s.temperatureWindow)!==null&&C.mapValue(row,o.key,s.temperatureWindow)!==null;
  }
  function comparison(data,store){
    const s=store.get(),rows=scopeRows(data,s.area),p=C.metrics[s.planningLayer],o=C.metrics[s.observedLayer];
    const capable=Boolean(data.beryl&&p.kind!=="category"&&o.kind!=="category");
    const count=metric=>rows.filter(row=>V4Metrics.mapRaw(row,metric,s.temperatureWindow)!==null).length;
    return {capable,enabled:capable&&s.commonSupport===true,paired:capable?rows.filter(row=>pairSupported(row,store)).length:null,planning:count(p),observed:count(o)};
  }
  function syncComparison(data,store){
    const toolbar=document.getElementById("berylToolbar");toolbar.hidden=!data.beryl;if(!data.beryl)return;
    const s=store.get(),n=comparison(data,store),toggle=document.getElementById("commonSupport");
    toggle.disabled=!n.capable;toggle.checked=n.enabled;
    document.getElementById("pairedSupport").textContent=!n.capable ? "Categories" : n.enabled ? `${n.paired.toLocaleString("en-US")} paired roads` : "";
    toolbar.querySelector('[data-overlay="track"]').checked=s.trackVisible;
    toolbar.querySelector('[data-overlay="evacuation"]').checked=s.evacuationVisible;
    V4H.syncFocus(data,store);
  }
  function inspector(data, store, host, row, current, receive, rerender) {
    const state = store.get(), tab = state.inspectorTab;
    if (tab === "observed") { root.V4Evidence.inspector(data, store, host, row, current, receive, rerender); return; }
    const categoryId = tab === "weather" ? "hazard" : tab === "impact" ? "impact" : "planning";
    if(tab === "planning"){V4J.planning(data,row,host);return;}
    host.append(T("h3", ({hazard:"Weather",impact:"Mobility Impact",planning:"Planning"})[categoryId], "evidence-heading"));
    const metrics = Object.values(C.metrics).filter(metric => tab === "weather" ? metric.categoryId === "hazard" && !["normalized_precipitation","normalized_gust","track_distance","weather"].includes(metric.key) : tab === "impact" ? metric.categoryId === "impact" : ["planning", "network"].includes(metric.categoryId) || metric.key === "weather");
    const grid = T("div", "", "metric-pair"); metrics.forEach(metric => grid.append(metricCard(data, row, metric.key, state.temperatureWindow))); host.append(grid);
    if (tab === "weather" && !data.beryl) {
      const temperature = Object.values(C.metrics).filter(metric => metric.temp);
      host.append(T("h3", "Temperature", "evidence-heading"));
      const label = T("label", "PRISM date labels", "field"), select = document.getElementById("temperatureWindow").cloneNode(true);
      select.id = "inspectorTemperatureWindow"; select.value = state.temperatureWindow;
      select.addEventListener("change", () => store.set({ temperatureWindow: select.value })); label.append(select); host.append(label);
      const context = T("div", "", "metric-pair"); temperature.forEach(metric => context.append(metricCard(data, row, metric.key, state.temperatureWindow))); host.append(context);
      const methods=T("a","Temperature methods ↗","text-action");methods.href=V4J.methodLink(data,"temperature");host.append(methods);
    }
    if (tab === "planning") host.append(T("p", C.metrics.potential.note, "evidence-note"));
    if (tab === "impact") {const methods=T("a","Valuation methods ↗","text-action");methods.href=V4J.methodLink(data,"impact");host.append(methods);}
    host.querySelectorAll("[data-metric]").forEach(node => node.classList.toggle("current-metric", node.dataset.metric === state.layer));
  }
  root.V4Presentation = Object.freeze({ phaseValid, recoveryEvidence, metricCard, phaseCards, counts, caption, scopeRows, compareSelectors, syncSelectors, pairSupported, comparison, syncComparison, tabFor, inspector });
})(window);
