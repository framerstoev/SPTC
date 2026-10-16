(function (root) {
  "use strict";
  function create(data, store) {
    const T = root.V4Inspector.text, C = root.V4Core;
    const dialog = document.getElementById("seriesDialog"), body = document.getElementById("timeSeriesBody"), expanded = document.getElementById("expandedSeriesBody");
    let generation = 0, charts = [], resizeToken = 0;
    function destroy() { charts.forEach(chart => chart.destroy()); charts = []; }
    function draw(host, large, token) {
      const row = data.byId.get(store.get().selectedId); host.replaceChildren();
      if (!row) { host.append(T("h2", "Choose a roadway", "module-title"), T("p", "Click a road or use the floating search to inspect its accepted Q(t). No example section is selected for you.", "panel-lead")); return; }
      host.append(T("h2", `CS_${row.id}`, "module-title"), T("p", `${row.county_name} County · ${C.statusLabel(row)}`, "curve-status"));
      if (!row.has_curve) { host.append(T("p", "No observed Q(t) support is available. Missing evidence is not zero resilience.", "evidence-note")); return; }
      const wrap = T("div", "", "chart-wrap" + (large ? " expanded-chart" : "")), canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `Accepted Q(t) curve for CS_${row.id}`); wrap.append(canvas);
      const note = T("p", "Loading accepted curve…", "curve-status"); host.append(wrap, note);
      root.V4Data.curve(data, row.id).then(payload => {
        if (token !== generation || !canvas.isConnected) return;
        charts.push(root.V4Charts.draw(canvas, payload, row));
        note.textContent = row.status === "recovery_endpoint_censored" ? "Recovery endpoint censored; confirmed recovery is not established." : row.status === "no_sustained_drop" ? "No sustained drop under Candidate B; this is not proof of no impact." : "Accepted Candidate B onset, minimum and recovery markers. Original values and delivered timestamps retained.";
      }).catch(() => { if (token === generation) { wrap.hidden = true; note.textContent = "The curve could not be loaded. Other section evidence remains available."; } });
      if (!large) {
        const button = T("button", "Expand accepted Q(t) ↗", "outline-button"); button.id = "expandSeries";
        button.addEventListener("click", () => { dialog.showModal(); document.getElementById("seriesDialogTitle").textContent = `CS_${row.id} · Accepted Q(t)`; render(); }); host.append(button);
      }
      const legend = T("p", "Raw Q · Smoothed Q · Baseline Q = 1 · 0.90 × Q0", "evidence-note"); host.append(legend);
      const grid = T("div", "", "metric-pair"); grid.append(root.V4Inspector.card("Minimum Q", row.q_min, "Q ratio"), root.V4Inspector.card("Loss Area", row.resilience_loss_area, "Q-hours"), root.V4Inspector.card("Recovery", row.recovery_duration_hours, "hours"), root.V4Inspector.card("Score", C.value(row, "observed"), "index · 0–1")); host.append(grid);
      host.append(T("p", "Observed time series, not a forecast. Gaps remain gaps. The accepted speed-profile baseline and Candidate B method are unchanged.", "evidence-note"));
    }
    function render() {
      const token = ++generation; destroy();
      if (store.get().panel === "timeseries") draw(body, false, token); else body.replaceChildren();
      if (dialog.open) draw(expanded, true, token); else expanded.replaceChildren();
    }
    document.getElementById("closeSeries").addEventListener("click", () => dialog.close()); dialog.addEventListener("close", render);
    new ResizeObserver(() => { cancelAnimationFrame(resizeToken); resizeToken = requestAnimationFrame(() => charts.forEach(chart => chart.resize())); }).observe(document.getElementById("contextPanel"));
    return { render };
  }
  root.V4TimeSeries = Object.freeze({ create });
})(window);
