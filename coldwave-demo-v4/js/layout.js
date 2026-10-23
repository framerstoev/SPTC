(function (root) {
  "use strict";
  const KEY = "sptc-v4-layout-v1";
  const defaults = () => ({ version: 1, sidebarWidth: null, inspector: { x: null, y: null, width: null, height: null } });
  const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100000;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  function read() {
    const result = defaults();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved?.version !== 1) return result;
      if (finite(saved.sidebarWidth)) result.sidebarWidth = saved.sidebarWidth;
      for (const key of Object.keys(result.inspector)) if (finite(saved.inspector?.[key])) result.inspector[key] = saved.inspector[key];
    } catch (_) { /* Storage may be unavailable; the layout still works in memory. */ }
    return result;
  }
  function create(store) {
    const $ = id => document.getElementById(id), app = $("appLayout"), main = $("main"), panel = $("sectionInspector");
    const desktop = matchMedia("(min-width: 701px)");
    let preferences = read(), geometry = null, active = null, frame = 0, chartFrame = 0;
    function save() { try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch (_) { /* Optional local persistence. */ } }
    function sidebarLimits() {
      const rail = $("moduleRail").getBoundingClientRect().width;
      const minimumMap = store.get().workspace === "compare" ? Math.min(640, app.clientWidth - rail - 280) : app.clientWidth > 1000 ? 360 : 320;
      const max = Math.max(280, app.clientWidth - rail - minimumMap);
      return { min: 280, max, value: clamp(preferences.sidebarWidth ?? (innerWidth <= 1150 ? 310 : 352), 280, max) };
    }
    function bounds() {
      const workspace = $(store.get().workspace === "compare" ? "compareWorkspace" : "exploreWorkspace");
      const rect = workspace.getBoundingClientRect(), parent = main.getBoundingClientRect();
      return { left: rect.left - parent.left + 8, top: rect.top - parent.top + 8, width: Math.max(1, rect.width - 16), height: Math.max(1, rect.height - 16) };
    }
    function limits() {
      const box = bounds();
      return { ...box, minWidth: Math.min(340, box.width), minHeight: Math.min(280, box.height) };
    }
    function aria(id, value, min, max) {
      const handle = $(id);
      handle.setAttribute("aria-valuenow", String(Math.round(value)));
      handle.setAttribute("aria-valuemin", String(Math.round(min)));
      handle.setAttribute("aria-valuemax", String(Math.round(max)));
    }
    function apply() {
      if (!desktop.matches) return;
      const side = sidebarLimits();
      app.style.setProperty("--context-width", `${side.value}px`);
      aria("sidebarResize", side.value, side.min, side.max);
      const box = limits(), wanted = preferences.inspector;
      const width = clamp(wanted.width ?? 350, box.minWidth, box.width);
      const height = clamp(wanted.height ?? box.height - 16, box.minHeight, box.height);
      const next = {
        width, height,
        x: clamp(wanted.x ?? box.left + box.width - width - 62, box.left, box.left + box.width - width),
        y: clamp(wanted.y ?? box.top + 8, box.top, box.top + box.height - height)
      };
      const resized = geometry?.width !== width || geometry?.height !== height;
      geometry = next;
      panel.classList.toggle("inspector-compact", height < 400);
      for (const [key, value] of Object.entries(next)) panel.style.setProperty(`--inspector-${key}`, `${value}px`);
      aria("inspectorResizeWidth", width, box.minWidth, box.width);
      aria("inspectorResizeHeight", height, box.minHeight, box.height);
      if (resized) {
        cancelAnimationFrame(chartFrame);
        chartFrame = requestAnimationFrame(() => panel.querySelectorAll("canvas").forEach(canvas => root.Chart?.getChart(canvas)?.resize()));
      }
    }
    function refresh() { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply); }
    function finish(cancel = false) {
      if (!active) return;
      const previous = active;
      active = null;
      if (cancel) preferences = previous.before;
      document.body.classList.remove("layout-interacting");
      document.body.style.removeProperty("--layout-cursor");
      if (previous.handle.hasPointerCapture(previous.id)) previous.handle.releasePointerCapture(previous.id);
      apply();
      if (!cancel) save();
    }
    function bind(id, kind, cursor) {
      const handle = $(id);
      handle.addEventListener("pointerdown", event => {
        if (!desktop.matches || event.button !== 0 || active || (kind === "move" && event.target.closest("button,a,input,select,textarea,[role=tab]"))) return;
        event.preventDefault(); event.stopPropagation();
        apply();
        active = { handle, kind, id: event.pointerId, startX: event.clientX, startY: event.clientY, side: sidebarLimits().value, geometry: { ...geometry }, before: structuredClone(preferences) };
        handle.setPointerCapture(event.pointerId);
        document.body.classList.add("layout-interacting");
        document.body.style.setProperty("--layout-cursor", cursor);
      });
      handle.addEventListener("pointermove", event => {
        if (!active || active.handle !== handle || active.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const dx = event.clientX - active.startX, dy = event.clientY - active.startY, box = limits(), start = active.geometry;
        if (kind === "sidebar") {
          const side = sidebarLimits(); preferences.sidebarWidth = clamp(active.side + dx, side.min, side.max);
        } else if (kind === "move") {
          preferences.inspector.x = clamp(start.x + dx, box.left, box.left + box.width - start.width);
          preferences.inspector.y = clamp(start.y + dy, box.top, box.top + box.height - start.height);
        } else {
          if (kind !== "height") preferences.inspector.width = clamp(start.width + dx, box.minWidth, box.left + box.width - start.x);
          if (kind !== "width") preferences.inspector.height = clamp(start.height + dy, box.minHeight, box.top + box.height - start.y);
        }
        refresh();
      });
      handle.addEventListener("pointerup", event => { if (active?.handle === handle && active.id === event.pointerId) { event.preventDefault(); event.stopPropagation(); finish(); } });
      handle.addEventListener("pointercancel", () => { if (active?.handle === handle) finish(true); });
      handle.addEventListener("lostpointercapture", () => { if (active?.handle === handle) finish(true); });
      handle.addEventListener("keydown", event => {
        if (!desktop.matches || event.target !== handle || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); apply();
        const step = event.shiftKey ? 40 : 16, dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const box = limits();
        if (kind === "sidebar") {
          const side = sidebarLimits(); preferences.sidebarWidth = event.key === "Home" ? side.min : event.key === "End" ? side.max : clamp(side.value + dx, side.min, side.max);
        } else if (kind === "move") {
          preferences.inspector.x = clamp(geometry.x + dx, box.left, box.left + box.width - geometry.width);
          preferences.inspector.y = clamp(geometry.y + dy, box.top, box.top + box.height - geometry.height);
        } else {
          if (kind !== "height") preferences.inspector.width = clamp(geometry.width + dx, box.minWidth, box.left + box.width - geometry.x);
          if (kind !== "width") preferences.inspector.height = clamp(geometry.height + dy, box.minHeight, box.top + box.height - geometry.y);
        }
        apply(); save();
      });
    }
    bind("sidebarResize", "sidebar", "col-resize");
    bind("inspectorDrag", "move", "grabbing");
    bind("inspectorResizeWidth", "width", "ew-resize");
    bind("inspectorResizeHeight", "height", "ns-resize");
    bind("inspectorResizeCorner", "both", "nwse-resize");
    function reset() { finish(true); preferences = defaults(); save(); apply(); }
    $("resetLayout").addEventListener("click", reset);
    $("sidebarResize").addEventListener("dblclick", () => { preferences.sidebarWidth = null; apply(); save(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && active) { event.preventDefault(); finish(true); } });
    desktop.addEventListener("change", () => { finish(true); refresh(); });
    window.addEventListener("resize", refresh);
    const observer = new ResizeObserver(refresh);
    [main, $("exploreWorkspace"), $("compareWorkspace")].forEach(node => observer.observe(node));
    store.subscribe(refresh);
    apply(); refresh();
    return Object.freeze({ reset, refresh });
  }
  root.V4Layout = Object.freeze({ create });
})(window);
