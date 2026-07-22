"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const v2Root = path.resolve(__dirname, "..");
const nativeFetch = globalThis.fetch;
if (typeof nativeFetch !== "function") {
  throw new Error("The selected JavaScript runtime does not provide fetch.");
}

globalThis.window = globalThis;
globalThis.location = {
  href: "http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-tools",
  search: "?assistantMode=backend-tools"
};
globalThis.fetch = nativeFetch;

for (const relativePath of ["js/assistant-config.js", "js/assistant-api.js"]) {
  const sourcePath = path.join(v2Root, relativePath);
  vm.runInThisContext(fs.readFileSync(sourcePath, "utf8"), { filename: sourcePath });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async function runLiveClientQa() {
  const client = globalThis.SPTCAssistant.client;
  const expectedStatuses = {
    1081: "detected",
    257: "no_sustained_drop",
    3597: "recovery_endpoint_censored",
    1: "no_observed_support"
  };
  for (const [sectionId, expectedStatus] of Object.entries(expectedStatuses)) {
    const summary = await client.getSectionSummary(sectionId);
    assert(summary.support_status.detection_status === expectedStatus, sectionId);
    assert(Object.isFrozen(summary) && Object.isFrozen(summary.observed_metrics), sectionId);
  }

  for (const metricName of ["q_min", "event_rei"]) {
    const explanation = await client.explainMetric(metricName);
    assert(explanation.metric.name === metricName, metricName);
    assert(Object.isFrozen(explanation.metric), metricName);
  }

  const detectedNote = await client.generateSectionReviewNote("CS_1081");
  const noSupportNote = await client.generateSectionReviewNote("CS_1");
  for (const note of [detectedNote, noSupportNote]) {
    assert(note.sections.length === 6, "review-note section count");
    assert(note.evidence.length > 0 && note.evidence.length <= 64, "review-note evidence bound");
    assert(Object.isFrozen(note.evidence), "review-note output is mutable");
  }

  console.log(
    "Live deterministic client QA passed: four summaries, two metrics, and two review notes "
    + `(evidence counts ${detectedNote.evidence.length}/${noSupportNote.evidence.length}).`
  );
})().catch(error => {
  console.error(`FAILED: ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
});
