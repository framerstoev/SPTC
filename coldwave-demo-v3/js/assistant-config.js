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
  const deploymentTargets = Object.freeze({
    localLoopback: "local-loopback",
    sameOrigin: "same-origin"
  });
  const backendToolsTimeoutMs = 8000;
  const backendAgentTimeoutMs = 80000;
  const runtimeOverrideParameters = new Set([
    "apikey", "apiurl", "assistantapikey", "assistantapiurl",
    "assistantbackendurl", "assistantmodel", "assistantollamaurl",
    "assistantprovider", "assistanttimeout", "backendendpoint",
    "backendhost", "backendport", "backendurl", "baseurl", "endpoint",
    "host", "model", "modelname", "ollamabaseurl", "ollamaurl", "port",
    "provider", "timeout"
  ]);

  function currentPageUrl() {
    try {
      return new global.URL(global.location.href);
    } catch {
      return null;
    }
  }

  function isReviewedLocalPage(pageUrl) {
    return pageUrl !== null
      && pageUrl.protocol === "http:"
      && (pageUrl.hostname === "127.0.0.1" || pageUrl.hostname === "localhost")
      && pageUrl.username === ""
      && pageUrl.password === "";
  }

  function resolveDeployment(pageUrl) {
    const supplied = global.SPTCV3Deployment;
    const keys = supplied && typeof supplied === "object"
      ? Object.keys(supplied)
      : [];
    if (
      !supplied
      || keys.length !== 1
      || keys[0] !== "backend_target"
      || !Object.values(deploymentTargets).includes(supplied.backend_target)
    ) {
      return { valid: false, backendTarget: null, backendBaseUrl: null };
    }
    if (supplied.backend_target === deploymentTargets.localLoopback) {
      return {
        valid: isReviewedLocalPage(pageUrl),
        backendTarget: supplied.backend_target,
        backendBaseUrl: "http://127.0.0.1:8080"
      };
    }
    const validSameOrigin = pageUrl !== null
      && pageUrl.protocol === "https:"
      && pageUrl.username === ""
      && pageUrl.password === "";
    return {
      valid: validSameOrigin,
      backendTarget: supplied.backend_target,
      backendBaseUrl: validSameOrigin ? pageUrl.origin : null
    };
  }

  function resolveMode(deployment) {
    let searchParams;
    let modeEntries;
    try {
      searchParams = new global.URLSearchParams(global.location.search || "");
      modeEntries = Array.from(searchParams.entries())
        .filter(([name]) => name.toLowerCase() === "assistantmode");
    } catch {
      return {
        requestedMode: "invalid",
        effectiveMode: modes.localTemplate,
        fallbackReason: "invalid_mode_parameter"
      };
    }

    if (Array.from(searchParams.keys()).some(name => (
      runtimeOverrideParameters.has(name.toLowerCase())
    ))) {
      return {
        requestedMode: "invalid",
        effectiveMode: modes.localTemplate,
        fallbackReason: "runtime_override_parameter"
      };
    }
    if (modeEntries.length === 0) {
      return {
        requestedMode: modes.localTemplate,
        effectiveMode: modes.localTemplate,
        fallbackReason: null
      };
    }
    if (modeEntries.length !== 1 || modeEntries[0][0] !== "assistantMode") {
      return {
        requestedMode: "invalid",
        effectiveMode: modes.localTemplate,
        fallbackReason: "invalid_mode_parameter"
      };
    }

    const requestedMode = modeEntries[0][1];
    if (requestedMode === modes.localTemplate) {
      return { requestedMode, effectiveMode: requestedMode, fallbackReason: null };
    }
    if (requestedMode !== modes.backendTools && requestedMode !== modes.backendAgent) {
      return {
        requestedMode: "invalid",
        effectiveMode: modes.localTemplate,
        fallbackReason: "invalid_mode"
      };
    }
    if (!deployment.valid) {
      return {
        requestedMode,
        effectiveMode: modes.localTemplate,
        fallbackReason: "backend_mode_requires_reviewed_deployment"
      };
    }
    return { requestedMode, effectiveMode: requestedMode, fallbackReason: null };
  }

  const pageUrl = currentPageUrl();
  const deployment = resolveDeployment(pageUrl);
  const resolvedMode = resolveMode(deployment);
  const runtime = Object.freeze({
    requested_mode: resolvedMode.requestedMode,
    effective_mode: resolvedMode.effectiveMode,
    assistant_profile: "v3",
    backend_target: deployment.backendTarget,
    backend_base_url: deployment.backendBaseUrl,
    timeout_ms: backendToolsTimeoutMs,
    agent_timeout_ms: backendAgentTimeoutMs,
    fallback_reason: resolvedMode.fallbackReason,
    backend_agent_enabled: resolvedMode.effectiveMode === modes.backendAgent
  });
  const namespace = Object.create(null);
  Object.defineProperties(namespace, {
    modes: { value: modes, enumerable: true },
    runtime: { value: runtime, enumerable: true }
  });
  Object.defineProperty(global, namespaceName, {
    value: namespace,
    enumerable: false,
    configurable: false,
    writable: false
  });
})(window);
