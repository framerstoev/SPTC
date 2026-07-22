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

  function createController(options = {}) {
    const assistantNamespace = global.SPTCAssistant || Object.create(null);
    const runtime = options.runtime || assistantNamespace.runtime || {
      effective_mode: "local-template"
    };
    const modes = assistantNamespace.modes || {
      localTemplate: "local-template",
      backendTools: "backend-tools"
    };
    const activeLayerMetrics = options.activeLayerMetrics
      || assistantNamespace.activeLayerMetrics
      || Object.freeze({});
    const client = options.client || assistantNamespace.client || null;
    const documentRef = options.document || global.document;
    const mode = runtime.effective_mode === modes.backendTools
      ? modes.backendTools
      : modes.localTemplate;
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

    function clearReview() {
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
      elements.status.textContent = statusText;
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
      return "Local template preview";
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
      updateState(requestStates.cancelledOrStale, "Request cancelled", request.action);
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

    function renderUnwiredBackendFallback(action) {
      clearReview();
      const prefix = action === actions.review
        ? "The backend review-note draft is unavailable."
        : "The backend action is unavailable.";
      replaceMessage(`${prefix} ${context.localSectionText || "A concise local section preview is unavailable."}`);
      updateState(
        requestStates.fallbackSuccess,
        "Backend unavailable — local fallback",
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
      if (mode !== modes.backendTools) {
        renderLocalAction(action);
        return;
      }

      // Action-specific backend handlers are added in the following reviewed commits.
      if (!client) {
        renderUnwiredBackendFallback(action);
        return;
      }
      renderUnwiredBackendFallback(action);
    }

    function bindAction(button, action) {
      button.addEventListener("click", () => startAction(action));
    }

    elements.modeLabel.textContent = mode === modes.backendTools
      ? "Backend tools"
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
