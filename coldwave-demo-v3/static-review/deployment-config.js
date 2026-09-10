(function configureStaticReview(global) {
  "use strict";
  Object.defineProperty(global, "SPTCV3Deployment", {
    value: Object.freeze({
      mode: "static-review",
      assistantEnabled: false,
      backendEnabled: false
    }),
    configurable: false,
    writable: false
  });
})(window);
