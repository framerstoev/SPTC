(async function runAssistantClientTests(global) {
  "use strict";

  const resultNode = document.getElementById("testResult");
  const tests = [];
  const nativeFetch = global.fetch.bind(global);
  const clientMessages = Object.freeze({
    invalid_request: "The request does not meet the reviewed client contract.",
    backend_unavailable: "The local deterministic backend is unavailable.",
    request_timeout: "The local deterministic backend request timed out.",
    request_cancelled: "The local deterministic backend request was cancelled.",
    section_not_found: "The control section was not found in the reviewed release.",
    metric_not_found: "The metric was not found in the reviewed registry.",
    backend_validation_error: "The backend rejected the reviewed request.",
    snapshot_unavailable: "The reviewed resilience snapshot is unavailable.",
    invalid_json: "The backend returned invalid JSON.",
    invalid_response: "The backend response does not match the reviewed contract.",
    unexpected_status: "The backend returned an unexpected status."
  });

  function test(name, callback) {
    tests.push({ name, callback });
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
  }

  function equal(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
      throw new Error(message || `Expected ${expectedJson}, received ${actualJson}`);
    }
  }

  async function expectCode(callback, expectedCode) {
    let caught = null;
    try {
      await callback();
    } catch (error) {
      caught = error;
    }
    assert(caught, `Expected ${expectedCode} rejection`);
    equal(caught.code, expectedCode, `Expected ${expectedCode}, received ${caught.code}`);
    equal(caught.message, clientMessages[expectedCode], "Client error message was not sanitized");
    for (const marker of ["http", "private", "Not found.", "Invalid request.", "Unavailable."]) {
      assert(!caught.message.includes(marker), `Client error leaked ${marker}`);
    }
  }

  function jsonResponse(status, payload) {
    return {
      status,
      text: async () => JSON.stringify(payload)
    };
  }

  function textResponse(status, text) {
    return {
      status,
      text: async () => text
    };
  }

  function timerProbe() {
    let nextId = 1;
    const callbacks = new Map();
    const cleared = [];
    return {
      callbacks,
      cleared,
      setTimeout(callback, milliseconds) {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, { callback, milliseconds });
        return id;
      },
      clearTimeout(id) {
        cleared.push(id);
        callbacks.delete(id);
      },
      fireFirst() {
        const first = callbacks.entries().next().value;
        assert(first, "No pending timeout to fire");
        first[1].callback();
      }
    };
  }

  function signalProbe() {
    let listener = null;
    const state = {
      added: 0,
      removed: 0
    };
    const signal = {
      aborted: false,
      addEventListener(type, callback) {
        assert(type === "abort", "Unexpected signal event type");
        state.added += 1;
        listener = callback;
      },
      removeEventListener(type, callback) {
        assert(type === "abort", "Unexpected signal event type");
        state.removed += 1;
        if (listener === callback) listener = null;
      }
    };
    return {
      signal,
      state,
      abort() {
        signal.aborted = true;
        if (listener) listener();
      }
    };
  }

  function warningForStatus(status) {
    if (status === "detected") {
      return [{ code: "METHOD_SCOPE", severity: "info", message: "Experimental method scope." }];
    }
    if (status === "no_sustained_drop") {
      return [
        { code: "NO_SUSTAINED_DROP", severity: "caution", message: "No sustained drop." },
        { code: "METHOD_SCOPE", severity: "info", message: "Experimental method scope." }
      ];
    }
    if (status === "recovery_endpoint_censored") {
      return [
        { code: "RECOVERY_CENSORED", severity: "caution", message: "Recovery censored." },
        { code: "METHOD_SCOPE", severity: "info", message: "Experimental method scope." }
      ];
    }
    return [{
      code: "NO_OBSERVED_SUPPORT",
      severity: "caution",
      message: "No observed support."
    }];
  }

  function summaryFixture(status = "detected", sectionId = "29") {
    const noSupport = status === "no_observed_support";
    const noDrop = status === "no_sustained_drop";
    const phaseAvailable = !noSupport && !noDrop;
    return {
      identity: {
        normalized_cs_id: sectionId,
        display_cs_id: `CS_${sectionId}`,
        route: "US_90_",
        county: "Brewster",
        county_fips: "48043",
        ignored_identity_field: "not forwarded"
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
      warnings: warningForStatus(status),
      source_label: "Jan. 2026 cold-wave processed control-section resilience release",
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0",
      timezone_status: "unverified_local_clock_time",
      ignored_top_level: { arbitrary: true }
    };
  }

  function metricFixture(name = "q_min") {
    const planning = name === "event_rei";
    return {
      metric: {
        name,
        display_name: planning ? "Event REI" : "Minimum normalized Q",
        category: planning ? "planning_context" : "observed_operational",
        definition: "A reviewed deterministic metric definition.",
        unit: "dimensionless",
        value_type: "number",
        nullable: !planning,
        applicability: planning
          ? [
            "detected",
            "no_sustained_drop",
            "recovery_endpoint_censored",
            "no_observed_support"
          ]
          : ["detected", "recovery_endpoint_censored"],
        null_meaning: "Null means the reviewed value is unavailable.",
        expected_domain: "Reviewed release domain.",
        calculation_summary: "Returned from the accepted registry.",
        event_specific: true,
        ignored_metric_field: "not forwarded"
      },
      interpretation: {
        plain_language: "A bounded plain-language interpretation.",
        limitations: ["This metric is event and method specific."],
        directionality: null
      },
      provenance: {
        source_label: "Jan. 2026 cold-wave processed control-section resilience release",
        source_field: planning ? "EVENT_REI" : "q_min",
        method_version: "data_driven_resilience_v0"
      },
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0",
      ignored_top_level: true
    };
  }

  function evidenceFixture(fieldName, rawValue, valueType, applicability) {
    return {
      evidence_id: `e_${fieldName}`,
      field_name: fieldName,
      metric_name: null,
      value_type: valueType,
      display_label: fieldName.replaceAll("_", " "),
      definition: "Reviewed evidence definition.",
      raw_value: rawValue,
      display_value: String(rawValue),
      unit: null,
      source_component: "section_summary",
      applicability,
      null_meaning: null,
      interpretation_limit: "Interpret only within this event and method."
    };
  }

  function metricEvidenceFixture(metricName, rawValue) {
    return {
      evidence_id: `e_${metricName}`,
      field_name: null,
      metric_name: metricName,
      value_type: "number",
      display_label: "Reviewed metric",
      definition: "Reviewed metric evidence definition.",
      raw_value: rawValue,
      display_value: String(rawValue),
      unit: "dimensionless",
      source_component: "section_summary",
      applicability: ["detected", "recovery_endpoint_censored"],
      null_meaning: "Null means this metric is unavailable.",
      interpretation_limit: "Interpret only within this event and method."
    };
  }

  function reviewNoteFixture(status = "detected", sectionId = "29") {
    const applicability = [
      "detected",
      "no_sustained_drop",
      "recovery_endpoint_censored",
      "no_observed_support"
    ];
    const evidence = [
      evidenceFixture("normalized_cs_id", sectionId, "categorical", applicability),
      evidenceFixture("display_cs_id", `CS_${sectionId}`, "categorical", applicability),
      evidenceFixture("route", "US_90_", "categorical", applicability),
      evidenceFixture("county", "Brewster", "categorical", applicability),
      evidenceFixture("detection_status", status, "categorical", applicability),
      evidenceFixture(
        "observed_support",
        status !== "no_observed_support",
        "boolean",
        applicability
      )
    ];
    const sectionDefinitions = [
      ["review_status", "Review status"],
      ["planning_context", "Planning context"],
      ["observed_operational_evidence", "Observed operational evidence"],
      ["event_phase_and_recovery", "Event phase and recovery"],
      ["data_and_method_cautions", "Data and method cautions"],
      ["human_review_items", "Human review items"]
    ];
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
        route: "US_90_",
        county: "Brewster"
      },
      title: `Control Section CS_${sectionId} Review Note`,
      sections: sectionDefinitions.map(([key, heading], index) => ({
        key,
        heading,
        body: `Reviewed ${heading.toLowerCase()} content.`,
        evidence_ids: [evidence[index].evidence_id]
      })),
      evidence,
      warnings: warningForStatus(status),
      limitations: ["This draft requires human review."],
      human_review_items: ["Confirm the selected control section."],
      source_label: "Jan. 2026 cold-wave processed control-section resilience release",
      event_id: "coldwave_2026_01",
      data_release: "coldwave_2026_01_r1",
      method_version: "data_driven_resilience_v0",
      rendered_markdown: `# Control Section CS_${sectionId} Review Note\n\nDraft for review.`,
      ignored_top_level: "not forwarded"
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  let configSource;
  let apiSource;

  function fakeWindow(href, overrides = {}) {
    const url = new URL(href);
    return {
      location: { href: url.href, search: url.search },
      URL,
      URLSearchParams,
      AbortController,
      setTimeout: overrides.setTimeout || global.setTimeout.bind(global),
      clearTimeout: overrides.clearTimeout || global.clearTimeout.bind(global),
      fetch: overrides.fetch || (async () => {
        throw new Error("Unexpected fetch");
      })
    };
  }

  function evaluateConfig(href) {
    const target = fakeWindow(href);
    new Function("window", configSource)(target);
    return target;
  }

  function evaluateClient(href, overrides = {}) {
    const target = fakeWindow(href, overrides);
    new Function("window", configSource)(target);
    new Function("window", apiSource)(target);
    return target;
  }

  function successfulFetch(calls, summaryPayload = summaryFixture()) {
    return async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/api/v1/sections/29")) {
        return jsonResponse(200, summaryPayload);
      }
      if (url.endsWith("/api/v1/metrics/q_min")) {
        return jsonResponse(200, metricFixture("q_min"));
      }
      if (url.endsWith("/api/v1/metrics/event_rei")) {
        return jsonResponse(200, metricFixture("event_rei"));
      }
      if (url.endsWith("/api/v1/reports/review-note")) {
        return jsonResponse(200, reviewNoteFixture("detected", "29"));
      }
      throw new Error("Unexpected URL");
    };
  }

  test("production scripts load dormant with immutable local runtime", () => {
    assert(global.SPTCAssistant, "Production namespace was not created");
    equal(global.SPTCAssistant.runtime.requested_mode, "backend-tools");
    equal(global.SPTCAssistant.runtime.effective_mode, "backend-tools");
    equal(global.SPTCAssistant.runtime.backend_base_url, "http://127.0.0.1:8080");
    equal(global.SPTCAssistant.runtime.timeout_ms, 8000);
    assert(global.SPTCAssistant.runtime.backend_agent_enabled === false);
    assert(Object.isFrozen(global.SPTCAssistant.runtime));
    assert(Object.isFrozen(global.SPTCAssistant.client));
    assert(Object.isFrozen(global.SPTCAssistant));
  });

  test("runtime mode resolution is exact and local only", () => {
    const cases = [
      ["http://127.0.0.1:8001/page", "local-template", "local-template", null],
      [
        "http://127.0.0.1:8001/page?assistantMode=local-template",
        "local-template",
        "local-template",
        null
      ],
      [
        "http://127.0.0.1:8001/page?assistantMode=backend-tools",
        "backend-tools",
        "backend-tools",
        null
      ],
      [
        "http://localhost:8001/page?assistantMode=backend-tools",
        "backend-tools",
        "backend-tools",
        null
      ],
      [
        "https://localhost:8001/page?assistantMode=backend-tools",
        "backend-tools",
        "local-template",
        "backend_tools_requires_local_http"
      ],
      [
        "http://review.example/page?assistantMode=backend-tools",
        "backend-tools",
        "local-template",
        "backend_tools_requires_local_http"
      ],
      [
        "file:///review/page.html?assistantMode=backend-tools",
        "backend-tools",
        "local-template",
        "backend_tools_requires_local_http"
      ],
      [
        "http://reviewer:placeholder@localhost:8001/page?assistantMode=backend-tools",
        "backend-tools",
        "local-template",
        "backend_tools_requires_local_http"
      ],
      [
        "http://127.0.0.1:8001/page?assistantMode=backend-agent",
        "backend-agent",
        "local-template",
        "backend_agent_disabled"
      ],
      [
        "http://127.0.0.1:8001/page?assistantMode=unknown",
        "invalid",
        "local-template",
        "invalid_mode"
      ],
      [
        "http://127.0.0.1:8001/page?assistantMode=Backend-Tools",
        "invalid",
        "local-template",
        "invalid_mode"
      ],
      [
        "http://127.0.0.1:8001/page?assistantMode=backend-tools&assistantMode=backend-tools",
        "invalid",
        "local-template",
        "duplicate_mode_parameter"
      ],
      [
        "http://127.0.0.1:8001/page?AssistantMode=backend-tools",
        "invalid",
        "local-template",
        "invalid_mode_parameter"
      ],
      [
        "http://127.0.0.1:8001/page#assistantMode=backend-tools",
        "local-template",
        "local-template",
        null
      ],
      [
        "http://127.0.0.1:8001/page?assistantMode=%E0%A4%A",
        "invalid",
        "local-template",
        "invalid_mode"
      ]
    ];
    cases.forEach(([href, expectedRequestedMode, expectedMode, expectedReason]) => {
      const runtime = evaluateConfig(href).SPTCAssistant.runtime;
      equal(runtime.requested_mode, expectedRequestedMode, href);
      equal(runtime.effective_mode, expectedMode, href);
      equal(runtime.fallback_reason, expectedReason, href);
      assert(runtime.backend_agent_enabled === false, href);
    });
  });

  test("configuration refuses to overwrite an existing namespace", async () => {
    const target = fakeWindow("http://localhost/page");
    const existing = { retained: true };
    target.SPTCAssistant = existing;
    let caught = null;
    try {
      new Function("window", configSource)(target);
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof Error, "Existing namespace should be rejected");
    assert(target.SPTCAssistant === existing, "Existing namespace was overwritten");
  });

  test("backend destination noise is ignored and runtime is immutable", () => {
    const target = evaluateConfig(
      "http://localhost:8001/page?assistantMode=backend-tools"
      + "&backendUrl=http://review.example&apiUrl=http://review.example&host=review.example&port=9"
    );
    const runtime = target.SPTCAssistant.runtime;
    equal(runtime.backend_base_url, "http://127.0.0.1:8080");
    equal(runtime.timeout_ms, 8000);
    try {
      runtime.backend_base_url = "http://review.example";
    } catch {}
    equal(runtime.backend_base_url, "http://127.0.0.1:8080");
  });

  test("client surface and active-layer allowlist are exactly bounded", () => {
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools");
    equal(Object.getOwnPropertyNames(target.SPTCAssistant.client).sort(), [
      "explainMetric",
      "generateSectionReviewNote",
      "getSectionSummary"
    ]);
    equal(target.SPTCAssistant.activeLayerMetrics, {
      observed_curve_resilience_score_v0: "observed_curve_resilience_score_v0",
      q_min: "q_min",
      loss_depth: "loss_depth",
      resilience_loss_area: "resilience_loss_area",
      recovery_duration_hours: "recovery_duration_hours",
      recovery_slope: "recovery_slope",
      Potential_Resilience_Score: "potential_resilience_score",
      WEATHER_REI: "weather_rei",
      NETRISK_LITE: "netrisk_lite",
      EVENT_REI: "event_rei"
    });
    assert(!Object.values(target.SPTCAssistant.activeLayerMetrics).includes("loss_depth_fraction"));
    assert(!Object.hasOwn(target.SPTCAssistant.activeLayerMetrics, "detection_status"));
    assert(!Object.hasOwn(target.SPTCAssistant.activeLayerMetrics, "total_detected_phase_delay_proxy"));
  });

  test("three methods construct exact reviewed requests", async () => {
    const calls = [];
    const timers = timerProbe();
    const summaryRaw = summaryFixture();
    const target = evaluateClient("http://127.0.0.1/page?assistantMode=backend-tools", {
      fetch: successfulFetch(calls, summaryRaw),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout
    });
    const summary = await target.SPTCAssistant.client.getSectionSummary("CS_00029");
    const metric = await target.SPTCAssistant.client.explainMetric("q_min");
    const eventMetric = await target.SPTCAssistant.client.explainMetric("event_rei");
    const review = await target.SPTCAssistant.client.generateSectionReviewNote(29);

    equal(calls.map(call => call.url), [
      "http://127.0.0.1:8080/api/v1/sections/29",
      "http://127.0.0.1:8080/api/v1/metrics/q_min",
      "http://127.0.0.1:8080/api/v1/metrics/event_rei",
      "http://127.0.0.1:8080/api/v1/reports/review-note"
    ]);
    calls.forEach((call, index) => {
      equal(call.options.method, index === 3 ? "POST" : "GET");
      equal(call.options.mode, "cors");
      equal(call.options.credentials, "omit");
      equal(call.options.redirect, "error");
      equal(call.options.cache, "no-store");
      assert(call.options.headers.Accept === "application/json");
      assert(!Object.hasOwn(call.options.headers, "Authorization"));
    });
    assert(!Object.hasOwn(calls[0].options.headers, "Content-Type"));
    assert(calls[3].options.headers["Content-Type"] === "application/json");
    equal(JSON.parse(calls[3].options.body), { scope: "section", section_ids: ["29"] });
    assert(Object.isFrozen(summary) && Object.isFrozen(summary.identity));
    assert(Object.isFrozen(summary.warnings) && Object.isFrozen(summary.warnings[0]));
    assert(Object.isFrozen(metric) && Object.isFrozen(eventMetric) && Object.isFrozen(review));
    assert(Object.isFrozen(review.sections) && Object.isFrozen(review.sections[0]));
    assert(Object.isFrozen(review.evidence) && Object.isFrozen(review.evidence[0]));
    assert(!Object.hasOwn(summary, "ignored_top_level"));
    assert(!Object.hasOwn(summary.identity, "ignored_identity_field"));
    assert(summary !== summaryRaw);
    equal(timers.callbacks.size, 0);
    equal(timers.cleared.length, 4);
  });

  test("section and metric inputs reject before fetch", async () => {
    let fetchCount = 0;
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      fetch: async () => {
        fetchCount += 1;
        return jsonResponse(200, summaryFixture());
      }
    });
    for (const value of [0, -1, true, null, "", " 29", "29/curve", "CS_bad", "1e2", "1234567890123"]) {
      await expectCode(() => target.SPTCAssistant.client.getSectionSummary(value), "invalid_request");
    }
    for (const metric of [
      "detection_status",
      "total_detected_phase_delay_proxy",
      "q0",
      "loss_depth_fraction",
      "Q_MIN",
      "q-min",
      "../q_min"
    ]) {
      await expectCode(() => target.SPTCAssistant.client.explainMetric(metric), "invalid_request");
    }
    await expectCode(
      () => target.SPTCAssistant.client.getSectionSummary("29", { timeout: 1 }),
      "invalid_request"
    );
    equal(fetchCount, 0);
  });

  test("inactive and future-agent modes never issue requests", async () => {
    for (const href of [
      "http://localhost/page",
      "http://localhost/page?assistantMode=backend-agent",
      "https://localhost/page?assistantMode=backend-tools"
    ]) {
      let fetchCount = 0;
      const target = evaluateClient(href, {
        fetch: async () => {
          fetchCount += 1;
          return jsonResponse(200, summaryFixture());
        }
      });
      await expectCode(() => target.SPTCAssistant.client.getSectionSummary(29), "invalid_request");
      equal(fetchCount, 0);
    }
  });

  test("reviewed statuses map to sanitized client errors", async () => {
    const cases = [
      [
        "getSectionSummary",
        [29],
        404,
        { detail: { code: "section_not_found", message: "Not found." } },
        "section_not_found"
      ],
      [
        "explainMetric",
        ["q_min"],
        404,
        { detail: { code: "metric_not_found", metric_name: "q_min" } },
        "metric_not_found"
      ],
      [
        "generateSectionReviewNote",
        [29],
        422,
        { detail: { code: "invalid_review_note_request", message: "Invalid request." } },
        "backend_validation_error"
      ],
      [
        "getSectionSummary",
        [29],
        503,
        { detail: { code: "snapshot_unavailable", message: "Unavailable." } },
        "snapshot_unavailable"
      ]
    ];
    for (const [method, args, status, payload, code] of cases) {
      let fetchCount = 0;
      const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
        fetch: async () => {
          fetchCount += 1;
          return jsonResponse(status, payload);
        }
      });
      await expectCode(() => target.SPTCAssistant.client[method](...args), code);
      equal(fetchCount, 1);
    }
  });

  test("network, JSON, contract, and unexpected status failures are distinct", async () => {
    const cases = [
      [async () => { throw new Error("private network detail"); }, "backend_unavailable"],
      [async () => textResponse(200, "not-json"), "invalid_json"],
      [async () => jsonResponse(200, { identity: {} }), "invalid_response"],
      [async () => textResponse(500, "not-json"), "unexpected_status"],
      [
        async () => jsonResponse(404, { detail: { code: "wrong_code", message: "Wrong." } }),
        "invalid_response"
      ],
      [
        async () => jsonResponse(404, { detail: { code: "section_not_found" } }),
        "invalid_response"
      ],
      [
        async () => jsonResponse(422, { detail: { code: "invalid_cs_id" } }),
        "invalid_response"
      ],
      [
        async () => jsonResponse(503, { detail: { code: "snapshot_unavailable" } }),
        "invalid_response"
      ]
    ];
    for (const [fetchImplementation, code] of cases) {
      let fetchCount = 0;
      const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
        fetch: async (...args) => {
          fetchCount += 1;
          return fetchImplementation(...args);
        }
      });
      await expectCode(() => target.SPTCAssistant.client.getSectionSummary(29), code);
      equal(fetchCount, 1);
    }
  });

  test("timeout aborts once and clears its timer", async () => {
    const timers = timerProbe();
    let fetchCount = 0;
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      fetch: async (url, options) => {
        void url;
        fetchCount += 1;
        return new Promise((resolve, reject) => {
          void resolve;
          options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true
          });
        });
      }
    });
    const pending = target.SPTCAssistant.client.getSectionSummary(29);
    equal(fetchCount, 1);
    equal(Array.from(timers.callbacks.values())[0].milliseconds, 8000);
    timers.fireFirst();
    await expectCode(() => pending, "request_timeout");
    equal(fetchCount, 1);
    equal(timers.callbacks.size, 0);
    equal(timers.cleared.length, 1);
  });

  test("caller cancellation removes listeners and clears timers", async () => {
    const timers = timerProbe();
    const caller = signalProbe();
    let fetchCount = 0;
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      fetch: async (url, options) => {
        void url;
        fetchCount += 1;
        return new Promise((resolve, reject) => {
          void resolve;
          options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true
          });
        });
      }
    });
    const pending = target.SPTCAssistant.client.getSectionSummary(29, {
      signal: caller.signal
    });
    equal(caller.state.added, 1);
    caller.abort();
    await expectCode(() => pending, "request_cancelled");
    equal(fetchCount, 1);
    equal(caller.state.removed, 1);
    equal(timers.callbacks.size, 0);
    equal(timers.cleared.length, 1);
  });

  test("a pre-aborted caller signal rejects before fetch", async () => {
    const timers = timerProbe();
    const caller = signalProbe();
    caller.signal.aborted = true;
    let fetchCount = 0;
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      fetch: async () => {
        fetchCount += 1;
        return jsonResponse(200, summaryFixture());
      }
    });
    await expectCode(
      () => target.SPTCAssistant.client.getSectionSummary(29, { signal: caller.signal }),
      "request_cancelled"
    );
    equal(fetchCount, 0);
    equal(caller.state.added, 0);
    equal(caller.state.removed, 0);
    equal(timers.cleared.length, 1);
  });

  test("timeout during response-body reading is sanitized and cleaned", async () => {
    const timers = timerProbe();
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      fetch: async (url, options) => {
        void url;
        return {
          status: 200,
          text: () => new Promise((resolve, reject) => {
            void resolve;
            options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true
            });
          })
        };
      }
    });
    const pending = target.SPTCAssistant.client.getSectionSummary(29);
    await Promise.resolve();
    await Promise.resolve();
    timers.fireFirst();
    await expectCode(() => pending, "request_timeout");
    equal(timers.cleared.length, 1);
    equal(timers.callbacks.size, 0);
  });

  test("caller listener is also cleaned after success", async () => {
    const timers = timerProbe();
    const caller = signalProbe();
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      fetch: async () => jsonResponse(200, summaryFixture())
    });
    await target.SPTCAssistant.client.getSectionSummary(29, { signal: caller.signal });
    equal(caller.state.added, 1);
    equal(caller.state.removed, 1);
    equal(timers.cleared.length, 1);
  });

  test("caller listener and timer are cleaned after a response error", async () => {
    const timers = timerProbe();
    const caller = signalProbe();
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      fetch: async () => textResponse(200, "not-json")
    });
    await expectCode(
      () => target.SPTCAssistant.client.getSectionSummary(29, { signal: caller.signal }),
      "invalid_json"
    );
    equal(caller.state.added, 1);
    equal(caller.state.removed, 1);
    equal(timers.cleared.length, 1);
  });

  test("caller listener is removed if timeout setup fails", async () => {
    const caller = signalProbe();
    let fetchCount = 0;
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      setTimeout: () => {
        throw new Error("timer unavailable");
      },
      fetch: async () => {
        fetchCount += 1;
        return jsonResponse(200, summaryFixture());
      }
    });
    await expectCode(
      () => target.SPTCAssistant.client.getSectionSummary(29, { signal: caller.signal }),
      "backend_unavailable"
    );
    equal(fetchCount, 0);
    equal(caller.state.added, 1);
    equal(caller.state.removed, 1);
  });

  test("all four status contracts and warning sequences are sanitized", async () => {
    for (const status of [
      "detected",
      "no_sustained_drop",
      "recovery_endpoint_censored",
      "no_observed_support"
    ]) {
      const calls = [];
      const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
        fetch: async (url, options) => {
          calls.push({ url, options });
          if (url.includes("/sections/")) return jsonResponse(200, summaryFixture(status));
          if (url.includes("/reports/")) return jsonResponse(200, reviewNoteFixture(status));
          throw new Error("Unexpected URL");
        }
      });
      const summary = await target.SPTCAssistant.client.getSectionSummary(29);
      const review = await target.SPTCAssistant.client.generateSectionReviewNote(29);
      equal(summary.support_status.detection_status, status);
      equal(summary.warnings, warningForStatus(status));
      equal(review.warnings, warningForStatus(status));
      equal(review.evidence.length, 6);
      assert(!Object.hasOwn(review, "ignored_top_level"));
      assert(!Object.hasOwn(summary, "ignored_top_level"));
      equal(calls.length, 2);
    }
  });

  test("a future-compatible metric-bearing review note validates", async () => {
    const payload = reviewNoteFixture();
    const metricEvidence = metricEvidenceFixture("q_min", 0.81);
    payload.evidence.push(metricEvidence);
    payload.sections[2].evidence_ids.push(metricEvidence.evidence_id);
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      fetch: async () => jsonResponse(200, payload)
    });
    const review = await target.SPTCAssistant.client.generateSectionReviewNote(29);
    equal(review.evidence.length, 7);
    equal(review.evidence[6].metric_name, "q_min");
  });

  test("q_min and event_rei explanation contracts validate", async () => {
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      fetch: async url => {
        const name = url.endsWith("event_rei") ? "event_rei" : "q_min";
        return jsonResponse(200, metricFixture(name));
      }
    });
    const qMin = await target.SPTCAssistant.client.explainMetric("q_min");
    const eventRei = await target.SPTCAssistant.client.explainMetric("event_rei");
    equal(qMin.metric.name, "q_min");
    equal(eventRei.metric.name, "event_rei");
    assert(!Object.hasOwn(qMin, "ignored_top_level"));
    assert(!Object.hasOwn(qMin.metric, "ignored_metric_field"));
  });

  test("review-note duplicate and dangling evidence references reject", async () => {
    const duplicate = reviewNoteFixture();
    duplicate.evidence[1].evidence_id = duplicate.evidence[0].evidence_id;
    duplicate.sections[1].evidence_ids = [duplicate.evidence[0].evidence_id];
    const dangling = reviewNoteFixture();
    dangling.sections[0].evidence_ids = ["e_missing_reference"];
    for (const payload of [duplicate, dangling]) {
      const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
        fetch: async () => jsonResponse(200, payload)
      });
      await expectCode(
        () => target.SPTCAssistant.client.generateSectionReviewNote(29),
        "invalid_response"
      );
    }
  });

  test("review-note identity, status, release, and metric provenance drift reject", async () => {
    const identityMismatch = reviewNoteFixture();
    identityMismatch.evidence[0].raw_value = "30";
    const statusMismatch = reviewNoteFixture();
    statusMismatch.evidence[4].raw_value = "no_observed_support";
    statusMismatch.evidence[5].raw_value = false;
    const releaseMismatch = reviewNoteFixture();
    const releaseEvidence = evidenceFixture(
      "event_id",
      "wrong_release",
      "categorical",
      ["detected", "no_sustained_drop", "recovery_endpoint_censored", "no_observed_support"]
    );
    releaseEvidence.source_component = "release_metadata";
    releaseMismatch.evidence.push(releaseEvidence);
    releaseMismatch.sections[4].evidence_ids.push(releaseEvidence.evidence_id);
    const metricSourceMismatch = reviewNoteFixture();
    const metricEvidence = metricEvidenceFixture("q_min", 0.81);
    metricEvidence.source_component = "metric_registry";
    metricSourceMismatch.evidence.push(metricEvidence);
    metricSourceMismatch.sections[2].evidence_ids.push(metricEvidence.evidence_id);
    for (const payload of [
      identityMismatch,
      statusMismatch,
      releaseMismatch,
      metricSourceMismatch
    ]) {
      const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
        fetch: async () => jsonResponse(200, payload)
      });
      await expectCode(
        () => target.SPTCAssistant.client.generateSectionReviewNote(29),
        "invalid_response"
      );
    }
  });

  test("oversize, HTML, internal path, and nonfinite drift reject", async () => {
    const tooManyEvidence = reviewNoteFixture();
    tooManyEvidence.evidence = Array.from({ length: 65 }, (_, index) => ({
      ...clone(tooManyEvidence.evidence[0]),
      evidence_id: `e_extra_${index}`
    }));
    const rawHtml = reviewNoteFixture();
    rawHtml.rendered_markdown = "# Draft\n<script>unsafe</script>";
    const internalPath = summaryFixture();
    internalPath.warnings[0].message = "/home/reviewer/private/output";
    const overlongText = reviewNoteFixture();
    overlongText.sections[0].body = "x".repeat(4001);
    const nonfinite = JSON.stringify(summaryFixture()).replace('"q0":1', '"q0":1e400');
    const cases = [
      ["review", jsonResponse(200, tooManyEvidence)],
      ["review", jsonResponse(200, rawHtml)],
      ["review", jsonResponse(200, overlongText)],
      ["summary", jsonResponse(200, internalPath)],
      ["summary", textResponse(200, nonfinite)]
    ];
    for (const [kind, response] of cases) {
      const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
        fetch: async () => response
      });
      const call = kind === "review"
        ? () => target.SPTCAssistant.client.generateSectionReviewNote(29)
        : () => target.SPTCAssistant.client.getSectionSummary(29);
      await expectCode(call, "invalid_response");
    }
  });

  test("schema drift in sections, status, and response size rejects", async () => {
    const wrongSections = reviewNoteFixture();
    wrongSections.sections.reverse();
    const missingSection = reviewNoteFixture();
    missingSection.sections.pop();
    const wrongStatus = summaryFixture();
    wrongStatus.support_status.detection_status = "unexpected_status";
    const impossibleTimestamp = summaryFixture();
    impossibleTimestamp.observed_metrics.onset_time = "2026-02-30T05:00:00";
    const contradictorySupport = summaryFixture("no_observed_support");
    contradictorySupport.support_status.observed_support = true;
    const contradictoryNulls = summaryFixture("no_sustained_drop");
    contradictoryNulls.observed_metrics.q_min = 0.9;
    const inconsistentUnits = summaryFixture();
    inconsistentUnits.observed_metrics.loss_depth_percent = 0.19;
    const largeBody = " ".repeat(128 * 1024 + 1);
    const cases = [
      ["review", jsonResponse(200, wrongSections)],
      ["review", jsonResponse(200, missingSection)],
      ["summary", jsonResponse(200, wrongStatus)],
      ["summary", jsonResponse(200, impossibleTimestamp)],
      ["summary", jsonResponse(200, contradictorySupport)],
      ["summary", jsonResponse(200, contradictoryNulls)],
      ["summary", jsonResponse(200, inconsistentUnits)],
      ["summary", textResponse(200, largeBody)]
    ];
    for (const [kind, response] of cases) {
      const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
        fetch: async () => response
      });
      const call = kind === "review"
        ? () => target.SPTCAssistant.client.generateSectionReviewNote(29)
        : () => target.SPTCAssistant.client.getSectionSummary(29);
      await expectCode(call, "invalid_response");
    }
  });

  test("ordinary safe URL text is not mistaken for an internal path", async () => {
    const payload = summaryFixture();
    payload.identity.route = "http://example.test/review";
    const target = evaluateClient("http://localhost/page?assistantMode=backend-tools", {
      fetch: async () => jsonResponse(200, payload)
    });
    const summary = await target.SPTCAssistant.client.getSectionSummary(29);
    equal(summary.identity.route, "http://example.test/review");
  });

  try {
    configSource = await nativeFetch("../js/assistant-config.js", { cache: "no-store" })
      .then(response => response.text());
    apiSource = await nativeFetch("../js/assistant-api.js", { cache: "no-store" })
      .then(response => response.text());
    let passed = 0;
    for (const current of tests) {
      await current.callback();
      passed += 1;
    }
    document.body.dataset.status = "passed";
    resultNode.textContent = `${passed} Phase 2A2 JavaScript contract tests passed.`;
  } catch (error) {
    document.body.dataset.status = "failed";
    resultNode.textContent = `FAILED: ${String(error && error.message ? error.message : error)}`;
  }
})(window);
