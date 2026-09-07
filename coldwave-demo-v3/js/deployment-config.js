(function initializeV3DeploymentConfiguration(global) {
  "use strict";

  const namespaceName = "SPTCV3Deployment";
  if (Object.prototype.hasOwnProperty.call(global, namespaceName)) {
    throw new Error("The V3 deployment configuration is already defined.");
  }

  // Deployment-owned configuration. IT may replace this small file with the
  // same-origin target; application source and URL query parameters stay fixed.
  const configuration = Object.freeze({
    backend_target: "local-loopback"
  });

  Object.defineProperty(global, namespaceName, {
    value: configuration,
    enumerable: false,
    configurable: false,
    writable: false
  });
})(window);
