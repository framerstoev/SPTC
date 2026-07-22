(function initializeAssistantConfiguration(global) {
  "use strict";

  const namespaceName = "SPTCAssistant";
  if (Object.prototype.hasOwnProperty.call(global, namespaceName)) {
    throw new Error("The SPTC assistant namespace is already defined.");
  }

  const modes = Object.freeze({
    localTemplate: "local-template",
    backendTools: "backend-tools",
    backendAgent: "backend-agent"
  });
  const backendBaseUrl = "http://127.0.0.1:8080";
  const timeoutMs = 8000;

  function isReviewedLocalPage() {
    let pageUrl;
    try {
      pageUrl = new global.URL(global.location.href);
    } catch {
      return false;
    }
    return pageUrl.protocol === "http:"
      && (pageUrl.hostname === "127.0.0.1" || pageUrl.hostname === "localhost")
      && pageUrl.username === ""
      && pageUrl.password === "";
  }

  function resolveMode() {
    let modeEntries;
    try {
      const searchParams = new global.URLSearchParams(global.location.search || "");
      modeEntries = Array.from(searchParams.entries())
        .filter(([name]) => name.toLowerCase() === "assistantmode");
    } catch {
      return {
        requestedMode: "invalid",
        effectiveMode: modes.localTemplate,
        fallbackReason: "invalid_mode_parameter"
      };
    }

    if (modeEntries.length === 0) {
      return {
        requestedMode: modes.localTemplate,
        effectiveMode: modes.localTemplate,
        fallbackReason: null
      };
    }
    if (modeEntries.length !== 1) {
      return {
        requestedMode: "invalid",
        effectiveMode: modes.localTemplate,
        fallbackReason: "duplicate_mode_parameter"
      };
    }

    const [parameterName, requestedMode] = modeEntries[0];
    if (parameterName !== "assistantMode") {
      return {
        requestedMode: "invalid",
        effectiveMode: modes.localTemplate,
        fallbackReason: "invalid_mode_parameter"
      };
    }
    if (requestedMode === modes.localTemplate) {
      return {
        requestedMode,
        effectiveMode: modes.localTemplate,
        fallbackReason: null
      };
    }
    if (requestedMode === modes.backendAgent) {
      return {
        requestedMode,
        effectiveMode: modes.localTemplate,
        fallbackReason: "backend_agent_disabled"
      };
    }
    if (requestedMode !== modes.backendTools) {
      return {
        requestedMode: "invalid",
        effectiveMode: modes.localTemplate,
        fallbackReason: "invalid_mode"
      };
    }
    if (!isReviewedLocalPage()) {
      return {
        requestedMode,
        effectiveMode: modes.localTemplate,
        fallbackReason: "backend_tools_requires_local_http"
      };
    }
    return {
      requestedMode,
      effectiveMode: modes.backendTools,
      fallbackReason: null
    };
  }

  const resolvedMode = resolveMode();
  const runtime = Object.freeze({
    requested_mode: resolvedMode.requestedMode,
    effective_mode: resolvedMode.effectiveMode,
    backend_base_url: backendBaseUrl,
    timeout_ms: timeoutMs,
    fallback_reason: resolvedMode.fallbackReason,
    backend_agent_enabled: false
  });
  const namespace = Object.create(null);
  Object.defineProperties(namespace, {
    modes: {
      value: modes,
      enumerable: true
    },
    runtime: {
      value: runtime,
      enumerable: true
    }
  });
  Object.defineProperty(global, namespaceName, {
    value: namespace,
    enumerable: false,
    configurable: false,
    writable: false
  });
})(window);
