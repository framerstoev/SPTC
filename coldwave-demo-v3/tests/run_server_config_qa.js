"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(root, "js/assistant-config.js"), "utf8");
const server = { mode: "server", backend_target: "same-origin", base_path: "/trans-resilience" };
let checks = 0;
function run(url, config) {
  const location = new URL(url);
  let requests = 0;
  const window = { URL, URLSearchParams, location, SPTCV3Deployment: config,
    fetch() { requests++; throw new Error("Unexpected request"); } };
  vm.runInNewContext(code, { window });
  assert.equal(requests, 0); checks++;
  return window.SPTCAssistant.runtime;
}
for (const suffix of ["/", "/?assistantMode=backend-agent"]) {
  const runtime = run("https://sptc.geos.tamu.edu/trans-resilience" + suffix, server);
  assert.equal(runtime.effective_mode, "backend-agent");
  assert.equal(runtime.backend_base_url, "https://sptc.geos.tamu.edu/trans-resilience");
  assert.equal(runtime.assistant_profile, "v3"); checks += 3;
}
for (const url of ["http://sptc.geos.tamu.edu/trans-resilience/", "https://example.com/other/",
  "https://example.com/trans-resilience-evil/", "https://user@example.com/trans-resilience/"]) {
  const runtime = run(url, server);
  assert.equal(runtime.effective_mode, "local-template");
  assert.equal(runtime.backend_base_url, null); checks += 2;
}
for (const config of [{ ...server, base_path: "//evil" }, { ...server, backend_target: "local-loopback" },
  { ...server, extra: true }]) {
  assert.equal(run("https://example.com/trans-resilience/", config).backend_base_url, null); checks++;
}
for (const query of ["?backendUrl=http://evil", "?assistantMode=backend-agent&assistantMode=backend-tools"]) {
  assert.equal(run("https://example.com/trans-resilience/" + query, server).effective_mode, "local-template"); checks++;
}
assert.equal(run("http://127.0.0.1:8001/coldwave-demo-v3/", { backend_target: "local-loopback" }).effective_mode, "local-template"); checks++;
assert.equal(run("http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent", { backend_target: "local-loopback" }).backend_base_url, "http://127.0.0.1:8080"); checks++;
console.log(`${checks} server/local profile assertions passed; zero initialization requests`);
