"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const v2Root = path.resolve(__dirname, "..");
const sourcePaths = [
  path.join(v2Root, "js", "assistant-config.js"),
  path.join(v2Root, "js", "assistant-api.js"),
  path.join(v2Root, "js", "assistant-actions.js")
];
const expectUnavailable = process.argv.includes("--expect-unavailable");
const nativeFetch = globalThis.fetch;

if (typeof nativeFetch !== "function") {
  throw new Error("The selected JavaScript runtime does not provide fetch.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function includes(value, fragment, message) {
  assert(
    String(value).includes(fragment),
    message || `Expected ${JSON.stringify(value)} to include ${JSON.stringify(fragment)}`
  );
}

class FakeElement {
  constructor(tagName, id = null) {
    this.tagName = String(tagName).toUpperCase();
    this.id = id;
    this.className = "";
    this.children = [];
    this.parentNode = null;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.scrollTop = 0;
    this._textContent = "";
    this._attributes = new Map();
    this._listeners = new Map();
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = value === null || value === undefined ? "" : String(value);
    this.children = [];
  }

  get scrollHeight() {
    return this.children.length;
  }

  appendChild(child) {
    assert(child instanceof FakeElement, "Only fake DOM elements may be appended");
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach(child => {
      child.parentNode = null;
    });
    this.children = [];
    this._textContent = "";
    children.forEach(child => this.appendChild(child));
  }

  setAttribute(name, value) {
    const attributeName = String(name);
    const attributeValue = String(value);
    this._attributes.set(attributeName, attributeValue);
    if (attributeName === "id") this.id = attributeValue;
  }

  getAttribute(name) {
    return this._attributes.has(String(name))
      ? this._attributes.get(String(name))
      : null;
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) || [];
    listeners.push(listener);
    this._listeners.set(type, listeners);
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    for (const [id, tagName] of [
      ["assistantModeLabel", "span"],
      ["assistantStatus", "span"],
      ["assistantMessages", "div"],
      ["assistantActionAvailability", "p"],
      ["assistantReviewContainer", "div"],
      ["assistantExplainSection", "button"],
      ["assistantExplainMetric", "button"],
      ["assistantGenerateReviewNote", "button"]
    ]) {
      this.elements.set(id, new FakeElement(tagName, id));
    }
  }

  getElementById(id) {
    const element = this.elements.get(id);
    if (!element) throw new Error(`Unexpected Assistant DOM id: ${id}`);
    return element;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function descendants(root) {
  return root.children.flatMap(child => [child, ...descendants(child)]);
}

function byTag(root, tagName) {
  const canonicalTag = String(tagName).toUpperCase();
  return descendants(root).filter(element => element.tagName === canonicalTag);
}

function byAttribute(root, attributeName) {
  return descendants(root).filter(element => element.getAttribute(attributeName) !== null);
}

function byId(root, id) {
  return descendants(root).find(element => element.id === id) || null;
}

const fetchCalls = [];
globalThis.window = globalThis;
globalThis.location = {
  href: "http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-tools",
  search: "?assistantMode=backend-tools"
};
globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url: String(url), options });
  return nativeFetch(url, options);
};

for (const sourcePath of sourcePaths) {
  vm.runInThisContext(fs.readFileSync(sourcePath, "utf8"), { filename: sourcePath });
}

assert(fetchCalls.length === 0, "Production Assistant scripts issued a request during evaluation");
assert(
  globalThis.SPTCAssistant.runtime.effective_mode === "backend-tools",
  "Reviewed runtime did not activate backend-tools"
);

const document = new FakeDocument();
const controller = globalThis.SPTCAssistantActions.createController({
  document,
  clipboard: null
});
assert(fetchCalls.length === 0, "Controller creation issued an Assistant API request");

controller.setContext({
  sectionId: "1081",
  activeLayer: "q_min",
  localSectionText: "LIVE LOCAL SECTION FALLBACK",
  localMetricText: "LIVE LOCAL METRIC FALLBACK"
});
assert(fetchCalls.length === 0, "Context selection issued an Assistant API request");

async function runUnavailableProbe() {
  await controller.startAction("section");
  equal(fetchCalls.length, 1, "Unavailable probe did not issue exactly one explicit request");
  equal(controller.getState().requestState, "fallback_success");
  includes(document.getElementById("assistantStatus").textContent, "local fallback");
  includes(document.getElementById("assistantMessages").textContent, "LIVE LOCAL SECTION FALLBACK");
  console.log(
    "Live production-controller unavailable-backend QA passed: zero automatic requests and one explicit local fallback."
  );
}

async function runAvailableProbe() {
  await controller.startAction("section");
  equal(fetchCalls.length, 1, "Section action did not issue exactly one request");
  equal(fetchCalls[0].url, "http://127.0.0.1:8080/api/v1/sections/1081");
  equal(controller.getState().requestState, "backend_success");
  equal(controller.getState().currentAction, "section");
  const messages = document.getElementById("assistantMessages");
  includes(messages.textContent, "CS_1081");
  includes(messages.textContent, "METHOD_SCOPE");
  const observedCounts = byAttribute(messages, "data-observed-metric-count");
  const planningCounts = byAttribute(messages, "data-planning-metric-count");
  equal(observedCounts.length, 1);
  equal(planningCounts.length, 1);
  assert(Number(observedCounts[0].getAttribute("data-observed-metric-count")) <= 3);
  assert(Number(planningCounts[0].getAttribute("data-planning-metric-count")) <= 3);

  await controller.startAction("metric");
  equal(fetchCalls.length, 2, "Metric action did not add exactly one request");
  equal(fetchCalls[1].url, "http://127.0.0.1:8080/api/v1/metrics/q_min");
  equal(controller.getState().requestState, "backend_success");
  equal(controller.getState().currentAction, "metric");
  includes(messages.textContent, "Q");
  includes(messages.textContent, "dimensionless");
  includes(messages.textContent, "not an interpretation of the selected section");
  const limitationCounts = byAttribute(messages, "data-limitation-count");
  equal(limitationCounts.length, 1);
  assert(Number(limitationCounts[0].getAttribute("data-limitation-count")) <= 3);

  await controller.startAction("review");
  equal(fetchCalls.length, 3, "Review action did not add exactly one request");
  equal(fetchCalls[2].url, "http://127.0.0.1:8080/api/v1/reports/review-note");
  equal(controller.getState().requestState, "backend_success");
  equal(controller.getState().currentAction, "review");
  equal(document.getElementById("assistantStatus").textContent, "Draft for human review");
  includes(messages.textContent, "Draft for human review");
  includes(messages.textContent, "CS_1081");
  const reviewContainer = document.getElementById("assistantReviewContainer");
  const details = byTag(reviewContainer, "details");
  equal(details.length, 1);
  equal(details[0].open, false);
  equal(details[0].getAttribute("data-report-section-count"), "6");
  equal(byAttribute(reviewContainer, "data-report-section").length, 6);
  equal(
    byAttribute(reviewContainer, "data-review-list")
      .map(block => block.getAttribute("data-review-list"))
      .join(","),
    "warnings,limitations,human-review-checklist"
  );
  assert(byId(reviewContainer, "assistantCopyMarkdown"), "Copy control is missing");

  console.log(
    "Live production-controller QA passed: zero automatic requests; section, metric, and review actions each issued one validated request."
  );
}

(expectUnavailable ? runUnavailableProbe() : runAvailableProbe()).catch(error => {
  console.error(`FAILED: ${error && error.stack ? error.stack : String(error)}`);
  process.exitCode = 1;
});
