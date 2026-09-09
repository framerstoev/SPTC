(function initializeAssistantActions(global) {
  "use strict";

  const namespaceName = "SPTCAssistantActions";
  if (Object.prototype.hasOwnProperty.call(global, namespaceName)) {
    throw new Error("The SPTC assistant actions namespace is already defined.");
  }

  const requestStates = Object.freeze({
    idle: "idle",
    noSelection: "no_selection",
    unsupportedMetric: "unsupported_metric",
    loading: "loading",
    backendSuccess: "backend_success",
    fallbackSuccess: "fallback_success",
    cancelledOrStale: "cancelled_or_stale"
  });
  const actions = Object.freeze({
    section: "section",
    metric: "metric",
    review: "review"
  });
  const fallbackLabels = Object.freeze({
    backend_unavailable: "Review service unavailable — showing a local result.",
    request_timeout: "Review request timed out — showing a local result.",
    section_not_found: "Section result unavailable — showing a local result.",
    metric_not_found: "Metric result unavailable — showing a local result.",
    backend_validation_error: "Review request was not accepted — showing a local result.",
    snapshot_unavailable: "Reviewed snapshot unavailable — showing a local result.",
    invalid_json: "Review result unavailable — showing a local result.",
    invalid_response: "Review result unavailable — showing a local result.",
    unexpected_status: "Review result unavailable — showing a local result."
  });
  const actionLabels = Object.freeze({
    section: "Explain this section",
    metric: "Explain the current metric",
    review: "Generate review note"
  });

  function safeDisplayText(value) {
    return String(value ?? "")
      .replace(/observed[ _-]+curve[ _-]+resilience[ _-]+score[ _-]+v0/gi, "Tier 3 observed resilience score")
      .replace(/\bscore[ _-]?v0\b/gi, "Tier 3 score")
      .replace(/\bnetrisk[ _-]?lite\b/gi, "NETWORK_REI")
      .replace(/\btier[ _-]?2[ _-]?lite\b/gi, "Tier 2")
      .replace(/\bevent[ _-]?rei\b/gi, "combined potential context")
      .replace(/\bmethod_definition_required\b/gi, "a reviewed classification rule is required")
      .replace(/\brecovery_censored\b/gi, "recovery completion was not observed")
      .replace(/\bno_observed_support\b/gi, "no observed support")
      .replace(/\bno_sustained_drop\b/gi, "no sustained drop")
      .replace(/\bmethod_scope\b/gi, "event-specific experimental method")
      .replace(/\bpartial_observed_coverage\b/gi, "partial observed coverage")
      .replace(/\bq_min\b/gi, "Minimum");
  }

  function createController(options = {}) {
    const assistantNamespace = global.SPTCAssistant || Object.create(null);
    const runtime = options.runtime || assistantNamespace.runtime || {
      effective_mode: "local-template"
    };
    const modes = assistantNamespace.modes || {
      localTemplate: "local-template",
      backendTools: "backend-tools",
      backendAgent: "backend-agent"
    };
    const activeLayerMetrics = options.activeLayerMetrics
      || assistantNamespace.activeLayerMetrics
      || Object.freeze({});
    const client = options.client || assistantNamespace.client || null;
    const documentRef = options.document || global.document;
    const clipboard = Object.prototype.hasOwnProperty.call(options, "clipboard")
      ? options.clipboard
      : global.navigator?.clipboard || null;
    const mode = runtime.effective_mode === modes.backendTools
      ? modes.backendTools
      : runtime.effective_mode === modes.backendAgent
        ? modes.backendAgent
        : modes.localTemplate;
    const backendActionsEnabled = mode === modes.backendTools || mode === modes.backendAgent;
    const elements = {
      modeLabel: documentRef.getElementById("assistantModeLabel"),
      status: documentRef.getElementById("assistantStatus"),
      messages: documentRef.getElementById("assistantMessages"),
      actionAvailability: documentRef.getElementById("assistantActionAvailability"),
      sectionButton: documentRef.getElementById("assistantExplainSection"),
      metricButton: documentRef.getElementById("assistantExplainMetric"),
      reviewButton: documentRef.getElementById("assistantGenerateReviewNote")
    };
    let context = {
      sectionId: null,
      activeLayer: null,
      activeMetric: null,
      localSectionText: null,
      localMetricText: null
    };
    let generation = 0;
    let pending = null;
    let state = {
      mode,
      requestState: requestStates.noSelection,
      selectedSectionId: null,
      activeLayer: null,
      activeMetric: null,
      requestGeneration: generation,
      currentAction: null
    };

    function appendMessage(text) {
      const message = documentRef.createElement("div");
      message.className = "assistant-message assistant";
      message.textContent = safeDisplayText(text);
      elements.messages.appendChild(message);
      elements.messages.scrollTop = elements.messages.scrollHeight;
      return message;
    }

    function replaceMessage(text) {
      elements.messages.replaceChildren();
      appendMessage(text);
      elements.messages.scrollTop = 0;
    }

    function textElement(tagName, className, text) {
      const element = documentRef.createElement(tagName);
      if (className) element.className = className;
      element.textContent = safeDisplayText(text);
      return element;
    }

    function replaceTimelineEntry(current, replacement) {
      const parent = current?.parentNode;
      if (!parent) {
        elements.messages.appendChild(replacement);
      } else {
        const children = Array.from(parent.children).map(child => (
          child === current ? replacement : child
        ));
        parent.replaceChildren(...children);
      }
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }

    function appendActionInvocation(action) {
      const message = textElement(
        "div",
        "assistant-message user quick-action",
        actionLabels[action]
      );
      message.setAttribute("data-assistant-invocation", action);
      elements.messages.appendChild(message);
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }

    function verifiedTextMessage(text) {
      const result = documentRef.createElement("div");
      result.className = "assistant-message assistant assistant-result";
      result.setAttribute("data-result-kind", "verified");
      result.appendChild(textElement("p", "assistant-result-note", text));
      return result;
    }

    function appendDefinition(result, label, value) {
      const row = documentRef.createElement("p");
      row.className = "assistant-result-row";
      row.appendChild(textElement("strong", null, `${label}: `));
      row.appendChild(textElement("span", null, value));
      result.appendChild(row);
    }

    function formatNumber(value, digits = 3) {
      if (value === null || value === undefined) return "unavailable";
      return Number(value).toFixed(digits);
    }

    function readableStatus(value) {
      return String(value).replaceAll("_", " ");
    }

    function updateState(requestState, statusText, currentAction = null) {
      state = {
        mode,
        requestState,
        selectedSectionId: context.sectionId,
        activeLayer: context.activeLayer,
        activeMetric: context.activeMetric,
        requestGeneration: generation,
        currentAction
      };
      if (statusText !== null) elements.status.textContent = statusText;
      const actionBusy = requestState === requestStates.loading;
      elements.messages.setAttribute("data-action-busy", actionBusy ? "true" : "false");
      elements.messages.setAttribute(
        "aria-busy",
        actionBusy || elements.messages.getAttribute("data-chat-busy") === "true"
          ? "true"
          : "false"
      );
    }

    function baseRequestState() {
      if (!context.sectionId) return requestStates.noSelection;
      if (!context.activeMetric) return requestStates.unsupportedMetric;
      return requestStates.idle;
    }

    function baseStatusText() {
      if (!context.sectionId) return "Selected section required.";
      return "";
    }

    function renderPreview() {
      if (options.showContextNotices === false) {
        updateState(baseRequestState(), "");
        return;
      }
      if (!context.sectionId) {
        replaceMessage("Select a control section to use section-based actions.");
      } else {
        replaceMessage(`Context updated to CS_${context.sectionId}. No request was sent.`);
      }
      updateState(baseRequestState(), baseStatusText());
    }

    function updateAvailability() {
      const hasSelection = Boolean(context.sectionId);
      elements.sectionButton.disabled = !hasSelection;
      elements.reviewButton.disabled = !hasSelection;
      elements.metricButton.disabled = !hasSelection || !context.activeMetric;
      if (!hasSelection) {
        elements.actionAvailability.hidden = false;
        elements.actionAvailability.textContent = "Select a control section to use section-based actions.";
      } else if (!context.activeMetric) {
        elements.actionAvailability.hidden = false;
        elements.actionAvailability.textContent = "The current layer has no reviewed metric explanation. Section and review-note actions remain available.";
      } else {
        elements.actionAvailability.textContent = "";
        elements.actionAvailability.hidden = true;
      }
    }

    function abortPending() {
      if (!pending) return;
      const request = pending;
      pending = null;
      generation += 1;
      request.controller.abort();
      if (request.entry?.parentNode) {
        replaceTimelineEntry(
          request.entry,
          textElement("div", "assistant-chat-notice", "Quick action cancelled.")
        );
      }
      updateState(requestStates.cancelledOrStale, null, request.action);
    }

    function normalizeContext(nextContext) {
      const sectionId = typeof nextContext?.sectionId === "string"
        && /^[1-9][0-9]{0,11}$/.test(nextContext.sectionId)
        ? nextContext.sectionId
        : null;
      const activeLayer = typeof nextContext?.activeLayer === "string"
        ? nextContext.activeLayer
        : null;
      const activeMetric = activeLayer
        && Object.prototype.hasOwnProperty.call(activeLayerMetrics, activeLayer)
        ? activeLayerMetrics[activeLayer]
        : null;
      return {
        sectionId,
        activeLayer,
        activeMetric,
        localSectionText: typeof nextContext?.localSectionText === "string"
          ? nextContext.localSectionText
          : null,
        localMetricText: typeof nextContext?.localMetricText === "string"
          ? nextContext.localMetricText
          : null
      };
    }

    function setContext(nextContext) {
      const normalized = normalizeContext(nextContext);
      const identityChanged = normalized.sectionId !== context.sectionId
        || normalized.activeLayer !== context.activeLayer
        || normalized.activeMetric !== context.activeMetric;
      if (!identityChanged) {
        context = normalized;
        updateAvailability();
        return;
      }
      if (identityChanged) abortPending();
      context = normalized;
      if (identityChanged) generation += 1;
      updateAvailability();
      renderPreview();
    }

    function renderLocalAction(action) {
      appendActionInvocation(action);
      let text;
      if (action === actions.metric) {
        text = context.localMetricText
          || "The current layer does not map to a reviewed metric explanation.";
      } else if (action === actions.review) {
        text = `The review-note service is required to generate the structured draft. ${context.localSectionText || "A concise local section result is unavailable."}`;
      } else {
        text = context.localSectionText || "A local section result is unavailable.";
      }
      elements.messages.appendChild(verifiedTextMessage(text));
      elements.messages.scrollTop = elements.messages.scrollHeight;
      updateState(requestStates.idle, "", action);
    }

    function localFallbackText(action) {
      if (action === actions.metric) {
        return context.localMetricText
          || "The current layer does not map to a reviewed metric explanation.";
      }
      if (action === actions.review) {
        return `The structured review-note draft is unavailable; no draft was generated. ${context.localSectionText || "A concise local section result is unavailable."}`;
      }
      return context.localSectionText || "A concise local section result is unavailable.";
    }

    function renderBackendFallback(action, errorCode, request = null) {
      const result = verifiedTextMessage(localFallbackText(action));
      if (request?.entry) {
        replaceTimelineEntry(request.entry, result);
      } else {
        elements.messages.appendChild(result);
      }
      updateState(
        requestStates.fallbackSuccess,
        fallbackLabels[errorCode] || "Review result unavailable — showing a local result.",
        action
      );
    }

    function renderSectionResult(response, request) {
      const observed = response.observed_metrics;
      const planning = response.planning_context;
      const text = [
        `${response.identity.display_cs_id}, ${response.identity.route}, ${response.identity.county}. ${readableStatus(response.support_status.detection_status)}.`,
        `Tier 3: Minimum ${formatNumber(observed.q_min)}; Loss Area ${formatNumber(observed.resilience_loss_area)} Q-hours; Recovery ${formatNumber(observed.recovery_duration_hours, 1)} hours.`,
        `Planning context: WEATHER_REI ${formatNumber(planning.weather_rei)}; NETWORK_REI ${formatNumber(planning.netrisk_lite)}; Potential Resilience ${formatNumber(planning.potential_resilience_score)}.`,
        ...response.warnings.map(warning => warning.message)
      ].join("\n\n");
      replaceTimelineEntry(request.entry, verifiedTextMessage(text));
    }

    function renderMetricResult(response, request) {
      const text = [
        response.metric.display_name + ". " + response.interpretation.plain_language,
        response.metric.definition,
        "Unit: " + response.metric.unit + ".",
        ...(response.metric.nullable ? [response.metric.null_meaning] : []),
        ...response.interpretation.limitations
      ].join("\n\n");
      replaceTimelineEntry(request.entry, verifiedTextMessage(text));
    }

    function renderReviewResult(response, request) {
      const text = [
        "Draft for human review.",
        response.title,
        ...response.sections.filter(section => section.key !== "data_and_method_cautions").map(section => section.body),
        ...response.human_review_items.map((item, index) => `${index + 1}. ${item}`),
        ...response.warnings.map(warning => warning.message),
        ...response.limitations
      ].join("\n\n");
      replaceTimelineEntry(request.entry, verifiedTextMessage(text));
    }

    function backendMethod(action) {
      if (!client) return null;
      if (action === actions.section && typeof client.getSectionSummary === "function") {
        return (request, signal) => client.getSectionSummary(request.sectionId, { signal });
      }
      if (action === actions.metric && typeof client.explainMetric === "function") {
        return (request, signal) => client.explainMetric(request.metricName, { signal });
      }
      if (action === actions.review && typeof client.generateSectionReviewNote === "function") {
        return (request, signal) => client.generateSectionReviewNote(request.sectionId, { signal });
      }
      return null;
    }

    function requestIsCurrent(request) {
      return pending === request
        && generation === request.generation
        && context.sectionId === request.sectionId
        && context.activeLayer === request.activeLayer
        && context.activeMetric === request.metricName;
    }

    function renderBackendSuccess(action, response, request) {
      if (action === actions.section) {
        renderSectionResult(response, request);
      } else if (action === actions.metric) {
        renderMetricResult(response, request);
      } else {
        renderReviewResult(response, request);
      }
      updateState(
        requestStates.backendSuccess,
        "",
        action
      );
    }

    async function startAction(action) {
      if (!Object.values(actions).includes(action)) return;
      if (!context.sectionId) return;
      if (action === actions.metric && !context.activeMetric) return;
      abortPending();
      generation += 1;
      if (!backendActionsEnabled) {
        renderLocalAction(action);
        return;
      }

      const method = backendMethod(action);
      if (!method) {
        appendActionInvocation(action);
        renderBackendFallback(action, "backend_unavailable");
        return;
      }
      appendActionInvocation(action);
      const request = {
        generation,
        action,
        controller: new global.AbortController(),
        sectionId: context.sectionId,
        activeLayer: context.activeLayer,
        metricName: context.activeMetric
      };
      const loadingText = action === actions.metric
        ? "Loading the reviewed metric definition..."
        : action === actions.review
          ? "Loading the reviewed review-note draft..."
          : "Loading the reviewed section summary...";
      request.entry = appendMessage(loadingText);
      request.entry.className = "assistant-message assistant assistant-pending";
      pending = request;
      updateState(requestStates.loading, "Loading reviewed evidence…", action);
      try {
        const response = await method(request, request.controller.signal);
        if (!requestIsCurrent(request)) return;
        renderBackendSuccess(action, response, request);
        pending = null;
      } catch (error) {
        if (!requestIsCurrent(request)) return;
        pending = null;
        const errorCode = typeof error?.code === "string" ? error.code : "invalid_response";
        if (errorCode === "request_cancelled") {
          updateState(requestStates.cancelledOrStale, null, action);
          renderPreview();
          return;
        }
        renderBackendFallback(action, errorCode, request);
      }
    }

    function bindAction(button, action) {
      button.addEventListener("click", () => startAction(action));
      button.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        startAction(action);
      });
    }

    elements.modeLabel.textContent = mode === modes.backendAgent
      ? "AI Assistant"
      : mode === modes.backendTools
        ? "Review tools"
        : "Local preview";
    bindAction(elements.sectionButton, actions.section);
    bindAction(elements.metricButton, actions.metric);
    bindAction(elements.reviewButton, actions.review);
    updateAvailability();
    renderPreview();

    return Object.freeze({
      setContext,
      startAction,
      getState() {
        return Object.freeze({ ...state });
      }
    });
  }

  Object.defineProperty(global, namespaceName, {
    value: Object.freeze({
      actions,
      requestStates,
      safeDisplayText,
      createController
    }),
    enumerable: false,
    configurable: false,
    writable: false
  });
})(window);
