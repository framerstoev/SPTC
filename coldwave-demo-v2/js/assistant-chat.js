(function initializeAssistantChat(global) {
  "use strict";

  const namespaceName = "SPTCAssistantChat";
  if (Object.prototype.hasOwnProperty.call(global, namespaceName)) {
    throw new Error("The SPTC assistant chat namespace is already defined.");
  }

  const maximumMessageCharacters = 1000;
  const maximumHistoryMessages = 4;
  const responseStatusLabels = Object.freeze({
    completed: "Completed",
    clarification_required: "Clarification required",
    unsupported_request: "Unsupported request",
    assistant_disabled: "Assistant disabled",
    model_unavailable: "Model unavailable",
    tool_error: "Tool error",
    invalid_model_response: "Invalid model response"
  });
  const completionStatusText = Object.freeze({
    completed: "Local Qwen response ready.",
    clarification_required: "Clarification required.",
    unsupported_request: "Request outside the reviewed assistant scope.",
    assistant_disabled: "The local chatbot is not enabled.",
    model_unavailable: "The local Qwen model is unavailable.",
    tool_error: "The deterministic tool could not complete.",
    invalid_model_response: "The local model response was not safely accepted."
  });
  const clientFailureText = Object.freeze({
    invalid_request: "The question could not be sent because its local request was invalid.",
    backend_unavailable: "The local assistant service is unavailable. The deterministic fixed actions remain available.",
    request_timeout: "The local Qwen request did not complete. The deterministic fixed actions remain available.",
    request_cancelled: "The local Qwen request was cancelled.",
    backend_validation_error: "The local assistant service rejected the bounded request.",
    invalid_json: "The local assistant returned an unreadable response.",
    invalid_response: "The local assistant response did not pass frontend validation.",
    unexpected_status: "The local assistant returned an unexpected status."
  });

  function createController(options = {}) {
    const assistantNamespace = global.SPTCAssistant || Object.create(null);
    const runtime = options.runtime || assistantNamespace.runtime || {
      effective_mode: "local-template",
      backend_agent_enabled: false
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
    const agentMode = runtime.effective_mode === modes.backendAgent
      && runtime.backend_agent_enabled === true;
    const elements = {
      disclaimer: documentRef.getElementById("assistantDisclaimer"),
      interactionNote: documentRef.getElementById("assistantInteractionNote"),
      agentRegion: documentRef.getElementById("assistantAgent"),
      chatMessages: documentRef.getElementById("assistantChatMessages"),
      chatStatus: documentRef.getElementById("assistantChatStatus"),
      suggestions: documentRef.getElementById("assistantSuggestedQuestions"),
      composer: documentRef.getElementById("assistantComposer"),
      input: documentRef.getElementById("assistantInput"),
      characterCount: documentRef.getElementById("assistantCharacterCount"),
      send: documentRef.getElementById("assistantSend"),
      cancel: documentRef.getElementById("assistantCancel")
    };
    const suggestionButtons = Array.from(
      elements.suggestions?.querySelectorAll("button[data-assistant-question]") || []
    );
    let context = {
      sectionId: null,
      activeLayer: null,
      activeMetric: null
    };
    let contextInitialized = false;
    let generation = 0;
    let pending = null;
    let history = [];

    function textElement(tagName, className, text) {
      const element = documentRef.createElement(tagName);
      if (className) element.className = className;
      element.textContent = text;
      return element;
    }

    function appendChatNode(node) {
      elements.chatMessages.appendChild(node);
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }

    function appendNotice(text) {
      appendChatNode(textElement("div", "assistant-chat-notice", text));
    }

    function appendUserMessage(text) {
      const message = textElement("div", "assistant-chat-message user", text);
      message.setAttribute("data-chat-role", "user");
      appendChatNode(message);
    }

    function responseSourceLabel(status) {
      if (["completed", "clarification_required", "unsupported_request"].includes(status)) {
        return "Local Qwen3 8B + deterministic tools";
      }
      return "Local assistant status";
    }

    function readableIdentifier(value) {
      return String(value || "").replaceAll("_", " ");
    }

    function appendDefinition(parent, label, value) {
      const row = documentRef.createElement("p");
      row.className = "assistant-chat-definition";
      row.appendChild(textElement("strong", null, `${label}: `));
      row.appendChild(textElement("span", null, value));
      parent.appendChild(row);
    }

    function expandableBlock(summaryText, className) {
      const details = documentRef.createElement("details");
      details.className = className;
      details.open = false;
      details.appendChild(textElement("summary", null, summaryText));
      return details;
    }

    function appendTools(message, toolsUsed) {
      if (toolsUsed.length === 0) return;
      const details = expandableBlock(
        `Tools used (${toolsUsed.length})`,
        "assistant-chat-details assistant-chat-tools"
      );
      const list = documentRef.createElement("ul");
      toolsUsed.forEach(tool => {
        list.appendChild(textElement("li", null, readableIdentifier(tool.tool_name)));
      });
      details.appendChild(list);
      message.appendChild(details);
    }

    function appendEvidence(message, evidence) {
      if (evidence.length === 0) return;
      const details = expandableBlock(
        `Structured deterministic evidence (${evidence.length})`,
        "assistant-chat-details assistant-chat-evidence"
      );
      const list = documentRef.createElement("ul");
      evidence.forEach(record => {
        const item = documentRef.createElement("li");
        item.className = "assistant-chat-evidence-item";
        const displayValue = record.unit
          ? `${record.display_value} (${record.unit})`
          : record.display_value;
        appendDefinition(item, record.label, displayValue);
        if (record.section_id) appendDefinition(item, "Section", record.section_id);
        if (record.metric_name) {
          appendDefinition(item, "Metric", record.metric_name);
        }
        if (record.definition) {
          item.appendChild(textElement(
            "p",
            "assistant-chat-evidence-definition",
            record.definition
          ));
        }
        list.appendChild(item);
      });
      details.appendChild(list);
      message.appendChild(details);
    }

    function appendWarnings(message, warnings) {
      if (warnings.length === 0) return;
      const section = documentRef.createElement("section");
      section.className = "assistant-chat-warnings";
      section.setAttribute("aria-label", "Assistant warnings");
      section.appendChild(textElement("h4", null, "Warnings"));
      const list = documentRef.createElement("ul");
      warnings.forEach(warning => {
        const item = documentRef.createElement("li");
        item.className = `severity-${warning.severity}`;
        const scope = warning.section_id ? ` for ${warning.section_id}` : "";
        item.appendChild(textElement(
          "strong",
          null,
          `${warning.code} (${warning.severity})${scope}: `
        ));
        item.appendChild(textElement("span", null, warning.message));
        list.appendChild(item);
      });
      section.appendChild(list);
      message.appendChild(section);
    }

    function appendLimitations(message, limitations) {
      if (limitations.length === 0) return;
      const details = expandableBlock(
        `Limitations (${limitations.length})`,
        "assistant-chat-details assistant-chat-limitations"
      );
      const list = documentRef.createElement("ul");
      limitations.forEach(limitation => {
        list.appendChild(textElement("li", null, limitation));
      });
      details.appendChild(list);
      message.appendChild(details);
    }

    function appendReleaseMetadata(message, response) {
      const details = expandableBlock(
        "Release and method",
        "assistant-chat-details assistant-chat-metadata"
      );
      appendDefinition(details, "Data release", response.data_release);
      appendDefinition(details, "Method version", response.method_version);
      message.appendChild(details);
    }

    function displayedAnswer(response) {
      const reviewedStatusText = {
        assistant_disabled: "The local chatbot is not enabled. The deterministic fixed actions remain available.",
        model_unavailable: "The local Qwen model is unavailable. The deterministic fixed actions remain available.",
        tool_error: "The deterministic tool could not complete the request. No raw error was displayed.",
        invalid_model_response: "The local model response could not be safely accepted. Rejected model text was not displayed."
      };
      return reviewedStatusText[response.status] || response.answer;
    }

    function renderAssistantResponse(response) {
      const message = documentRef.createElement("article");
      message.className = `assistant-chat-message assistant status-${response.status}`;
      message.setAttribute("data-chat-role", "assistant");
      message.setAttribute("data-assistant-status", response.status);
      message.appendChild(textElement(
        "p",
        "assistant-chat-source",
        responseSourceLabel(response.status)
      ));
      message.appendChild(textElement(
        "p",
        "assistant-chat-response-status",
        `Status: ${responseStatusLabels[response.status] || "Unavailable"}`
      ));
      if (response.intent) {
        appendDefinition(message, "Intent", readableIdentifier(response.intent));
      }
      if (response.status === "clarification_required" && response.clarification) {
        message.appendChild(textElement(
          "p",
          "assistant-chat-clarification",
          response.clarification.question
        ));
      } else {
        message.appendChild(textElement(
          "p",
          "assistant-chat-answer",
          displayedAnswer(response)
        ));
      }
      appendWarnings(message, response.warnings);
      appendTools(message, response.tools_used);
      appendEvidence(message, response.evidence);
      appendLimitations(message, response.limitations);
      appendReleaseMetadata(message, response);
      appendChatNode(message);
    }

    function inputValue() {
      return typeof elements.input.value === "string" ? elements.input.value : "";
    }

    function updateCharacterCount() {
      const length = inputValue().length;
      elements.characterCount.textContent = `${length} / ${maximumMessageCharacters}`;
      elements.characterCount.classList.toggle(
        "over-limit",
        length > maximumMessageCharacters
      );
      elements.send.disabled = !agentMode
        || pending !== null
        || inputValue().trim().length === 0
        || length > maximumMessageCharacters;
    }

    function updateSuggestions() {
      suggestionButtons.forEach(button => {
        const requirement = button.getAttribute("data-requires-context");
        const missingContext = requirement === "section"
          ? context.sectionId === null
          : requirement === "metric"
            ? context.activeMetric === null
            : false;
        button.disabled = !agentMode || pending !== null || missingContext;
      });
    }

    function setLoading(loading) {
      elements.agentRegion.setAttribute("aria-busy", loading ? "true" : "false");
      elements.chatMessages.setAttribute("aria-busy", loading ? "true" : "false");
      elements.input.disabled = !agentMode || loading;
      elements.cancel.hidden = !loading;
      elements.cancel.disabled = !agentMode || !loading;
      updateCharacterCount();
      updateSuggestions();
    }

    function focusInput() {
      if (!agentMode || elements.input.disabled || typeof elements.input.focus !== "function") {
        return;
      }
      elements.input.focus();
    }

    function abortPending() {
      if (!pending) return false;
      const request = pending;
      pending = null;
      generation += 1;
      request.controller.abort();
      setLoading(false);
      return true;
    }

    function normalizeContext(nextContext) {
      const rawSectionId = typeof nextContext?.sectionId === "string"
        ? nextContext.sectionId.replace(/^CS_/, "")
        : null;
      const sectionId = rawSectionId && /^[1-9][0-9]{0,11}$/.test(rawSectionId)
        ? rawSectionId
        : null;
      const activeLayer = typeof nextContext?.activeLayer === "string"
        ? nextContext.activeLayer
        : null;
      const activeMetric = activeLayer
        && Object.prototype.hasOwnProperty.call(activeLayerMetrics, activeLayer)
        ? activeLayerMetrics[activeLayer]
        : null;
      return { sectionId, activeLayer, activeMetric };
    }

    function contextResetText(sectionChanged, metricChanged) {
      if (sectionChanged) {
        return context.sectionId
          ? `Chat context reset for selected section CS_${context.sectionId}. No question was sent.`
          : "Chat context reset because no control section is selected. No question was sent.";
      }
      if (metricChanged) {
        return context.activeMetric
          ? `Chat context reset for active metric ${context.activeMetric}. No question was sent.`
          : "Chat context reset because the current layer has no reviewed active metric. No question was sent.";
      }
      return "Chat context is ready.";
    }

    function setContext(nextContext) {
      const normalized = normalizeContext(nextContext);
      const sectionChanged = normalized.sectionId !== context.sectionId;
      const metricChanged = normalized.activeMetric !== context.activeMetric;
      const changed = sectionChanged || metricChanged;
      if (changed) abortPending();
      context = normalized;
      if (changed) {
        generation += 1;
        history = [];
        elements.input.value = "";
        elements.chatMessages.replaceChildren();
        if (contextInitialized && agentMode) {
          appendNotice(contextResetText(sectionChanged, metricChanged));
          elements.chatStatus.textContent = "Chat context reset.";
        }
      }
      contextInitialized = true;
      updateCharacterCount();
      updateSuggestions();
    }

    function requestIsCurrent(request) {
      return pending === request
        && generation === request.generation
        && context.sectionId === request.sectionId
        && context.activeMetric === request.activeMetric;
    }

    function boundedHistoryWith(message, answer) {
      history = [
        ...history,
        { role: "user", content: message },
        { role: "assistant", content: answer.slice(0, maximumMessageCharacters) }
      ].slice(-maximumHistoryMessages);
    }

    function failureText(error) {
      const code = typeof error?.code === "string" ? error.code : "invalid_response";
      return clientFailureText[code] || clientFailureText.invalid_response;
    }

    async function submitQuestion(question = inputValue()) {
      if (!agentMode || pending !== null) return false;
      const message = typeof question === "string" ? question.trim() : "";
      if (!message) {
        elements.chatStatus.textContent = "Enter a question before sending.";
        focusInput();
        return false;
      }
      if (message.length > maximumMessageCharacters) {
        elements.chatStatus.textContent = "The question exceeds the 1000-character limit.";
        focusInput();
        return false;
      }
      if (!client || typeof client.queryAssistant !== "function") {
        elements.chatStatus.textContent = clientFailureText.backend_unavailable;
        return false;
      }

      generation += 1;
      const request = {
        generation,
        controller: new global.AbortController(),
        sectionId: context.sectionId,
        activeMetric: context.activeMetric,
        message
      };
      const requestBody = { message };
      if (request.sectionId) requestBody.selected_section_id = `CS_${request.sectionId}`;
      if (request.activeMetric) requestBody.active_metric = request.activeMetric;
      if (history.length > 0) {
        requestBody.history = history.slice(-maximumHistoryMessages).map(item => ({
          role: item.role,
          content: item.content
        }));
      }
      pending = request;
      appendUserMessage(message);
      elements.input.value = "";
      elements.chatStatus.textContent = "Local Qwen is working…";
      setLoading(true);

      try {
        const response = await client.queryAssistant(requestBody, {
          signal: request.controller.signal
        });
        if (!requestIsCurrent(request)) return false;
        pending = null;
        renderAssistantResponse(response);
        boundedHistoryWith(message, response.answer);
        elements.chatStatus.textContent = completionStatusText[response.status]
          || "Local assistant response ready.";
        setLoading(false);
        focusInput();
        return true;
      } catch (error) {
        if (!requestIsCurrent(request)) return false;
        pending = null;
        appendNotice(failureText(error));
        elements.chatStatus.textContent = failureText(error);
        setLoading(false);
        focusInput();
        return false;
      }
    }

    function cancel() {
      if (!abortPending()) return false;
      appendNotice("Local Qwen request cancelled. No assistant result was added to history.");
      elements.chatStatus.textContent = "Local Qwen request cancelled.";
      focusInput();
      return true;
    }

    function configureMode() {
      elements.agentRegion.hidden = !agentMode;
      elements.agentRegion.setAttribute("aria-hidden", agentMode ? "false" : "true");
      elements.composer.hidden = !agentMode;
      elements.composer.setAttribute("aria-hidden", agentMode ? "false" : "true");
      elements.input.disabled = !agentMode;
      elements.send.disabled = true;
      elements.cancel.hidden = true;
      elements.cancel.disabled = true;
      if (agentMode) {
        elements.disclaimer.textContent = "Local Qwen explains evidence returned by reviewed deterministic tools. This local-only assistant is experimental and does not provide causal, predictive, or investment advice.";
        elements.interactionNote.textContent = "The three fixed actions above remain deterministic. Free-form questions below use the local Qwen assistant endpoint.";
        elements.chatStatus.textContent = "Ready for a local question.";
      } else {
        elements.disclaimer.textContent = "Deterministic local templates and reviewed read-only backend tools only. No language model is connected in this mode.";
        elements.interactionNote.textContent = "Fixed reviewed actions only; free-form input is not available in this mode.";
      }
      setLoading(false);
    }

    elements.input.addEventListener("input", updateCharacterCount);
    elements.input.addEventListener("keydown", event => {
      if (
        event.key !== "Enter"
        || event.shiftKey
        || event.isComposing
      ) {
        return;
      }
      event.preventDefault();
      submitQuestion();
    });
    elements.send.addEventListener("click", () => submitQuestion());
    elements.cancel.addEventListener("click", cancel);
    suggestionButtons.forEach(button => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        const question = button.getAttribute("data-assistant-question");
        elements.input.value = question || "";
        updateCharacterCount();
        submitQuestion(question);
      });
    });
    configureMode();
    updateCharacterCount();
    updateSuggestions();

    return Object.freeze({
      setContext,
      submitQuestion,
      cancel,
      getState() {
        return Object.freeze({
          mode: runtime.effective_mode,
          agentMode,
          pending: pending !== null,
          selectedSectionId: context.sectionId,
          activeMetric: context.activeMetric,
          historyLength: history.length,
          generation
        });
      }
    });
  }

  Object.defineProperty(global, namespaceName, {
    value: Object.freeze({
      createController,
      maximumMessageCharacters,
      maximumHistoryMessages
    }),
    enumerable: false,
    configurable: false,
    writable: false
  });
})(window);
