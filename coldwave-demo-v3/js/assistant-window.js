(function initializeAssistantWindow(global) {
  "use strict";

  function createController({ document: documentRef = global.document } = {}) {
    const panel = documentRef.getElementById("assistantPanel");
    const handle = documentRef.getElementById("assistantResizeHandle");
    let size = null;
    let drag = null;
    const desktop = () => global.innerWidth > 900;
    const bounds = () => ({
      width: Math.min(global.innerWidth * 0.92, global.innerWidth - 32),
      height: Math.min(global.innerHeight * 0.90, global.innerHeight - 24)
    });

    function apply(width, height) {
      const maximum = bounds();
      size = {
        width: Math.max(Math.min(480, maximum.width), Math.min(maximum.width, width)),
        height: Math.max(Math.min(420, maximum.height), Math.min(maximum.height, height))
      };
      panel.style.setProperty("--assistant-width", `${size.width}px`);
      panel.style.setProperty("--assistant-height", `${size.height}px`);
      handle.setAttribute("aria-label", `Resize AI Assistant, ${Math.round(size.width)} by ${Math.round(size.height)} pixels`);
    }

    function endDrag() {
      if (drag && handle.hasPointerCapture?.(drag.id)) handle.releasePointerCapture(drag.id);
      drag = null;
    }

    function fitViewport() {
      handle.hidden = !desktop();
      handle.disabled = !desktop();
      if (!desktop()) {
        endDrag();
        panel.style.removeProperty("--assistant-width");
        panel.style.removeProperty("--assistant-height");
      } else {
        apply(size?.width ?? 700, size?.height ?? global.innerHeight * 0.78);
      }
    }

    handle.addEventListener("pointerdown", event => {
      if (!desktop() || event.button !== 0) return;
      event.preventDefault();
      handle.focus();
      const rect = panel.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      apply(drag.width + drag.x - event.clientX, drag.height + drag.y - event.clientY);
    });
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("lostpointercapture", () => { drag = null; });
    handle.addEventListener("keydown", event => {
      if (!desktop() || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const delta = event.shiftKey ? 40 : 20;
      apply(rect.width + (event.key === "ArrowLeft" ? delta : event.key === "ArrowRight" ? -delta : 0),
        rect.height + (event.key === "ArrowUp" ? delta : event.key === "ArrowDown" ? -delta : 0));
    });
    global.addEventListener("resize", fitViewport);
    fitViewport();
    return Object.freeze({ fitViewport });
  }

  global.SPTCAssistantWindow = Object.freeze({ createController });
})(window);
