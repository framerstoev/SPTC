(function (root) {
  "use strict";
  function create(store) {
    const $ = id => document.getElementById(id), dialog = $("guideDialog");
    let step = 0, saved = null, frame = 0;
    const steps = [
      { title: "Welcome to the Roadway Resilience Explorer", description: "One roadway network, different evidence: weather, planning context, observed traffic performance and expected-demand mobility impact.", target: ".brand", panel: null },
      { title: "Start with the map", description: "Explore accepted roadway evidence. Search for a road, zoom or reset the selected area. Missing values remain unavailable.", target: "#exploreMap", panel: null },
      { title: "Seven modules, one map", description: "Overview, Analysis, Layers, Time Series, Forecast, Data and About open contextual panels. Click a module again to collapse it without losing map state.", target: "#moduleRail", panel: null },
      { title: "Choose your analysis context", description: "Overview selects Area, Hazard Type and Event. January 2026 winter weather is the supported case; planned hazards cannot run.", target: "#module-overview", panel: "overview" },
      { title: "Choose a layer; read its units", description: "Layers keeps weather, planning, observed and mobility metrics separate. Experimental temperature has its own PRISM windows and does not change WEATHER_REI.", target: "#module-layers", panel: "layers" },
      { title: "Select a road and inspect its evidence", description: "Use this search or click a roadway. Weather, Planning, Observed and Impact share one selected section. Time Series shows its accepted Q(t) when supported.", target: "#mapSearch", panel: null },
      { title: "Compare Planning and Observed", description: "Planning remains on the left, Observed on the right. Viewports and roadway selection are shared; these are distinct evidence families, without a new composite score.", target: "#compareWorkspace", panel: null, workspace: "compare" },
      { title: "Impact now; forecasting later", description: "Mobility Impact is expected-demand delay burden, not total economic loss. Forecast describes planned temporal and spatial research; no trained model or prediction is available.", target: "#module-forecast", panel: "forecast" }
    ];
    function remember() { try { localStorage.setItem("sptc-v4-guide-seen", "1"); } catch (_) { /* Storage is optional. */ } $("guideInvitation").hidden = true; }
    function position() {
      if (!dialog.open) return;
      const target = document.querySelector(steps[step].target), highlight = $("guideHighlight");
      if (!target) { highlight.hidden = true; return; }
      const rect = target.getBoundingClientRect(); highlight.hidden = false;
      const clip = target.closest(".context-scroll")?.getBoundingClientRect();
      const left = Math.max(4, rect.left - 4, clip?.left ?? 0), top = Math.max(4, rect.top - 4, clip?.top ?? 0);
      highlight.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(1, Math.min(innerWidth - 4, rect.right + 4, clip?.right ?? innerWidth) - left)}px;height:${Math.max(1, Math.min(innerHeight - 4, rect.bottom + 4, clip?.bottom ?? innerHeight) - top)}px`;
      const card = dialog.querySelector(".guide-card");
      card.classList.toggle("guide-card-top", rect.top > innerHeight * .55);
    }
    function render() {
      const current = steps[step]; store.set({ workspace: current.workspace || "explore", panel: current.panel, inspectorOpen: false });
      $("guideTitle").textContent = current.title; $("guideDescription").textContent = current.description;
      $("guideProgress").textContent = `GUIDE / ${step + 1} OF ${steps.length}`;
      $("guidePrevious").disabled = step === 0; $("guideNext").textContent = step === steps.length - 1 ? "Finish" : "Next";
      dialog.dataset.step = String(step + 1);
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { position(); $("guideNext").focus(); });
    }
    function start() { if (dialog.open) return; saved = { workspace: store.get().workspace, panel: store.get().panel, inspectorOpen: store.get().inspectorOpen }; step = 0; remember(); dialog.showModal(); render(); }
    $("startGuide").addEventListener("click", start); $("acceptGuide").addEventListener("click", start); $("dismissGuide").addEventListener("click", remember);
    $("guideNext").addEventListener("click", () => { if (step === steps.length - 1) dialog.close(); else { step++; render(); } });
    $("guidePrevious").addEventListener("click", () => { if (step > 0) { step--; render(); } });
    $("guideSkip").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => { cancelAnimationFrame(frame); if (saved) store.set(saved); saved = null; $("startGuide").focus(); });
    window.addEventListener("resize", position);
    try { $("guideInvitation").hidden = localStorage.getItem("sptc-v4-guide-seen") === "1"; } catch (_) { $("guideInvitation").hidden = true; }
    return { start };
  }
  root.V4Guide = Object.freeze({ create });
})(window);
