(function initializeServerDeployment(global) {
  "use strict";
  Object.defineProperty(global, "SPTCV3Deployment", {
    value: Object.freeze({
      mode: "server",
      backend_target: "same-origin",
      base_path: "/trans-resilience"
    }),
    writable: false,
    configurable: false
  });
})(window);
