"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const v3Root = path.resolve(__dirname, "..");
const actionsPath = path.join(v3Root, "js", "assistant-actions.js");
const actionsSource = fs.readFileSync(actionsPath, "utf8");

globalThis.window = globalThis;
globalThis.__assistantActionsSource = actionsSource;

vm.runInThisContext(actionsSource, { filename: actionsPath });

const runAssistantActionsTests = require("./assistant-actions-tests.js");

runAssistantActionsTests()
  .then(result => {
    console.log(result);
  })
  .catch(error => {
    console.error(`FAILED: ${error && error.stack ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
