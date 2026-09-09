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
    model_unavailable: "AI unavailable",
    tool_error: "Tool error",
    invalid_model_response: "Response rejected"
  });
  const completionStatusText = Object.freeze({
    completed: "",
    clarification_required: "",
    unsupported_request: "",
    assistant_disabled: "AI Assistant unavailable.",
    model_unavailable: "AI Assistant unavailable.",
    tool_error: "The deterministic tool could not complete.",
    invalid_model_response: "The AI response was not safely accepted."
  });
  const clientFailureText = Object.freeze({
    invalid_request: "The question could not be sent because the request was invalid.",
    backend_unavailable: "AI Assistant unavailable. Verified quick actions remain available.",
    request_timeout: "The AI request did not complete. Verified quick actions remain available.",
    request_cancelled: "The AI request was cancelled.",
    backend_validation_error: "The review service rejected the bounded request.",
    invalid_json: "The AI Assistant returned an unreadable response.",
    invalid_response: "The AI response did not pass frontend validation.",
    unexpected_status: "The AI Assistant returned an unexpected status."
  });
  const fallbackDisplayText = value => String(value ?? "")
    .replace(/observed[ _-]+curve[ _-]+resilience[ _-]+score[ _-]+v0/gi, "Tier 3 observed resilience score")
    .replace(/\bscore[ _-]?v0\b/gi, "Tier 3 score")
    .replace(/\bnetrisk[ _-]?lite\b/gi, "NETWORK_REI")
    .replace(/\btier[ _-]?2[ _-]?lite\b/gi, "Tier 2")
    .replace(/\bevent[ _-]?rei\b/gi, "combined potential context")
    .replace(/\bq_min\b/gi, "Minimum");
  const safeDisplayText = global.SPTCAssistantActions?.safeDisplayText || fallbackDisplayText;

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
      chatMessages: documentRef.getElementById("assistantMessages"),
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
    const resetTimelineOnContextChange = options.resetTimelineOnContextChange !== false;
    const showContextResetNotice = options.showContextResetNotice !== false;
    let context = {
      sectionId: null,
      activeLayer: null,
      activeAnalysisLayer: null,
      activeMetric: null
    };
    let contextInitialized = false;
    let generation = 0;
    let pending = null;
    let history = [];

    function textElement(tagName, className, text, preserveTechnicalNames = false) {
      const element = documentRef.createElement(tagName);
      if (className) element.className = className;
      element.textContent = preserveTechnicalNames ? String(text ?? "") : safeDisplayText(text);
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

    function formatStructuredValue(value) {
      if (value === null || value === undefined) return "unavailable";
      return typeof value === "number"
        ? value.toLocaleString("en-US", { maximumFractionDigits: 3 })
        : String(value);
    }

    function sectionLines(title, rows) {
      if (!rows.length) return title + ": no eligible sections returned.";
      return title + ":\n" + rows.map(row =>
        `${row.metric_rank}. ${row.section_id} · ${row.route} · ${row.county}: ${formatStructuredValue(row.value)} (${row.detection_status.replaceAll("_", " ")}).`
      ).join("\n");
    }

    // Only presentation of the client's closed, validated result projection.
    // Do not rank, aggregate, classify, or calculate analytical values here.
    function countyLine(row) {
      return `${row.county_rank === null ? "Unranked" : row.county_rank}. ${row.county} County: median ${formatStructuredValue(row.median)}; ${row.available_count} of ${row.total_sections} roads have this score (${formatStructuredValue(row.coverage_percent)}%).`;
    }

    function structuredAnswer(result, interpretation = "") {
      if (!result) return "";
      if (result.result_type === "section_ranking") {
        return [
          interpretation,
          `${formatStructuredValue(result.distribution.available_count)} roads have the data needed for this ${result.metric.display_name} ranking. Showing the highest ${result.highest_sections.length} and lowest ${result.lowest_sections.length} below.`,
          result.metric.higher_value_interpretation,
          sectionLines("Highest values", result.highest_sections),
          sectionLines("Lowest values", result.lowest_sections)
        ].filter(Boolean).join("\n\n");
      }
      if (result.result_type === "county_ranking") {
        const target = result.rows.find(row => row.county === result.county);
        return [
          interpretation,
          `Texas counties ranked by ${result.metric.display_name}; ${result.available_counties} counties have this score. ${result.plain_language_direction}`,
          target ? countyLine(target) : result.rows.filter(row => row.median !== null).slice(0, 10).map(countyLine).join("\n"),
          "Each county is represented by the middle score of its roads with data. Check the number of roads and coverage before interpreting a county's position; even counties with very few observations are included."
        ].filter(Boolean).join("\n\n");
      }
      if (result.result_type === "county_resilience_summary") {
        return [
          interpretation,
          `${result.county} County has ${formatStructuredValue(result.total_sections)} roads (control sections); ${formatStructuredValue(result.observed_support_count)} have traffic observations.`,
          ...result.metric_summaries.filter(item => ["potential_resilience", "tier3_observed_resilience"].includes(item.metric.metric)).map(item =>
            `${item.metric.display_name}: the middle score is ${formatStructuredValue(item.distribution.median)}, ${item.median_relative_to_statewide} the middle score among Texas roads with this metric. County position: ${formatStructuredValue(item.county_rank)} among ${formatStructuredValue(item.counties_available)} counties, ordered from higher to lower scores. ${item.distribution.available_count} roads have this score.`),
          "Next, review the weather and network information and compare individual traffic curves. Detailed distributions and examples are available below."
        ].filter(Boolean).join("\n\n");
      }
      if (result.result_type === "tier_alignment_summary") {
        return [
          interpretation,
          `This comparison uses ${formatStructuredValue(result.valid_pair_count)} roads where we have both the planning score and the real traffic score. The numerical association results and sample details are available below.`
        ].filter(Boolean).join("\n\n");
      }
      if (result.result_type === "section_resilience_comparison") {
        return [
          interpretation,
          `${result.identity.display_cs_id} · ${result.identity.route} · ${result.identity.county} County`,
          ...[result.potential, result.observed].map(item =>
            item.value === null ? `${item.metric.display_name}: unavailable.`
              : `${item.metric.display_name}: ${formatStructuredValue(item.value)}. Higher than about ${formatStructuredValue(item.higher_than_percent)}% of the same ${formatStructuredValue(result.paired_sample_reference.valid_pair_count)} roads where both planning and traffic scores exist.`),
          "The two scores describe different things; their raw values are not subtracted. Review Tier 1 weather conditions, Tier 2 network alternatives, and Q(t), the traffic-speed curve, to investigate the contrast."
        ].filter(Boolean).join("\n\n");
      }
      return "";
    }

    function displayedAnswer(response) {
      const reviewedStatusText = {
        assistant_disabled: "AI Assistant is unavailable. Verified quick actions remain available.",
        model_unavailable: "AI Assistant is unavailable. Verified quick actions remain available.",
        tool_error: "The deterministic tool could not complete the request. No raw error was displayed.",
        invalid_model_response: "The AI response could not be safely accepted. Rejected response text was not displayed."
      };
      return reviewedStatusText[response.status] || response.answer;
    }

    function renderAssistantResponse(response) {
      const message = documentRef.createElement("article");
      message.className = `assistant-chat-message assistant status-${response.status}`;
      message.setAttribute("data-chat-role", "assistant");
      message.setAttribute("data-result-kind", "ai-assisted");
      message.setAttribute("data-assistant-status", response.status);
      const answer = response.status === "clarification_required" && response.clarification
        ? response.clarification.question : displayedAnswer(response);
      const projection = response.status === "completed" ? structuredAnswer(response.structured_result, answer) : "";
      message.appendChild(textElement(
        "p", "assistant-chat-answer", projection || answer,
        response.status === "completed" && response.tools_used?.some(item => item.tool_name === "explain_project_concept")
      ));
      if (response.status === "completed" && response.structured_result?.result_type === "section_ranking"
        && typeof options.openRanking === "function") {
        const button = textElement("button", "assistant-full-ranking",
          `View full ranking (${formatStructuredValue(response.structured_result.distribution.available_count)})`);
        button.type = "button";
        button.addEventListener("click", () => options.openRanking(response.structured_result, button));
        message.appendChild(button);
      }
      if (response.status === "completed" && response.structured_result) {
        const details = documentRef.createElement("details");
        details.appendChild(textElement("summary", "", response.structured_result.result_type === "county_ranking"
          ? "View all counties and technical details" : "Evidence and technical details"));
        if (response.structured_result.result_type === "county_ranking") {
          details.appendChild(textElement("p", "assistant-chat-answer",
            response.structured_result.rows.map(countyLine).join("\n")));
        }
        details.appendChild(textElement("p", "assistant-chat-answer", JSON.stringify({
          evidence: response.structured_result, warnings: response.warnings,
          limitations: response.limitations, tools_used: response.tools_used
        }, null, 2), true));
        message.appendChild(details);
      }
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
      elements.chatMessages.setAttribute("data-chat-busy", loading ? "true" : "false");
      elements.chatMessages.setAttribute(
        "aria-busy",
        loading || elements.chatMessages.getAttribute("data-action-busy") === "true"
          ? "true"
          : "false"
      );
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
      const activeAnalysisLayer = ["tier1", "tier2", "potential", "tier3"].includes(
        nextContext?.activeTier
      )
        ? nextContext.activeTier
        : ["tier1", "tier2", "potential", "tier3"].includes(activeLayer)
          ? activeLayer
          : null;
      const activeMetric = activeLayer
        && Object.prototype.hasOwnProperty.call(activeLayerMetrics, activeLayer)
        ? activeLayerMetrics[activeLayer]
        : null;
      return { sectionId, activeLayer, activeAnalysisLayer, activeMetric };
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
      const tierChanged = normalized.activeAnalysisLayer !== context.activeAnalysisLayer;
      const changed = sectionChanged || metricChanged || tierChanged;
      if (changed) abortPending();
      context = normalized;
      if (changed) {
        generation += 1;
        history = [];
        elements.input.value = "";
        elements.chatStatus.textContent = "";
        if (resetTimelineOnContextChange) {
          elements.chatMessages.replaceChildren();
        }
        if (contextInitialized && agentMode && showContextResetNotice) {
          appendNotice(contextResetText(sectionChanged, metricChanged));
          elements.chatStatus.textContent = "Context reset.";
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
        && context.activeMetric === request.activeMetric
        && context.activeAnalysisLayer === request.activeAnalysisLayer;
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
        activeAnalysisLayer: context.activeAnalysisLayer,
        message
      };
      const requestBody = { message };
      if (request.sectionId) requestBody.selected_section_id = `CS_${request.sectionId}`;
      if (request.activeMetric) requestBody.active_metric = request.activeMetric;
      if (request.activeAnalysisLayer) {
        requestBody.active_analysis_layer = request.activeAnalysisLayer;
      }
      if (history.length > 0) {
        requestBody.history = history.slice(-maximumHistoryMessages).map(item => ({
          role: item.role,
          content: item.content
        }));
      }
      pending = request;
      appendUserMessage(message);
      elements.input.value = "";
      elements.chatStatus.textContent = "AI is working…";
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
          || "";
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
      appendNotice("AI request cancelled. No result was added to history.");
      elements.chatStatus.textContent = "AI request cancelled.";
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
        elements.disclaimer.textContent = "Ask about the selected roadway section and resilience evidence.";
        elements.interactionNote.textContent = "Verified quick actions and AI-assisted responses remain distinct.";
        elements.chatStatus.textContent = "";
      } else {
        elements.disclaimer.textContent = "Use quick actions to review the selected roadway section and current metric.";
        elements.interactionNote.textContent = "Free-form questions are unavailable in this review mode.";
        elements.chatStatus.textContent = "";
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
          activeAnalysisLayer: context.activeAnalysisLayer,
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
