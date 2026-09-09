"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
let checks = 0;
function check(condition) { assert.ok(condition); checks++; }

class Element {
  constructor(id = "") {
    this.id = id;
    this.listeners = {};
    this.attributes = {};
    this.children = [];
    this.properties = {};
    this.style = { setProperty: (key, value) => { this.properties[key] = value; },
      removeProperty: key => { delete this.properties[key]; } };
    this.isConnected = true;
    this.open = false;
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(key, fn) { (this.listeners[key] ||= []).push(fn); }
  dispatch(key, values = {}) {
    const event = { button: 0, preventDefault() {}, stopPropagation() {}, ...values };
    for (const listener of this.listeners[key] || []) listener(event);
  }
  focus() { this.focused = true; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
  getBoundingClientRect() {
    return { width: parseFloat(this.properties["--assistant-width"] || "700"),
      height: parseFloat(this.properties["--assistant-height"] || "702") };
  }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch("close"); }
}

function environment() {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  }, createElement: () => new Element() };
  const resizeEvents = [];
  const window = { document, innerWidth: 1440, innerHeight: 900, AbortController,
    addEventListener: (name, fn) => { if (name === "resize") resizeEvents.push(fn); } };
  const context = vm.createContext({window});
  for (const file of ["assistant-window.js", "ranking-browser.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  }
  return { window, document, resizeEvents };
}

async function main() {
  const { window, document, resizeEvents } = environment();
  window.SPTCAssistantWindow.createController({document});
  const panel = document.getElementById("assistantPanel");
  const handle = document.getElementById("assistantResizeHandle");
  check(panel.getBoundingClientRect().width === 700);
  check(panel.getBoundingClientRect().height === 702);
  handle.dispatch("pointerdown", {pointerId: 2, clientX: 200, clientY: 200});
  handle.dispatch("pointermove", {pointerId: 3, clientX: 100, clientY: 100});
  check(panel.getBoundingClientRect().width === 700); // Other pointer cannot steal resize.
  handle.dispatch("pointermove", {pointerId: 2, clientX: 100, clientY: 150});
  check(panel.getBoundingClientRect().width === 800 && panel.getBoundingClientRect().height === 752);
  handle.dispatch("pointerup");
  for (let i = 0; i < 100; i++) {
    handle.dispatch("keydown", {key: "ArrowRight"});
    handle.dispatch("keydown", {key: "ArrowDown"});
  }
  check(panel.getBoundingClientRect().width === 480 && panel.getBoundingClientRect().height === 420);
  for (let i = 0; i < 100; i++) {
    handle.dispatch("keydown", {key: "ArrowLeft"});
    handle.dispatch("keydown", {key: "ArrowUp"});
  }
  check(panel.getBoundingClientRect().width <= 1440 * .92 && panel.getBoundingClientRect().height <= 810);
  window.innerWidth = 390;
  resizeEvents.forEach(fn => fn());
  handle.dispatch("keydown", {key: "ArrowLeft"});
  check(handle.hidden && handle.disabled && !("--assistant-width" in panel.properties));
  window.innerWidth = 1024;
  resizeEvents.forEach(fn => fn());
  check(!handle.hidden && panel.getBoundingClientRect().width <= 1024 * .92);

  const calls = [];
  const waits = [];
  const client = { getRankedSectionsPage(request, options) {
    calls.push({request, options});
    return new Promise((resolve, reject) => waits.push({resolve, reject}));
  } };
  const browser = window.SPTCRankingBrowser.createController({document, client});
  const trigger = new Element("trigger");
  const result = {metric: {metric: "tier3_observed_resilience", display_name: "Tier 3",
    higher_value_interpretation: "more favorable"}, direction: "descending", county: null};
  const dialog = document.getElementById("rankingDialog");
  const body = document.getElementById("rankingRows");
  function resolve(offset, count = 25) {
    waits.shift().resolve({total_count: 3473, page_size: 25, offset,
      rows: Array.from({length: count}, (_, i) => ({metric_rank: offset + i + 1,
        section_id: "CS_" + (offset + i + 1), route: "<img onerror=alert(1)>", county: "Dallas",
        value: .5, detection_status: "detected"}))});
  }
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  check(calls.length === 0);
  browser.open(result, trigger);
  check(calls.length === 1 && dialog.open && calls[0].request.page_size === 25);
  resolve(0);
  await settle();
  check(body.children.length === 25 && document.getElementById("rankingRange").textContent === "Showing 1–25 of 3,473");
  check(body.children[0].children[2].textContent === "<img onerror=alert(1)>"); // Inert text, no HTML.
  document.getElementById("rankingNext").dispatch("click");
  check(calls.at(-1).request.offset === 25);
  resolve(25);
  await settle();
  document.getElementById("rankingLast").dispatch("click");
  check(calls.at(-1).request.offset === 3450);
  resolve(3450, 23);
  await settle();
  check(body.children.length === 23 && document.getElementById("rankingNext").disabled);
  document.getElementById("rankingFirst").dispatch("click");
  document.getElementById("rankingClose").dispatch("click");
  check(calls.at(-1).options.signal.aborted && !dialog.open && trigger.focused);
  resolve(0);
  await settle();
  check(body.children.length === 0); // Late closed-page result is ignored.
  browser.open(result, trigger);
  resolve(0);
  await settle();
  document.getElementById("rankingNext").dispatch("click");
  waits.shift().reject(new Error("private error must not render"));
  await settle();
  check(!document.getElementById("rankingRange").textContent.includes("private"));
  dialog.dispatch("cancel");
  check(!dialog.open);
  console.log(`${checks} Phase 4C resize/ranking controller checks passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
