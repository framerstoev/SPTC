(function (root) {
  "use strict";
  const C = root.V4Core;
  function text(tag, content, className) { const el = document.createElement(tag); el.textContent = content; if (className) el.className = className; return el; }
  function card(label, value, unit, options = {}) {
    const node = document.createElement("div"); node.className = "metric-card";
    const strong = text("strong", C.format(value, options)); strong.title = value === null || value === undefined ? "Not available for this road" : `${C.format(value, options)} ${unit}`;
    node.append(text("span", label), strong, text("small", unit)); return node;
  }
  function create(data, store) {
    let chart = null, generation = 0, lastSection = null, lastTab = null;
    const body = document.getElementById("inspectorBody"), panel = document.getElementById("sectionInspector");
    function render() {
      const token = ++generation, state = store.get(), row = data.byId.get(state.selectedId);
      chart?.destroy(); chart = null;
      panel.hidden = !row || !state.inspectorOpen || state.panel === "timeseries";
      document.getElementById("appLayout").classList.toggle("has-inspector", !panel.hidden);
      const relative = document.getElementById("relativeHeader");
      root.V5R.relativeHeader(relative, panel.hidden ? null : row, Boolean(data.beryl));
      if (panel.hidden) { body.replaceChildren(); return; }
      document.getElementById("sectionTitle").textContent = `CS_${row.id}`;
      document.getElementById("sectionContext").textContent = `${row.route?.replaceAll("_", " ").trim() || "Route unavailable"} · ${row.county_name} County`;
      document.querySelectorAll("[data-inspector-tab]").forEach(btn => { const active = btn.dataset.inspectorTab === state.inspectorTab; btn.setAttribute("aria-selected", active); btn.tabIndex = active ? 0 : -1; });
      if (state.inspectorTab !== "observed") body.replaceChildren();
      if((lastSection!==row.id||lastTab!==state.inspectorTab))body.scrollTop=0;
      lastSection=row.id;lastTab=state.inspectorTab;
      body.dataset.tab = state.inspectorTab;
      root.V4Presentation.inspector(data, store, body, row, () => token === generation, value => { chart = value; }, render);
    }
    return { render };
  }
  root.V4Inspector = Object.freeze({ create, card, text });
})(window);
