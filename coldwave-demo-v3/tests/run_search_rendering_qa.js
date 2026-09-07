"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const v3Root = path.resolve(__dirname, "..");
const appPath = path.join(v3Root, "js", "app.js");
const assistantActionsPath = path.join(v3Root, "js", "assistant-actions.js");
const appBytes = fs.readFileSync(appPath);
const assistantActionsBytes = fs.readFileSync(assistantActionsPath);
const runSearchRenderingTests = require("./search-rendering-tests.js");

runSearchRenderingTests({
  appSource: appBytes.toString("utf8"),
  assistantActionsSource: assistantActionsBytes.toString("utf8"),
  vm
})
  .then(result => {
    console.log(result);
  })
  .catch(error => {
    console.error(`FAILED: ${error && error.stack ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
