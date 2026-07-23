(function initializeAssistantApi(global) {
  "use strict";

  const namespace = global.SPTCAssistant;
  if (!namespace || !namespace.runtime || !namespace.modes) {
    throw new Error("The SPTC assistant runtime configuration is unavailable.");
  }
  if (Object.prototype.hasOwnProperty.call(namespace, "client")) {
    throw new Error("The SPTC assistant client is already defined.");
  }

  const eventId = "coldwave_2026_01";
  const dataRelease = "coldwave_2026_01_r1";
  const methodVersion = "data_driven_resilience_v0";
  const timezoneStatus = "unverified_local_clock_time";
  const sourceLabel = "Jan. 2026 cold-wave processed control-section resilience release";
  const summaryResponseLimit = 128 * 1024;
  const metricResponseLimit = 128 * 1024;
  const reviewNoteResponseLimit = 1024 * 1024;
  const assistantResponseLimit = 512 * 1024;
  const detectionStatuses = Object.freeze([
    "detected",
    "no_sustained_drop",
    "recovery_endpoint_censored",
    "no_observed_support"
  ]);
  const warningCodes = Object.freeze([
    "METHOD_SCOPE",
    "NO_SUSTAINED_DROP",
    "RECOVERY_CENSORED",
    "NO_OBSERVED_SUPPORT"
  ]);
  const warningSeverities = Object.freeze(["info", "caution"]);
  const assistantStatuses = Object.freeze([
    "completed",
    "clarification_required",
    "unsupported_request",
    "assistant_disabled",
    "model_unavailable",
    "tool_error",
    "invalid_model_response"
  ]);
  const assistantIntents = Object.freeze([
    "explain_selected_section",
    "explain_explicit_section",
    "explain_current_metric",
    "explain_explicit_metric",
    "explain_warning_or_status",
    "compare_two_sections",
    "generate_review_note",
    "explain_planning_vs_observed",
    "request_clarification",
    "decline_unsupported_request"
  ]);
  const assistantToolNames = Object.freeze([
    "get_section_summary",
    "explain_metric",
    "compare_sections",
    "generate_review_note",
    "request_clarification",
    "answer_scope_explanation",
    "decline_unsupported_request"
  ]);
  const assistantEvidenceKinds = Object.freeze([
    "section_status",
    "metric_value",
    "metric_definition",
    "review_status",
    "identity"
  ]);
  const clarificationReasons = Object.freeze([
    "section_required",
    "metric_required",
    "two_sections_required",
    "ambiguous_supported_intent"
  ]);
  const activeLayerMetrics = Object.freeze({
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
  const metricSourceFields = Object.freeze({
    observed_curve_resilience_score_v0: "observed_curve_resilience_score_v0",
    q_min: "q_min",
    loss_depth: "loss_depth",
    resilience_loss_area: "resilience_loss_area",
    recovery_duration_hours: "recovery_duration_hours",
    recovery_slope: "recovery_slope",
    potential_resilience_score: "Potential_Resilience_Score",
    weather_rei: "WEATHER_REI",
    netrisk_lite: "NETRISK_LITE",
    event_rei: "EVENT_REI"
  });
  const explainableMetrics = new Set(Object.values(activeLayerMetrics));
  const assistantEvidenceMetricNames = new Set([
    "q0",
    "q_min",
    "loss_depth",
    "loss_depth_fraction",
    "loss_depth_percent",
    "degradation_duration_hours",
    "degradation_slope",
    "recovery_duration_hours",
    "recovery_slope",
    "time_to_80_hours",
    "time_to_90_hours",
    "resilience_loss_area",
    "normalized_loss_area",
    "observed_curve_resilience_score_v0",
    "weather_rei",
    "netrisk_lite",
    "event_rei",
    "potential_resilience_score",
    "aadt"
  ]);
  const reviewNoteMetricNames = new Set([
    "weather_rei",
    "netrisk_lite",
    "event_rei",
    "potential_resilience_score",
    "aadt",
    "q0",
    "q_min",
    "loss_depth_percent",
    "resilience_loss_area",
    "observed_curve_resilience_score_v0",
    "degradation_duration_hours",
    "recovery_duration_hours",
    "time_to_80_hours",
    "time_to_90_hours"
  ]);
  const reviewNoteFieldNames = new Set([
    "normalized_cs_id",
    "display_cs_id",
    "route",
    "county",
    "detection_status",
    "observed_support",
    "event_id",
    "data_release",
    "method_version",
    "timezone_status",
    "onset_time",
    "minimum_time",
    "recovery_end_time"
  ]);
  const reviewNoteSections = Object.freeze([
    Object.freeze(["review_status", "Review status"]),
    Object.freeze(["planning_context", "Planning context"]),
    Object.freeze(["observed_operational_evidence", "Observed operational evidence"]),
    Object.freeze(["event_phase_and_recovery", "Event phase and recovery"]),
    Object.freeze(["data_and_method_cautions", "Data and method cautions"]),
    Object.freeze(["human_review_items", "Human review items"])
  ]);
  const expectedWarningsByStatus = Object.freeze({
    detected: Object.freeze([Object.freeze(["METHOD_SCOPE", "info"])]),
    no_sustained_drop: Object.freeze([
      Object.freeze(["NO_SUSTAINED_DROP", "caution"]),
      Object.freeze(["METHOD_SCOPE", "info"])
    ]),
    recovery_endpoint_censored: Object.freeze([
      Object.freeze(["RECOVERY_CENSORED", "caution"]),
      Object.freeze(["METHOD_SCOPE", "info"])
    ]),
    no_observed_support: Object.freeze([
      Object.freeze(["NO_OBSERVED_SUPPORT", "caution"])
    ])
  });
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
  const unsafeTextPattern = /(?:file:\/\/|(?:^|[^a-z0-9+.-])[a-z]:[\\/]|\\\\[^\\]|(?:^|[\s("'`])\/(?:home|users|tmp|var|opt|srv|mnt|workspace|root)(?:\/|\b)|\.(?:csv|parquet|duckdb|sqlite3?)\b|\binternal_path\b|\btraceback\b)/i;
  const assistantRestrictedTextPattern = /(?:https?:\/\/|\bollama\b|<\/?think\b|\bchain[-_ ]of[-_ ]thought\b|\binternal[_ ]prompt\b|\bprompt[_ ]tokens\b|\bresponse[_ ]metadata\b)/i;
  const assistantInternalPathPattern = /(?:^|[\s("'`])(?:\.\.[\\/]|\/(?:app|code|etc|private|project|repo)(?:\/|\b)|services[\\/]resilience-agent\b|data[\\/]tier3\b|\.local[\\/]snapshot\b)/i;
  const assistantRawJsonPattern = /^\s*(?:\{[\s\S]*\}|\[[\s\S]*\])\s*$/;
  const disallowedControlPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  const evidenceIdPattern = /^e_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
  const assistantEvidenceIdPattern = /^e_[a-z0-9_]+$/;
  const assistantSectionIdPattern = /^CS_[1-9][0-9]{0,11}$/;
  const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/;

  class AssistantClientError extends Error {
    constructor(code) {
      super(clientMessages[code]);
      this.name = "AssistantClientError";
      this.code = code;
    }
  }

  function clientError(code) {
    return new AssistantClientError(code);
  }

  function invalidResponse() {
    throw clientError("invalid_response");
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
  }

  function required(record, key) {
    if (!isRecord(record) || !hasOwn(record, key)) invalidResponse();
    return record[key];
  }

  function boundedText(value, maxLength, minLength = 1) {
    if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
      invalidResponse();
    }
    if (
      disallowedControlPattern.test(value)
      || unsafeTextPattern.test(value)
      || value.includes("<")
      || value.includes(">")
    ) {
      invalidResponse();
    }
    return value;
  }

  function optionalText(value, maxLength) {
    return value === null ? null : boundedText(value, maxLength);
  }

  function oneOf(value, allowed) {
    if (!allowed.includes(value)) invalidResponse();
    return value;
  }

  function finiteNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) invalidResponse();
    return value;
  }

  function optionalFiniteNumber(value) {
    return value === null ? null : finiteNumber(value);
  }

  function finiteNumberInRange(value, minimum, maximum) {
    const number = finiteNumber(value);
    if (number < minimum || number > maximum) invalidResponse();
    return number;
  }

  function optionalFiniteNumberInRange(value, minimum, maximum) {
    return value === null ? null : finiteNumberInRange(value, minimum, maximum);
  }

  function strictBoolean(value) {
    if (typeof value !== "boolean") invalidResponse();
    return value;
  }

  function optionalBoolean(value) {
    return value === null ? null : strictBoolean(value);
  }

  function boundedInteger(value, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalidResponse();
    return value;
  }

  function optionalBoundedInteger(value, minimum, maximum) {
    return value === null ? null : boundedInteger(value, minimum, maximum);
  }

  function copyArray(value, minimum, maximum, copier) {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
      invalidResponse();
    }
    return value.map(copier);
  }

  function uniqueArray(values) {
    if (new Set(values).size !== values.length) invalidResponse();
    return values;
  }

  function canonicalSectionId(value) {
    let digits;
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 999999999999) {
        throw clientError("invalid_request");
      }
      digits = String(value);
    } else if (typeof value === "string") {
      const match = /^(?:CS_)?([0-9]{1,12})$/.exec(value);
      if (!match) throw clientError("invalid_request");
      digits = match[1].replace(/^0+/, "") || "0";
      if (digits === "0") throw clientError("invalid_request");
    } else {
      throw clientError("invalid_request");
    }
    return digits;
  }

  function canonicalMetricName(value) {
    if (
      typeof value !== "string"
      || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value)
      || !explainableMetrics.has(value)
    ) {
      throw clientError("invalid_request");
    }
    return value;
  }

  function callerSignal(options) {
    if (options === undefined) return null;
    if (!isRecord(options)) throw clientError("invalid_request");
    const keys = Object.keys(options);
    if (keys.some(key => key !== "signal")) throw clientError("invalid_request");
    if (!hasOwn(options, "signal") || options.signal === null || options.signal === undefined) {
      return null;
    }
    const signal = options.signal;
    if (
      !isRecord(signal)
      || typeof signal.aborted !== "boolean"
      || typeof signal.addEventListener !== "function"
      || typeof signal.removeEventListener !== "function"
    ) {
      throw clientError("invalid_request");
    }
    return signal;
  }

  function ensureBackendToolsMode() {
    if (
      namespace.runtime.effective_mode !== namespace.modes.backendTools
      && namespace.runtime.effective_mode !== namespace.modes.backendAgent
    ) {
      throw clientError("invalid_request");
    }
  }

  function ensureBackendAgentMode() {
    if (
      namespace.runtime.effective_mode !== namespace.modes.backendAgent
      || namespace.runtime.backend_agent_enabled !== true
    ) {
      throw clientError("invalid_request");
    }
  }

  function createCancellation(signal, timeoutMs = namespace.runtime.timeout_ms) {
    if (
      typeof global.AbortController !== "function"
      || typeof global.setTimeout !== "function"
      || typeof global.clearTimeout !== "function"
    ) {
      throw clientError("backend_unavailable");
    }
    const controller = new global.AbortController();
    let cancellationReason = null;
    let callerListener = null;
    let callerListenerAttached = false;
    let cleaned = false;

    const removeCallerListener = () => {
      if (!signal || !callerListener || !callerListenerAttached) return;
      try {
        signal.removeEventListener("abort", callerListener);
      } catch {
        // Cleanup must not replace a sanitized request result or error.
      }
      callerListenerAttached = false;
    };

    if (signal) {
      callerListener = () => {
        if (cancellationReason === null) {
          cancellationReason = "caller";
          controller.abort();
        }
      };
      if (signal.aborted) {
        callerListener();
      } else {
        try {
          signal.addEventListener("abort", callerListener, { once: true });
          callerListenerAttached = true;
        } catch {
          throw clientError("invalid_request");
        }
      }
    }

    let timeoutId;
    try {
      timeoutId = global.setTimeout(() => {
        if (cancellationReason === null) {
          cancellationReason = "timeout";
          controller.abort();
        }
      }, timeoutMs);
    } catch {
      removeCallerListener();
      throw clientError("backend_unavailable");
    }

    return {
      signal: controller.signal,
      didTimeout: () => cancellationReason === "timeout",
      didCallerCancel: () => cancellationReason === "caller",
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        try {
          global.clearTimeout(timeoutId);
        } catch {
          // Cleanup must not replace a sanitized request result or error.
        }
        removeCallerListener();
      }
    };
  }

  function throwIfCancelled(cancellation) {
    if (cancellation.didTimeout()) throw clientError("request_timeout");
    if (cancellation.didCallerCancel()) throw clientError("request_cancelled");
  }

  function validateWarning(value) {
    const code = oneOf(required(value, "code"), warningCodes);
    const severity = oneOf(required(value, "severity"), warningSeverities);
    return {
      code,
      severity,
      message: boundedText(required(value, "message"), 2000)
    };
  }

  function validateWarnings(value, maximum = 4) {
    return copyArray(value, 0, maximum, validateWarning);
  }

  function validateStatusWarnings(warnings, detectionStatus) {
    const expectedWarnings = expectedWarningsByStatus[detectionStatus];
    if (
      !expectedWarnings
      || warnings.length !== expectedWarnings.length
      || warnings.some((warning, index) => (
        warning.code !== expectedWarnings[index][0]
        || warning.severity !== expectedWarnings[index][1]
      ))
    ) {
      invalidResponse();
    }
  }

  function validateTimestamp(value) {
    if (value === null) return null;
    const timestamp = boundedText(value, 64);
    const match = timestampPattern.exec(timestamp);
    if (!match) invalidResponse();
    const [year, month, day, hour, minute, second] = match
      .slice(1, 7)
      .map(component => Number(component));
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (
      year < 1
      || month < 1
      || month > 12
      || day < 1
      || day > daysByMonth[month - 1]
      || hour > 23
      || minute > 59
      || second > 59
    ) {
      invalidResponse();
    }
    return timestamp;
  }

  function validateIdentity(value, expectedSectionId, includeCountyFips) {
    const normalizedId = boundedText(required(value, "normalized_cs_id"), 12);
    if (!/^[1-9][0-9]{0,11}$/.test(normalizedId) || normalizedId !== expectedSectionId) {
      invalidResponse();
    }
    const displayId = boundedText(required(value, "display_cs_id"), 15);
    if (displayId !== `CS_${normalizedId}`) invalidResponse();
    const identity = {
      normalized_cs_id: normalizedId,
      display_cs_id: displayId,
      route: boundedText(required(value, "route"), 200),
      county: boundedText(required(value, "county"), 200)
    };
    if (includeCountyFips) {
      const countyFips = boundedText(required(value, "county_fips"), 5);
      if (!/^[0-9]{5}$/.test(countyFips)) invalidResponse();
      identity.county_fips = countyFips;
    }
    return identity;
  }

  function validateApplicability(value) {
    return uniqueArray(copyArray(
      value,
      1,
      4,
      status => oneOf(status, detectionStatuses)
    ));
  }

  function validateReleaseMetadata(record, includeTimezone) {
    if (required(record, "event_id") !== eventId) invalidResponse();
    if (required(record, "data_release") !== dataRelease) invalidResponse();
    if (required(record, "method_version") !== methodVersion) invalidResponse();
    const metadata = {
      event_id: eventId,
      data_release: dataRelease,
      method_version: methodVersion
    };
    if (includeTimezone) {
      if (required(record, "timezone_status") !== timezoneStatus) invalidResponse();
      metadata.timezone_status = timezoneStatus;
    }
    return metadata;
  }

  function validateSectionSummary(payload, expectedSectionId) {
    if (!isRecord(payload)) invalidResponse();
    const identity = validateIdentity(required(payload, "identity"), expectedSectionId, true);
    const supportValue = required(payload, "support_status");
    const detectionStatus = oneOf(required(supportValue, "detection_status"), detectionStatuses);
    const supportStatus = {
      observed_support: strictBoolean(required(supportValue, "observed_support")),
      detection_status: detectionStatus,
      matched_tmc_count: optionalBoundedInteger(
        required(supportValue, "matched_tmc_count"),
        0,
        1000000
      ),
      data_density_summary: required(supportValue, "data_density_summary") === null
        ? null
        : oneOf(required(supportValue, "data_density_summary"), ["A", "B", "C"])
    };
    const observedValue = required(payload, "observed_metrics");
    const observedMetrics = {
      q0: optionalFiniteNumber(required(observedValue, "q0")),
      q_min: optionalFiniteNumber(required(observedValue, "q_min")),
      loss_depth: optionalFiniteNumber(required(observedValue, "loss_depth")),
      loss_depth_fraction: optionalFiniteNumberInRange(
        required(observedValue, "loss_depth_fraction"),
        0,
        1
      ),
      loss_depth_percent: optionalFiniteNumberInRange(
        required(observedValue, "loss_depth_percent"),
        0,
        100
      ),
      degradation_duration_hours: optionalFiniteNumber(
        required(observedValue, "degradation_duration_hours")
      ),
      degradation_slope: optionalFiniteNumber(required(observedValue, "degradation_slope")),
      recovery_duration_hours: optionalFiniteNumber(
        required(observedValue, "recovery_duration_hours")
      ),
      recovery_slope: optionalFiniteNumber(required(observedValue, "recovery_slope")),
      time_to_80_hours: optionalFiniteNumber(required(observedValue, "time_to_80_hours")),
      time_to_90_hours: optionalFiniteNumber(required(observedValue, "time_to_90_hours")),
      resilience_loss_area: optionalFiniteNumber(
        required(observedValue, "resilience_loss_area")
      ),
      normalized_loss_area: optionalFiniteNumber(
        required(observedValue, "normalized_loss_area")
      ),
      observed_curve_resilience_score_v0: optionalFiniteNumber(
        required(observedValue, "observed_curve_resilience_score_v0")
      ),
      onset_time: validateTimestamp(required(observedValue, "onset_time")),
      minimum_time: validateTimestamp(required(observedValue, "minimum_time")),
      recovery_end_time: validateTimestamp(required(observedValue, "recovery_end_time"))
    };
    const relativeLoss = observedMetrics.loss_depth_fraction;
    const percentLoss = observedMetrics.loss_depth_percent;
    if (
      (relativeLoss === null) !== (percentLoss === null)
      || (
        relativeLoss !== null
        && Math.abs(percentLoss - (relativeLoss * 100)) > 1e-9
      )
    ) {
      invalidResponse();
    }
    const phaseMetricValues = Object.entries(observedMetrics)
      .filter(([fieldName]) => fieldName !== "q0")
      .map(([, fieldValue]) => fieldValue);
    if (detectionStatus === "no_observed_support") {
      if (
        supportStatus.observed_support
        || supportStatus.matched_tmc_count !== null
        || supportStatus.data_density_summary !== null
        || Object.values(observedMetrics).some(fieldValue => fieldValue !== null)
      ) {
        invalidResponse();
      }
    } else if (!supportStatus.observed_support) {
      invalidResponse();
    } else if (
      detectionStatus === "no_sustained_drop"
      && phaseMetricValues.some(fieldValue => fieldValue !== null)
    ) {
      invalidResponse();
    }
    const planningValue = required(payload, "planning_context");
    const planningContext = {
      weather_rei: finiteNumber(required(planningValue, "weather_rei")),
      netrisk_lite: finiteNumber(required(planningValue, "netrisk_lite")),
      event_rei: finiteNumber(required(planningValue, "event_rei")),
      potential_resilience_score: finiteNumber(
        required(planningValue, "potential_resilience_score")
      ),
      aadt: finiteNumber(required(planningValue, "aadt"))
    };
    const warnings = validateWarnings(required(payload, "warnings"), 2);
    validateStatusWarnings(warnings, detectionStatus);
    const metadata = validateReleaseMetadata(payload, true);
    const responseSourceLabel = boundedText(required(payload, "source_label"), 2000);
    if (responseSourceLabel !== sourceLabel) invalidResponse();
    return deepFreeze({
      identity,
      support_status: supportStatus,
      observed_metrics: observedMetrics,
      planning_context: planningContext,
      warnings,
      source_label: responseSourceLabel,
      ...metadata
    });
  }

  function validateMetricExplanation(payload, expectedMetricName) {
    if (!isRecord(payload)) invalidResponse();
    const metricValue = required(payload, "metric");
    const metricName = required(metricValue, "name");
    if (metricName !== expectedMetricName || !explainableMetrics.has(metricName)) {
      invalidResponse();
    }
    const metric = {
      name: metricName,
      display_name: boundedText(required(metricValue, "display_name"), 2000),
      category: oneOf(required(metricValue, "category"), [
        "observed_operational",
        "experimental_score",
        "planning_context",
        "demand_context"
      ]),
      definition: boundedText(required(metricValue, "definition"), 2000),
      unit: boundedText(required(metricValue, "unit"), 2000),
      value_type: required(metricValue, "value_type"),
      nullable: strictBoolean(required(metricValue, "nullable")),
      applicability: validateApplicability(required(metricValue, "applicability")),
      null_meaning: boundedText(required(metricValue, "null_meaning"), 2000),
      expected_domain: optionalText(required(metricValue, "expected_domain"), 2000),
      calculation_summary: optionalText(required(metricValue, "calculation_summary"), 2000),
      event_specific: optionalBoolean(required(metricValue, "event_specific"))
    };
    if (metric.value_type !== "number") invalidResponse();
    const interpretationValue = required(payload, "interpretation");
    const interpretation = {
      plain_language: boundedText(required(interpretationValue, "plain_language"), 2000),
      limitations: copyArray(
        required(interpretationValue, "limitations"),
        1,
        8,
        value => boundedText(value, 2000)
      ),
      directionality: required(interpretationValue, "directionality")
    };
    if (interpretation.directionality !== null) invalidResponse();
    const provenanceValue = required(payload, "provenance");
    const provenance = {
      source_label: boundedText(required(provenanceValue, "source_label"), 2000),
      source_field: boundedText(required(provenanceValue, "source_field"), 200),
      method_version: required(provenanceValue, "method_version")
    };
    if (
      provenance.source_label !== sourceLabel
      || provenance.source_field !== metricSourceFields[metricName]
      || provenance.method_version !== methodVersion
    ) {
      invalidResponse();
    }
    const metadata = validateReleaseMetadata(payload, false);
    return deepFreeze({ metric, interpretation, provenance, ...metadata });
  }

  function validateEvidence(value) {
    if (!isRecord(value)) invalidResponse();
    const evidenceId = boundedText(required(value, "evidence_id"), 100);
    if (!evidenceIdPattern.test(evidenceId)) invalidResponse();
    const fieldName = required(value, "field_name");
    const metricName = required(value, "metric_name");
    if ((fieldName === null) === (metricName === null)) invalidResponse();
    const valueType = oneOf(required(value, "value_type"), [
      "number",
      "categorical",
      "boolean",
      "timestamp"
    ]);
    const rawValue = required(value, "raw_value");
    let copiedRawValue;
    if (metricName !== null) {
      if (!reviewNoteMetricNames.has(metricName) || valueType !== "number") invalidResponse();
      copiedRawValue = finiteNumber(rawValue);
    } else {
      if (!reviewNoteFieldNames.has(fieldName)) invalidResponse();
      if (fieldName === "observed_support") {
        if (valueType !== "boolean") invalidResponse();
        copiedRawValue = strictBoolean(rawValue);
      } else if (["onset_time", "minimum_time", "recovery_end_time"].includes(fieldName)) {
        if (valueType !== "timestamp") invalidResponse();
        copiedRawValue = validateTimestamp(rawValue);
        if (copiedRawValue === null) invalidResponse();
      } else {
        if (valueType !== "categorical") invalidResponse();
        copiedRawValue = boundedText(rawValue, 4000);
      }
    }
    const sourceComponent = oneOf(required(value, "source_component"), [
      "section_summary",
      "metric_registry",
      "warning_contract",
      "release_metadata"
    ]);
    const releaseFields = ["event_id", "data_release", "method_version", "timezone_status"];
    const expectedSourceComponent = metricName !== null || !releaseFields.includes(fieldName)
      ? "section_summary"
      : "release_metadata";
    if (sourceComponent !== expectedSourceComponent) invalidResponse();
    return {
      evidence_id: evidenceId,
      field_name: fieldName,
      metric_name: metricName,
      value_type: valueType,
      display_label: boundedText(required(value, "display_label"), 200),
      definition: boundedText(required(value, "definition"), 4000),
      raw_value: copiedRawValue,
      display_value: boundedText(required(value, "display_value"), 200),
      unit: optionalText(required(value, "unit"), 200),
      source_component: sourceComponent,
      applicability: validateApplicability(required(value, "applicability")),
      null_meaning: optionalText(required(value, "null_meaning"), 4000),
      interpretation_limit: boundedText(required(value, "interpretation_limit"), 4000)
    };
  }

  function validateReviewNote(payload, expectedSectionId) {
    if (!isRecord(payload)) invalidResponse();
    const metadataValue = required(payload, "report_metadata");
    const reportMetadata = {
      scope: required(metadataValue, "scope"),
      template_name: required(metadataValue, "template_name"),
      template_version: required(metadataValue, "template_version"),
      status: required(metadataValue, "status"),
      editable: required(metadataValue, "editable"),
      event_id: required(metadataValue, "event_id"),
      data_release: required(metadataValue, "data_release"),
      method_version: required(metadataValue, "method_version"),
      timezone_status: required(metadataValue, "timezone_status")
    };
    if (
      reportMetadata.scope !== "section"
      || reportMetadata.template_name !== "section_review_note"
      || reportMetadata.template_version !== "section_review_note_v1"
      || reportMetadata.status !== "draft_for_human_review"
      || reportMetadata.editable !== true
      || reportMetadata.event_id !== eventId
      || reportMetadata.data_release !== dataRelease
      || reportMetadata.method_version !== methodVersion
      || reportMetadata.timezone_status !== timezoneStatus
    ) {
      invalidResponse();
    }
    const identity = validateIdentity(required(payload, "identity"), expectedSectionId, false);
    const title = boundedText(required(payload, "title"), 200);
    if (title !== `Control Section ${identity.display_cs_id} Review Note`) invalidResponse();
    const sections = copyArray(required(payload, "sections"), 6, 6, (section, index) => {
      const [expectedKey, expectedHeading] = reviewNoteSections[index];
      const key = required(section, "key");
      const heading = boundedText(required(section, "heading"), 100);
      if (key !== expectedKey || heading !== expectedHeading) invalidResponse();
      const evidenceIds = uniqueArray(copyArray(
        required(section, "evidence_ids"),
        1,
        10,
        value => {
          const evidenceId = boundedText(value, 100);
          if (!evidenceIdPattern.test(evidenceId)) invalidResponse();
          return evidenceId;
        }
      ));
      return {
        key,
        heading,
        body: boundedText(required(section, "body"), 4000),
        evidence_ids: evidenceIds
      };
    });
    const evidence = copyArray(required(payload, "evidence"), 1, 64, validateEvidence);
    const evidenceIds = evidence.map(record => record.evidence_id);
    uniqueArray(evidenceIds);
    const evidenceNames = evidence.map(record => record.metric_name || record.field_name);
    uniqueArray(evidenceNames);
    const knownEvidenceIds = new Set(evidenceIds);
    sections.forEach(section => {
      section.evidence_ids.forEach(evidenceId => {
        if (!knownEvidenceIds.has(evidenceId)) invalidResponse();
      });
    });
    const warnings = validateWarnings(required(payload, "warnings"), 4);
    const evidenceByName = new Map(
      evidence.map(record => [record.metric_name || record.field_name, record])
    );
    const requiredEvidenceValues = {
      normalized_cs_id: identity.normalized_cs_id,
      display_cs_id: identity.display_cs_id,
      route: identity.route,
      county: identity.county
    };
    Object.entries(requiredEvidenceValues).forEach(([fieldName, expectedValue]) => {
      const record = evidenceByName.get(fieldName);
      if (!record || record.raw_value !== expectedValue) invalidResponse();
    });
    const statusEvidence = evidenceByName.get("detection_status");
    const supportEvidence = evidenceByName.get("observed_support");
    if (!statusEvidence || !supportEvidence) invalidResponse();
    const detectionStatus = oneOf(statusEvidence.raw_value, detectionStatuses);
    if (supportEvidence.raw_value !== (detectionStatus !== "no_observed_support")) {
      invalidResponse();
    }
    validateStatusWarnings(warnings, detectionStatus);
    const releaseEvidenceValues = {
      event_id: eventId,
      data_release: dataRelease,
      method_version: methodVersion,
      timezone_status: timezoneStatus
    };
    Object.entries(releaseEvidenceValues).forEach(([fieldName, expectedValue]) => {
      const record = evidenceByName.get(fieldName);
      if (record && record.raw_value !== expectedValue) invalidResponse();
    });
    const limitations = copyArray(
      required(payload, "limitations"),
      1,
      12,
      value => boundedText(value, 4000)
    );
    const humanReviewItems = copyArray(
      required(payload, "human_review_items"),
      1,
      10,
      value => boundedText(value, 4000)
    );
    const releaseMetadata = validateReleaseMetadata(payload, false);
    if (
      releaseMetadata.event_id !== reportMetadata.event_id
      || releaseMetadata.data_release !== reportMetadata.data_release
      || releaseMetadata.method_version !== reportMetadata.method_version
    ) {
      invalidResponse();
    }
    const responseSourceLabel = boundedText(required(payload, "source_label"), 2000);
    if (responseSourceLabel !== sourceLabel) invalidResponse();
    return deepFreeze({
      report_metadata: reportMetadata,
      identity,
      title,
      sections,
      evidence,
      warnings,
      limitations,
      human_review_items: humanReviewItems,
      source_label: responseSourceLabel,
      ...releaseMetadata,
      rendered_markdown: boundedText(required(payload, "rendered_markdown"), 30000)
    });
  }

  function boundedAssistantRequestText(value, maximumLength) {
    if (typeof value !== "string") throw clientError("invalid_request");
    const text = value.trim();
    if (
      text.length < 1
      || text.length > maximumLength
      || disallowedControlPattern.test(text)
    ) {
      throw clientError("invalid_request");
    }
    return text;
  }

  function buildAssistantRequestBody(request) {
    if (!isRecord(request)) throw clientError("invalid_request");
    const allowedKeys = new Set([
      "message",
      "selected_section_id",
      "active_metric",
      "history"
    ]);
    if (Object.keys(request).some(key => !allowedKeys.has(key)) || !hasOwn(request, "message")) {
      throw clientError("invalid_request");
    }

    const body = {
      message: boundedAssistantRequestText(request.message, 1000)
    };
    if (
      hasOwn(request, "selected_section_id")
      && request.selected_section_id !== null
      && request.selected_section_id !== undefined
      && request.selected_section_id !== ""
    ) {
      body.selected_section_id = `CS_${canonicalSectionId(request.selected_section_id)}`;
    }
    if (
      hasOwn(request, "active_metric")
      && request.active_metric !== null
      && request.active_metric !== undefined
      && request.active_metric !== ""
    ) {
      body.active_metric = canonicalMetricName(request.active_metric);
    }
    if (
      hasOwn(request, "history")
      && request.history !== null
      && request.history !== undefined
    ) {
      if (!Array.isArray(request.history) || request.history.length > 4) {
        throw clientError("invalid_request");
      }
      let totalCharacters = 0;
      const history = request.history.map(item => {
        if (
          !isRecord(item)
          || Object.keys(item).some(key => key !== "role" && key !== "content")
          || Object.keys(item).length !== 2
          || !["user", "assistant"].includes(item.role)
        ) {
          throw clientError("invalid_request");
        }
        const content = boundedAssistantRequestText(item.content, 1000);
        totalCharacters += content.length;
        return { role: item.role, content };
      });
      if (totalCharacters > 4000) throw clientError("invalid_request");
      if (history.length > 0) body.history = history;
    }
    return body;
  }

  function boundedAssistantResponseText(value, maximumLength, minimumLength = 1) {
    const text = boundedText(value, maximumLength, minimumLength);
    if (assistantRestrictedTextPattern.test(text)) invalidResponse();
    return text;
  }

  function boundedAssistantAnswer(value) {
    const text = boundedAssistantResponseText(value, 4000);
    if (
      assistantInternalPathPattern.test(text)
      || assistantRawJsonPattern.test(text)
    ) {
      invalidResponse();
    }
    return text;
  }

  function validateAssistantSectionId(value) {
    if (value === null) return null;
    const sectionId = boundedAssistantResponseText(value, 15);
    if (!assistantSectionIdPattern.test(sectionId)) invalidResponse();
    return sectionId;
  }

  function validateAssistantMetricName(value) {
    if (value === null) return null;
    if (typeof value !== "string" || !assistantEvidenceMetricNames.has(value)) invalidResponse();
    return value;
  }

  function validateAssistantEvidenceValue(value) {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return finiteNumber(value);
    if (typeof value === "string") {
      return boundedAssistantResponseText(value, 4000, 0);
    }
    invalidResponse();
  }

  function validateAssistantEvidence(value) {
    const evidenceId = boundedAssistantResponseText(required(value, "evidence_id"), 100);
    if (!assistantEvidenceIdPattern.test(evidenceId)) invalidResponse();
    const kind = oneOf(required(value, "kind"), assistantEvidenceKinds);
    const sectionId = validateAssistantSectionId(required(value, "section_id"));
    const metricName = validateAssistantMetricName(required(value, "metric_name"));
    const definition = required(value, "definition") === null
      ? null
      : boundedAssistantResponseText(required(value, "definition"), 2000);
    if (
      (["metric_value", "metric_definition"].includes(kind) && metricName === null)
      || (!["metric_value", "metric_definition"].includes(kind) && metricName !== null)
      || (kind === "metric_definition" && (sectionId !== null || definition === null))
    ) {
      invalidResponse();
    }
    return {
      evidence_id: evidenceId,
      kind,
      section_id: sectionId,
      metric_name: metricName,
      label: boundedAssistantResponseText(required(value, "label"), 200),
      value: validateAssistantEvidenceValue(required(value, "value")),
      display_value: boundedAssistantResponseText(required(value, "display_value"), 500),
      unit: required(value, "unit") === null
        ? null
        : boundedAssistantResponseText(required(value, "unit"), 200),
      definition
    };
  }

  function validateAssistantWarning(value) {
    return {
      section_id: validateAssistantSectionId(required(value, "section_id")),
      code: oneOf(required(value, "code"), warningCodes),
      severity: oneOf(required(value, "severity"), warningSeverities),
      message: boundedAssistantResponseText(required(value, "message"), 1000)
    };
  }

  function validateAssistantResponse(payload, httpStatus) {
    if (!isRecord(payload)) invalidResponse();
    const status = oneOf(required(payload, "status"), assistantStatuses);
    const statusesByHttpCode = {
      200: ["completed", "clarification_required", "unsupported_request"],
      502: ["invalid_model_response"],
      503: ["assistant_disabled", "model_unavailable", "tool_error"]
    };
    if (!statusesByHttpCode[httpStatus]?.includes(status)) invalidResponse();

    const intentValue = required(payload, "intent");
    const intent = intentValue === null ? null : oneOf(intentValue, assistantIntents);
    const toolsUsed = copyArray(required(payload, "tools_used"), 0, 1, item => {
      if (required(item, "call_index") !== 1) invalidResponse();
      return {
        tool_name: oneOf(required(item, "tool_name"), assistantToolNames),
        call_index: 1
      };
    });
    const evidence = copyArray(
      required(payload, "evidence"),
      0,
      32,
      validateAssistantEvidence
    );
    uniqueArray(evidence.map(item => item.evidence_id));
    const warnings = copyArray(
      required(payload, "warnings"),
      0,
      8,
      validateAssistantWarning
    );
    const limitations = copyArray(
      required(payload, "limitations"),
      0,
      12,
      item => boundedAssistantResponseText(item, 2000)
    );
    const clarificationValue = required(payload, "clarification");
    const clarification = clarificationValue === null ? null : {
      reason: oneOf(required(clarificationValue, "reason"), clarificationReasons),
      question: boundedAssistantResponseText(required(clarificationValue, "question"), 500)
    };
    if (
      (status === "clarification_required"
        && (intent !== "request_clarification" || clarification === null))
      || (status !== "clarification_required" && clarification !== null)
      || (status === "unsupported_request" && intent !== "decline_unsupported_request")
    ) {
      invalidResponse();
    }
    if (required(payload, "data_release") !== dataRelease) invalidResponse();
    if (required(payload, "method_version") !== methodVersion) invalidResponse();
    return deepFreeze({
      status,
      answer: boundedAssistantAnswer(required(payload, "answer")),
      intent,
      tools_used: toolsUsed,
      evidence,
      warnings,
      limitations,
      clarification,
      data_release: dataRelease,
      method_version: methodVersion
    });
  }

  function validateAssistantRequestError(payload) {
    if (!isRecord(payload)) invalidResponse();
    const detail = required(payload, "detail");
    if (required(detail, "code") !== "invalid_assistant_request") invalidResponse();
    boundedAssistantResponseText(required(detail, "message"), 2000);
    throw clientError("backend_validation_error");
  }

  function validateErrorPayload(payload, status, endpointKind, expectedValue) {
    if (!isRecord(payload)) invalidResponse();
    const detail = required(payload, "detail");
    const code = boundedText(required(detail, "code"), 100);
    if (status === 404) {
      if (endpointKind === "metric") {
        if (code !== "metric_not_found" || required(detail, "metric_name") !== expectedValue) {
          invalidResponse();
        }
        throw clientError("metric_not_found");
      }
      if (code !== "section_not_found") invalidResponse();
      boundedText(required(detail, "message"), 2000);
      throw clientError("section_not_found");
    }
    if (status === 422) {
      const allowedCodes = endpointKind === "metric"
        ? ["invalid_metric_name"]
        : endpointKind === "review_note"
          ? ["invalid_cs_id", "invalid_review_note_request"]
          : ["invalid_cs_id"];
      if (!allowedCodes.includes(code)) invalidResponse();
      boundedText(required(detail, "message"), 2000);
      throw clientError("backend_validation_error");
    }
    if (status === 503) {
      if (code !== "snapshot_unavailable") invalidResponse();
      boundedText(required(detail, "message"), 2000);
      throw clientError("snapshot_unavailable");
    }
    throw clientError("unexpected_status");
  }

  async function readReviewedJson(response, maximumLength, cancellation) {
    let text;
    try {
      text = await response.text();
    } catch {
      throw clientError("invalid_response");
    }
    throwIfCancelled(cancellation);
    if (typeof text !== "string" || text.length > maximumLength) {
      throw clientError("invalid_response");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw clientError("invalid_json");
    }
  }

  async function requestReviewedJson({
    url,
    method,
    body,
    endpointKind,
    expectedValue,
    responseLimit,
    validator,
    signal
  }) {
    if (endpointKind === "assistant") ensureBackendAgentMode();
    else ensureBackendToolsMode();
    if (typeof global.fetch !== "function") throw clientError("backend_unavailable");
    const timeoutMs = endpointKind === "assistant"
      ? namespace.runtime.agent_timeout_ms
      : namespace.runtime.timeout_ms;
    const cancellation = createCancellation(signal, timeoutMs);
    try {
      throwIfCancelled(cancellation);
      const headers = { Accept: "application/json" };
      const requestOptions = {
        method,
        mode: "cors",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers,
        signal: cancellation.signal
      };
      if (method === "POST") {
        headers["Content-Type"] = "application/json";
        requestOptions.body = JSON.stringify(body);
      }

      let response;
      try {
        response = await global.fetch(url, requestOptions);
      } catch {
        throwIfCancelled(cancellation);
        throw clientError("backend_unavailable");
      }
      throwIfCancelled(cancellation);
      if (
        !isRecord(response)
        || !Number.isInteger(response.status)
        || typeof response.text !== "function"
      ) {
        throw clientError("invalid_response");
      }
      const allowedStatuses = endpointKind === "assistant"
        ? [200, 422, 502, 503]
        : [200, 404, 422, 503];
      if (!allowedStatuses.includes(response.status)) {
        throw clientError("unexpected_status");
      }
      const payload = await readReviewedJson(response, responseLimit, cancellation);
      if (endpointKind === "assistant") {
        if (response.status === 422) validateAssistantRequestError(payload);
        return validator(payload, response.status);
      }
      if (response.status !== 200) {
        validateErrorPayload(payload, response.status, endpointKind, expectedValue);
      }
      return validator(payload, expectedValue);
    } catch (error) {
      if (cancellation.didTimeout()) throw clientError("request_timeout");
      if (cancellation.didCallerCancel()) throw clientError("request_cancelled");
      if (error instanceof AssistantClientError) throw error;
      throw clientError("backend_unavailable");
    } finally {
      cancellation.cleanup();
    }
  }

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  async function getSectionSummary(sectionId, options) {
    const normalizedId = canonicalSectionId(sectionId);
    return requestReviewedJson({
      url: `${namespace.runtime.backend_base_url}/api/v1/sections/${normalizedId}`,
      method: "GET",
      body: null,
      endpointKind: "section",
      expectedValue: normalizedId,
      responseLimit: summaryResponseLimit,
      validator: validateSectionSummary,
      signal: callerSignal(options)
    });
  }

  async function explainMetric(metricName, options) {
    const canonicalName = canonicalMetricName(metricName);
    return requestReviewedJson({
      url: `${namespace.runtime.backend_base_url}/api/v1/metrics/${canonicalName}`,
      method: "GET",
      body: null,
      endpointKind: "metric",
      expectedValue: canonicalName,
      responseLimit: metricResponseLimit,
      validator: validateMetricExplanation,
      signal: callerSignal(options)
    });
  }

  async function generateSectionReviewNote(sectionId, options) {
    const normalizedId = canonicalSectionId(sectionId);
    return requestReviewedJson({
      url: `${namespace.runtime.backend_base_url}/api/v1/reports/review-note`,
      method: "POST",
      body: { scope: "section", section_ids: [normalizedId] },
      endpointKind: "review_note",
      expectedValue: normalizedId,
      responseLimit: reviewNoteResponseLimit,
      validator: validateReviewNote,
      signal: callerSignal(options)
    });
  }

  async function queryAssistant(request, options) {
    const body = buildAssistantRequestBody(request);
    return requestReviewedJson({
      url: `${namespace.runtime.backend_base_url}/api/v1/assistant/query`,
      method: "POST",
      body,
      endpointKind: "assistant",
      expectedValue: null,
      responseLimit: assistantResponseLimit,
      validator: validateAssistantResponse,
      signal: callerSignal(options)
    });
  }

  Object.defineProperties(namespace, {
    activeLayerMetrics: {
      value: activeLayerMetrics,
      enumerable: true
    },
    client: {
      value: Object.freeze({
        getSectionSummary,
        explainMetric,
        generateSectionReviewNote,
        queryAssistant
      }),
      enumerable: true
    }
  });
  Object.freeze(namespace);
})(window);
