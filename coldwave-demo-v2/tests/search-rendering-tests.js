"use strict";

module.exports = async function runSearchRenderingTests({
  appSource,
  assistantActionsSource,
  assistantActionsSha256,
  vm
}) {
  const tests = [];

  function test(name, callback) {
    tests.push({ name, callback });
  }

  function assert(condition, message = "Assertion failed") {
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

  function excludes(value, fragment, message) {
    assert(
      !String(value).includes(fragment),
      message || `Expected ${JSON.stringify(value)} not to include ${JSON.stringify(fragment)}`
    );
  }

  function extractFunction(source, functionName) {
    const declaration = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
    const match = declaration.exec(source);
    if (!match) throw new Error(`Production function ${functionName} was not found`);
    const bodyStart = source.indexOf("{", match.index + match[0].length);
    if (bodyStart < 0) throw new Error(`Production function ${functionName} has no body`);

    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = bodyStart; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];

      if (lineComment) {
        if (character === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (character === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote !== null) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === "/" && next === "/") {
        lineComment = true;
        index += 1;
        continue;
      }
      if (character === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") depth += 1;
      if (character === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(match.index, index + 1);
      }
    }
    throw new Error(`Production function ${functionName} has an unterminated body`);
  }

  class FakeClassList {
    constructor(element) {
      this.element = element;
    }

    values() {
      return new Set(this.element.className.split(/\s+/).filter(Boolean));
    }

    write(values) {
      this.element.className = Array.from(values).join(" ");
    }

    add(...names) {
      const values = this.values();
      names.forEach(name => values.add(String(name)));
      this.write(values);
    }

    remove(...names) {
      const values = this.values();
      names.forEach(name => values.delete(String(name)));
      this.write(values);
    }

    contains(name) {
      return this.values().has(String(name));
    }
  }

  class FakeElement {
    constructor(tagName, id = null) {
      this.tagName = String(tagName).toUpperCase();
      this.id = id;
      this.className = "";
      this.classList = new FakeClassList(this);
      this.children = [];
      this.parentNode = null;
      this.dataset = Object.create(null);
      this.type = "";
      this.value = "";
      this.disabled = false;
      this.focused = false;
      this._textContent = "";
      this._attributes = new Map();
      this._listeners = new Map();
    }

    get textContent() {
      return this._textContent + this.children.map(child => child.textContent).join("");
    }

    set textContent(value) {
      this._textContent = value === null || value === undefined ? "" : String(value);
      this.children.forEach(child => {
        child.parentNode = null;
      });
      this.children = [];
    }

    get innerHTML() {
      throw new Error("Production search rendering attempted to read innerHTML");
    }

    set innerHTML(_value) {
      throw new Error("Production search rendering attempted to write innerHTML");
    }

    appendChild(child) {
      assert(child instanceof FakeElement, "Only inert fake DOM elements may be appended");
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    append(...children) {
      children.forEach(child => this.appendChild(child));
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
      this._attributes.set(String(name), String(value));
    }

    getAttribute(name) {
      return this._attributes.has(String(name))
        ? this._attributes.get(String(name))
        : null;
    }

    addEventListener(type, listener) {
      const eventType = String(type);
      const listeners = this._listeners.get(eventType) || [];
      listeners.push(listener);
      this._listeners.set(eventType, listeners);
    }

    dispatchEvent(event) {
      const dispatched = event || {};
      if (!dispatched.type) throw new Error("A fake DOM event requires a type");
      if (!dispatched.target) dispatched.target = this;
      if (!dispatched.preventDefault) {
        dispatched.preventDefault = () => {
          dispatched.defaultPrevented = true;
        };
      }
      let current = this;
      while (current) {
        dispatched.currentTarget = current;
        const listeners = current._listeners.get(dispatched.type) || [];
        listeners.forEach(listener => listener.call(current, dispatched));
        current = current.parentNode;
      }
      return !dispatched.defaultPrevented;
    }

    click() {
      if (this.disabled) return;
      this.dispatchEvent({ type: "click", target: this });
    }

    focus() {
      this.focused = true;
    }

    matches(selector) {
      if (!selector.startsWith(".")) return false;
      return this.classList.contains(selector.slice(1));
    }

    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches(selector)) return current;
        current = current.parentNode;
      }
      return null;
    }

    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const descendant = child.querySelector(selector);
        if (descendant) return descendant;
      }
      return null;
    }
  }

  class FakeDocument {
    constructor() {
      this.createdTags = [];
      this.elements = new Map([
        ["searchResults", new FakeElement("div", "searchResults")],
        ["csSearch", new FakeElement("input", "csSearch")],
        ["clearSearch", new FakeElement("button", "clearSearch")]
      ]);
    }

    getElementById(id) {
      const element = this.elements.get(id);
      if (!element) throw new Error(`Unexpected production search DOM id: ${id}`);
      return element;
    }

    createElement(tagName) {
      this.createdTags.push(String(tagName).toUpperCase());
      return new FakeElement(tagName);
    }
  }

  function descendants(root) {
    return root.children.flatMap(child => [child, ...descendants(child)]);
  }

  const renderSource = extractFunction(appSource, "renderSearchResults");
  const setupSource = extractFunction(appSource, "setupSearch");
  const statusLabelSource = extractFunction(appSource, "statusLabel");
  const dataDensityLabelSource = extractFunction(appSource, "dataDensityLabel");

  function createHarness() {
    const document = new FakeDocument();
    const sandbox = { document };
    vm.createContext(sandbox);
    vm.runInContext(`
      "use strict";
      let searchIndex = [];
      const selectionCalls = [];
      function selectByKey(key) { selectionCalls.push(key); }
      ${renderSource}
      ${setupSource}
      globalThis.__searchQa = Object.freeze({
        renderSearchResults,
        setupSearch,
        setSearchIndex(items) { searchIndex = items; },
        getSelectionCalls() { return selectionCalls.slice(); }
      });
    `, sandbox, { filename: "production-search-functions.js" });
    return {
      api: sandbox.__searchQa,
      document,
      input: document.getElementById("csSearch"),
      clear: document.getElementById("clearSearch"),
      results: document.getElementById("searchResults")
    };
  }

  function fixture(overrides = {}) {
    return {
      key: overrides.key || "1081",
      ctrlKey: overrides.ctrlKey || "CS_1081",
      route: overrides.route || "IH_35_",
      county: overrides.county || "Bell",
      status: overrides.status || "Detected phase pattern",
      haystack: overrides.haystack || "fixture"
    };
  }

  test("production search uses safe DOM construction and leaves the Assistant renderer unchanged", () => {
    equal(
      assistantActionsSha256,
      "e5684da9261b955374588c5f3a515b84a45b2f89b843ae9bbbbe1237f51cda4f",
      "assistant-actions.js differs from the accepted Phase 2A3 renderer"
    );
    excludes(renderSource, "innerHTML");
    excludes(renderSource, "outerHTML");
    excludes(renderSource, "insertAdjacentHTML");
    excludes(renderSource, "DOMParser");
    includes(renderSource, "document.createElement");
    includes(renderSource, "textContent");
    includes(renderSource, "replaceChildren");
    excludes(assistantActionsSource, "innerHTML");
    excludes(assistantActionsSource, "outerHTML");
    excludes(assistantActionsSource, "insertAdjacentHTML");
  });

  test("legacy HTML templates receive only closed status and data-density labels", () => {
    const sandbox = {
      detectionLabels: Object.freeze({
        detected: "Detected phase pattern",
        no_observed_support: "No observed NPMRDS support"
      })
    };
    vm.createContext(sandbox);
    vm.runInContext(`
      ${statusLabelSource}
      ${dataDensityLabelSource}
      globalThis.__labelQa = Object.freeze({ statusLabel, dataDensityLabel });
    `, sandbox, { filename: "production-closed-label-functions.js" });

    equal(sandbox.__labelQa.statusLabel("detected"), "Detected phase pattern");
    equal(sandbox.__labelQa.statusLabel("<img src=x onerror=alert(1)>"), "Unknown");
    equal(sandbox.__labelQa.statusLabel("constructor"), "Unknown");
    equal(sandbox.__labelQa.dataDensityLabel("A"), "A");
    equal(sandbox.__labelQa.dataDensityLabel("C"), "C");
    equal(sandbox.__labelQa.dataDensityLabel("<script>alert(1)</script>"), "N/A");
    equal(sandbox.__labelQa.dataDensityLabel("D"), "N/A");
  });

  test("hostile identity fixtures remain inert visible text with reviewed structure", () => {
    const longText = `LONG_${"r".repeat(512)}`;
    const fixtures = [
      fixture({ key: "1", route: "<script>alert(1)</script>" }),
      fixture({ key: "2", county: "<img src=x onerror=alert(1)>" }),
      fixture({ key: "3", ctrlKey: `CS_\"quoted\" and O'Brien` }),
      fixture({ key: "4", route: "FM_1 & US_2", county: "A & B" }),
      fixture({ key: "5", route: "<Route>", county: "County <North>" }),
      fixture({ key: "6", route: "<b>IH_35</b>", county: "<em>Bell County</em>" }),
      fixture({ key: "7", route: longText, county: longText }),
      fixture({
        key: `8\" onfocus=\"alert(1)`,
        route: "Route\tTabbed\nLine\u0001",
        county: "County\r\nControl\u0002"
      })
    ];
    const { api, document, results } = createHarness();
    api.setSearchIndex(fixtures);
    api.renderSearchResults("fixture");

    equal(results.children.length, fixtures.length);
    assert(results.classList.contains("visible"));
    results.children.forEach((button, index) => {
      const item = fixtures[index];
      equal(button.tagName, "BUTTON");
      equal(button.className, "search-result");
      equal(button.type, "button");
      equal(button.dataset.key, item.key);
      equal(button.children.length, 2);
      equal(button.children[0].tagName, "STRONG");
      equal(button.children[0].textContent, `${item.route} | ${item.ctrlKey}`);
      equal(button.children[1].tagName, "SPAN");
      equal(button.children[1].textContent, `${item.county} | ${item.status}`);
    });

    const renderedElements = descendants(results);
    assert(!document.createdTags.includes("SCRIPT"));
    assert(!document.createdTags.includes("IMG"));
    assert(!document.createdTags.includes("SVG"));
    assert(!renderedElements.some(element => ["SCRIPT", "IMG", "SVG"].includes(element.tagName)));
    assert(!renderedElements.some(element => (
      Array.from(element._attributes.keys()).some(name => /^on/i.test(name))
    )));
    assert(!renderedElements.some(element => (
      Object.keys(element).some(name => /^on/i.test(name))
    )));
  });

  test("matching preserves source order and the existing ten-result limit", () => {
    const items = Array.from({ length: 12 }, (_, index) => fixture({
      key: String(index + 1),
      ctrlKey: `CS_${index + 1}`,
      route: `ROUTE_${index + 1}`,
      haystack: "ordered fixture"
    }));
    const { api, results } = createHarness();
    api.setSearchIndex(items);
    api.renderSearchResults("ordered");
    equal(results.children.length, 10);
    equal(
      results.children.map(button => button.dataset.key).join(","),
      items.slice(0, 10).map(item => item.key).join(",")
    );
  });

  test("blank and no-match searches preserve clearing and empty-result behavior", () => {
    const { api, results } = createHarness();
    api.setSearchIndex([fixture()]);
    api.renderSearchResults("fixture");
    equal(results.children.length, 1);
    api.renderSearchResults("   ");
    equal(results.children.length, 0);
    assert(!results.classList.contains("visible"));

    api.renderSearchResults("not-present");
    assert(results.classList.contains("visible"));
    equal(results.children.length, 1);
    equal(results.children[0].tagName, "DIV");
    equal(results.children[0].className, "search-empty");
    equal(results.children[0].textContent, "No matching control section found.");
  });

  test("delegated nested-element clicks select the exact safe section key", () => {
    const item = fixture({
      key: `1081\" data-probe=\"value`,
      ctrlKey: `CS_1081 & \"review\"`,
      route: "IH_35 <North>"
    });
    const { api, input, results } = createHarness();
    api.setSearchIndex([item]);
    api.setupSearch();
    input.value = "fixture";
    input.dispatchEvent({ type: "input", target: input });
    const nestedIdentity = results.children[0].children[0];
    nestedIdentity.click();

    equal(api.getSelectionCalls().length, 1);
    equal(api.getSelectionCalls()[0], item.key);
    equal(input.value, `${item.ctrlKey} ${item.route}`);
    equal(results.children.length, 0);
    assert(!results.classList.contains("visible"));
  });

  test("Enter from the search input activates the first ordered result", () => {
    const items = [
      fixture({ key: "257", ctrlKey: "CS_257", route: "FIRST" }),
      fixture({ key: "3597", ctrlKey: "CS_3597", route: "SECOND" })
    ];
    const { api, input, results } = createHarness();
    api.setSearchIndex(items);
    api.setupSearch();
    input.value = "fixture";
    input.dispatchEvent({ type: "input", target: input });
    equal(results.children.length, 2);
    input.dispatchEvent({ type: "keydown", key: "Enter", target: input });

    equal(api.getSelectionCalls().length, 1);
    equal(api.getSelectionCalls()[0], "257");
    equal(input.value, "CS_257 FIRST");
  });

  test("non-Enter keys do not select and Clear restores focus and an empty list", () => {
    const { api, input, clear, results } = createHarness();
    api.setSearchIndex([fixture()]);
    api.setupSearch();
    input.value = "fixture";
    input.dispatchEvent({ type: "input", target: input });
    input.dispatchEvent({ type: "keydown", key: "Space", target: input });
    equal(api.getSelectionCalls().length, 0);
    equal(results.children.length, 1);

    clear.click();
    equal(input.value, "");
    equal(results.children.length, 0);
    assert(!results.classList.contains("visible"));
    assert(input.focused);
  });

  let passed = 0;
  for (const { name, callback } of tests) {
    try {
      await callback();
      passed += 1;
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  return `${passed} Phase 2A4 search rendering tests passed.`;
};
