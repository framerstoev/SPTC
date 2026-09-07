"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const v3Root = path.resolve(__dirname, "..");
const sourcePaths = {
  "../js/deployment-config.js": path.join(v3Root, "js", "deployment-config.js"),
  "../js/assistant-config.js": path.join(v3Root, "js", "assistant-config.js"),
  "../js/assistant-api.js": path.join(v3Root, "js", "assistant-api.js")
};
const sources = Object.fromEntries(
  Object.entries(sourcePaths).map(([requestPath, sourcePath]) => [
    requestPath,
    fs.readFileSync(sourcePath, "utf8")
  ])
);
const resultNode = { textContent: "Tests are running." };
const qaResourceRequests = [];

globalThis.window = globalThis;
globalThis.location = {
  href: "http://127.0.0.1:8001/coldwave-demo-v3/tests/assistant-client-tests.html"
    + "?assistantMode=backend-tools",
  search: "?assistantMode=backend-tools"
};
globalThis.document = {
  body: { dataset: { status: "pending" } },
  getElementById(id) {
    if (id !== "testResult") throw new Error(`Unexpected test DOM id: ${id}`);
    return resultNode;
  }
};
globalThis.fetch = async requestPath => {
  qaResourceRequests.push(String(requestPath));
  const source = sources[String(requestPath)];
  if (source === undefined) throw new Error(`Unexpected QA resource: ${requestPath}`);
  return { text: async () => source };
};

vm.runInThisContext(sources["../js/deployment-config.js"], {
  filename: sourcePaths["../js/deployment-config.js"]
});
vm.runInThisContext(sources["../js/assistant-config.js"], {
  filename: sourcePaths["../js/assistant-config.js"]
});
vm.runInThisContext(sources["../js/assistant-api.js"], {
  filename: sourcePaths["../js/assistant-api.js"]
});
if (qaResourceRequests.length !== 0) {
  throw new Error("Production assistant scripts issued a request during evaluation.");
}
vm.runInThisContext(
  fs.readFileSync(path.join(__dirname, "assistant-client-tests.js"), "utf8"),
  { filename: path.join(__dirname, "assistant-client-tests.js") }
);

const deadline = Date.now() + 30_000;
function reportWhenComplete() {
  const status = globalThis.document.body.dataset.status;
  if (status === "passed") {
    console.log(resultNode.textContent);
    return;
  }
  if (status === "failed") {
    console.error(resultNode.textContent);
    process.exitCode = 1;
    return;
  }
  if (Date.now() >= deadline) {
    console.error("FAILED: JavaScript contract tests did not finish within 30 seconds.");
    process.exitCode = 1;
    return;
  }
  setTimeout(reportWhenComplete, 10);
}

reportWhenComplete();
