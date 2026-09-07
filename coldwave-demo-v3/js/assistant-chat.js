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
    clarification_required: "Clarification required.",
    unsupported_request: "Request outside the reviewed assistant scope.",
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

    function textElement(tagName, className, text) {
      const element = documentRef.createElement(tagName);
      if (className) element.className = className;
      element.textContent = safeDisplayText(text);
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
        return "AI-assisted response";
      }
      return "AI Assistant status";
    }

    function readableIdentifier(value) {
      return String(value || "").replaceAll("_", " ");
    }

    function appendDefinition(parent, label, value, field = null) {
      const row = documentRef.createElement("p");
      row.className = "assistant-chat-definition";
      if (field) row.setAttribute("data-field", field);
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
      const visibleEvidence = evidence.filter(record => record.metric_name !== "event_rei");
      if (visibleEvidence.length === 0) return;
      const details = expandableBlock(
        `Structured deterministic evidence (${visibleEvidence.length})`,
        "assistant-chat-details assistant-chat-evidence"
      );
      const list = documentRef.createElement("ul");
      visibleEvidence.forEach(record => {
        const item = documentRef.createElement("li");
        item.className = "assistant-chat-evidence-item";
        const displayValue = record.unit
          ? `${record.display_value} (${record.unit})`
          : record.display_value;
        appendDefinition(item, record.label, displayValue);
        if (record.section_id) appendDefinition(item, "Section", record.section_id);
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

    function formatStructuredValue(value, unit = null) {
      if (value === null || value === undefined) return "N/A";
      const rendered = typeof value === "number"
        ? value.toLocaleString(undefined, { maximumFractionDigits: 3 })
        : String(value);
      return unit ? `${rendered} ${unit}` : rendered;
    }

    function appendDistribution(parent, distribution) {
      const grid = documentRef.createElement("div");
      grid.className = "assistant-structured-stats";
      [
        ["Sections", distribution.population_count],
        ["Available", distribution.available_count],
        ["Missing", distribution.missing_count],
        ["Median", formatStructuredValue(distribution.median)]
      ].forEach(([label, value]) => {
        const item = documentRef.createElement("div");
        item.className = "assistant-structured-stat";
        item.appendChild(textElement("span", null, label));
        item.appendChild(textElement("strong", null, String(value)));
        grid.appendChild(item);
      });
      parent.appendChild(grid);
    }

    function appendSectionTable(parent, title, rows, metric) {
      const section = documentRef.createElement("section");
      section.className = "assistant-structured-section";
      section.appendChild(textElement("h4", null, title));
      if (rows.length === 0) {
        section.appendChild(textElement("p", "assistant-result-note", "No eligible sections were returned."));
        parent.appendChild(section);
        return;
      }
      const wrap = documentRef.createElement("div");
      wrap.className = "assistant-table-wrap";
      const table = documentRef.createElement("table");
      table.className = "assistant-structured-table";
      const head = documentRef.createElement("thead");
      const headRow = documentRef.createElement("tr");
      [
        ["Rank", "metric_rank"],
        ["Section", "section_id"],
        ["Route", "route"],
        ["County", "county"],
        [metric.display_name, "value"],
        ["Tier 3 observed support", "detection_status"]
      ].forEach(([label, field]) => {
        const heading = textElement("th", null, label);
        heading.setAttribute("data-field", field);
        headRow.appendChild(heading);
      });
      head.appendChild(headRow);
      table.appendChild(head);
      const body = documentRef.createElement("tbody");
      rows.forEach(row => {
        const tr = documentRef.createElement("tr");
        [
          [row.metric_rank, "metric_rank"],
          [row.section_id, "section_id"],
          [row.route, "route"],
          [row.county, "county"],
          [formatStructuredValue(row.value, metric.unit), "value"]
        ].forEach(([value, field]) => {
          const cell = textElement("td", null, String(value));
          cell.setAttribute("data-field", field);
          tr.appendChild(cell);
        });
        const statusCell = documentRef.createElement("td");
        statusCell.setAttribute("data-field", "detection_status");
        const statusBadge = textElement(
          "span",
          `assistant-section-status status-${row.detection_status}`,
          row.observed_support
            ? `${readableIdentifier(row.detection_status)}; observed support`
            : `${readableIdentifier(row.detection_status)}; support unavailable`
        );
        statusBadge.setAttribute("data-observed-support", String(row.observed_support));
        statusCell.appendChild(statusBadge);
        tr.appendChild(statusCell);
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);
      section.appendChild(wrap);
      parent.appendChild(section);
    }

    function appendRankingResult(message, result) {
      const card = documentRef.createElement("section");
      card.className = "assistant-structured-card ranking-result";
      card.setAttribute("data-structured-result", result.result_type);
      card.appendChild(textElement("h3", null, `${result.metric.display_name} section ranking`));
      appendDefinition(card, "Scope", result.county || "Statewide");
      appendDefinition(
        card,
        "Direction",
        result.direction === "descending" ? "Descending" : "Ascending",
        "direction"
      );
      appendDefinition(card, "Higher values", result.metric.higher_value_interpretation);
      appendDistribution(card, result.distribution);
      appendSectionTable(card, "Highest values", result.highest_sections, result.metric);
      appendSectionTable(card, "Lowest values", result.lowest_sections, result.metric);
      card.appendChild(textElement("p", "assistant-result-note", result.interpretation_limit));
      message.appendChild(card);
    }

    function appendCountyResult(message, result) {
      const card = documentRef.createElement("section");
      card.className = "assistant-structured-card county-result";
      card.setAttribute("data-structured-result", result.result_type);
      card.appendChild(textElement("h3", null, `${result.county} County evidence`));
      const summary = documentRef.createElement("div");
      summary.className = "assistant-structured-stats";
      [
        ["Sections", result.total_sections, "total_sections"],
        ["Observed support", `${result.observed_support_count} (${formatStructuredValue(result.observed_support_percent, "%")})`, "observed_support_count"],
        ["Detected", result.status_counts.detected, "status_counts.detected"],
        ["No sustained drop", result.status_counts.no_sustained_drop, "status_counts.no_sustained_drop"],
        ["Recovery censored", result.status_counts.recovery_endpoint_censored, "status_counts.recovery_endpoint_censored"],
        ["No observed support", result.status_counts.no_observed_support, "status_counts.no_observed_support"]
      ].forEach(([label, value, field]) => {
        const item = documentRef.createElement("div");
        item.className = "assistant-structured-stat";
        item.setAttribute("data-field", field);
        item.appendChild(textElement("span", null, label));
        item.appendChild(textElement("strong", null, String(value)));
        summary.appendChild(item);
      });
      card.appendChild(summary);
      const metricTable = documentRef.createElement("div");
      metricTable.className = "assistant-table-wrap";
      const table = documentRef.createElement("table");
      table.className = "assistant-structured-table metric-summary-table";
      const head = documentRef.createElement("thead");
      const headRow = documentRef.createElement("tr");
      ["Metric", "Available", "Median", "Range"].forEach(label => {
        headRow.appendChild(textElement("th", null, label));
      });
      head.appendChild(headRow);
      table.appendChild(head);
      const body = documentRef.createElement("tbody");
      result.metric_summaries.forEach(summaryItem => {
        const tr = documentRef.createElement("tr");
        const distribution = summaryItem.distribution;
        [
          summaryItem.metric.display_name,
          distribution.available_count,
          formatStructuredValue(distribution.median, summaryItem.metric.unit),
          distribution.minimum === null
            ? "N/A"
            : `${formatStructuredValue(distribution.minimum)}–${formatStructuredValue(distribution.maximum)}`
        ].forEach(value => tr.appendChild(textElement("td", null, String(value))));
        body.appendChild(tr);
      });
      table.appendChild(body);
      metricTable.appendChild(table);
      card.appendChild(metricTable);
      const observedMetric = result.metric_summaries[3].metric;
      appendSectionTable(card, "Representative high observed values", result.representative_high_observed, observedMetric);
      appendSectionTable(card, "Representative low observed values", result.representative_low_observed, observedMetric);
      card.appendChild(textElement("p", "assistant-result-note", result.coverage_caveat));
      message.appendChild(card);
    }

    function appendAlignmentResult(message, result) {
      const card = documentRef.createElement("section");
      card.className = "assistant-structured-card alignment-result";
      card.setAttribute("data-structured-result", result.result_type);
      card.appendChild(textElement("h3", null, "Potential and observed alignment"));
      appendDefinition(
        card,
        "Metrics",
        `${result.potential_metric.display_name} and ${result.observed_metric.display_name}`
      );
      appendDefinition(
        card,
        "Classification status",
        readableIdentifier(result.classification_status),
        "classification_status"
      );
      appendDefinition(card, "Consistent count", "Not defined", "consistent_count");
      appendDefinition(card, "Mismatch count", "Not defined", "mismatch_count");
      appendDefinition(
        card,
        "Representative examples",
        "Not defined",
        "representative_examples"
      );
      const distribution = {
        population_count: result.statewide_section_count,
        available_count: result.valid_pair_count,
        missing_count: result.missing_pair_count_within_common_support,
        median: result.pearson_r
      };
      const grid = documentRef.createElement("div");
      grid.className = "assistant-structured-stats";
      [
        ["Statewide sections", distribution.population_count, "statewide_section_count"],
        ["Common support", result.common_support_count, "common_support_count"],
        ["Valid pairs", distribution.available_count, "valid_pair_count"],
        ["Missing pairs", distribution.missing_count, "missing_pair_count_within_common_support"],
        ["Excluded: no support", result.excluded_no_support_count, "excluded_no_support_count"],
        ["Pearson r", formatStructuredValue(result.pearson_r), "pearson_r"],
        ["Spearman rho", formatStructuredValue(result.spearman_rho), "spearman_rho"]
      ].forEach(([label, value, field]) => {
        const item = documentRef.createElement("div");
        item.className = "assistant-structured-stat";
        item.setAttribute("data-field", field);
        item.appendChild(textElement("span", null, label));
        item.appendChild(textElement("strong", null, String(value)));
        grid.appendChild(item);
      });
      card.appendChild(grid);
      card.appendChild(textElement(
        "p",
        "assistant-result-note caution",
        "Consistent and mismatch categories are not shown because their method definition is unresolved."
      ));
      card.appendChild(textElement("p", "assistant-result-note", result.method_note));
      message.appendChild(card);
    }

    function appendStructuredResult(message, result) {
      if (!result) return;
      if (result.result_type === "section_ranking") appendRankingResult(message, result);
      if (result.result_type === "county_resilience_summary") appendCountyResult(message, result);
      if (result.result_type === "tier_alignment_summary") appendAlignmentResult(message, result);
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
      message.appendChild(textElement(
        "p",
        "assistant-chat-source",
        responseSourceLabel(response.status)
      ));
      if (response.status !== "completed") {
        message.appendChild(textElement(
          "p",
          "assistant-chat-response-status",
          `Status: ${responseStatusLabels[response.status] || "Unavailable"}`
        ));
      }
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
      appendStructuredResult(message, response.structured_result);
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
