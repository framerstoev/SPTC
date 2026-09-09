(function (root) {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function createController({ document, maps, resizeChart, environment = root }) {
    const workspace = document.getElementById("comparativeWorkspace");
    const mobile = environment.matchMedia("(max-width: 900px)");
    const visible = { observed: true, planning: true };
    let mobileSide = "observed";
    let syncing = false;
    let moveFrame = null;
    let resizeFrame = null;
    let movingMap = maps[0];
    let drag = null;
    const ratios = { width: 50, observed: 43, planning: 43 };

    function synchronize(source) {
      const center = source.getCenter();
      const zoom = source.getZoom();
      syncing = true;
      try {
        maps.forEach(target => {
          if (target === source) return;
          if (!target.getCenter().equals(center, 1e-9) || target.getZoom() !== zoom) {
            target.setView(center, zoom, { animate: false });
          }
        });
      } finally { syncing = false; }
    }

    maps.forEach(map => map.on("move zoom", () => {
      if (syncing) return;
      movingMap = map;
      if (moveFrame !== null) return;
      moveFrame = environment.requestAnimationFrame(() => {
        moveFrame = null;
        synchronize(movingMap);
      });
    }));

    function scheduleResize() {
      if (resizeFrame !== null) return;
      resizeFrame = environment.requestAnimationFrame(() => {
        resizeFrame = null;
        const source = maps.find(map => map.getContainer().clientWidth > 0) || maps[0];
        const center = source.getCenter();
        const zoom = source.getZoom();
        syncing = true;
        try {
          maps.forEach(map => {
            map.invalidateSize({ pan: false });
            map.setView(center, zoom, { animate: false });
          });
          resizeChart();
        } finally { syncing = false; }
      });
    }

    const splitters = [
      { id: "workspaceSplitter", key: "width", variable: "--observed-width", area: "comparativeWorkspace", vertical: true, min: 35, max: 65 },
      { id: "observedSplitter", key: "observed", variable: "--observed-map-height", area: "observedSideContent", min: 25, max: 65 },
      { id: "planningSplitter", key: "planning", variable: "--planning-map-height", area: "planningSideContent", min: 25, max: 65 }
    ];
    function updateRatio(spec, value) {
      ratios[spec.key] = clamp(value, spec.min, spec.max);
      workspace.style.setProperty(spec.variable, `${ratios[spec.key]}%`);
      document.getElementById(spec.id).setAttribute("aria-valuenow", String(Math.round(ratios[spec.key])));
      scheduleResize();
    }
    function endDrag() {
      if (!drag) return;
      const { element, pointerId } = drag;
      drag = null;
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      document.body.classList.remove("workspace-resizing", "workspace-resizing-horizontal");
      scheduleResize();
    }
    splitters.forEach(spec => {
      const element = document.getElementById(spec.id);
      element.addEventListener("pointerdown", event => {
        if (mobile.matches || event.button !== 0) return;
        event.preventDefault();
        drag = { spec, element, pointerId: event.pointerId };
        element.setPointerCapture(event.pointerId);
        element.focus();
        document.body.classList.add("workspace-resizing");
        document.body.classList.toggle("workspace-resizing-horizontal", !spec.vertical);
      });
      element.addEventListener("pointermove", event => {
        if (!drag || drag.element !== element || event.pointerId !== drag.pointerId) return;
        const rect = document.getElementById(spec.area).getBoundingClientRect();
        const fraction = spec.vertical ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
        updateRatio(spec, fraction * 100);
      });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => element.addEventListener(type, endDrag));
      element.addEventListener("keydown", event => {
        if (mobile.matches) return;
        const previous = spec.vertical ? "ArrowLeft" : "ArrowUp";
        const next = spec.vertical ? "ArrowRight" : "ArrowDown";
        let value = ratios[spec.key];
        if (event.key === previous) value -= 2;
        else if (event.key === next) value += 2;
        else if (event.key === "Home") value = spec.min;
        else if (event.key === "End") value = spec.max;
        else return;
        event.preventDefault();
        updateRatio(spec, value);
      });
    });

    function renderVisibility() {
      workspace.dataset.mobileSide = mobileSide;
      workspace.classList.toggle("observed-hidden", !visible.observed);
      workspace.classList.toggle("planning-hidden", !visible.planning);
      ["observed", "planning"].forEach(side => {
        const shown = mobile.matches ? mobileSide === side : visible[side];
        const button = document.getElementById(side === "observed" ? "toggleObserved" : "togglePlanning");
        button.setAttribute("aria-pressed", String(shown));
        button.setAttribute("aria-label", `${mobile.matches ? "Show" : (shown ? "Hide" : "Show")} ${side} workspace`);
        document.getElementById(`${side}Workspace`).setAttribute("aria-hidden", String(!shown));
      });
      scheduleResize();
    }
    ["observed", "planning"].forEach(side => {
      document.getElementById(side === "observed" ? "toggleObserved" : "togglePlanning").addEventListener("click", () => {
        mobileSide = side;
        if (!mobile.matches) {
          visible[side] = !visible[side];
          // Hiding the last side restores the other, so there is always a workspace.
          if (!visible.observed && !visible.planning) visible[side === "observed" ? "planning" : "observed"] = true;
        }
        renderVisibility();
      });
    });
    mobile.addEventListener("change", () => { endDrag(); renderVisibility(); });
    environment.addEventListener("resize", scheduleResize);
    const observer = new environment.ResizeObserver(scheduleResize);
    ["observedSideContent", "planningSideContent"].forEach(id => observer.observe(document.getElementById(id)));
    renderVisibility();
    return Object.freeze({ scheduleResize });
  }

  root.SPTCWorkspace = Object.freeze({ createController });
})(typeof window !== "undefined" ? window : globalThis);
