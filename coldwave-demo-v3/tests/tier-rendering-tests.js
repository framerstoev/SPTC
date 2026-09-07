"use strict";

module.exports = async function runTierRenderingTests({ appSource, vm }) {
  const tests = [];

  function test(name, callback) {
    tests.push({ name, callback });
  }

  function assert(condition, message = "Assertion failed") {
    if (!condition) throw new Error(message);
  }

  function equal(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
      throw new Error(message || `Expected ${expectedJson}, received ${actualJson}`);
    }
  }

  function includes(value, fragment, message) {
    assert(
      String(value).includes(fragment),
      message || `Expected ${JSON.stringify(value)} to include ${JSON.stringify(fragment)}`
    );
  }

  function excludes(value, fragment, message) {
    assert(
      !String(value).includes(fragment),
      message || `Expected ${JSON.stringify(value)} not to include ${JSON.stringify(fragment)}`
    );
  }

  class FakeElement {
    constructor(tagName, id = null) {
      this.tagName = String(tagName).toUpperCase();
      this.id = id;
      this.dataset = Object.create(null);
      this.attributes = new Map();
      this.listeners = new Map();
      this.children = [];
      this.parentNode = null;
      this.hidden = false;
      this.value = "";
      this.tabIndex = 0;
      this.focused = false;
      this.style = Object.create(null);
      this._textContent = "";
      this._innerHTML = "";
    }

    get textContent() {
      return this._textContent;
    }

    set textContent(value) {
      this._textContent = String(value ?? "");
      this._innerHTML = "";
      this.children = [];
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(value) {
      this._innerHTML = String(value ?? "");
      this._textContent = "";
      this.children = [];
    }

    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    replaceChildren(...children) {
      this.children = [];
      this._textContent = "";
      this._innerHTML = "";
      children.forEach(child => this.appendChild(child));
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatchEvent(event) {
      const dispatched = {
        type: event.type,
        target: event.target || this,
        key: event.key,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        }
      };
      let current = this;
      while (current) {
        dispatched.currentTarget = current;
        (current.listeners.get(dispatched.type) || []).forEach(listener => listener(dispatched));
        current = current.parentNode;
      }
      return !dispatched.defaultPrevented;
    }

    click() {
      return this.dispatchEvent({ type: "click", target: this });
    }

    focus() {
      this.focused = true;
    }

    closest(selector) {
      let current = this;
      while (current) {
        if (selector === "[data-analysis-layer]" && current.dataset.analysisLayer) return current;
        current = current.parentNode;
      }
      return null;
    }

    querySelectorAll(selector) {
      const matches = [];
      const visit = element => {
        if (selector === "[data-analysis-layer]" && element.dataset.analysisLayer) {
          matches.push(element);
        }
        element.children.forEach(visit);
      };
      this.children.forEach(visit);
      return matches;
    }
  }

  class FakeDocument {
    constructor() {
      this.elements = new Map();
      [
        "layerNote",
        "legend",
        "tierEmptyState",
        "tierMetrics",
        "tierFootnote",
        "curvePanel",
        "tierPanelEyebrow",
        "tierPanelHeading",
        "activeTierChip",
        "selectedTitle",
        "selectedSub",
        "statusBadges",
        "warningCard",
        "curveCard",
        "curveChartWrap",
        "curveNote",
        "phaseMarkerLegend",
        "curveChart",
        "tierSelect",
        "analysisTierControl"
      ].forEach(id => this.elements.set(id, new FakeElement("div", id)));
      this.elements.get("tierSelect").tagName = "SELECT";
      const control = this.elements.get("analysisTierControl");
      this.buttons = ["tier1", "tier2", "potential", "tier3"].map(layer => {
        const button = new FakeElement("button");
        button.dataset.analysisLayer = layer;
        control.appendChild(button);
        return button;
      });
    }

    getElementById(id) {
      const element = this.elements.get(id);
      if (!element) throw new Error(`Unexpected production tier DOM id: ${id}`);
      return element;
    }

    querySelectorAll(selector) {
      return selector === "[data-analysis-layer]" ? this.buttons.slice() : [];
    }
  }

  class FakeChart {
    static instances = [];

    static register() {}

    constructor(element, configuration) {
      this.element = element;
      this.configuration = configuration;
      this.destroyed = false;
      this.resizeCount = 0;
      FakeChart.instances.push(this);
    }

    destroy() {
      this.destroyed = true;
    }

    resize() {
      this.resizeCount += 1;
    }
  }

  function curveResponse() {
    return {
      ok: true,
      async json() {
        return {
          metadata: {
            q0: 1,
            onset_time: "2026-01-24T01:00:00",
            min_time: "2026-01-24T02:00:00",
            recovery_end_time: "2026-01-24T03:00:00"
          },
          series: {
            timestamp: ["2026-01-24T01:00:00", "2026-01-24T02:00:00"],
            q: [1, 0.7],
            q_smoothed: [1, 0.75]
          }
        };
      }
    };
  }

  function sectionFixture() {
    return {
      CTRL_SECT_KEY: "CS_1081",
      CTRL_SECT_NORM: "1081",
      ROUTE_KEY: "IH_35_",
      county_name: "Bell",
      event_id: "coldwave_2026_01",
      detection_status: "detected",
      curve_file: "./data/curves/CS_1081.json",
      WEATHER_REI: 0.1,
      NETRISK_LITE: 0.8,
      Potential_Resilience_Score: 0.6,
      observed_curve_resilience_score_v0: 0.72,
      AADT_CS: 12345.5,
      q0: 1,
      q_min: 0.65,
      resilience_loss_area: 4.2,
      recovery_duration_hours: 5.5,
      recovery_slope: 0.04,
      onset_time: "2026-01-24T01:00:00",
      min_time: "2026-01-24T02:00:00",
      recovery_end_time: "2026-01-24T03:00:00"
    };
  }

  function createHarness() {
    const bootMarker = "\nsetupFloatingAssistant();";
    const bootIndex = appSource.lastIndexOf(bootMarker);
    assert(bootIndex > 0, "Production app boot marker was not found");
    const document = new FakeDocument();
    const controlLayer = {
      styleCalls: [],
      setStyle(styleFunction) {
        this.styleCalls.push(styleFunction);
      }
    };
    const map = {
      invalidateCalls: 0,
      getZoom() { return 6; },
      invalidateSize() { this.invalidateCalls += 1; }
    };
    const actionContexts = [];
    const chatContexts = [];
    const sandbox = {
      console,
      document,
      Chart: FakeChart,
      L: {
        canvas() { return {}; },
        geoJSON() { throw new Error("Tier regression must not create a selection overlay"); }
      },
      fetch: async () => curveResponse(),
      requestAnimationFrame(callback) { callback(); },
      setTimeout,
      clearTimeout
    };
    sandbox.window = sandbox;
    sandbox.SPTCAssistant = {
      activeLayerMetrics: {
        tier1: "weather_rei",
        tier2: "netrisk_lite",
        potential: "potential_resilience_score",
        tier3: "observed_curve_resilience_score_v0"
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(`
      ${appSource.slice(0, bootIndex)}
      globalThis.__tierQa = Object.freeze({
        setupTierControls,
        setActiveAnalysisLayer,
        featureStyle,
        setFetch(nextFetch) { globalThis.fetch = nextFetch; },
        setSelectedProps(props) { selectedProps = props; },
        setRuntimeState(nextMap, nextControlLayer) {
          map = nextMap;
          controlLayer = nextControlLayer;
          ranges = {
            WEATHER_REI: { min: 0, max: 1 },
            NETRISK_LITE: { min: 0, max: 1 },
            Potential_Resilience_Score: { min: 0, max: 1 }
          };
          scoreClassBreaks = [0, 0.2, 0.4, 0.6, 0.8, 1];
        },
        setControllers(actionController, chatController) {
          assistantActionController = actionController;
          assistantChatController = chatController;
        },
        state() {
          return {
            activeAnalysisLayer,
            curveRequestId,
            hasChart: Boolean(curveChart)
          };
        }
      });
    `, sandbox, { filename: "production-v3-tier-runtime.js" });
    sandbox.__tierQa.setRuntimeState(map, controlLayer);
    sandbox.__tierQa.setSelectedProps(sectionFixture());
    sandbox.__tierQa.setControllers(
      { setContext(context) { actionContexts.push(context); } },
      { setContext(context) { chatContexts.push(context); } }
    );
    return {
      api: sandbox.__tierQa,
      sandbox,
      document,
      buttons: document.buttons,
      control: document.getElementById("analysisTierControl"),
      select: document.getElementById("tierSelect"),
      controlLayer,
      map,
      actionContexts,
      chatContexts
    };
  }

  function assertSingleActive(buttons, layer) {
    const checked = buttons.filter(button => button.getAttribute("aria-checked") === "true");
    equal(checked.length, 1, "Exactly one tier radio must be checked");
    equal(checked[0].dataset.analysisLayer, layer);
    buttons.forEach(button => {
      equal(button.tabIndex, button.dataset.analysisLayer === layer ? 0 : -1);
      assert(!/(^|\s)(active|is-active)(\s|$)/.test(button.className || ""));
    });
  }

  test("production tier controls initialize and switch through one aria-checked contract", async () => {
    const { api, buttons, control, select } = createHarness();
    buttons.forEach(button => button.setAttribute("aria-checked", "false"));
    buttons.forEach(button => { button.tabIndex = 0; });
    api.setupTierControls();
    assertSingleActive(buttons, "tier3");
    equal(select.value, "tier3");

    buttons[0].click();
    assertSingleActive(buttons, "tier1");
    equal(select.value, "tier1");

    control.dispatchEvent({ type: "keydown", key: "ArrowRight", target: buttons[0] });
    assertSingleActive(buttons, "tier2");
    assert(buttons[1].focused, "Keyboard tier switching must move focus");

    select.value = "potential";
    select.dispatchEvent({ type: "change", target: select });
    assertSingleActive(buttons, "potential");
  });

  test("tier switching synchronizes map style, legend, panel, curve visibility, and Assistant context", async () => {
    const {
      api,
      buttons,
      document,
      controlLayer,
      actionContexts,
      chatContexts
    } = createHarness();
    api.setupTierControls();
    const expected = [
      ["tier1", "Weather Resilience Context", "WEATHER_REI", "NETWORK_REI"],
      ["tier2", "Network Resilience Context", "NETWORK_REI", "Potential Resilience"],
      ["potential", "Potential Resilience", "Tier 1", "Loss Area"]
    ];
    for (const [index, [layer, heading, includedMetric, excludedMetric]] of expected.entries()) {
      buttons[index].click();
      assertSingleActive(buttons, layer);
      equal(document.getElementById("tierPanelHeading").textContent, heading);
      includes(document.getElementById("tierMetrics").innerHTML, includedMetric);
      excludes(document.getElementById("tierMetrics").innerHTML, excludedMetric);
      includes(document.getElementById("legend").innerHTML, heading.split(" ")[0]);
      assert(document.getElementById("curvePanel").hidden);
      equal(actionContexts.at(-1).activeLayer, layer);
      equal(chatContexts.at(-1).activeLayer, layer);
      assert(typeof controlLayer.styleCalls.at(-1) === "function");
      const style = controlLayer.styleCalls.at(-1)({ properties: sectionFixture() });
      assert(/^#[0-9a-f]{6}$/i.test(style.color));
    }

    const fetchCalls = [];
    api.setFetch(async url => {
      fetchCalls.push(url);
      return curveResponse();
    });
    await api.setActiveAnalysisLayer("tier3");
    assertSingleActive(buttons, "tier3");
    equal(document.getElementById("tierPanelHeading").textContent, "Observed Resilience");
    const metrics = document.getElementById("tierMetrics").innerHTML;
    ["Score", "Minimum", "Loss Area", "Recovery"].forEach(label => includes(metrics, label));
    equal((metrics.match(/class="metric-card/g) || []).length, 4);
    assert(!document.getElementById("curvePanel").hidden);
    equal(fetchCalls, ["./data/curves/CS_1081.json"]);
    assert(api.state().hasChart);
    includes(
      document.getElementById("legend").innerHTML,
      "Higher values indicate more favorable observed operational resilience"
    );
    includes(document.getElementById("curveNote").textContent, "Shaded area");
  });

  test("leaving Tier 3 invalidates a pending curve response before chart creation", async () => {
    FakeChart.instances.length = 0;
    const { api, buttons, document } = createHarness();
    api.setupTierControls();
    await api.setActiveAnalysisLayer("potential");
    let resolveFetch;
    api.setFetch(() => new Promise(resolve => {
      resolveFetch = resolve;
    }));
    const pendingTier3 = api.setActiveAnalysisLayer("tier3");
    await Promise.resolve();
    assert(typeof resolveFetch === "function");
    await api.setActiveAnalysisLayer("tier1");
    resolveFetch(curveResponse());
    await pendingTier3;
    assertSingleActive(buttons, "tier1");
    assert(document.getElementById("curvePanel").hidden);
    equal(FakeChart.instances.length, 0, "A stale Tier 3 response must not create a chart");
  });

  let passed = 0;
  for (const { name, callback } of tests) {
    try {
      await callback();
      passed += 1;
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  return `${passed} Phase 4A V3 tier runtime tests passed.`;
};
