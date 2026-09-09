"use strict";

module.exports = async function runAssistantChatTests() {
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

  class FakeClassList {
    constructor(element) {
      this.element = element;
    }

    toggle(name, force) {
      const classes = new Set(this.element.className.split(/\s+/).filter(Boolean));
      const enabled = force === undefined ? !classes.has(name) : Boolean(force);
      if (enabled) classes.add(name);
      else classes.delete(name);
      this.element.className = Array.from(classes).join(" ");
      return enabled;
    }
  }

  class FakeElement {
    constructor(tagName, ownerDocument, id = null) {
      this.tagName = String(tagName).toUpperCase();
      this.ownerDocument = ownerDocument;
      this.id = id;
      this.className = "";
      this.hidden = false;
      this.disabled = false;
      this.value = "";
      this.open = false;
      this.scrollTop = 0;
      this.children = [];
      this.parentNode = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this._textContent = "";
      this.classList = new FakeClassList(this);
    }

    get textContent() {
      return this._textContent + this.children.map(child => child.textContent).join("");
    }

    set textContent(value) {
      this._textContent = String(value ?? "");
      this.children = [];
    }

    get scrollHeight() {
      return this.children.length * 40;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === "id") this.id = String(value);
    }

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    replaceChildren(...children) {
      this._textContent = "";
      this.children.forEach(child => {
        child.parentNode = null;
      });
      this.children = [];
      children.forEach(child => this.appendChild(child));
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    async dispatch(type, overrides = {}) {
      const event = {
        type,
        target: this,
        currentTarget: this,
        key: undefined,
        shiftKey: false,
        isComposing: false,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...overrides
      };
      for (const listener of this.listeners.get(type) || []) {
        await listener(event);
      }
      return event;
    }

    async click() {
      if (this.disabled) return null;
      return this.dispatch("click");
    }

    focus() {
      this.ownerDocument.activeElement = this;
    }

    querySelectorAll(selector) {
      const matches = [];
      function visit(element) {
        const isQuestionButton = selector === "button[data-assistant-question]"
          && element.tagName === "BUTTON"
          && element.attributes.has("data-assistant-question");
        if (isQuestionButton) matches.push(element);
        element.children.forEach(visit);
      }
      this.children.forEach(visit);
      return matches;
    }
  }

  class FakeDocument {
    constructor() {
      this.elements = new Map();
      this.activeElement = null;
      const definitions = [
        ["assistantDisclaimer", "p"],
        ["assistantInteractionNote", "p"],
        ["assistantAgent", "div"],
        ["assistantMessages", "div"],
        ["assistantChatStatus", "div"],
        ["assistantSuggestedQuestions", "div"],
        ["assistantComposer", "div"],
        ["assistantInput", "textarea"],
        ["assistantCharacterCount", "span"],
        ["assistantSend", "button"],
        ["assistantCancel", "button"],
        ["assistantModeLabel", "span"],
        ["assistantStatus", "span"],
        ["assistantActionAvailability", "p"],
        ["assistantExplainSection", "button"],
        ["assistantExplainMetric", "button"],
        ["assistantGenerateReviewNote", "button"]
      ];
      definitions.forEach(([id, tagName]) => {
        this.elements.set(id, new FakeElement(tagName, this, id));
      });
      this.elements.get("assistantAgent").hidden = true;
      this.elements.get("assistantComposer").hidden = true;
      this.elements.get("assistantInput").disabled = true;
      this.elements.get("assistantSend").disabled = true;
      this.elements.get("assistantCancel").hidden = true;
      this.elements.get("assistantCancel").disabled = true;
      const suggestions = [
        ["What happened on the selected section?", "section"],
        ["What does the warning mean?", "section"],
        ["What is the difference between planning context and observed evidence?", null],
        ["Explain the current metric.", "metric"],
        ["Why is observed evidence unavailable here?", "section"],
        ["Compare CS_1081 and CS_583693.", null],
        ["Generate a review note for this section.", "section"],
        ["What kinds of questions are outside the scope of this assistant?", null]
      ];
      const suggestionContainer = this.elements.get("assistantSuggestedQuestions");
      const primarySuggestions = new FakeElement("div", this);
      primarySuggestions.className = "assistant-suggestion-grid assistant-suggestion-primary";
      const moreSuggestions = new FakeElement("details", this);
      moreSuggestions.className = "assistant-more-suggestions";
      moreSuggestions.open = false;
      const moreSummary = new FakeElement("summary", this);
      moreSummary.textContent = "More suggested questions";
      const additionalSuggestions = new FakeElement("div", this);
      additionalSuggestions.className = "assistant-suggestion-grid";
      moreSuggestions.appendChild(moreSummary);
      moreSuggestions.appendChild(additionalSuggestions);
      suggestions.forEach(([question, requirement], index) => {
        const button = new FakeElement("button", this);
        button.textContent = question;
        button.setAttribute("data-assistant-question", question);
        if (requirement) button.setAttribute("data-requires-context", requirement);
        (index < 3 ? primarySuggestions : additionalSuggestions).appendChild(button);
      });
      suggestionContainer.appendChild(primarySuggestions);
      suggestionContainer.appendChild(moreSuggestions);
    }

    getElementById(id) {
      const element = this.elements.get(id);
      if (!element) throw new Error(`Unexpected test DOM id: ${id}`);
      return element;
    }

    createElement(tagName) {
      return new FakeElement(tagName, this);
    }
  }

  const activeLayerMetrics = Object.freeze({
    tier1: "weather_rei",
    tier2: "netrisk_lite",
    potential: "potential_resilience_score",
    tier3: "observed_curve_resilience_score_v0"
  });

  function responseFixture(overrides = {}) {
    const status = overrides.status || "completed";
    const defaultsByStatus = {
      completed: { intent: "explain_selected_section", clarification: null },
      clarification_required: {
        intent: "request_clarification",
        clarification: {
          reason: "section_required",
          question: "Which control section should I explain?"
        }
      },
      unsupported_request: { intent: "decline_unsupported_request", clarification: null },
      assistant_disabled: { intent: null, clarification: null },
      model_unavailable: { intent: null, clarification: null },
      tool_error: { intent: "explain_selected_section", clarification: null },
      invalid_model_response: { intent: null, clarification: null }
    };
    const defaults = defaultsByStatus[status];
    const response = {
      status,
      answer: overrides.answer || "A grounded answer from reviewed evidence.",
      intent: overrides.intent === undefined ? defaults.intent : overrides.intent,
      tools_used: overrides.tools_used || [
        { tool_name: "get_section_summary", call_index: 1 }
      ],
      evidence: overrides.evidence || [{
        evidence_id: "e_metric_q_min",
        kind: "metric_value",
        section_id: "CS_1081",
        metric_name: "q_min",
        label: "Minimum normalized Q",
        value: 0.62,
        display_value: "0.620",
        unit: "dimensionless",
        definition: "Minimum smoothed normalized performance."
      }],
      warnings: overrides.warnings || [{
        section_id: "CS_1081",
        code: "METHOD_SCOPE",
        severity: "info",
        message: "The method is experimental and event specific."
      }],
      limitations: overrides.limitations || [
        "This single-event review does not establish cause or predict future performance."
      ],
      clarification: overrides.clarification === undefined
        ? defaults.clarification
        : overrides.clarification,
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0",
      chain_of_thought: overrides.chain_of_thought,
      raw_model_response: overrides.raw_model_response
    };
    if (Object.prototype.hasOwnProperty.call(overrides, "structured_result")) {
      response.structured_result = overrides.structured_result;
    }
    return response;
  }

  function structuredMetric(metric, displayName, sourceMetric) {
    return {
      metric,
      display_name: displayName,
      source_metric: sourceMetric,
      unit: "dimensionless",
      higher_value_interpretation: "Higher values are more favorable within this release."
    };
  }

  function structuredDistribution(populationCount, availableCount) {
    return {
      population_count: populationCount,
      available_count: availableCount,
      missing_count: populationCount - availableCount,
      minimum: 0.1,
      median: 0.5,
      maximum: 0.9
    };
  }

  function structuredRow(
    position,
    value,
    sectionId = `CS_${1000 + position}`,
    metricRank = position
  ) {
    return {
      position,
      metric_rank: metricRank,
      section_id: sectionId,
      route: "IH_35_",
      county: "Dallas",
      value,
      observed_support: true,
      detection_status: "detected"
    };
  }

  function rankingResultFixture() {
    return {
      result_type: "section_ranking",
      metric: structuredMetric("tier2_network", "Tier 2 Network", "netrisk_lite"),
      direction: "descending",
      county: null,
      limit_per_tail: 1,
      distribution: structuredDistribution(10029, 10029),
      highest_sections: [structuredRow(1, 0.9, "CS_1001", 7)],
      lowest_sections: [structuredRow(1, 0.1, "CS_2001", 10023)],
      interpretation_limit: "This descriptive ordering is not an investment priority.",
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0"
    };
  }

  function countyResultFixture() {
    const descriptors = [
      structuredMetric("tier1_weather", "Tier 1 Weather", "weather_rei"),
      structuredMetric("tier2_network", "Tier 2 Network", "netrisk_lite"),
      structuredMetric("potential_resilience", "Potential Resilience", "potential_resilience_score"),
      structuredMetric("tier3_observed_resilience", "Tier 3 Observed Resilience", "observed_curve_resilience_score_v0")
    ];
    return {
      result_type: "county_resilience_summary",
      county: "Dallas",
      total_sections: 58,
      observed_support_count: 56,
      observed_support_percent: 56 / 58 * 100,
      status_counts: {
        detected: 50,
        no_sustained_drop: 4,
        recovery_endpoint_censored: 2,
        no_observed_support: 2
      },
      metric_summaries: descriptors.map((metric, index) => ({
        metric,
        distribution: { ...structuredDistribution(58, index === 3 ? 56 : 58), q1: 0.3, q3: 0.7 },
        statewide_distribution: { ...structuredDistribution(10029, index === 3 ? 3473 : 10029), q1: 0.3, q3: 0.7 },
        median_relative_to_statewide: "equal",
        median_percentile_in_statewide_sections: 50
      })),
      representative_high_observed: [structuredRow(1, 0.9)],
      representative_low_observed: [structuredRow(1, 0.1, "CS_2001")],
      coverage_caveat: "Two sections have no observed support.",
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0"
    };
  }

  function alignmentResultFixture() {
    return {
      result_type: "tier_alignment_summary",
      potential_metric: structuredMetric("potential_resilience", "Potential Resilience", "potential_resilience_score"),
      observed_metric: structuredMetric("tier3_observed_resilience", "Tier 3 Observed Resilience", "observed_curve_resilience_score_v0"),
      statewide_section_count: 10029,
      common_support_count: 3842,
      valid_pair_count: 3473,
      missing_pair_count_within_common_support: 369,
      excluded_no_support_count: 6187,
      pearson_r: 0.277170,
      spearman_rho: 0.281802,
      classification_status: "method_definition_required",
      alignment_definition: null,
      consistent_count: null,
      mismatch_count: null,
      category_counts: null,
      representative_examples: null,
      method_note: "Agreement categories require a reviewed method definition.",
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0"
    };
  }

  function sectionSummaryFixture() {
    return {
      identity: {
        normalized_cs_id: "1081",
        display_cs_id: "CS_1081",
        route: "US_67_",
        county: "Presidio",
        county_fips: "48377"
      },
      support_status: {
        observed_support: true,
        detection_status: "detected",
        matched_tmc_count: 4,
        data_density_summary: "A"
      },
      observed_metrics: {
        q0: 1,
        q_min: 0.62,
        loss_depth: 0.38,
        loss_depth_fraction: 0.38,
        loss_depth_percent: 38,
        degradation_duration_hours: 4,
        degradation_slope: -0.095,
        recovery_duration_hours: 6,
        recovery_slope: 0.06,
        time_to_80_hours: 2,
        time_to_90_hours: 6,
        resilience_loss_area: 1.4,
        normalized_loss_area: 0.23,
        observed_curve_resilience_score_v0: 0.77,
        onset_time: "2026-01-22T01:00:00",
        minimum_time: "2026-01-22T05:00:00",
        recovery_end_time: "2026-01-22T11:00:00"
      },
      planning_context: {
        weather_rei: 0.25,
        netrisk_lite: 0.5,
        event_rei: 0.3375,
        potential_resilience_score: 0.66,
        aadt: 1234.5
      },
      warnings: [{
        code: "METHOD_SCOPE",
        severity: "info",
        message: "The method is experimental and event specific."
      }],
      source_label: "Reviewed release",
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0",
      timezone_status: "unverified_local_clock_time"
    };
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

  function clientError(code) {
    const error = new Error("sanitized");
    error.code = code;
    return error;
  }

  function createHarness({
    mode = "backend-agent",
    client = null,
    sectionId = "1081",
    activeLayer = "tier3",
    selectContext = true,
    resetTimelineOnContextChange = undefined,
    showContextResetNotice = undefined,
    openRanking = undefined
  } = {}) {
    const document = new FakeDocument();
    const calls = [];
    const safeClient = client || {
      async queryAssistant(request, options) {
        calls.push({ request, options });
        return responseFixture();
      }
    };
    const controller = globalThis.SPTCAssistantChat.createController({
      document,
      runtime: {
        effective_mode: mode,
        backend_agent_enabled: mode === "backend-agent"
      },
      activeLayerMetrics,
      client: safeClient,
      resetTimelineOnContextChange,
      showContextResetNotice,
      openRanking
    });
    controller.setContext({ sectionId: null, activeLayer });
    if (selectContext) controller.setContext({ sectionId, activeLayer });
    return {
      controller,
      document,
      calls,
      elements: Object.fromEntries(document.elements)
    };
  }

  function allDescendants(element) {
    const values = [];
    function visit(node) {
      values.push(node);
      node.children.forEach(visit);
    }
    visit(element);
    return values;
  }

  function suggestionButtons(elements) {
    return elements.assistantSuggestedQuestions.querySelectorAll(
      "button[data-assistant-question]"
    );
  }

  test("chat module exposes a bounded frozen surface without network or persistence code", () => {
    const namespace = globalThis.SPTCAssistantChat;
    assert(Object.isFrozen(namespace));
    equal(namespace.maximumMessageCharacters, 1000);
    equal(namespace.maximumHistoryMessages, 4);
    const source = String(globalThis.__assistantChatSource || "");
    for (const forbidden of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "DOMParser",
      "fetch(",
      "11434",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "telemetry",
      "upload",
      "Qwen",
      "Ollama",
      "FastAPI",
      "qwen3:8b"
    ]) {
      excludes(source, forbidden, `Chat source contains ${forbidden}`);
    }
    includes(source, "queryAssistant");
    for (const deterministicMethod of [
      "getSectionSummary",
      "explainMetric",
      "generateSectionReviewNote"
    ]) {
      excludes(source, deterministicMethod);
    }
    const actionsSource = String(globalThis.__assistantActionsSource || "");
    excludes(actionsSource, "queryAssistant");
    excludes(actionsSource, "fetch(");
    excludes(actionsSource, "11434");
  });

  test("composer and suggestions are visible only in backend-agent mode", () => {
    for (const mode of ["local-template", "backend-tools", "invalid"]) {
      const { controller, elements } = createHarness({ mode });
      assert(elements.assistantAgent.hidden, mode);
      assert(elements.assistantComposer.hidden, mode);
      assert(elements.assistantInput.disabled, mode);
      assert(elements.assistantSend.disabled, mode);
      assert(suggestionButtons(elements).every(button => button.disabled), mode);
      assert(controller.getState().agentMode === false, mode);
    }
    const { controller, elements, calls } = createHarness();
    assert(!elements.assistantAgent.hidden);
    assert(!elements.assistantComposer.hidden);
    assert(!elements.assistantInput.disabled);
    assert(controller.getState().agentMode === true);
    equal(calls.length, 0);
    includes(elements.assistantDisclaimer.textContent, "selected roadway section");
    excludes(elements.assistantDisclaimer.textContent, "Qwen");
  });

  test("blank and over-limit questions are rejected while 1000 characters are accepted", async () => {
    const { controller, calls, elements } = createHarness();
    assert(await controller.submitQuestion("   ") === false);
    equal(calls.length, 0);
    elements.assistantInput.value = "x".repeat(1001);
    await elements.assistantInput.dispatch("input");
    equal(elements.assistantCharacterCount.textContent, "1001 / 1000");
    assert(elements.assistantSend.disabled);
    assert(await controller.submitQuestion(elements.assistantInput.value) === false);
    equal(calls.length, 0);
    assert(await controller.submitQuestion("x".repeat(1000)) === true);
    equal(calls.length, 1);
    equal(calls[0].request.message.length, 1000);
  });

  test("Enter submits and Shift+Enter preserves a newline action", async () => {
    const { calls, elements } = createHarness();
    elements.assistantInput.value = "Explain the selected section.";
    await elements.assistantInput.dispatch("input");
    const enter = await elements.assistantInput.dispatch("keydown", {
      key: "Enter",
      shiftKey: false
    });
    assert(enter.defaultPrevented);
    equal(calls.length, 1);

    const second = createHarness();
    second.elements.assistantInput.value = "Line one";
    const shiftEnter = await second.elements.assistantInput.dispatch("keydown", {
      key: "Enter",
      shiftKey: true
    });
    assert(!shiftEnter.defaultPrevented);
    equal(second.calls.length, 0);
  });

  test("pending state blocks duplicate submission and exposes accessible cancellation", async () => {
    const gate = deferred();
    let callCount = 0;
    const { controller, elements } = createHarness({
      client: {
        queryAssistant() {
          callCount += 1;
          return gate.promise;
        }
      }
    });
    const first = controller.submitQuestion("Explain the selected section.");
    assert(controller.getState().pending);
    assert(elements.assistantAgent.getAttribute("aria-busy") === "true");
    assert(elements.assistantMessages.getAttribute("aria-busy") === "true");
    assert(!elements.assistantCancel.hidden && !elements.assistantCancel.disabled);
    assert(elements.assistantInput.disabled);
    equal(elements.assistantChatStatus.textContent, "AI is working…");
    assert(await controller.submitQuestion("Duplicate") === false);
    equal(callCount, 1);
    gate.resolve(responseFixture());
    assert(await first === true);
    assert(!controller.getState().pending);
    assert(elements.assistantCancel.hidden);
    assert(elements.assistantAgent.getAttribute("aria-busy") === "false");
  });

  test("Cancel aborts the request, adds no assistant history, and returns focus", async () => {
    let receivedSignal = null;
    const { controller, document, elements } = createHarness({
      client: {
        queryAssistant(request, options) {
          receivedSignal = options.signal;
          return new Promise((resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(clientError("request_cancelled")), {
              once: true
            });
          });
        }
      }
    });
    const pending = controller.submitQuestion("Explain the selected section.");
    assert(controller.cancel());
    assert(receivedSignal.aborted);
    assert(await pending === false);
    equal(controller.getState().historyLength, 0);
    includes(elements.assistantMessages.textContent, "request cancelled");
    assert(document.activeElement === elements.assistantInput);
  });

  test("current selected section and reviewed active metric are authoritative request context", async () => {
    const { controller, calls } = createHarness();
    await controller.submitQuestion("Explain it.");
    equal(calls[0].request.selected_section_id, "CS_1081");
    equal(calls[0].request.active_metric, "observed_curve_resilience_score_v0");
    equal(calls[0].request.active_analysis_layer, "tier3");
    assert(!Object.hasOwn(calls[0].request, "history"));

    const unsupported = createHarness({ activeLayer: "detection_status" });
    await unsupported.controller.submitQuestion("Explain the warning.");
    equal(unsupported.calls[0].request.selected_section_id, "CS_1081");
    assert(!Object.hasOwn(unsupported.calls[0].request, "active_metric"));
    const metricSuggestion = suggestionButtons(unsupported.elements).find(button => (
      button.getAttribute("data-assistant-question") === "Explain the current metric."
    ));
    assert(metricSuggestion.disabled);
  });

  test("history is capped at four user/answer messages and excludes structured response data", async () => {
    const { controller, calls } = createHarness();
    await controller.submitQuestion("Question one.");
    await controller.submitQuestion("Question two.");
    await controller.submitQuestion("Question three.");
    equal(calls.length, 3);
    assert(!Object.hasOwn(calls[0].request, "history"));
    equal(calls[1].request.history.length, 2);
    equal(calls[2].request.history.length, 4);
    equal(calls[2].request.history.map(item => item.role), [
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
    calls[2].request.history.forEach(item => {
      equal(Object.keys(item).sort(), ["content", "role"]);
      excludes(item.content, "METHOD_SCOPE");
      excludes(item.content, "e_metric_q_min");
      excludes(item.content, "raw_model_response");
    });
    equal(controller.getState().historyLength, 4);
  });

  test("long valid answers are bounded before entering the next request history", async () => {
    const calls = [];
    const longAnswer = "A".repeat(2500);
    const { controller, elements } = createHarness({
      client: {
        async queryAssistant(request, options) {
          calls.push({ request, options });
          return responseFixture({ answer: calls.length === 1 ? longAnswer : "Second answer." });
        }
      }
    });
    assert(await controller.submitQuestion("First question.") === true);
    includes(elements.assistantMessages.textContent, longAnswer);
    assert(await controller.submitQuestion("Second question.") === true);
    equal(calls[1].request.history.length, 2);
    equal(calls[1].request.history[0], { role: "user", content: "First question." });
    equal(calls[1].request.history[1].role, "assistant");
    equal(calls[1].request.history[1].content.length, 1000);
    equal(calls[1].request.history[1].content, longAnswer.slice(0, 1000));
  });

  test("successful history resets without an automatic request on context changes", async () => {
    const { controller, calls, elements } = createHarness();
    await controller.submitQuestion("First section question.");
    equal(controller.getState().historyLength, 2);
    const sectionCallCount = calls.length;
    controller.setContext({ sectionId: "257", activeLayer: "tier3" });
    equal(controller.getState().historyLength, 0);
    equal(calls.length, sectionCallCount);
    includes(elements.assistantMessages.textContent, "No question was sent");
    await controller.submitQuestion("New section question.");
    equal(calls.at(-1).request.selected_section_id, "CS_257");
    equal(calls.at(-1).request.active_metric, "observed_curve_resilience_score_v0");
    assert(!Object.hasOwn(calls.at(-1).request, "history"));

    equal(controller.getState().historyLength, 2);
    const metricCallCount = calls.length;
    controller.setContext({ sectionId: "257", activeLayer: "tier2" });
    equal(controller.getState().historyLength, 0);
    equal(calls.length, metricCallCount);
    await controller.submitQuestion("New metric question.");
    equal(calls.at(-1).request.selected_section_id, "CS_257");
    equal(calls.at(-1).request.active_metric, "netrisk_lite");
    assert(!Object.hasOwn(calls.at(-1).request, "history"));
  });

  test("shared-timeline context changes clear stale status without adding a chat notice", async () => {
    const { controller, elements } = createHarness({
      resetTimelineOnContextChange: false,
      showContextResetNotice: false,
      client: {
        async queryAssistant() {
          return responseFixture({ status: "unsupported_request" });
        }
      }
    });
    await controller.submitQuestion("Predict next winter.");
    equal(
      elements.assistantChatStatus.textContent,
      ""
    );
    const priorTimelineText = elements.assistantMessages.textContent;
    controller.setContext({ sectionId: "257", activeLayer: "tier3" });
    equal(elements.assistantChatStatus.textContent, "");
    equal(elements.assistantMessages.textContent, priorTimelineText);
    equal(controller.getState().historyLength, 0);
  });

  test("section changes clear history, cancel pending work, and ignore stale responses", async () => {
    const gate = deferred();
    let signal = null;
    const { controller, elements } = createHarness({
      client: {
        queryAssistant(request, options) {
          signal = options.signal;
          return gate.promise;
        }
      }
    });
    const pending = controller.submitQuestion("Explain the selected section.");
    controller.setContext({ sectionId: "257", activeLayer: "tier3" });
    assert(signal.aborted);
    equal(controller.getState().historyLength, 0);
    equal(controller.getState().selectedSectionId, "257");
    includes(elements.assistantMessages.textContent, "CS_257");
    includes(elements.assistantMessages.textContent, "No question was sent");
    gate.resolve(responseFixture({ answer: "STALE RESPONSE" }));
    assert(await pending === false);
    excludes(elements.assistantMessages.textContent, "STALE RESPONSE");
  });

  test("metric changes clear history and cancel a pending metric-context request", async () => {
    const gate = deferred();
    let signal = null;
    const { controller, elements } = createHarness({
      client: {
        queryAssistant(request, options) {
          signal = options.signal;
          return gate.promise;
        }
      }
    });
    const pending = controller.submitQuestion("Explain the current metric.");
    controller.setContext({ sectionId: "1081", activeLayer: "tier2" });
    assert(signal.aborted);
    equal(controller.getState().activeMetric, "netrisk_lite");
    equal(controller.getState().historyLength, 0);
    includes(elements.assistantMessages.textContent, "NETWORK_REI");
    excludes(elements.assistantMessages.textContent.toLowerCase(), "netrisk_lite");
    gate.resolve(responseFixture({ answer: "STALE METRIC RESPONSE" }));
    assert(await pending === false);
    excludes(elements.assistantMessages.textContent, "STALE METRIC RESPONSE");
  });

  test("all seven reviewed response statuses have explicit presentation", async () => {
    const statuses = [
      "completed",
      "clarification_required",
      "unsupported_request",
      "assistant_disabled",
      "model_unavailable",
      "tool_error",
      "invalid_model_response"
    ];
    for (const status of statuses) {
      const { controller, elements } = createHarness({
        client: {
          async queryAssistant() {
            return responseFixture({
              status,
              answer: status === "invalid_model_response" ? "REJECTED MODEL TEXT" : undefined
            });
          }
        }
      });
      assert(await controller.submitQuestion(`Test ${status}.`) === true, status);
      assert(allDescendants(elements.assistantMessages).some(node => node.className === "assistant-chat-answer"));
      excludes(elements.assistantMessages.textContent, "Status:");
      if (status === "clarification_required") {
        includes(elements.assistantMessages.textContent, "Which control section");
        includes(elements.assistantMessages.textContent, `Test ${status}.`);
      }
      if (status === "invalid_model_response") {
        excludes(elements.assistantMessages.textContent, "REJECTED MODEL TEXT");
        includes(elements.assistantMessages.textContent, "could not be safely accepted");
      }
      if (status === "model_unavailable") {
        includes(elements.assistantMessages.textContent, "AI Assistant is unavailable");
        excludes(elements.assistantMessages.textContent, "AI Assistant status");
        includes(elements.assistantMessages.textContent, "Verified quick actions remain available");
        excludes(elements.assistantMessages.textContent, "Qwen");
      }
    }
  });

  test("timeout and client cancellation failures are sanitized without a fake fallback", async () => {
    for (const code of ["request_timeout", "request_cancelled"]) {
      const { controller, elements } = createHarness({
        client: {
          async queryAssistant() {
            throw clientError(code);
          }
        }
      });
      assert(await controller.submitQuestion("Explain it.") === false);
      includes(elements.assistantMessages.textContent, code === "request_timeout"
        ? "did not complete"
        : "was cancelled");
      excludes(elements.assistantMessages.textContent, "80000");
      excludes(elements.assistantMessages.textContent, "local template");
      equal(controller.getState().historyLength, 0);
    }
  });

  test("normal response renders inert answer only and retains metadata outside visible DOM", async () => {
    const scriptLike = '<img src=x onerror="PRIVATE_SCRIPT"> **not Markdown HTML**';
    const { controller, elements } = createHarness({
      client: {
        async queryAssistant() {
          return responseFixture({
            answer: scriptLike,
            evidence: [{
              evidence_id: "e_1_status",
              kind: "section_status",
              section_id: "CS_1081",
              metric_name: null,
              label: "Detection status",
              value: "RAW_PRIVATE_VALUE",
              display_value: "detected",
              unit: null,
              definition: null
            }],
            chain_of_thought: "PRIVATE_REASONING C:\\private\\file.txt",
            raw_model_response: "http://127.0.0.1:11434/private"
          });
        }
      }
    });
    await controller.submitQuestion("Render safely.");
    const text = elements.assistantMessages.textContent;
    includes(text, scriptLike);
    excludes(text, "AI-assisted response");
    excludes(text, "METHOD_SCOPE (info)");
    excludes(text, "get section summary");
    excludes(text, "Detection status");
    excludes(text, "detected");
    excludes(text, "Limitations (1)");
    excludes(text, "Release and method");
    excludes(text, "coldwave_2026_01_r1");
    excludes(text, "RAW_PRIVATE_VALUE");
    excludes(text, "PRIVATE_REASONING");
    excludes(text, "11434");
    excludes(text, "raw_model_response");
    excludes(text, '"tools_used"');
    const descendants = allDescendants(elements.assistantMessages);
    assert(!descendants.some(element => element.tagName === "IMG"));
    const details = descendants.filter(element => element.tagName === "DETAILS");
    equal(details.length, 0);
    assert(details.every(element => element.open === false));
  });

  test("suggested questions use the ordinary query method and respect context enablement", async () => {
    const { calls, elements } = createHarness();
    const buttons = suggestionButtons(elements);
    equal(buttons.length, 8);
    assert(buttons.every(button => button.tagName === "BUTTON"));
    const suggestionDescendants = allDescendants(elements.assistantSuggestedQuestions);
    const primary = suggestionDescendants.find(element => (
      String(element.className).split(/\s+/).includes("assistant-suggestion-primary")
    ));
    const more = suggestionDescendants.find(element => (
      String(element.className).split(/\s+/).includes("assistant-more-suggestions")
    ));
    assert(primary);
    assert(more);
    equal(primary.querySelectorAll("button[data-assistant-question]").length, 3);
    equal(more.querySelectorAll("button[data-assistant-question]").length, 5);
    equal(more.open, false);
    const comparison = buttons.find(button => (
      button.getAttribute("data-assistant-question") === "Compare CS_1081 and CS_583693."
    ));
    await comparison.click();
    await Promise.resolve();
    equal(calls.length, 1);
    equal(calls[0].request.message, "Compare CS_1081 and CS_583693.");
    equal(Object.keys(calls[0].request).sort(), [
      "active_analysis_layer",
      "active_metric",
      "message",
      "selected_section_id"
    ]);
  });

  test("verified quick action and AI response coexist chronologically in one timeline", async () => {
    const document = new FakeDocument();
    const elements = Object.fromEntries(document.elements);
    const runtime = {
      effective_mode: "backend-agent",
      backend_agent_enabled: true
    };
    const actionCalls = [];
    const chatCalls = [];
    const actionController = globalThis.SPTCAssistantActions.createController({
      document,
      runtime,
      activeLayerMetrics,
      clipboard: null,
      client: {
        async getSectionSummary(sectionId) {
          actionCalls.push(sectionId);
          return sectionSummaryFixture();
        }
      }
    });
    const chatController = globalThis.SPTCAssistantChat.createController({
      document,
      runtime,
      activeLayerMetrics,
      resetTimelineOnContextChange: false,
      showContextResetNotice: false,
      client: {
        async queryAssistant(request) {
          chatCalls.push(request);
          return responseFixture({ answer: "AI explanation grounded in reviewed evidence." });
        }
      }
    });
    const emptyContext = {
      sectionId: null,
      activeLayer: "tier3",
      localSectionText: null,
      localMetricText: null
    };
    const selected = {
      sectionId: "1081",
      activeLayer: "tier3",
      localSectionText: "LOCAL SECTION PREVIEW",
      localMetricText: "LOCAL METRIC PREVIEW"
    };
    actionController.setContext(emptyContext);
    chatController.setContext(emptyContext);
    actionController.setContext(selected);
    chatController.setContext(selected);

    await actionController.startAction("section");
    await chatController.submitQuestion("Explain the selected section.");

    equal(actionCalls, ["1081"]);
    equal(chatCalls.length, 1);
    equal(chatCalls[0].selected_section_id, "CS_1081");
    equal(chatCalls[0].active_metric, "observed_curve_resilience_score_v0");
    equal(chatCalls[0].active_analysis_layer, "tier3");
    const entries = elements.assistantMessages.children;
    equal(entries.length, 5);
    includes(entries[0].textContent, "Context updated to CS_1081");
    equal(entries[1].getAttribute("data-assistant-invocation"), "section");
    equal(entries[2].getAttribute("data-result-kind"), "verified");
    equal(entries[3].getAttribute("data-chat-role"), "user");
    equal(entries[4].getAttribute("data-result-kind"), "ai-assisted");
    const sourceLabels = allDescendants(elements.assistantMessages)
      .filter(element => ["assistant-result-source", "assistant-chat-source"]
        .includes(element.className))
      .map(element => element.textContent);
    equal(sourceLabels, []);
    includes(entries[2].textContent, "CS_1081");
    includes(entries[4].textContent, "AI explanation grounded in reviewed evidence.");
  });

  test("validated network results render bounded numerical prose without metadata cards", async () => {
    const cases = [
      [rankingResultFixture(), ["Highest values", "Lowest values", "7.", "10023."]],
      [countyResultFixture(), ["Dallas County has 58", "56 have Tier 3 support", "no observed support 2", "detected 50", "no sustained drop 4", "recovery censored 2", "Q1", "Q3", "statewide median", "Notable sections"]],
      [alignmentResultFixture(), ["3,473", "3,842", "0.277", "0.282", "reviewed classification rule has not been defined"]]
    ];
    for (const [result, fragments] of cases) {
      const original = JSON.stringify(result);
      const answer = result.result_type === "tier_alignment_summary"
        ? "A reviewed classification rule has not been defined."
        : "The eligible sample supports this comparison.";
      const {controller,elements} = createHarness({client:{async queryAssistant(){return responseFixture({structured_result:result, answer});}}});
      await controller.submitQuestion("Show the reviewed result.");
      const text = elements.assistantMessages.textContent;
      fragments.forEach(fragment=>includes(text,fragment));
      excludes(text, "METHOD_DEFINITION_REQUIRED");
      excludes(text, "classification_status");
      excludes(text, "tools_used");
      excludes(text, "Warnings");
      excludes(text, "Release and method");
      const nodes = allDescendants(elements.assistantMessages);
      assert(!nodes.some(node=>["TABLE","DETAILS","H3","H4"].includes(node.tagName)));
      equal(JSON.stringify(result), original, "presentation must not mutate structured evidence");
    }
  });

  test("essential backend answer cautions remain visible plain text for all detection states", async () => {
    const cautions = [
      "Detected under the current event-specific method.",
      "No sustained drop does not prove that no impact occurred.",
      "The recovery endpoint is censored and does not confirm completed recovery.",
      "Missing Tier 3 support is not zero resilience and does not establish whether disruption occurred."
    ];
    for (const answer of cautions) {
      const {controller,elements} = createHarness({client:{async queryAssistant(){return responseFixture({answer});}}});
      await controller.submitQuestion("Explain the selected section.");
      includes(elements.assistantMessages.textContent,answer);
      equal(allDescendants(elements.assistantMessages).filter(node=>node.className==="assistant-chat-answer").length,1);
    }
  });

  test("full ranking trigger opens deterministic scope without another Assistant request", async () => {
    let calls = 0;
    const opened = [];
    const result = rankingResultFixture();
    const {controller, elements} = createHarness({
      client: {async queryAssistant() { calls++; return responseFixture({structured_result: result}); }},
      openRanking: (scope, trigger) => opened.push({scope, trigger})
    });
    await controller.submitQuestion("Rank Tier 2 sections.");
    const button = allDescendants(elements.assistantMessages).find(node => node.className === "assistant-full-ranking");
    includes(button.textContent, "10,029");
    includes(elements.assistantMessages.textContent, "highest 1 and lowest 1");
    await button.click();
    equal(calls, 1);
    equal(opened.length, 1);
    assert(opened[0].scope === result && opened[0].trigger === button);
  });

  test("successful completion restores input focus and keeps suggestions available", async () => {
    const { controller, document, elements } = createHarness();
    await controller.submitQuestion("Explain it.");
    assert(document.activeElement === elements.assistantInput);
    assert(!elements.assistantInput.disabled);
    assert(suggestionButtons(elements).some(button => !button.disabled));
    equal(elements.assistantCharacterCount.textContent, "0 / 1000");
  });

  for (const { name, callback } of tests) {
    try {
      await callback();
    } catch (error) {
      throw new Error(`${name}: ${String(error?.message || error)}`);
    }
  }
  return `${tests.length} Phase 4A V3 Assistant chat interaction tests passed.`;
};
