(async function () {
  "use strict";
  const C = V4Core, $ = id => document.getElementById(id);
  const store = C.store({ workspace: "explore", panel: null, inspectorOpen: false, area: "texas", layer: "potential", planningLayer: "potential", observedLayer: "observed", temperatureWindow: "legacy_labels", selectedId: null, inspectorTab: "observed" });
  const empty = { mode: V4Data.PUBLIC, manifest: {}, rows: [], byId: new Map(), geometry: { type: "FeatureCollection", features: [] }, counties: [], countySummaries: {}, eventSummary: null, curveCache: new Map() };
  let data;
  try { data = await V4Data.load(); } catch (error) { data = { ...empty, note: "Data package unavailable or invalid. No analytical values have been loaded." }; $("loadStatus").dataset.error = "true"; }
  const local = data.rows.length > 0;
  $("modeBadge").textContent = V4Data.label(data);
  $("loadStatus").textContent = local ? "" : data.note;
  data.counties.forEach(county => $("areaSelect").append(new Option(county.name, county.id)));
  $("areaSelect").disabled = !local;
  $("eventSelect").replaceChildren(new Option(local ? "January 2026 · Texas cold wave" : "Public event data pending", local ? data.manifest.event_id : ""));
  $("eventSelect").disabled = !local;
  $("publicEmpty").hidden = local;
  $("eventWindow").textContent = local ? "Impact Window · Jan 22–27, 2026" : "No approved public event package";
  const areaName = () => store.get().area === "texas" ? "Texas matched domain" : `${data.counties.find(c => c.id === store.get().area)?.name || "Unknown"} County`;
  function select(id, focus = false) {
    if (!data.byId.has(id)) return;
    const row = data.byId.get(id);
    if (store.get().area !== "texas" && row.county_fips !== store.get().area) store.set({ area: "texas" });
    store.set({ selectedId: id, inspectorOpen: true });
    if (focus) requestAnimationFrame(() => maps.focus(id));
  }
  const maps = V4Maps.create(data, store, select), inspector = V4Inspector.create(data, store);
  if (data.mode === V4Data.LOCAL) $("docsLink").href = "./docs.html?mode=LOCAL_RESEARCH_PREVIEW";
  const navigation = V4Navigation.create(data, store, {
    layer: key => store.set({ workspace: "explore", layer: key }),
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
    const state = store.get(), metric = C.metrics[state.layer];
    $("mapTitle").textContent = metric.label;
    $("exploreEyebrow").textContent = metric.group.toUpperCase();
    $("mapSubtitle").textContent = `${areaName()} · ${metric.temp ? (state.temperatureWindow === "legacy_labels" ? "Jan 22–27 labels" : "Jan 22–28 labels") : "January 2026"}`;
    $("layerDescription").textContent = metric.note;
    $("temperatureControl").hidden = !metric.temp;
    $("temperatureWindow").value = state.temperatureWindow;
    $("areaSelect").value = state.area;
    $("visibleCount").textContent = data.rows.filter(r => state.area === "texas" || r.county_fips === state.area).length.toLocaleString("en-US");
    const row = data.byId.get(state.selectedId);
    $("reopenInspector").hidden = !row || state.inspectorOpen || state.panel === "timeseries";
    $("reopenInspector").textContent = row ? `CS_${row.id} · inspect ↗` : "Selected road";
    $("map-footer")?.setAttribute("aria-live", "polite");
  }
  function workspace(name) {
    if (!["explore", "compare"].includes(name)) return;
    store.set({ workspace: name });
  }
  store.subscribe((state, old) => {
    if (state.workspace !== old.workspace) {
      ["explore", "compare"].forEach(name => $(`${name}Workspace`).hidden = name !== state.workspace);
      document.querySelectorAll("[data-workspace]").forEach(btn => { if (btn.dataset.workspace === state.workspace) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current"); });
      maps.activate(state.workspace);
      inspector.render();
    }
    if (["selectedId", "inspectorTab", "temperatureWindow", "inspectorOpen", "panel"].some(key => state[key] !== old[key])) {
      inspector.render();

    }
    if (state.area !== old.area) { renderImpact(); maps.fit(); }
    if (["area", "layer", "planningLayer", "observedLayer", "temperatureWindow", "selectedId"].some(k => state[k] !== old[k])) maps.render();
    navigation.render(state, old);
    if (state.selectedId !== old.selectedId || state.panel !== old.panel) timeSeries.render();
    renderHeader();
  });
  document.querySelectorAll("[data-workspace]").forEach(btn => btn.addEventListener("click", () => workspace(btn.dataset.workspace)));
  document.querySelector(".brand").addEventListener("click", event => { event.preventDefault(); workspace("explore"); });
  $("emptyMethods").addEventListener("click", () => navigation.open("data"));
  $("openLayers").addEventListener("click", () => navigation.open("layers"));
  $("areaSelect").addEventListener("change", event => { const area = event.target.value; const selected = data.byId.get(store.get().selectedId); store.set({ area, selectedId: selected && area !== "texas" && selected.county_fips !== area ? null : store.get().selectedId }); });
  $("eventSelect").addEventListener("change", () => { if ($("eventSelect").value !== data.manifest.event_id) return; store.set({ area: "texas", selectedId: null }); maps.fit(); });
  $("planningLayer").addEventListener("change", event => store.set({ planningLayer: event.target.value }));
  $("observedLayer").addEventListener("change", event => store.set({ observedLayer: event.target.value }));
  $("temperatureWindow").addEventListener("change", event => store.set({ temperatureWindow: event.target.value }));
  ["resetExplore", "resetCompare"].forEach(id => $(id).addEventListener("click", () => maps.fit()));
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
      body.append(V4Inspector.text("p", `${V4Data.reviewLabel(data)} · Jan 22–27, 2026. Expected/profile demand, not observed event-day volume. Not total economic loss.`, "evidence-note"));
    }
    $("impactDrawer").showModal(); $("impactDetails").setAttribute("aria-expanded", "true");
  }
  $("impactDetails").addEventListener("click", showImpact);
  document.querySelector('[data-action="impact"]').addEventListener("click", showImpact);
  $("closeImpact").addEventListener("click", () => $("impactDrawer").close());
  $("impactDrawer").addEventListener("close", () => $("impactDetails").setAttribute("aria-expanded", "false"));
  $("impactDrawer").addEventListener("click", event => { if (event.target === $("impactDrawer")) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
  let resizeFrame = 0;
  new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => maps.resize()); }).observe($("main"));
  navigation.render(store.get());
  V4Guide.create(store);
  renderImpact(); renderHeader(); maps.fit();
  rootReady();
  function rootReady() { window.v4App = Object.freeze({ store, data, maps, select, workspace, navigation, timeSeries, ready: true }); }
})();
