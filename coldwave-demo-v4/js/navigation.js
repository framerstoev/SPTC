(function (root) {
  "use strict";
  const modules = [
    ["overview", "Overview", "M4 4h16v16H4z M4 10h16 M10 10v10"],
    ["analysis", "Analysis", "M5 20V12 M12 20V5 M19 20V9"],
    ["layers", "Layers", "m3 8 9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5"],
    ["timeseries", "Time Series", "M3 4v16h18 M5 14l4-5 4 7 6-11"],
    ["forecast", "Forecast", "M4 18l5-6 4 3 7-10 M15 5h5v5"],
    ["data", "Data", "M4 5h16v14H4z M4 10h16 M4 14h16 M10 5v14"],
    ["about", "About", "M12 10v7 M12 6v1 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"]
  ];
  function create(data, store, actions) {
    const C = root.V4Core, T = root.V4Inspector.text, $ = id => document.getElementById(id);
    const rail = $("moduleRail");
    modules.forEach(([id, label, path]) => {
      const button = document.createElement("button"); button.type = "button";
      button.dataset.module = id; button.title = label; button.setAttribute("aria-label", label);
      button.setAttribute("aria-controls", "contextPanel"); button.setAttribute("aria-expanded", "false");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
      const line = document.createElementNS(svg.namespaceURI, "path"); line.setAttribute("d", path); svg.append(line);
      button.append(svg, T("span", label)); button.addEventListener("click", () => open(store.get().panel === id ? null : id)); rail.append(button);
    });
    function open(id) { if (id !== null && !modules.some(m => m[0] === id)) return; store.set({ panel: id }); }
    $("collapsePanel").addEventListener("click", () => { const previous = store.get().panel; open(null); rail.querySelector(`[data-module="${previous}"]`)?.focus(); });
    $("contextPanel").addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); $("collapsePanel").click(); } });
    function heading(host, eyebrow, title, paragraphs) {
      const card = T("article", "", "module-card"); if (eyebrow) card.append(T("p", eyebrow, "eyebrow"));
      card.append(T("h2", title)); paragraphs.forEach(p => card.append(T("p", p))); host.append(card); return card;
    }
    function action(host, label, handler, className = "text-action") { const button = T("button", label, className); button.type = "button"; button.addEventListener("click", handler); host.append(button); return button; }
    const analysis = $("module-analysis");
    const planning = heading(analysis, "01 / PLANNING CONTEXT", "Planning / Potential", ["What do exposure, infrastructure and network context suggest? Accepted screening indicators describe potential disruption context."]);
    [["weather", "Tier 1 · WEATHER_REI"], ["network", "Tier 2 · NETRISK_LITE"], ["potential", "Potential Resilience"]].forEach(([key, label]) => action(planning, label + " ↗", () => actions.layer(key)));
    action(planning, "Open Planning evidence", () => actions.inspect("planning"));
    const observed = heading(analysis, "02 / OBSERVED EVIDENCE", "Observed / Tier 3", ["How did traffic performance change? Examine supported Q(t), Candidate B phases, minimum and recovery; missing support remains unavailable."]);
    action(observed, "Show Observed Score ↗", () => actions.layer("observed")); action(observed, "Open Time Series ↗", () => open("timeseries")); action(observed, "Compare Planning / Observed ↗", () => actions.workspace("compare"));
    const impact = heading(analysis, "03 / MOBILITY CONSEQUENCE", "Mobility Economic Impact", ["What expected-demand mobility delay burden accompanies event-period conditions? Vehicle delay hours and 2024 USD valuation are separate from resilience scores and total economic loss."]);
    action(impact, "Show Vehicle Delay Hours ↗", () => actions.layer("vehicle_delay")); action(impact, "Show Delay Cost ↗", () => actions.layer("mobility_cost")); action(impact, "View area breakdown ↗", actions.impact); action(impact, "Open selected-section Impact", () => actions.inspect("impact"));
    const groups = [["Weather Exposure", ["weather"]], ["Planning", ["network", "potential"]], ["Observed Performance", ["observed", "minimum", "loss", "recovery"]], ["Mobility Economic Impact", ["vehicle_delay", "mobility_cost"]], ["Experimental Temperature", ["temp_min", "temp_tmin_days", "temp_tmax_days"]]];
    groups.forEach(([name, keys]) => {
      const group = T("fieldset", "", "layer-group"); group.append(T("legend", name)); group.setAttribute("role", "radiogroup");
      keys.forEach(key => {
        const metric = C.metrics[key], button = T("button", "", "layer-option"); button.type = "button"; button.dataset.layer = key; button.setAttribute("role", "radio"); button.setAttribute("aria-checked", "false");
        button.append(T("span", metric.label.replace(/^Experimental · /, "")), T("small", metric.unit));
        button.disabled = Boolean(metric.temp) && data.mode !== root.V4Data.LOCAL;
        button.addEventListener("click", () => actions.layer(key)); group.append(button);
      }); $("layerGroups").append(group);
    });
    $("layerGroups").addEventListener("keydown", event => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...event.target.closest("fieldset").querySelectorAll("button:not(:disabled)")];
      const index = buttons.indexOf(event.target); if (index < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click(); buttons[next].focus();
    });
    const forecast = $("module-forecast");
    forecast.append(T("p", "PLANNED RESEARCH", "planned-badge"), T("h2", "Forecast — Planned Research", "module-title"), T("p", "Future versions will use historical events and roadway characteristics to estimate traffic disruption and recovery across time and locations with limited observations.", "panel-lead"));
    heading(forecast, "FUTURE / TIME", "Temporal Forecasting", ["Planned — model not yet available.", "Research goals include performance trajectories, disruption severity, recovery and mobility delay burden under specified event conditions."]);
    heading(forecast, "FUTURE / LOCATION", "Spatial Prediction", ["Planned — model not yet available.", "Roadway, weather, network and historical event attributes may support estimates for sections with limited observations. Predictions must be distinguished from measurements."]);
    const disabled = action(forecast, "Prediction unavailable", () => {}, "outline-button"); disabled.disabled = true;
    const roadmap = document.createElement("ol"); roadmap.className = "research-roadmap";
    ["Historical event database", "Training data preparation", "Model development", "Spatial / temporal validation", "Uncertainty assessment", "Deployment of reviewed predictions"].forEach(step => roadmap.append(T("li", step))); forecast.append(roadmap);
    const about = $("module-about");
    heading(about, "SPTC / RESEARCH PROGRAM", "One network. Different evidence.", ["Study transportation resilience through planning context, observed event performance and mobility-delay consequences. The January 2026 Texas cold wave is the current historical case study.", "WEATHER_REI remains precipitation-based. Temperature is a separate experimental extension. Expected-demand mobility delay cost is not total economic loss; these results are event-associated, not causal disaster-loss estimates.", "Future work includes a multi-event database, temporal forecasting and spatial prediction. Forecast models and predictions are not yet available."]);
    heading(about, "ATTRIBUTION", "Roadway Resilience Explorer", ["SPTC research project · Texas A&M Transportation Institute · Texas A&M University.", "This case-study prototype is not a permanent roadway resilience rating or an investment decision model."]);
    const docs = document.createElement("a"); docs.href = $("docsLink").href; docs.className = "text-action"; docs.textContent = "Read the documentation ↗"; about.append(docs);
    function summary() { const area = store.get().area; return area === "texas" ? data.eventSummary : data.countySummaries[area]; }
    function renderOverview() {
      const row = summary(), host = $("overviewContext"), metric = C.metrics[store.get().layer]; host.replaceChildren();
      const windows = data.manifest.windows;
      const dates = windows ? `${windows.economic_impact_start.slice(0, 10)} → ${windows.economic_impact_end.slice(0, 10)} (end exclusive)` : "No approved public event window";
      host.append(T("p", data.mode === root.V4Data.LOCAL ? "January 2026 · Texas winter weather" : "Public event package unavailable", "context-event"), T("p", `Registered impact window · ${dates}`, "evidence-note"), T("p", `Current Explore layer: ${metric.label} · ${metric.unit}`, "panel-lead"));
      const totals = T("div", "", "overview-totals");
      totals.append(root.V4Inspector.card("Expected-Demand Mobility Delay Cost", row?.expected_demand_mobility_delay_cost_2024usd, "2024 USD", { money: true, compact: true }), root.V4Inspector.card("Vehicle Delay Hours", row?.total_vehicle_delay_hours, "vehicle-hours", { compact: true })); host.append(totals);
      host.append(T("p", data.mode === root.V4Data.LOCAL ? "REVIEW_READY / NOT_APPROVED · matched reporting domain" : "No approved public result is bundled.", "evidence-note"));
      const selected = data.byId.get(store.get().selectedId), selection = $("overviewSelection"); selection.replaceChildren();
      selection.append(T("h2", selected ? `Selected · CS_${selected.id}` : "Select a roadway", "module-title"), T("p", selected ? `${selected.county_name} County · ${C.statusLabel(selected)}` : "Click a line or search by control-section ID, route or county.", "panel-lead"));
      if (selected) action(selection, "Open selected-section evidence ↗", () => actions.inspect("observed"));
    }
    function renderData() {
      const host = $("module-data"); host.replaceChildren();
      const local = data.mode === root.V4Data.LOCAL;
      const network = heading(host, "PACKAGE / COVERAGE", "Supported roadway domain", []);
      const dl = document.createElement("dl"); dl.className = "coverage-list";
      const entries = local ? [["Control sections", data.rows.length], ["Observed Q(t) support", data.rows.filter(r => r.has_curve).length], ["County filters", data.counties.length], ["County impact summaries", Object.keys(data.countySummaries).length], ["Sections with impact evidence", data.rows.filter(r => C.number(r.total_vehicle_delay_hours) !== null).length]] : [["Public analytical package", "Unavailable"]];
      entries.forEach(([label, value]) => dl.append(T("dt", label), T("dd", typeof value === "number" ? C.format(value, { digits: 0 }) : value))); network.append(dl);
      heading(host, "SOURCES / VINTAGE", "A linked evidence package", ["TxDOT control-section network; PRISM daily weather; NPMRDS speed / travel time; expected/profile traffic exposure; frozen economic valuation method in 2024 USD.", "Temperature: PRISM D2 release 8. Existing precipitation retains its earlier frozen vintage. No raw probe records or ledgers are served.", "Coverage is uneven. County filtering uses the accepted primary-county attribution; missing summaries are unavailable."]);
      if (local) {
        const provenance = heading(host, "AUTHORITATIVE LOCAL PACKAGE", data.manifest.event_id, [`Run: ${data.manifest.run_id}`, `${data.manifest.status} / ${data.manifest.approval_status}`]);
        const details = document.createElement("details"); details.append(T("summary", "Method versions and registered windows"));
        const pre = T("pre", JSON.stringify({ method_versions: data.manifest.method_versions, windows: data.manifest.windows, temperature_windows: data.manifest.temperature_windows }, null, 2)); details.append(pre); provenance.append(details);
      }
      heading(host, "PUBLICATION / QUALITY", "Know the boundary", [local ? "Authorized local review preview. Results are not approved for public redistribution." : "PUBLIC_SHOWCASE contains interface code and empty approved metadata. Analytical values are unavailable pending publication review.", "No observed support is not zero resilience. No sustained drop does not prove no impact. Censored recovery is not confirmed recovery. Daily air temperature is not measured pavement icing."]);
    }
    renderData(); renderOverview();
    function render(state, previous = {}) {
      $("contextPanel").hidden = state.panel === null;
      $("appLayout").classList.toggle("panel-open", state.panel !== null);
      modules.forEach(([id, label], i) => {
        const active = state.panel === id, button = rail.querySelector(`[data-module="${id}"]`);
        button.setAttribute("aria-expanded", String(active)); button.classList.toggle("active", active);
        $("module-" + id).hidden = !active;
        if (active) { $("panelTitle").textContent = label; $("panelEyebrow").textContent = `0${i + 1} / RESEARCH EXPLORER`; }
      });
      document.querySelectorAll("[data-layer]").forEach(btn => btn.setAttribute("aria-checked", String(btn.dataset.layer === state.layer)));
      if (["area", "layer", "selectedId"].some(key => state[key] !== previous[key])) renderOverview();
      if (state.panel !== previous.panel) $("contextPanel").querySelector(".context-scroll").scrollTop = 0;
    }
    return { open, render, modules };
  }
  root.V4Navigation = Object.freeze({ create, modules });
})(window);
