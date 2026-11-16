(async function () {
  "use strict";
  const C = V4Core, $ = id => document.getElementById(id);
  const store = C.store({ eventId: "coldwave_2026_01", seriesRange: "event", commonSupport: false, impactFocus: false, displayModeNotice: "", trackVisible: true, workspace: "compare", planningVisible: true, observationVisible: true, evacuationVisible: false, panel: null, inspectorOpen: false, area: "texas", layer: "potential", planningLayer: "potential", observedLayer: "observed", temperatureWindow: "legacy_labels", selectedId: null, inspectorTab: "observed" });
  const empty = { mode: V4Data.PUBLIC, manifest: {}, rows: [], byId: new Map(), geometry: { type: "FeatureCollection", features: [] }, counties: [], countySummaries: {}, eventSummary: null, curveCache: new Map() };
  let data;
  try { data = await V4Events.load(new URL(location.href).searchParams.get("event")); } catch (error) {
    $("loadStatus").dataset.error = "true";$("loadStatus").setAttribute("role","alert");
    $("loadStatus").textContent="Map data could not be loaded or verified. Check the connection and reload.";
    $("appLayout").hidden=true;window.v4StartupError={requiredDataUnavailable:true};return;
  }
  const requestedEvent = new URL(location.href).searchParams.get("event");
  const explicitEvent = ["coldwave_2026_01","beryl_2024_07"].includes(requestedEvent) && requestedEvent === data.eventId;
  let local = data.rows.length > 0, suspended = false, eventGeneration = 0;
  V4Events.setMetrics(data); store.set({ eventId:data.eventId || "coldwave_2026_01", panel:explicitEvent ? null : "overview", seriesPhaseContext:data.beryl ? "o1b" : null, impactFocus:Boolean(data.beryl), ...V4Metrics.defaults(data.eventId || "coldwave_2026_01") });
  function configureEventUI() {
    $("areaSelect").replaceChildren(new Option("Texas Study Area","texas"));
    data.counties.forEach(county => $("areaSelect").append(new Option(county.name,county.id)));
    $("areaSelect").disabled=!local;
    $("hazardSelect").value=data.beryl ? "hurricane" : "winter_weather";
    $("eventSelect").replaceChildren(new Option(data.beryl ? "Hurricane Beryl — July 2024" : "January 2026 · Texas cold wave",data.eventId));
    $("eventSelect").disabled=!local;
    $("eventWindow").textContent=data.beryl ? "Impact Window · Jul 7–9, 2024 · native local" : "Impact Window · Jan 22–27, 2026";
    V4Presentation.compareSelectors(data);
    $("activeEvent").textContent=data.beryl ? "Hurricane Beryl · July 2024" : "Texas Cold Wave · January 2026";
    $("overviewImpactMethods").href=data.beryl ? "./docs.html?event=beryl_2024_07#impact" : "./docs.html#impact";
    $("docsLink").href=data.beryl ? "./docs.html?event=beryl_2024_07" : data.mode === V4Data.LOCAL ? "./docs.html?mode=LOCAL_RESEARCH_PREVIEW" : "./docs.html";
    $("modeBadge").textContent=V4Data.label(data);

    $("evacuationControls").hidden=!data.beryl;
  }
  $("modeBadge").textContent = V4Data.label(data);
  $("loadStatus").textContent = local ? "" : data.note;
  
  $("areaSelect").disabled = !local;
  
  $("eventSelect").disabled = !local;
  $("compareWorkspace").hidden = false;
  configureEventUI();
  const areaName = () => store.get().area === "texas" ? "Texas Study Area" : `${data.counties.find(c => c.id === store.get().area)?.name || "Unknown"} County`;
  function select(id, focus = false) {
    if (!data.byId.has(id)) return;
    const row = data.byId.get(id);
    if (store.get().area !== "texas" && row.county_fips !== store.get().area) store.set({ area: "texas" });
    store.set({ selectedId: id, inspectorOpen: true, seriesRange: "event" });
    if (focus) requestAnimationFrame(() => maps.focus(id));
  }
  const maps = V4Maps.create(data, store, select), inspector = V4Inspector.create(data, store);
  
  const navigation = V4Navigation.create(data, store, {
    layer: chooseMetric,
    workspace,
    inspect: tab => { if (store.get().selectedId) store.set({ inspectorTab: tab, inspectorOpen: true, panel: store.get().panel === "timeseries" ? null : store.get().panel }); else navigation.open("timeseries"); },
    impact: showImpact
  });
  const timeSeries = V4TimeSeries.create(data, store);
  function summary() { return store.get().area === "texas" ? data.eventSummary : data.countySummaries[store.get().area]; }
  function renderImpact() {
    const row = summary();
    $("impactArea").textContent = areaName();
    $("areaCost").textContent = C.format(row?.expected_demand_mobility_delay_cost_2024usd, { money: true, compact: true });
    $("areaHours").textContent = C.format(row?.total_vehicle_delay_hours, { compact: true });
    $("impactReview").textContent = local ? V4Data.reviewLabel(data) : "Public result unavailable";
    for (const [id, field] of [["areaCost", "expected_demand_mobility_delay_cost_2024usd"], ["areaHours", "total_vehicle_delay_hours"]]) $(id).title = row?.[field] == null ? "Unavailable" : String(row[field]);
  }
  function renderHeader() {
    V4Presentation.syncSelectors(data,store);
    V4Presentation.syncComparison(data,store);
    const state = store.get(), metric = C.metrics[state.layer];
    $("layerDescription").textContent = metric.note;
    $("temperatureControl").hidden = !metric.temp;
    $("temperatureWindow").value = state.temperatureWindow;
    $("areaSelect").value = state.area;
    $("visibleCount").textContent = data.rows.filter(r => state.area === "texas" || r.county_fips === state.area).length.toLocaleString("en-US");
    $("areaSupport").textContent = V4Presentation.caption(data,state.area,state.layer,state.temperatureWindow);
    $("visibleCount").parentElement.lastChild.textContent=" study sections in selected area";
    const row = data.byId.get(state.selectedId);
    $("reopenInspector").hidden = !row || state.inspectorOpen || state.panel === "timeseries";
    $("reopenInspector").textContent = row ? `CS_${row.id} · inspect ↗` : "Selected road";
    $("map-footer")?.setAttribute("aria-live", "polite");
  }
  function workspace() { /* Compatibility for the native tour: one evidence workspace. */ }
  function toggleView(name) {
    const key=name === "planning" ? "planningVisible" : "observationVisible", other=name === "planning" ? "observationVisible" : "planningVisible", state=store.get();
    if (state[key] && !state[other]) return;
    store.set({[key]:!state[key]});
  }
  function renderViews(previous = {}) {
    const state=store.get();
    document.querySelectorAll("[data-view]").forEach(button=>{const key=button.dataset.view==="planning" ? "planningVisible" : "observationVisible",other=key==="planningVisible" ? "observationVisible" : "planningVisible";button.setAttribute("aria-pressed",String(state[key]));button.setAttribute("aria-disabled",String(state[key]&&!state[other]));});
    $("planningMap").closest("article").hidden=!state.planningVisible;
    $("observedMap").closest("article").hidden=!state.observationVisible;
    document.querySelector(".comparison-maps").classList.toggle("single-view",!(state.planningVisible&&state.observationVisible));
    maps.activate(previous);
  }
  function chooseMetric(key) {
    const metric=C.metrics[key];if(!metric)return;
    const planning=["planning","hazard","network"].includes(metric.categoryId)&&!metric.temp;
    const side=planning ? "planningLayer" : "observedLayer";
    const context = data.beryl && !planning ? {seriesPhaseContext:["phase_score","minimum","loss","recovery"].includes(key) ? "b4" : "o1b",seriesRange:"event"} : {};
    store.set({layer:key,[side]:key,inspectorTab:V4Presentation.tabFor(key),[planning?"planningVisible":"observationVisible"]:true,...context,...(metric.kind==="category"?{commonSupport:false}:{})});
  }
  store.subscribe((state, old) => {
    if (suspended) return;
    if (state.planningVisible !== old.planningVisible || state.observationVisible !== old.observationVisible) renderViews(old);
    if (["selectedId", "inspectorTab", "temperatureWindow", "inspectorOpen", "panel", "seriesRange", "seriesPhaseContext", "observedLayer"].some(key => state[key] !== old[key])) {
      inspector.render();

    }
    if (state.area !== old.area) { renderImpact(); maps.fit(); }
    if (["area", "layer", "planningLayer", "observedLayer", "temperatureWindow", "selectedId", "trackVisible", "evacuationVisible", "commonSupport", "impactFocus", "displayModeNotice"].some(k => state[k] !== old[k])) maps.render();
    navigation.render(state, old);
    if (["selectedId","panel","seriesRange","seriesPhaseContext","observedLayer"].some(key=>state[key]!==old[key])) timeSeries.render();
    V4Presentation.syncSelectors(data,store);
    renderHeader();
  });
  document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>toggleView(button.dataset.view)));
  document.querySelector(".brand").addEventListener("click",event=>{event.preventDefault();navigation.open("overview");});
  $("areaSelect").addEventListener("change", event => { const area = event.target.value; const selected = data.byId.get(store.get().selectedId); store.set({ area, selectedId: selected && area !== "texas" && selected.county_fips !== area ? null : store.get().selectedId }); });
  async function switchEvent(id) {
    const token=++eventGeneration, previous=store.get().eventId;
    if (id === previous) { configureEventUI(); $("loadStatus").textContent=""; return; }
    $("loadStatus").textContent="Loading event…";$("loadStatus").removeAttribute("data-error");
    for (const dialog of [$("seriesDialog"),$("impactDrawer"),$("guideDialog")]) if (dialog.open) dialog.close();
    try {
      const next=await V4Events.load(id);
      if (token !== eventGeneration) return;
      suspended=true;
      Object.keys(data).forEach(key=>delete data[key]);Object.assign(data,next);V4Events.setMetrics(data);local=data.rows.length>0;
      store.set({eventId:id,area:"texas",selectedId:null,inspectorOpen:false,...V4Metrics.defaults(id),temperatureWindow:"legacy_labels",seriesRange:"event",seriesPhaseContext:next.beryl ? "o1b" : null,trackVisible:true,evacuationVisible:false,commonSupport:false,impactFocus:Boolean(next.beryl),displayModeNotice:""});
      suspended=false;configureEventUI();maps.refresh();renderViews();
      inspector.render();timeSeries.render();navigation.render(store.get(),{...store.get(),eventId:previous});
      input.value="";searchRows=[];closeSearch();renderImpact();renderHeader();maps.fit();
      const url=new URL(location.href);if(data.beryl)url.searchParams.set("event",id);else url.searchParams.delete("event");history.replaceState(null,"",url);
      $("loadStatus").textContent="";
    } catch(error) {
      if(token!==eventGeneration)return;
      suspended=false;configureEventUI();$("loadStatus").dataset.error="true";$("loadStatus").textContent="This event could not be loaded. Your current map is unchanged.";
    }
  }
  $("hazardSelect").addEventListener("change",event=>switchEvent(event.target.value === "hurricane" ? "beryl_2024_07" : "coldwave_2026_01"));
  $("eventSelect").addEventListener("change",event=>switchEvent(event.target.value));
  $("resetComparison").addEventListener("click",()=>store.set({...V4Metrics.defaults(data.eventId),seriesRange:"event",seriesPhaseContext:data.beryl?"o1b":null,planningVisible:true,observationVisible:true}));
  $("commonSupport").addEventListener("change",event=>{if(data.beryl)store.set({commonSupport:event.target.checked,...(event.target.checked?{impactFocus:false,displayModeNotice:"Common Support on · Impact Focus off"}:{displayModeNotice:""})});});
  $("impactFocus").addEventListener("change",event=>{if(data.beryl)store.set({impactFocus:event.target.checked,...(event.target.checked?{commonSupport:false,displayModeNotice:"Impact Focus on · Common Support off"}:{displayModeNotice:""})});});
  for(const [kind,key] of [["track","trackVisible"],["evacuation","evacuationVisible"]]){
    document.querySelector(`#berylToolbar [data-overlay="${kind}"]`).addEventListener("change",event=>{if(data.beryl)store.set({[key]:event.target.checked});});
  }
  document.querySelector('[data-overlay-fit="texas"]').addEventListener("click",()=>maps.fit());
  document.querySelector('[data-overlay-fit="full"]').addEventListener("click",()=>maps.fitTrack());
  $("temperatureWindow").addEventListener("change", event => store.set({ temperatureWindow: event.target.value }));
  ["resetCompare"].forEach(id => $(id).addEventListener("click", () => maps.fit()));
  $("clearSelection").addEventListener("click", () => store.set({ selectedId: null, inspectorOpen: false }));
  $("hideInspector").addEventListener("click", () => store.set({ inspectorOpen: false }));
  $("reopenInspector").addEventListener("click", () => store.set({ inspectorOpen: true }));
  document.querySelectorAll("[data-inspector-tab]").forEach(btn => {
    btn.addEventListener("click", () => store.set({ inspectorTab: btn.dataset.inspectorTab }));
    btn.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const buttons = [...document.querySelectorAll("[data-inspector-tab]")]; const current = buttons.indexOf(btn);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click(); buttons[next].focus();
    });
  });
  const input = $("sectionSearch"), results = $("searchResults"); let searchRows = [];
  function closeSearch() { results.hidden = true; input.setAttribute("aria-expanded", "false"); }
  function choose(row) { closeSearch(); input.value = `CS_${row.id}`; select(row.id, true); }
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase().replace(/^cs[_\s-]?/, "");
    if (!query) { closeSearch(); return; }
    searchRows = data.rows.filter(row => row.id === query || `${row.id} ${row.route} ${row.county_name}`.toLowerCase().includes(query)).sort((a, b) => (b.id === query) - (a.id === query)).slice(0, 7);
    results.replaceChildren();
    searchRows.forEach(row => { const btn = document.createElement("button"); btn.type = "button"; btn.setAttribute("role", "option"); btn.append(V4Inspector.text("strong", `CS_${row.id}`), V4Inspector.text("small", `${row.route?.replaceAll("_", " ").trim()} · ${row.county_name}`)); btn.addEventListener("click", () => choose(row)); results.append(btn); });
    if (!searchRows.length) results.append(V4Inspector.text("p", local ? "No matching section." : "Search becomes available with an approved data package.", "hint"));
    results.hidden = false; input.setAttribute("aria-expanded", "true");
  });
  input.addEventListener("keydown", event => { if (event.key === "Enter" && searchRows[0]) { event.preventDefault(); choose(searchRows[0]); } if (event.key === "Escape") closeSearch(); if (event.key === "ArrowDown") { event.preventDefault(); results.querySelector("button")?.focus(); } });
  results.addEventListener("keydown", event => { const buttons = [...results.querySelectorAll("button")], i = buttons.indexOf(document.activeElement); if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); buttons[(i + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } if (event.key === "Escape") { closeSearch(); input.focus(); } });
  document.addEventListener("click", event => { if (!event.target.closest(".search-box")) closeSearch(); });
  function showImpact() {
    const row = summary(), body = $("impactDrawerBody"); body.replaceChildren();
    $("impactDrawerTitle").textContent = `${areaName()} · Mobility Impact`;
    if (!row) body.append(V4Inspector.text("p", local ? "No accepted impact summary is available for the selected county." : "No publication-approved monetary result is included in this package.", "evidence-description"));
    else {
      const groups = [
        ["Expected-demand totals", [["Expected-Demand Mobility Delay Cost", "expected_demand_mobility_delay_cost_2024usd", "2024 USD", true], ["Vehicle Delay Hours", "total_vehicle_delay_hours", "vehicle-hours", false]]],
        ["Cost breakdown", [["Passenger delay cost", "passenger_delay_cost_2024usd", "2024 USD", true], ["Commercial operator delay cost", "commercial_operator_delay_cost_2024usd", "2024 USD", true]]],
        ["Physical breakdown", [["Passenger person-hours", "passenger_person_delay_hours", "person-hours", false], ["Commercial / heavy vehicle-hours", "commercial_vehicle_delay_hours", "vehicle-hours", false]]]
      ];
      groups.forEach(([title, fields]) => { body.append(V4Inspector.text("h3", title)); const grid = document.createElement("div"); grid.className = "metric-pair"; fields.forEach(([label, field, unit, money]) => grid.append(V4Inspector.card(label, row[field], unit, { compact: true, money }))); body.append(grid); });
      body.append(V4Inspector.text("p", `Support: ${C.format(row.contributing_tmc_hours, { digits: 0 })} contributing TMC-hours; ${C.format(row.unique_contributing_tmcs, { digits: 0 })} contributing TMCs. Represented profile exposure: ${C.format(row.represented_profile_exposure, { digits: 0 })}.`, "evidence-note"));
      body.append(V4Inspector.text("p", `${V4Data.reviewLabel(data)} · ${data.beryl ? "July 7–9, 2024. Conditional expected-demand positive excess travel-time cost; not total causal hurricane loss." : "Jan 22–27, 2026. Expected/profile demand, not observed event-day volume. Not total economic loss."}`, "evidence-note"));
    }
    $("impactDrawer").showModal(); $("impactDetails").setAttribute("aria-expanded", "true");
  }
  $("impactDetails").addEventListener("click", showImpact);
  $("closeImpact").addEventListener("click", () => $("impactDrawer").close());
  $("impactDrawer").addEventListener("close", () => $("impactDetails").setAttribute("aria-expanded", "false"));
  $("impactDrawer").addEventListener("click", event => { if (event.target === $("impactDrawer")) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
  let resizeFrame = 0;
  const mapResizeObserver=new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => maps.resize()); });
  mapResizeObserver.observe($("main"));mapResizeObserver.observe(document.querySelector(".comparison-maps"));
  document.querySelectorAll(".map-canvas").forEach(canvas=>mapResizeObserver.observe(canvas));
  navigation.render(store.get());
  const layout = V4Layout.create(store);
  const guide = V4Guide.create(store);
  renderImpact(); renderHeader(); renderViews(); maps.fit();
  rootReady();
  guide.autoStart();
  function rootReady() { window.v4App = Object.freeze({ store, data, maps, select, workspace, toggleView, chooseMetric, navigation, timeSeries, layout, switchEvent, ready: true }); }
})();
