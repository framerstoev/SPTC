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
    backend_unavailable: "Backend unavailable — local fallback",
    request_timeout: "Backend timeout — local fallback",
    section_not_found: "Section unavailable — local fallback",
    metric_not_found: "Metric unavailable — local fallback",
    backend_validation_error: "Backend rejected request — local fallback",
    snapshot_unavailable: "Snapshot unavailable — local fallback",
    invalid_json: "Backend response unavailable — local fallback",
    invalid_response: "Backend response unavailable — local fallback",
    unexpected_status: "Backend response unavailable — local fallback"
  });

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
      reviewContainer: documentRef.getElementById("assistantReviewContainer"),
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
    let activeReview = null;
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
      message.textContent = text;
      elements.messages.appendChild(message);
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }

    function replaceMessage(text) {
      elements.messages.replaceChildren();
      appendMessage(text);
      elements.messages.scrollTop = 0;
    }

    function textElement(tagName, className, text) {
      const element = documentRef.createElement(tagName);
      if (className) element.className = className;
      element.textContent = text;
      return element;
    }

    function replaceStructuredMessage(message) {
      elements.messages.replaceChildren(message);
      elements.messages.scrollTop = 0;
    }

    function appendDefinition(result, label, value) {
      const row = documentRef.createElement("p");
      row.className = "assistant-result-row";
      row.appendChild(textElement("strong", null, `${label}: `));
      row.appendChild(textElement("span", null, value));
      result.appendChild(row);
    }

    function formatNumber(value, digits = 3) {
      return Number(value).toFixed(digits);
    }

    function readableStatus(value) {
      return String(value).replaceAll("_", " ");
    }

    function clearReview() {
      activeReview = null;
      elements.reviewContainer.replaceChildren();
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
      elements.messages.setAttribute(
        "aria-busy",
        requestState === requestStates.loading ? "true" : "false"
      );
    }

    function baseRequestState() {
      if (!context.sectionId) return requestStates.noSelection;
      if (!context.activeMetric) return requestStates.unsupportedMetric;
      return requestStates.idle;
    }

    function baseStatusText() {
      if (!context.sectionId) return "No section selected";
      return backendActionsEnabled ? "Deterministic fixed actions ready" : "Local template preview";
    }

    function renderPreview() {
      clearReview();
      if (!context.sectionId) {
        replaceMessage("Select a control section to ground the assistant context.");
      } else {
        replaceMessage(context.localSectionText || "A local section preview is unavailable.");
      }
      updateState(baseRequestState(), baseStatusText());
    }

    function updateAvailability() {
      const hasSelection = Boolean(context.sectionId);
      elements.sectionButton.disabled = !hasSelection;
      elements.reviewButton.disabled = !hasSelection;
      elements.metricButton.disabled = !hasSelection || !context.activeMetric;
      if (!hasSelection) {
        elements.actionAvailability.textContent = "Select a control section to enable the fixed actions.";
      } else if (!context.activeMetric) {
        elements.actionAvailability.textContent = "The current layer has no reviewed metric explanation. Section and review-note actions remain available.";
      } else {
        elements.actionAvailability.textContent = "Three fixed reviewed actions are available for the current selection.";
      }
    }

    function abortPending() {
      if (!pending) return;
      const request = pending;
      pending = null;
      generation += 1;
      request.controller.abort();
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
      if (!identityChanged && pending) {
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
      clearReview();
      if (action === actions.metric) {
        replaceMessage(
          context.localMetricText
          || "The current layer does not map to a reviewed metric explanation."
        );
      } else if (action === actions.review) {
        replaceMessage(
          `A local deterministic backend is required to generate the review-note draft. ${context.localSectionText || "A concise local section preview is unavailable."}`
        );
      } else {
        replaceMessage(context.localSectionText || "A local section preview is unavailable.");
      }
      updateState(requestStates.idle, "Local template", action);
    }

    function localFallbackText(action) {
      if (action === actions.metric) {
        return context.localMetricText
          || "The current layer does not map to a reviewed metric explanation.";
      }
      if (action === actions.review) {
        return `The backend review-note draft is unavailable; no draft was generated. ${context.localSectionText || "A concise local section preview is unavailable."}`;
      }
      return context.localSectionText || "A concise local section preview is unavailable.";
    }

    function renderBackendFallback(action, errorCode) {
      clearReview();
      replaceMessage(localFallbackText(action));
      updateState(
        requestStates.fallbackSuccess,
        fallbackLabels[errorCode] || "Backend response unavailable — local fallback",
        action
      );
    }

    function compactMetricList(title, metrics, attributeName) {
      const block = documentRef.createElement("div");
      block.className = "assistant-result-group";
      block.appendChild(textElement("h4", null, title));
      const list = documentRef.createElement("ul");
      metrics.forEach(metric => {
        list.appendChild(textElement("li", null, `${metric.label}: ${metric.value}`));
      });
      block.appendChild(list);
      block.setAttribute(attributeName, String(metrics.length));
      return block;
    }

    function renderSectionResult(response) {
      const result = documentRef.createElement("div");
      result.className = "assistant-message assistant assistant-result";
      result.appendChild(textElement("p", "assistant-result-source", "Deterministic fixed action"));
      result.appendChild(textElement("h3", null, response.identity.display_cs_id));
      appendDefinition(
        result,
        "Location",
        `${response.identity.route}, ${response.identity.county}`
      );
      appendDefinition(
        result,
        "Observed support",
        response.support_status.observed_support ? "available" : "unavailable"
      );
      appendDefinition(
        result,
        "Detection status",
        readableStatus(response.support_status.detection_status)
      );

      const observedMetrics = [];
      if (response.observed_metrics.q_min !== null) {
        observedMetrics.push({
          label: "Q_min",
          value: formatNumber(response.observed_metrics.q_min)
        });
      }
      if (response.observed_metrics.loss_depth_percent !== null) {
        observedMetrics.push({
          label: "Loss depth",
          value: `${formatNumber(response.observed_metrics.loss_depth_percent, 1)}%`
        });
      }
      if (response.observed_metrics.resilience_loss_area !== null) {
        observedMetrics.push({
          label: "Resilience loss area",
          value: `${formatNumber(response.observed_metrics.resilience_loss_area)} Q-hours`
        });
      }
      if (observedMetrics.length > 0) {
        result.appendChild(compactMetricList(
          "Selected observed evidence",
          observedMetrics.slice(0, 3),
          "data-observed-metric-count"
        ));
      } else if (!response.support_status.observed_support) {
        result.appendChild(textElement(
          "p",
          "assistant-result-note",
          "Tier 3 observed evidence is unavailable for this section in the current release. This does not indicate that no disruption occurred."
        ));
      } else {
        result.appendChild(textElement(
          "p",
          "assistant-result-note",
          "Phase-dependent observed metrics are unavailable under this detection status."
        ));
      }

      const planningMetrics = [
        { label: "WEATHER_REI", value: formatNumber(response.planning_context.weather_rei) },
        { label: "NETRISK_LITE", value: formatNumber(response.planning_context.netrisk_lite) },
        { label: "EVENT_REI", value: formatNumber(response.planning_context.event_rei) }
      ];
      result.appendChild(compactMetricList(
        "Planning context",
        planningMetrics,
        "data-planning-metric-count"
      ));
      if (response.warnings.length > 0) {
        result.appendChild(compactMetricList(
          "Warnings",
          response.warnings.map(warning => ({
            label: `${warning.code} (${warning.severity})`,
            value: warning.message
          })),
          "data-warning-count"
        ));
      } else {
        appendDefinition(result, "Warnings", "None returned");
      }
      result.appendChild(textElement(
        "p",
        "assistant-result-note",
        "Planning context and observed Tier 3 evidence describe different parts of this event-specific review."
      ));
      replaceStructuredMessage(result);
    }

    function renderMetricResult(response) {
      const result = documentRef.createElement("div");
      result.className = "assistant-message assistant assistant-result";
      result.appendChild(textElement("p", "assistant-result-source", "Deterministic fixed action"));
      result.appendChild(textElement("h3", null, response.metric.display_name));
      result.appendChild(textElement(
        "p",
        "assistant-result-note",
        response.interpretation.plain_language
      ));
      appendDefinition(result, "Definition", response.metric.definition);
      appendDefinition(result, "Unit", response.metric.unit);
      appendDefinition(
        result,
        "Applicability",
        response.metric.applicability.map(readableStatus).join(", ")
      );
      if (response.metric.nullable) {
        appendDefinition(result, "When unavailable", response.metric.null_meaning);
      }
      const limitations = response.interpretation.limitations.slice(0, 3);
      const limitationBlock = compactMetricList(
        "Reviewed limitations",
        limitations.map((limitation, index) => ({
          label: `Limitation ${index + 1}`,
          value: limitation
        })),
        "data-limitation-count"
      );
      result.appendChild(limitationBlock);
      result.appendChild(textElement(
        "p",
        "assistant-result-note",
        "This is a metric definition, not an interpretation of the selected section's relative standing."
      ));
      replaceStructuredMessage(result);
    }

    function reviewListBlock(title, items, listName) {
      const block = documentRef.createElement("section");
      block.className = "assistant-review-list-block";
      block.setAttribute("data-review-list", listName);
      block.appendChild(textElement("h3", null, title));
      const list = documentRef.createElement("ul");
      items.forEach(item => {
        list.appendChild(textElement("li", null, item));
      });
      block.appendChild(list);
      return block;
    }

    function reviewDetectionStatus(response) {
      const statusEvidence = response.evidence.find(evidence => (
        evidence.field_name === "detection_status"
      ));
      return statusEvidence ? readableStatus(statusEvidence.raw_value) : "unavailable";
    }

    function renderReviewResult(response, request) {
      const compact = documentRef.createElement("div");
      compact.className = "assistant-message assistant assistant-result";
      compact.setAttribute("data-review-compact", "true");
      compact.appendChild(textElement("p", "assistant-result-source", "Deterministic fixed action"));
      compact.appendChild(textElement("h3", null, response.title));
      compact.appendChild(textElement(
        "p",
        "assistant-review-draft-label",
        "Draft for human review"
      ));
      appendDefinition(
        compact,
        "Section",
        `${response.identity.display_cs_id}; ${response.identity.route}, ${response.identity.county}`
      );
      appendDefinition(compact, "Status", reviewDetectionStatus(response));
      appendDefinition(
        compact,
        "Warning codes",
        response.warnings.map(warning => warning.code).join(", ")
      );
      appendDefinition(compact, "Evidence records", String(response.evidence.length));
      appendDefinition(compact, "Limitations", String(response.limitations.length));
      compact.appendChild(textElement(
        "p",
        "assistant-result-note",
        "Expand the full draft below for structured review and the human-review checklist."
      ));
      replaceStructuredMessage(compact);

      const details = documentRef.createElement("details");
      details.className = "assistant-review-details";
      details.open = false;
      details.setAttribute("data-report-section-count", String(response.sections.length));
      details.appendChild(textElement("summary", null, "Open full review note"));
      const body = documentRef.createElement("div");
      body.className = "assistant-review-body";
      response.sections.forEach(section => {
        const sectionElement = documentRef.createElement("section");
        sectionElement.className = "assistant-review-section";
        sectionElement.setAttribute("data-report-section", section.key);
        sectionElement.appendChild(textElement("h3", null, section.heading));
        sectionElement.appendChild(textElement("p", null, section.body));
        body.appendChild(sectionElement);
      });
      body.appendChild(reviewListBlock(
        "Warnings",
        response.warnings.map(warning => (
          `${warning.code} (${warning.severity}): ${warning.message}`
        )),
        "warnings"
      ));
      body.appendChild(reviewListBlock(
        "Limitations",
        response.limitations,
        "limitations"
      ));
      body.appendChild(reviewListBlock(
        "Human-review checklist",
        response.human_review_items.map(item => `Review: ${item}`),
        "human-review-checklist"
      ));
      details.appendChild(body);
      elements.reviewContainer.appendChild(details);

      const reviewToken = Object.freeze({
        generation: request.generation,
        sectionId: request.sectionId,
        markdown: response.rendered_markdown
      });
      activeReview = reviewToken;
      const copyRow = documentRef.createElement("div");
      copyRow.className = "assistant-copy-row";
      const copyButton = textElement("button", null, "Copy Markdown");
      copyButton.setAttribute("id", "assistantCopyMarkdown");
      copyButton.setAttribute("type", "button");
      const copyStatus = documentRef.createElement("span");
      copyStatus.setAttribute("id", "assistantCopyStatus");
      copyStatus.className = "assistant-copy-status";
      copyStatus.setAttribute("role", "status");
      copyStatus.setAttribute("aria-live", "polite");
      copyStatus.setAttribute("aria-atomic", "true");
      copyButton.addEventListener("click", async () => {
        if (activeReview !== reviewToken) return;
        if (!clipboard || typeof clipboard.writeText !== "function") {
          copyStatus.textContent = "Clipboard unavailable.";
          return;
        }
        try {
          await clipboard.writeText(reviewToken.markdown);
          if (activeReview !== reviewToken) return;
          copyStatus.textContent = "Copied Markdown.";
        } catch {
          if (activeReview !== reviewToken) return;
          copyStatus.textContent = "Copy failed.";
        }
      });
      copyRow.appendChild(copyButton);
      copyRow.appendChild(copyStatus);
      elements.reviewContainer.appendChild(copyRow);
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
      clearReview();
      if (action === actions.section) {
        renderSectionResult(response);
      } else if (action === actions.metric) {
        renderMetricResult(response);
      } else {
        renderReviewResult(response, request);
      }
      updateState(
        requestStates.backendSuccess,
        action === actions.review
          ? "Deterministic draft for human review"
          : "Deterministic backend result",
        action
      );
    }

    async function startAction(action) {
      if (!Object.values(actions).includes(action)) return;
      if (!context.sectionId) return;
      if (action === actions.metric && !context.activeMetric) return;
      abortPending();
      generation += 1;
      clearReview();
      if (!backendActionsEnabled) {
        renderLocalAction(action);
        return;
      }

      const method = backendMethod(action);
      if (!method) {
        renderBackendFallback(action, "backend_unavailable");
        return;
      }
      const request = {
        generation,
        action,
        controller: new global.AbortController(),
        sectionId: context.sectionId,
        activeLayer: context.activeLayer,
        metricName: context.activeMetric
      };
      pending = request;
      const loadingText = action === actions.metric
        ? "Loading the reviewed metric definition..."
        : action === actions.review
          ? "Loading the reviewed review-note draft..."
          : "Loading the reviewed section summary...";
      replaceMessage(loadingText);
      updateState(requestStates.loading, "Backend tools — loading", action);
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
        renderBackendFallback(action, errorCode);
      }
    }

    function bindAction(button, action) {
      button.addEventListener("click", () => startAction(action));
    }

    elements.modeLabel.textContent = mode === modes.backendTools
      ? "Backend tools"
      : mode === modes.backendAgent
        ? "Local Qwen + backend tools"
        : "Local template";
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
      createController
    }),
    enumerable: false,
    configurable: false,
    writable: false
  });
})(window);
