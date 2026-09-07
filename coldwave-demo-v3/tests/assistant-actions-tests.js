"use strict";

module.exports = async function runAssistantActionsTests() {
  const tests = [];
  const pendingTests = [];

  function test(name, callback) {
    tests.push({ name, callback });
  }

  function assert(condition, message = "Assertion failed") {
    if (!condition) throw new Error(message);
  }

  function equal(actual, expected, message) {
    if (!Object.is(actual, expected)) {
      throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
      this.className = "";
      this.children = [];
      this.parentNode = null;
      this.disabled = false;
      this.hidden = false;
      this.open = false;
      this.scrollTop = 0;
      this._textContent = "";
      this._attributes = new Map();
      this._listeners = new Map();
    }

    get textContent() {
      return this._textContent + this.children.map(child => child.textContent).join("");
    }

    set textContent(value) {
      this._textContent = value === null || value === undefined ? "" : String(value);
      this.children = [];
    }

    get scrollHeight() {
      return this.children.length;
    }

    appendChild(child) {
      assert(child instanceof FakeElement, "Only reviewed fake elements may be appended");
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    append(...children) {
      children.forEach(child => this.appendChild(child));
    }

    replaceChildren(...children) {
      this.children.forEach(child => {
        child.parentNode = null;
      });
      this.children = [];
      this._textContent = "";
      children.forEach(child => this.appendChild(child));
    }

    setAttribute(name, value) {
      const attributeName = String(name);
      const attributeValue = String(value);
      this._attributes.set(attributeName, attributeValue);
      if (attributeName === "id") this.id = attributeValue;
    }

    getAttribute(name) {
      return this._attributes.has(String(name))
        ? this._attributes.get(String(name))
        : null;
    }

    addEventListener(type, listener) {
      const listeners = this._listeners.get(type) || [];
      listeners.push(listener);
      this._listeners.set(type, listeners);
    }

    async dispatchEvent(event) {
      if (this.disabled && event.type === "click") return;
      const listeners = this._listeners.get(event.type) || [];
      for (const listener of listeners) {
        await listener.call(this, event);
      }
    }

    async click() {
      await this.dispatchEvent({
        type: "click",
        target: this,
        currentTarget: this,
        preventDefault() {}
      });
    }
  }

  class FakeDocument {
    constructor() {
      this.createdTags = [];
      this.elements = new Map();
      const elementDefinitions = [
        ["assistantModeLabel", "span"],
        ["assistantStatus", "span"],
        ["assistantMessages", "div"],
        ["assistantActionAvailability", "p"],
        ["assistantExplainSection", "button"],
        ["assistantExplainMetric", "button"],
        ["assistantGenerateReviewNote", "button"]
      ];
      for (const [id, tagName] of elementDefinitions) {
        this.elements.set(id, new FakeElement(tagName, id));
      }
    }

    getElementById(id) {
      const element = this.elements.get(id);
      if (!element) throw new Error(`Unexpected Assistant DOM id: ${id}`);
      return element;
    }

    createElement(tagName) {
      this.createdTags.push(String(tagName).toUpperCase());
      return new FakeElement(tagName);
    }
  }

  function descendants(root) {
    return root.children.flatMap(child => [child, ...descendants(child)]);
  }

  function byAttribute(root, attributeName) {
    return descendants(root).filter(element => element.getAttribute(attributeName) !== null);
  }

  function byTag(root, tagName) {
    const canonicalTag = String(tagName).toUpperCase();
    return descendants(root).filter(element => element.tagName === canonicalTag);
  }

  function byClass(root, className) {
    return descendants(root).find(element => (
      String(element.className).split(/\s+/).includes(className)
    )) || null;
  }

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
  }

  function clientError(code, message = "private backend detail") {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  const activeLayerMetrics = Object.freeze({
    tier1: "weather_rei",
    tier2: "netrisk_lite",
    potential: "potential_resilience_score",
    tier3: "observed_curve_resilience_score_v0"
  });

  function warningForStatus(status, messageOverride = null) {
    if (status === "detected") {
      return [{
        code: "METHOD_SCOPE",
        severity: "info",
        message: messageOverride || "Experimental method scope."
      }];
    }
    if (status === "no_sustained_drop") {
      return [
        {
          code: "NO_SUSTAINED_DROP",
          severity: "caution",
          message: messageOverride || "No sustained drop."
        },
        { code: "METHOD_SCOPE", severity: "info", message: "Experimental method scope." }
      ];
    }
    if (status === "recovery_endpoint_censored") {
      return [
        {
          code: "RECOVERY_CENSORED",
          severity: "caution",
          message: messageOverride || "Recovery censored."
        },
        { code: "METHOD_SCOPE", severity: "info", message: "Experimental method scope." }
      ];
    }
    return [{
      code: "NO_OBSERVED_SUPPORT",
      severity: "caution",
      message: messageOverride || "No observed support."
    }];
  }

  function summaryFixture(status = "detected", overrides = {}) {
    const noSupport = status === "no_observed_support";
    const noDrop = status === "no_sustained_drop";
    const phaseAvailable = !noSupport && !noDrop;
    return {
      identity: {
        normalized_cs_id: "29",
        display_cs_id: "CS_29",
        route: overrides.route || "US_90_",
        county: overrides.county || "Brewster",
        county_fips: "48043"
      },
      support_status: {
        observed_support: !noSupport,
        detection_status: status,
        matched_tmc_count: noSupport ? null : 4,
        data_density_summary: noSupport ? null : "A"
      },
      observed_metrics: {
        q0: noSupport ? null : 1,
        q_min: phaseAvailable ? 0.81 : null,
        loss_depth: phaseAvailable ? 0.19 : null,
        loss_depth_fraction: phaseAvailable ? 0.19 : null,
        loss_depth_percent: phaseAvailable ? 19 : null,
        degradation_duration_hours: phaseAvailable ? 4 : null,
        degradation_slope: phaseAvailable ? -0.0475 : null,
        recovery_duration_hours: phaseAvailable ? 6 : null,
        recovery_slope: phaseAvailable ? 0.03 : null,
        time_to_80_hours: phaseAvailable ? 2 : null,
        time_to_90_hours: phaseAvailable ? 6 : null,
        resilience_loss_area: phaseAvailable ? 0.91 : null,
        normalized_loss_area: phaseAvailable ? 0.15 : null,
        observed_curve_resilience_score_v0: phaseAvailable ? 0.85 : null,
        onset_time: phaseAvailable ? "2026-01-22T01:00:00" : null,
        minimum_time: phaseAvailable ? "2026-01-22T05:00:00" : null,
        recovery_end_time: phaseAvailable ? "2026-01-22T11:00:00" : null
      },
      planning_context: {
        weather_rei: 0.25,
        netrisk_lite: 0.5,
        event_rei: 0.3375,
        potential_resilience_score: 0.66,
        aadt: 1234.5
      },
      warnings: warningForStatus(status, overrides.warningMessage),
      source_label: "Reviewed release",
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0",
      timezone_status: "unverified_local_clock_time"
    };
  }

  function metricFixture(overrides = {}) {
    const limitations = overrides.limitations || [
      "Event and method specific.",
      "Not cross-event calibrated."
    ];
    return {
      metric: {
        name: overrides.name || "q_min",
        display_name: overrides.displayName || "Minimum normalized Q",
        category: "observed_operational",
        definition: overrides.definition || "Minimum smoothed normalized performance.",
        unit: "dimensionless",
        value_type: "number",
        nullable: true,
        applicability: ["detected", "recovery_endpoint_censored"],
        null_meaning: "Unavailable outside an applicable detected phase.",
        expected_domain: "Reviewed release domain.",
        calculation_summary: "Returned by the reviewed registry.",
        event_specific: true
      },
      interpretation: {
        plain_language: overrides.plainLanguage || "Describes the minimum normalized Q value.",
        limitations,
        directionality: null
      },
      provenance: {
        source_label: "Reviewed release",
        source_field: "q_min",
        method_version: "data_driven_resilience_v0"
      },
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0"
    };
  }

  function reviewNoteFixture(overrides = {}) {
    const sectionDefinitions = [
      ["review_status", "Review status"],
      ["planning_context", "Planning context"],
      ["observed_operational_evidence", "Observed operational evidence"],
      ["event_phase_and_recovery", "Event phase and recovery"],
      ["data_and_method_cautions", "Data and method cautions"],
      ["human_review_items", "Human review items"]
    ];
    const sectionId = overrides.sectionId || "29";
    const status = overrides.status || "detected";
    return {
      report_metadata: {
        scope: "section",
        template_name: "section_review_note",
        template_version: "section_review_note_v1",
        status: "draft_for_human_review",
        editable: true,
        event_id: "coldwave_2026_01",
        data_release: "coldwave_2026_01_r1",
        method_version: "data_driven_resilience_v0",
        timezone_status: "unverified_local_clock_time"
      },
      identity: {
        normalized_cs_id: sectionId,
        display_cs_id: `CS_${sectionId}`,
        route: overrides.route || "US_90_",
        county: overrides.county || "Brewster"
      },
      title: overrides.title || `Control Section CS_${sectionId} Review Note`,
      sections: sectionDefinitions.map(([key, heading], index) => ({
        key,
        heading,
        body: overrides.sectionBodies?.[index] || `FULL BODY ${index + 1}: ${heading}.`,
        evidence_ids: [`e_${index + 1}`]
      })),
      evidence: sectionDefinitions.map((entry, index) => ({
        evidence_id: `e_${index + 1}`,
        field_name: index === 0 ? "detection_status" : "display_cs_id",
        metric_name: null,
        value_type: "categorical",
        display_label: `Evidence ${index + 1}`,
        definition: "Reviewed evidence definition.",
        raw_value: index === 0 ? status : `CS_${sectionId}`,
        display_value: index === 0 ? status : `CS_${sectionId}`,
        unit: null,
        source_component: "section_summary",
        applicability: [
          "detected",
          "no_sustained_drop",
          "recovery_endpoint_censored",
          "no_observed_support"
        ],
        null_meaning: null,
        interpretation_limit: "Interpret only within this event and method."
      })),
      warnings: overrides.warnings || warningForStatus(status),
      limitations: overrides.limitations || [
        "LIMITATION ONE: human interpretation is required.",
        "LIMITATION TWO: event and method specific."
      ],
      human_review_items: overrides.humanReviewItems || [
        "CHECKLIST ONE: confirm section identity.",
        "CHECKLIST TWO: review supporting evidence."
      ],
      source_label: "Reviewed release",
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0",
      rendered_markdown: overrides.renderedMarkdown
        || "# SECRET COPY-ONLY MARKDOWN\n\nThis exact string is for the clipboard."
    };
  }

  function selectedContext(overrides = {}) {
    return {
      sectionId: overrides.sectionId === undefined ? "29" : overrides.sectionId,
      activeLayer: overrides.activeLayer || "tier3",
      localSectionText: overrides.localSectionText || "LOCAL SECTION PREVIEW",
      localMetricText: overrides.localMetricText || "LOCAL METRIC MAPPING"
    };
  }

  function createHarness({ mode = "backend-tools", client = null, clipboard = null } = {}) {
    const document = new FakeDocument();
    const safeClient = client || {
      getSectionSummary() {
        throw new Error("Unexpected section call");
      },
      explainMetric() {
        throw new Error("Unexpected metric call");
      },
      generateSectionReviewNote() {
        throw new Error("Unexpected review call");
      }
    };
    const controller = globalThis.SPTCAssistantActions.createController({
      document,
      runtime: { effective_mode: mode },
      activeLayerMetrics,
      client: safeClient,
      clipboard
    });
    return {
      controller,
      document,
      elements: Object.fromEntries(document.elements)
    };
  }

  test("action module has a bounded frozen surface and safe rendering source", () => {
    const actionsNamespace = globalThis.SPTCAssistantActions;
    assert(Object.isFrozen(actionsNamespace));
    assert(Object.isFrozen(actionsNamespace.actions));
    assert(Object.isFrozen(actionsNamespace.requestStates));
    equal(Object.keys(actionsNamespace.actions).sort().join(","), "metric,review,section");
    const source = String(globalThis.__assistantActionsSource || "");
    for (const forbidden of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "DOMParser",
      "fetch(",
      "/api/v1/",
      "localStorage",
      "sessionStorage",
      "Authorization"
    ]) {
      excludes(source, forbidden, `Assistant action source contains ${forbidden}`);
    }
  });

  test("initial no-selection state disables every fixed action", () => {
    const { controller, elements } = createHarness();
    const state = controller.getState();
    equal(state.requestState, "no_selection");
    equal(state.selectedSectionId, null);
    assert(Object.isFrozen(state));
    assert(elements.assistantExplainSection.disabled);
    assert(elements.assistantExplainMetric.disabled);
    assert(elements.assistantGenerateReviewNote.disabled);
    includes(elements.assistantActionAvailability.textContent, "Select a control section");
  });

  test("local-template and invalid modes issue zero client calls", async () => {
    for (const mode of ["local-template", "invalid"]) {
      let callCount = 0;
      const client = {
        getSectionSummary() { callCount += 1; },
        explainMetric() { callCount += 1; },
        generateSectionReviewNote() { callCount += 1; }
      };
      const { controller, elements } = createHarness({ mode, client });
      controller.setContext(selectedContext());
      await elements.assistantExplainSection.click();
      await elements.assistantExplainMetric.click();
      await elements.assistantGenerateReviewNote.click();
      equal(callCount, 0, mode);
      equal(controller.getState().mode, "local-template", mode);
      equal(elements.assistantModeLabel.textContent, "Local preview", mode);
      equal(byAttribute(elements.assistantMessages, "data-assistant-invocation").length, 3);
      equal(
        descendants(elements.assistantMessages)
          .filter(element => element.className === "assistant-result-source")
          .map(element => element.textContent)
          .join(","),
        "Verified result,Verified result,Verified result"
      );
      excludes(elements.assistantMessages.textContent, "Section\n", mode);
    }
  });

  test("backend-agent keeps all three deterministic fixed actions enabled", async () => {
    const calls = [];
    const client = {
      async getSectionSummary() {
        calls.push("section");
        return summaryFixture();
      },
      async explainMetric() {
        calls.push("metric");
        return metricFixture();
      },
      async generateSectionReviewNote() {
        calls.push("review");
        return reviewNoteFixture();
      }
    };
    const { controller, elements } = createHarness({ mode: "backend-agent", client });
    controller.setContext(selectedContext());
    await elements.assistantExplainSection.click();
    equal(elements.assistantStatus.textContent, "");
    includes(elements.assistantMessages.textContent, "Verified result");
    await elements.assistantExplainMetric.click();
    equal(elements.assistantStatus.textContent, "");
    includes(elements.assistantMessages.textContent, "Verified result");
    await elements.assistantGenerateReviewNote.click();
    equal(calls.join(","), "section,metric,review");
    equal(controller.getState().mode, "backend-agent");
    equal(elements.assistantModeLabel.textContent, "AI Assistant");
    equal(elements.assistantStatus.textContent, "");
    equal(byAttribute(elements.assistantMessages, "data-assistant-invocation").length, 3);
    equal(
      descendants(elements.assistantMessages)
        .filter(element => element.className === "assistant-result-source")
        .map(element => element.textContent)
        .join(","),
      "Verified result,Verified result,Verified result"
    );
    includes(elements.assistantMessages.textContent, "CS_29");
    includes(elements.assistantMessages.textContent, "Minimum normalized Q");
    includes(elements.assistantMessages.textContent, "Control Section CS_29 Review Note");
  });

  test("backend-tools remains dormant until an enabled action is activated", async () => {
    let callCount = 0;
    const client = {
      async getSectionSummary() {
        callCount += 1;
        return summaryFixture();
      }
    };
    const { controller, elements } = createHarness({ client });
    equal(callCount, 0);
    controller.setContext(selectedContext());
    equal(callCount, 0);
    await elements.assistantExplainSection.click();
    equal(callCount, 1);
    equal(elements.assistantModeLabel.textContent, "Review tools");
  });

  test("action availability follows selection and the reviewed metric map", async () => {
    let callCount = 0;
    const client = {
      explainMetric() {
        callCount += 1;
        return Promise.resolve(metricFixture());
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    assert(!elements.assistantExplainSection.disabled);
    assert(!elements.assistantExplainMetric.disabled);
    assert(!elements.assistantGenerateReviewNote.disabled);
    equal(controller.getState().activeMetric, "observed_curve_resilience_score_v0");

    for (const activeLayer of [
      "unsupported_layer",
      "detection_status",
      "total_detected_phase_delay_proxy"
    ]) {
      controller.setContext(selectedContext({ activeLayer }));
      assert(!elements.assistantExplainSection.disabled, activeLayer);
      assert(elements.assistantExplainMetric.disabled, activeLayer);
      assert(!elements.assistantGenerateReviewNote.disabled, activeLayer);
      equal(controller.getState().requestState, "unsupported_metric", activeLayer);
      await elements.assistantExplainMetric.click();
      equal(callCount, 0, activeLayer);
      includes(elements.assistantActionAvailability.textContent, "no reviewed metric explanation");
    }
  });

  test("section action exposes loading then a bounded backend result", async () => {
    const pending = deferred();
    const calls = [];
    const client = {
      getSectionSummary(sectionId, options) {
        calls.push({ sectionId, signal: options.signal });
        return pending.promise;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    const actionPromise = controller.startAction("section");
    equal(controller.getState().requestState, "loading");
    equal(elements.assistantMessages.getAttribute("aria-busy"), "true");
    includes(elements.assistantStatus.textContent, "Loading");
    equal(calls.length, 1);
    equal(calls[0].sectionId, "29");
    assert(!calls[0].signal.aborted);
    pending.resolve(summaryFixture());
    await actionPromise;
    equal(controller.getState().requestState, "backend_success");
    equal(elements.assistantStatus.textContent, "");
    equal(elements.assistantMessages.getAttribute("aria-busy"), "false");
    includes(elements.assistantMessages.textContent, "CS_29");
    includes(elements.assistantMessages.textContent, "US_90_");
    includes(elements.assistantMessages.textContent, "METHOD_SCOPE");
    includes(elements.assistantMessages.textContent, "Verified result");
    const observedCounts = byAttribute(elements.assistantMessages, "data-observed-metric-count");
    const planningCounts = byAttribute(elements.assistantMessages, "data-planning-metric-count");
    equal(observedCounts.length, 1);
    equal(planningCounts.length, 1);
    assert(Number(observedCounts[0].getAttribute("data-observed-metric-count")) <= 3);
    assert(Number(planningCounts[0].getAttribute("data-planning-metric-count")) <= 3);
  });

  test("metric action exposes reviewed definition fields and at most three limitations", async () => {
    const pending = deferred();
    const calls = [];
    const client = {
      explainMetric(metricName, options) {
        calls.push({ metricName, signal: options.signal });
        return pending.promise;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    const actionPromise = controller.startAction("metric");
    equal(controller.getState().requestState, "loading");
    equal(elements.assistantMessages.getAttribute("aria-busy"), "true");
    includes(elements.assistantStatus.textContent, "Loading");
    equal(calls.length, 1);
    equal(calls[0].metricName, "observed_curve_resilience_score_v0");
    pending.resolve(metricFixture({
      limitations: ["One.", "Two.", "Three.", "Fourth must not render."]
    }));
    await actionPromise;
    equal(controller.getState().requestState, "backend_success");
    equal(elements.assistantStatus.textContent, "");
    equal(elements.assistantMessages.getAttribute("aria-busy"), "false");
    includes(elements.assistantMessages.textContent, "Verified result");
    includes(elements.assistantMessages.textContent, "Minimum normalized Q");
    includes(elements.assistantMessages.textContent, "dimensionless");
    includes(elements.assistantMessages.textContent, "When unavailable");
    includes(elements.assistantMessages.textContent, "not an interpretation of the selected section");
    excludes(elements.assistantMessages.textContent, "Fourth must not render");
    const counts = byAttribute(elements.assistantMessages, "data-limitation-count");
    equal(counts.length, 1);
    equal(counts[0].getAttribute("data-limitation-count"), "3");
  });

  test("all four reviewed detection statuses render conservatively", async () => {
    for (const status of [
      "detected",
      "no_sustained_drop",
      "recovery_endpoint_censored",
      "no_observed_support"
    ]) {
      const client = {
        async getSectionSummary() {
          return summaryFixture(status);
        }
      };
      const { controller, elements } = createHarness({ client });
      controller.setContext(selectedContext());
      await controller.startAction("section");
      includes(elements.assistantMessages.textContent, status.replaceAll("_", " "), status);
      for (const warning of warningForStatus(status)) {
        includes(elements.assistantMessages.textContent, warning.code, status);
      }
      if (status === "no_observed_support") {
        includes(elements.assistantMessages.textContent, "Tier 3 observed evidence is unavailable");
        includes(elements.assistantMessages.textContent, "does not indicate that no disruption occurred");
        includes(elements.assistantMessages.textContent, "Planning context");
      }
    }
  });

  test("starting a new action aborts and suppresses the earlier action", async () => {
    const sectionPending = deferred();
    const metricPending = deferred();
    const calls = [];
    const client = {
      getSectionSummary(sectionId, options) {
        calls.push({ action: "section", signal: options.signal });
        return sectionPending.promise;
      },
      explainMetric(metricName, options) {
        calls.push({ action: "metric", signal: options.signal });
        return metricPending.promise;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    const first = controller.startAction("section");
    const second = controller.startAction("metric");
    assert(calls[0].signal.aborted, "Prior request signal was not aborted");
    metricPending.resolve(metricFixture({ displayName: "CURRENT METRIC RESULT" }));
    await second;
    sectionPending.resolve(summaryFixture());
    await first;
    includes(elements.assistantMessages.textContent, "CURRENT METRIC RESULT");
    excludes(elements.assistantMessages.textContent, "US_90_");
    equal(controller.getState().currentAction, "metric");
  });

  test("section change aborts a pending request and restores the new context notice", async () => {
    const pending = deferred();
    let requestSignal;
    const client = {
      getSectionSummary(sectionId, options) {
        requestSignal = options.signal;
        return pending.promise;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    const request = controller.startAction("section");
    controller.setContext(selectedContext({
      sectionId: "30",
      localSectionText: "NEW SECTION PREVIEW"
    }));
    assert(requestSignal.aborted);
    pending.resolve(summaryFixture());
    await request;
    includes(elements.assistantMessages.textContent, "Context updated to CS_30");
    includes(elements.assistantMessages.textContent, "No request was sent");
    excludes(elements.assistantMessages.textContent, "CS_29");
    equal(controller.getState().selectedSectionId, "30");
    equal(controller.getState().requestState, "idle");
  });

  test("same-section reselection preserves the current loading request", async () => {
    const pending = deferred();
    const calls = [];
    const client = {
      getSectionSummary(sectionId, options) {
        calls.push({ sectionId, signal: options.signal });
        return pending.promise;
      }
    };
    const { controller, elements } = createHarness({ client });
    const context = selectedContext();
    controller.setContext(context);
    const actionPromise = controller.startAction("section");
    controller.setContext({
      ...context,
      localSectionText: "REFRESHED SAME-SECTION PREVIEW"
    });
    equal(calls.length, 1);
    assert(!calls[0].signal.aborted);
    equal(controller.getState().requestState, "loading");
    includes(elements.assistantMessages.textContent, "Loading the reviewed section summary");
    pending.resolve(summaryFixture("detected", { route: "SAME SECTION RESULT" }));
    await actionPromise;
    equal(controller.getState().requestState, "backend_success");
    includes(elements.assistantMessages.textContent, "SAME SECTION RESULT");
  });

  test("metric change aborts a pending metric request and ignores its late result", async () => {
    const pending = deferred();
    let requestSignal;
    const client = {
      explainMetric(metricName, options) {
        requestSignal = options.signal;
        return pending.promise;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    const request = controller.startAction("metric");
    controller.setContext(selectedContext({
      activeLayer: "tier2",
      localMetricText: "NEW METRIC MAPPING"
    }));
    assert(requestSignal.aborted);
    pending.resolve(metricFixture({ displayName: "STALE METRIC RESULT" }));
    await request;
    excludes(elements.assistantMessages.textContent, "STALE METRIC RESULT");
    includes(elements.assistantMessages.textContent, "Context updated to CS_29");
    equal(controller.getState().activeMetric, "netrisk_lite");
  });

  test("request_cancelled is silent and restores the current context notice", async () => {
    const client = {
      async getSectionSummary() {
        throw clientError("request_cancelled", "C:\\private\\cancel-detail.txt");
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    await controller.startAction("section");
    includes(elements.assistantMessages.textContent, "Context updated to CS_29");
    excludes(elements.assistantStatus.textContent, "fallback");
    excludes(elements.assistantMessages.textContent, "private");
    equal(controller.getState().requestState, "idle");
  });

  test("repeated section clicks abort the older request and retain only the replacement", async () => {
    const requests = [deferred(), deferred()];
    const signals = [];
    let index = 0;
    const client = {
      getSectionSummary(sectionId, options) {
        signals.push(options.signal);
        return requests[index++].promise;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    const first = controller.startAction("section");
    const second = controller.startAction("section");
    assert(signals[0].aborted);
    requests[1].resolve(summaryFixture("detected", { route: "SECOND RESULT" }));
    await second;
    requests[0].resolve(summaryFixture("detected", { route: "FIRST STALE RESULT" }));
    await first;
    includes(elements.assistantMessages.textContent, "SECOND RESULT");
    excludes(elements.assistantMessages.textContent, "FIRST STALE RESULT");
  });

  test("the reviewed fallback matrix is visible and always renders local content", async () => {
    const fallbackCases = [
      ["backend_unavailable", "section"],
      ["request_timeout", "section"],
      ["section_not_found", "section"],
      ["metric_not_found", "metric"],
      ["backend_validation_error", "section"],
      ["snapshot_unavailable", "section"],
      ["invalid_json", "section"],
      ["invalid_response", "section"],
      ["unexpected_status", "section"]
    ];
    for (const [code, action] of fallbackCases) {
      const failure = clientError(code, `C:\\private\\${code}.txt`);
      const client = {
        async getSectionSummary() { throw failure; },
        async explainMetric() { throw failure; }
      };
      const { controller, elements } = createHarness({ client });
      controller.setContext(selectedContext());
      await controller.startAction(action);
      equal(controller.getState().requestState, "fallback_success", code);
      includes(elements.assistantStatus.textContent, "showing a local result", code);
      includes(
        elements.assistantMessages.textContent,
        action === "metric" ? "LOCAL METRIC MAPPING" : "LOCAL SECTION PREVIEW",
        code
      );
      excludes(elements.assistantMessages.textContent, "private", code);
      excludes(elements.assistantMessages.textContent, code, code);
    }
  });

  test("script-like backend fields remain inert text and create no script nodes", async () => {
    const routeFixture = "<script>routeProbe()</script>";
    const countyFixture = "<img src=x onerror=countyProbe()>";
    const warningFixture = "<svg onload=warningProbe()>";
    const client = {
      async getSectionSummary() {
        return summaryFixture("detected", {
          route: routeFixture,
          county: countyFixture,
          warningMessage: warningFixture
        });
      },
      async explainMetric() {
        return metricFixture({
          definition: "<script>definitionProbe()</script>",
          plainLanguage: "<img src=x onerror=metricProbe()>"
        });
      }
    };
    const { controller, document, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    await controller.startAction("section");
    includes(elements.assistantMessages.textContent, routeFixture);
    includes(elements.assistantMessages.textContent, countyFixture);
    includes(elements.assistantMessages.textContent, "METHOD_SCOPE");
    includes(elements.assistantMessages.textContent, warningFixture);
    await controller.startAction("metric");
    includes(elements.assistantMessages.textContent, "<script>definitionProbe()</script>");
    includes(elements.assistantMessages.textContent, "<img src=x onerror=metricProbe()>");
    assert(!document.createdTags.includes("SCRIPT"));
    assert(!document.createdTags.includes("IMG"));
    assert(!document.createdTags.includes("SVG"));
    equal(byTag(elements.assistantMessages, "script").length, 0);
  });

  test("review-note action exposes loading then a successful draft state", async () => {
    const pending = deferred();
    const calls = [];
    const client = {
      generateSectionReviewNote(sectionId, options) {
        calls.push({ sectionId, signal: options.signal });
        return pending.promise;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    const actionPromise = controller.startAction("review");
    equal(controller.getState().requestState, "loading");
    equal(controller.getState().currentAction, "review");
    includes(elements.assistantMessages.textContent, "Loading the reviewed review-note draft");
    includes(elements.assistantStatus.textContent, "Loading");
    equal(calls.length, 1);
    equal(calls[0].sectionId, "29");
    assert(!calls[0].signal.aborted);
    pending.resolve(reviewNoteFixture());
    await actionPromise;
    equal(controller.getState().requestState, "backend_success");
    equal(controller.getState().currentAction, "review");
    equal(elements.assistantStatus.textContent, "");
    includes(elements.assistantMessages.textContent, "Verified result");
    includes(elements.assistantMessages.textContent, "Control Section CS_29 Review Note");
    includes(elements.assistantMessages.textContent, "Draft for human review");
  });

  test("review compact result keeps full bodies inside collapsed details and excludes copy-only Markdown", async () => {
    const response = reviewNoteFixture();
    const client = {
      async generateSectionReviewNote() {
        return response;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    await controller.startAction("review");
    const compact = byAttribute(elements.assistantMessages, "data-review-compact")[0];
    const compactText = compact.children
      .filter(element => element.tagName !== "DETAILS")
      .map(element => element.textContent)
      .join("");
    const details = byTag(compact, "details")[0];
    includes(compactText, response.title);
    includes(compactText, `Evidence records: ${response.evidence.length}`);
    includes(compactText, `Limitations: ${response.limitations.length}`);
    response.sections.forEach(section => {
      excludes(compactText, section.body);
      includes(details.textContent, section.body);
    });
    equal(details.open, false);
    excludes(compact.textContent, response.rendered_markdown);
    equal(compact.getAttribute("data-review-compact"), "true");
  });

  test("review-note details remain collapsed initially", async () => {
    const client = {
      async generateSectionReviewNote() {
        return reviewNoteFixture();
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    await controller.startAction("review");
    const details = byTag(elements.assistantMessages, "details");
    equal(details.length, 1);
    equal(details[0].open, false);
    equal(details[0].getAttribute("data-report-section-count"), "6");
    const summaries = byTag(details[0], "summary");
    equal(summaries.length, 1);
    equal(summaries[0].textContent, "Open full review note");
  });

  test("review-note sections retain the accepted six-section order", async () => {
    const response = reviewNoteFixture();
    const client = {
      async generateSectionReviewNote() {
        return response;
      }
    };
    const { controller, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    await controller.startAction("review");
    const renderedSections = byAttribute(
      elements.assistantMessages,
      "data-report-section"
    );
    equal(renderedSections.length, 6);
    equal(
      renderedSections.map(section => section.getAttribute("data-report-section")).join(","),
      response.sections.map(section => section.key).join(",")
    );
    equal(
      renderedSections.map(section => byTag(section, "h3")[0].textContent).join("|"),
      response.sections.map(section => section.heading).join("|")
    );
  });

  test("review warnings, limitations, and checklist are separate safe-text blocks", async () => {
    const scriptLikeWarning = "<script>warningProbe()</script>";
    const response = reviewNoteFixture({
      warnings: [{ code: "METHOD_SCOPE", severity: "info", message: scriptLikeWarning }],
      limitations: ["LIMITATION FIXTURE"],
      humanReviewItems: ["CHECKLIST FIXTURE"]
    });
    const client = {
      async generateSectionReviewNote() {
        return response;
      }
    };
    const { controller, document, elements } = createHarness({ client });
    controller.setContext(selectedContext());
    await controller.startAction("review");
    const listBlocks = byAttribute(elements.assistantMessages, "data-review-list");
    equal(
      listBlocks.map(block => block.getAttribute("data-review-list")).join(","),
      "warnings,limitations,human-review-checklist"
    );
    includes(listBlocks[0].textContent, "METHOD_SCOPE (info)");
    includes(listBlocks[0].textContent, scriptLikeWarning);
    includes(listBlocks[1].textContent, "LIMITATION FIXTURE");
    includes(listBlocks[2].textContent, "Review: CHECKLIST FIXTURE");
    assert(!document.createdTags.includes("SCRIPT"));
  });

  test("review copy control exists only after a successful validated response", async () => {
    const failureClient = {
      async generateSectionReviewNote() {
        throw clientError("invalid_response");
      }
    };
    const failed = createHarness({ client: failureClient });
    equal(byClass(failed.elements.assistantMessages, "assistant-copy-markdown"), null);
    failed.controller.setContext(selectedContext());
    await failed.controller.startAction("review");
    equal(byClass(failed.elements.assistantMessages, "assistant-copy-markdown"), null);

    const successClient = {
      async generateSectionReviewNote() {
        return reviewNoteFixture();
      }
    };
    const succeeded = createHarness({ client: successClient });
    succeeded.controller.setContext(selectedContext());
    await succeeded.controller.startAction("review");
    const copyButton = byClass(
      succeeded.elements.assistantMessages,
      "assistant-copy-markdown"
    );
    assert(copyButton);
    equal(copyButton.tagName, "BUTTON");
    equal(copyButton.getAttribute("type"), "button");
  });

  test("Copy Markdown writes the exact sanitized rendered_markdown string", async () => {
    const response = reviewNoteFixture({
      renderedMarkdown: "# Exact Markdown\n\n- reviewed\n- copy-only"
    });
    const copiedValues = [];
    const clipboard = {
      async writeText(value) {
        copiedValues.push(value);
      }
    };
    const client = {
      async generateSectionReviewNote() {
        return response;
      }
    };
    const { controller, elements } = createHarness({ client, clipboard });
    controller.setContext(selectedContext());
    await controller.startAction("review");
    const copyButton = byClass(elements.assistantMessages, "assistant-copy-markdown");
    await copyButton.click();
    equal(copiedValues.length, 1);
    equal(copiedValues[0], response.rendered_markdown);
    excludes(elements.assistantMessages.textContent, response.rendered_markdown);
  });

  test("retained review copy remains active after a later quick action", async () => {
    const response = reviewNoteFixture({
      renderedMarkdown: "# Retained review\n\n- same section"
    });
    const copiedValues = [];
    const clipboard = {
      async writeText(value) {
        copiedValues.push(value);
      }
    };
    const client = {
      async generateSectionReviewNote() {
        return response;
      },
      async getSectionSummary() {
        return summaryFixture();
      }
    };
    const { controller, elements } = createHarness({ client, clipboard });
    controller.setContext(selectedContext());
    await controller.startAction("review");
    const copyButton = byClass(elements.assistantMessages, "assistant-copy-markdown");
    await controller.startAction("section");
    equal(byAttribute(elements.assistantMessages, "data-result-kind").length, 2);
    await copyButton.click();
    equal(copiedValues.length, 1);
    equal(copiedValues[0], response.rendered_markdown);
  });

  test("successful Markdown copy is announced accessibly", async () => {
    const clipboard = { async writeText() {} };
    const client = {
      async generateSectionReviewNote() {
        return reviewNoteFixture();
      }
    };
    const { controller, elements } = createHarness({ client, clipboard });
    controller.setContext(selectedContext());
    await controller.startAction("review");
    const copyButton = byClass(elements.assistantMessages, "assistant-copy-markdown");
    const copyStatus = byClass(elements.assistantMessages, "assistant-copy-status");
    await copyButton.click();
    equal(copyStatus.textContent, "Copied Markdown.");
    equal(copyStatus.getAttribute("role"), "status");
    equal(copyStatus.getAttribute("aria-live"), "polite");
    equal(copyStatus.getAttribute("aria-atomic"), "true");
  });

  test("clipboard unavailable and rejection states are concise and sanitized", async () => {
    const client = {
      async generateSectionReviewNote() {
        return reviewNoteFixture();
      }
    };
    const unavailable = createHarness({ client, clipboard: null });
    unavailable.controller.setContext(selectedContext());
    await unavailable.controller.startAction("review");
    await byClass(
      unavailable.elements.assistantMessages,
      "assistant-copy-markdown"
    ).click();
    equal(
      byClass(unavailable.elements.assistantMessages, "assistant-copy-status").textContent,
      "Clipboard unavailable."
    );

    const rejectingClipboard = {
      async writeText() {
        throw new Error("C:\\private\\clipboard-secret.txt");
      }
    };
    const rejected = createHarness({ client, clipboard: rejectingClipboard });
    rejected.controller.setContext(selectedContext());
    await rejected.controller.startAction("review");
    await byClass(rejected.elements.assistantMessages, "assistant-copy-markdown").click();
    const rejectionStatus = byClass(
      rejected.elements.assistantMessages,
      "assistant-copy-status"
    ).textContent;
    equal(rejectionStatus, "Copy failed.");
    excludes(rejectionStatus, "private");
    excludes(rejectionStatus, "clipboard-secret");
  });

  test("review-note backend failure never claims that a draft was generated", async () => {
    const failureCases = ["backend_unavailable", "request_timeout", "invalid_response"];
    for (const code of failureCases) {
      const client = {
        async generateSectionReviewNote() {
          throw clientError(code);
        }
      };
      const { controller, elements } = createHarness({ client });
      controller.setContext(selectedContext());
      await controller.startAction("review");
      equal(controller.getState().requestState, "fallback_success", code);
      includes(elements.assistantStatus.textContent, "showing a local result", code);
      includes(elements.assistantMessages.textContent, "no draft was generated", code);
      includes(elements.assistantMessages.textContent, "LOCAL SECTION PREVIEW", code);
      excludes(elements.assistantMessages.textContent, "Draft for human review", code);
      equal(byClass(elements.assistantMessages, "assistant-copy-markdown"), null);
    }
  });

  test("stale clipboard completion cannot update status after context replacement", async () => {
    const writePending = deferred();
    const clipboard = {
      writeText() {
        return writePending.promise;
      }
    };
    const client = {
      async generateSectionReviewNote() {
        return reviewNoteFixture();
      }
    };
    const { controller, elements } = createHarness({ client, clipboard });
    controller.setContext(selectedContext());
    await controller.startAction("review");
    const copyButton = byClass(elements.assistantMessages, "assistant-copy-markdown");
    const staleCopyStatus = byClass(elements.assistantMessages, "assistant-copy-status");
    const copyPromise = copyButton.click();
    controller.setContext(selectedContext({
      sectionId: "30",
      localSectionText: "REPLACEMENT SECTION PREVIEW"
    }));
    writePending.resolve();
    await copyPromise;
    equal(staleCopyStatus.textContent, "");
    equal(byClass(elements.assistantMessages, "assistant-copy-markdown"), null);
    includes(elements.assistantMessages.textContent, "Context updated to CS_30");
  });

  test("Tier 2 section, metric, and review clicks retain internal IDs but render only V3 labels", async () => {
    const source = String(globalThis.__assistantActionsSource || "");
    includes(source, "response.planning_context.netrisk_lite");
    includes(source, "safeDisplayText");
    const legacyText = "NETRISK Lite, EVENT_REI, Q_min, and observed curve resilience score v0";
    const client = {
      async getSectionSummary() {
        return summaryFixture("detected", { warningMessage: legacyText });
      },
      async explainMetric() {
        return metricFixture({
          name: "netrisk_lite",
          displayName: "NETRISK Lite",
          definition: legacyText,
          plainLanguage: legacyText
        });
      },
      async generateSectionReviewNote() {
        return reviewNoteFixture({
          sectionBodies: Array.from({ length: 6 }, () => legacyText),
          renderedMarkdown: `# ${legacyText}`
        });
      }
    };
    const copied = [];
    const clipboard = { async writeText(value) { copied.push(value); } };
    const { controller, elements } = createHarness({ client, clipboard });
    controller.setContext(selectedContext({ activeLayer: "tier2" }));

    await elements.assistantExplainSection.click();
    await flushPromises();
    await elements.assistantExplainMetric.click();
    await flushPromises();
    await elements.assistantGenerateReviewNote.click();
    await flushPromises();

    const rendered = elements.assistantMessages.textContent;
    includes(rendered, "NETWORK_REI");
    includes(rendered, "Minimum");
    excludes(rendered.toLowerCase(), "netrisk lite");
    excludes(rendered.toLowerCase(), "netrisk_lite");
    excludes(rendered.toLowerCase(), "event_rei");
    excludes(rendered.toLowerCase(), "event rei");
    excludes(rendered.toLowerCase(), "score v0");
    excludes(rendered.toLowerCase(), "q_min");

    const copyButton = byClass(elements.assistantMessages, "assistant-copy-markdown");
    await copyButton.click();
    equal(copied.length, 1);
    excludes(copied[0].toLowerCase(), "netrisk lite");
    excludes(copied[0].toLowerCase(), "event_rei");
    excludes(copied[0].toLowerCase(), "score v0");
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

  assert(pendingTests.length === 0, "Phase 2A3 QA still contains pending review/copy cases");
  return `${passed} Phase 4A V3 Assistant action regression tests passed.`;
};
