(function (root) {
  "use strict";
  function create(store) {
    const $ = id => document.getElementById(id), dialog = $("guideDialog");
    // The original key remains valid across both events; no second persistence flag.
    const seenKey = "sptc-v4-guide-seen";
    let step = 0, saved = null, frame = 0, autoChecked = false, seen = false;
    try { seen = localStorage.getItem(seenKey) === "1"; } catch (_) { /* Offer onboarding when storage is unavailable. */ }
    const steps = [
      { title: "Explore roadway performance", description: "Compare Planning and Observation, then select a road for details. Use Docs for methods and Guide to replay this tour.", target: ".brand", panel: null },
      { title: "Start with the map", description: "Read accepted roadway evidence. Search for a road, zoom or reset the selected area. Missing values remain unavailable.", target: "#planningMap", panel: null },
      { title: "Seven modules, one map", description: "Overview, Analysis, Layers, Time Series, Forecast, Data and About open contextual panels. Click a module again to collapse it without losing map state.", target: "#moduleRail", panel: null },
      { title: "Choose your analysis context", description: "Overview selects Area, Hazard Type and Event. Choose January winter weather or Hurricane Beryl from the available events; unavailable hazards cannot run.", target: "#module-overview", panel: "overview" },
      { title: "Choose a layer; read its units", description: "Layers keeps weather, planning, observed and mobility metrics separate. Additional scientific layers and temperature context are in Advanced Analysis.", target: "#module-layers", panel: "layers" },
      { title: "Select a road and inspect its evidence", description: "Use this search or click a roadway. Weather, Planning, Observed and Impact share one selected section. Time Series shows its accepted Q(t) when supported.", target: "#mapSearch", panel: "overview" },
      { title: "Compare Planning and Observed", description: "Planning remains on the left, Observed on the right. Viewports and roadway selection are shared; these are distinct evidence families, without a new composite score.", target: "#compareWorkspace", panel: null, workspace: "compare" },
      { title: "Mobility Impact", description: "Read delay cost and delay hours in Overview. Open Area details for the breakdown.", target: "#overviewEconomics", panel: "overview" }
    ];
    function remember() { seen = true; try { localStorage.setItem(seenKey, "1"); } catch (_) { /* Persistence is optional; this instance still remembers dismissal. */ } $("guideInvitation").hidden = true; }
    function targetSelector() { return step === 1 && store.get().eventId === "beryl_2024_07" ? "#berylToolbar" : steps[step].target; }
    function position() {
      if (!dialog.open) return;
      let selector = targetSelector(), target = document.querySelector(selector);
      if (!target?.getClientRects().length) { selector = ".brand"; target = document.querySelector(selector); }
      const highlight = $("guideHighlight"); dialog.dataset.target = selector;
      if (!target) { highlight.hidden = true; return; }
      const rect = target.getBoundingClientRect(); highlight.hidden = false;
      const clip = target.closest(".context-scroll")?.getBoundingClientRect();
      const left = Math.max(4, rect.left - 4, clip?.left ?? 0), top = Math.max(4, rect.top - 4, clip?.top ?? 0);
      highlight.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(1, Math.min(innerWidth - 4, rect.right + 4, clip?.right ?? innerWidth) - left)}px;height:${Math.max(1, Math.min(innerHeight - 4, rect.bottom + 4, clip?.bottom ?? innerHeight) - top)}px`;
      const card = dialog.querySelector(".guide-card");
      card.classList.toggle("guide-card-top", rect.top > innerHeight * .55);
    }
    function render() {
      const current = steps[step]; store.set({ panel: current.panel, inspectorOpen: false, ...([1,6].includes(step) ? { planningVisible:true, observationVisible:true } : {}) });
      $("guideTitle").textContent = current.title;
      $("guideDescription").textContent = current.description;
      if(step===1)$("guideDescription").textContent=store.get().eventId === "beryl_2024_07" ? "Use NHC Track and TxDOT Evacuation Routes above the maps. Pan or zoom to explore." : "Pan or zoom to explore the roads. Open a legend's Details to read its scale.";
      if(step===2)$("guideDescription").textContent="Open a module from the rail; close it to return to the maps.";
      if(step===3)$("guideDescription").textContent="Choose an event and area in Overview.";
      if(step===4)$("guideDescription").textContent="Layers uses the left panel. Choose either map's metric, or reset the default comparison.";
      if(step===5)$("guideDescription").textContent="Search in Overview, then read the road's Inspector. Time Series shows its traffic history.";
      if(step===6){$("guideTitle").textContent="Planning and Observation";$("guideDescription").textContent="Keep both maps visible or expand one. Legends open for more detail. Methods explain each event's performance measure.";}
      $("guideProgress").textContent = `GUIDE / ${step + 1} OF ${steps.length}`;
      $("guidePrevious").disabled = step === 0; $("guideNext").textContent = step === steps.length - 1 ? "Finish" : "Next";
      dialog.dataset.step = String(step + 1);
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        if (["#mapSearch", "#overviewEconomics"].includes(current.target)) document.querySelector(current.target)?.scrollIntoView({ block:"nearest", inline:"nearest" });
        position(); $("guideNext").focus();
      });
    }
    function start() { if (dialog.open) return; saved = { workspace: store.get().workspace, panel: store.get().panel, inspectorOpen: store.get().inspectorOpen, planningVisible:store.get().planningVisible, observationVisible:store.get().observationVisible }; step = 0; $("guideInvitation").hidden = true; dialog.showModal(); render(); }
    function finish() { remember(); dialog.close(); }
    function autoStart() {
      if (autoChecked) return; autoChecked = true; $("guideInvitation").hidden = true;
      if (seen) return;
      // Called after event resolution/rootReady; wait for the current interface to paint.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!seen && !dialog.open && root.v4App?.ready) start(); }));
    }
    $("startGuide").addEventListener("click", start); $("acceptGuide").addEventListener("click", start); $("dismissGuide").addEventListener("click", remember);
    $("guideNext").addEventListener("click", () => { if (step === steps.length - 1) finish(); else { step++; render(); } });
    $("guidePrevious").addEventListener("click", () => { if (step > 0) { step--; render(); } });
    $("guideSkip").addEventListener("click", finish);
    dialog.addEventListener("cancel", remember);
    dialog.addEventListener("close", () => { remember(); cancelAnimationFrame(frame); if (saved) store.set(saved); saved = null; $("startGuide").focus(); });
    window.addEventListener("resize", () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); });
    $("guideInvitation").hidden = true;
    return { start, autoStart };
  }
  root.V4Guide = Object.freeze({ create });
})(window);
