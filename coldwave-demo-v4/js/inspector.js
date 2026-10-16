(function (root) {
  "use strict";
  const C = root.V4Core;
  function text(tag, content, className) { const el = document.createElement(tag); el.textContent = content; if (className) el.className = className; return el; }
  function card(label, value, unit, options = {}) {
    const node = document.createElement("div"); node.className = "metric-card";
    const strong = text("strong", C.format(value, options)); strong.title = value === null || value === undefined ? "Unavailable" : `${value} ${unit}`;
    node.append(text("span", label), strong, text("small", unit)); return node;
  }
  function create(data, store) {
    let chart = null, generation = 0;
    const body = document.getElementById("inspectorBody"), panel = document.getElementById("sectionInspector");
    function render() {
      const token = ++generation, state = store.get(), row = data.byId.get(state.selectedId);
      chart?.destroy(); chart = null;
      panel.hidden = !row || !state.inspectorOpen || state.panel === "timeseries";
      document.getElementById("appLayout").classList.toggle("has-inspector", !panel.hidden);
      if (!row || panel.hidden) { body.replaceChildren(); return; }
      document.getElementById("sectionTitle").textContent = `CS_${row.id}`;
      document.getElementById("sectionContext").textContent = `${row.route?.replaceAll("_", " ").trim() || "Route unavailable"} · ${row.county_name} County`;
      document.getElementById("sectionStatus").textContent = C.statusLabel(row);
      document.querySelectorAll("[data-inspector-tab]").forEach(btn => { const active = btn.dataset.inspectorTab === state.inspectorTab; btn.setAttribute("aria-selected", active); btn.tabIndex = active ? 0 : -1; });
      body.replaceChildren();
      body.dataset.tab = state.inspectorTab;
      const grid = document.createElement("div"); grid.className = "metric-pair";
      if (state.inspectorTab === "weather") {
        body.append(text("h3", "Weather Exposure", "evidence-heading"), text("p", "Accepted precipitation context and separate experimental air-temperature evidence.", "evidence-description"));
        grid.append(card("Tier 1 · Weather Exposure", row.WEATHER_REI, "index · 0–1"), card("Six-day precipitation", row.P_SUM6, "mm · Jan 22–27 labels")); body.append(grid);
        if (row.temperature) {
          body.append(text("h3", "Experimental temperature", "evidence-heading"));
          const label = text("label", "PRISM date labels", "field"), select = document.createElement("select"); select.id = "inspectorTemperatureWindow"; select.setAttribute("aria-label", "Inspector PRISM temperature window");
          [["legacy_labels", "Jan 22–27 · legacy labels"], ["temporal_overlap_labels", "Jan 22–28 · temporal overlap"]].forEach(([value, title]) => { const option = new Option(title, value); option.selected = value === state.temperatureWindow; select.append(option); });
          select.addEventListener("change", () => store.set({ temperatureWindow: select.value })); label.append(select); body.append(label);
          const temp = row.temperature[state.temperatureWindow];
          body.append(card("Minimum daily buffer-mean Tmin", temp?.minimum_daily_buffer_mean_tmin_c, "°C"), card("Days with buffer-mean Tmin < 0°C", temp?.tmin_below_zero_days, "PRISM days"), card("Days with buffer-mean Tmax < 0°C", temp?.tmax_below_zero_days, "PRISM days"));
        } else body.append(text("p", "Temperature research data are unavailable in this package.", "evidence-note"));
        body.append(text("p", "400 m buffers · means of valid grid cells. PRISM dates end at 12:00 UTC (06:00 CST / 05:00 MST in January). Daily air temperature does not measure pavement icing or freezing hours.", "evidence-note"));
      } else if (state.inspectorTab === "planning") {
        body.append(text("h3", "Planning / Potential", "evidence-heading"), text("p", "Separate views of precipitation exposure, network context and the accepted combined planning representation.", "evidence-description"));
        grid.append(card("Potential Resilience", row.Potential_Resilience_Score, "index · higher is more favorable"), card("Tier 1 · Weather Exposure", row.WEATHER_REI, "index · higher is more concern"), card("Tier 2 · Network Context", row.NETRISK_LITE, "index · higher is more concern"), card("AADT", row.AADT_CS, "vehicles/day", { digits: 0 })); body.append(grid, text("p", "Planning indicators do not predict the observed traffic response. Temperature attributes are not incorporated into the accepted Tier 1 formula.", "evidence-note"));
      } else if (state.inspectorTab === "impact") {
        body.append(text("h3", "Mobility Impact", "evidence-heading"), text("p", "Section-level expected-demand delay evidence during the authoritative impact window.", "evidence-description"));
        body.append(card("Vehicle Delay Hours", row.total_vehicle_delay_hours, "vehicle-hours"), card("Expected-Demand Mobility Delay Cost", row.expected_demand_mobility_delay_cost_2024usd, "2024 USD", { money: true, compact: true }));
        body.append(text("p", "REVIEW_READY / NOT_APPROVED · Local research preview. Expected/profile demand, not observed event-day volume or total economic loss. Section-level passenger/commercial breakdowns are not available.", "evidence-note"));
      } else {
        body.append(text("h3", "Observed Performance", "evidence-heading"), text("p", C.statusLabel(row), "evidence-description"));
        grid.append(card("Score", C.value(row, "observed"), "experimental index · 0–1"), card("Minimum Q", row.q_min, "Q ratio"), card("Loss Area", row.resilience_loss_area, "Q-hours"), card("Recovery", row.recovery_duration_hours, "hours")); body.append(grid);
        const seriesButton = text("button", "Open Time Series module ↗", "text-action"); seriesButton.dataset.action = "timeseries";
        seriesButton.addEventListener("click", () => store.set({ panel: "timeseries", inspectorOpen: false })); body.append(seriesButton);
        if (!row.has_curve) { body.append(text("p", "No observed Q(t) support is available. Missing evidence is not zero resilience.", "evidence-note")); return; }
        body.append(text("h3", "Q(t) · operational window", "evidence-heading"));
        const wrap = document.createElement("div"); wrap.className = "chart-wrap"; const canvas = document.createElement("canvas"); canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `Accepted Q(t) curve for CS_${row.id}`); wrap.append(canvas);
        const note = text("p", "Loading accepted curve…", "curve-status"); body.append(wrap, note);
        root.V4Data.curve(data, row.id).then(payload => {
          if (token !== generation || !canvas.isConnected) return;
          chart = root.V4Charts.draw(canvas, payload, row);
          note.textContent = row.status === "no_sustained_drop" ? "No sustained drop under Candidate B. This does not prove that the road was unaffected." : row.status === "recovery_endpoint_censored" ? "Recovery endpoint is censored; it does not establish confirmed recovery." : "Candidate B · dominant sustained drop. Original timestamps and accepted curve values retained.";
          const legend = document.createElement("div"); legend.className = "phase-legend";
          [["#176663", "Smoothed Q"], ["#ba8b45", "Onset"], ["#a54f52", "Minimum"], ["#547da0", row.status === "recovery_endpoint_censored" ? "Censored endpoint" : "Recovery endpoint"]].forEach(([color, name]) => { if (row.status === "no_sustained_drop" && name !== "Smoothed Q") return; const item = document.createElement("span"), mark = document.createElement("i"); mark.style.background = color; item.append(mark, document.createTextNode(name)); legend.append(item); });
          wrap.after(legend);
        }).catch(() => { if (token === generation) { wrap.hidden = true; note.textContent = "The curve could not be loaded. Other section evidence remains available."; } });
        body.append(text("p", "Q = observed speed / expected baseline speed. A centered six-observation median, 0.90 × Q0 threshold and three consecutive observations identify the phase. Observation gaps remain gaps; high speed does not establish normal access or safety.", "evidence-note"));
      }
    }
    return { render };
  }
  root.V4Inspector = Object.freeze({ create, card, text });
})(window);
