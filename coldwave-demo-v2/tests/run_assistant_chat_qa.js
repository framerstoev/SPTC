"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const v2Root = path.resolve(__dirname, "..");
const actionsPath = path.join(v2Root, "js", "assistant-actions.js");
const chatPath = path.join(v2Root, "js", "assistant-chat.js");
const actionsSource = fs.readFileSync(actionsPath, "utf8");
const chatSource = fs.readFileSync(chatPath, "utf8");

globalThis.window = globalThis;
globalThis.__assistantActionsSource = actionsSource;
globalThis.__assistantChatSource = chatSource;

vm.runInThisContext(actionsSource, { filename: actionsPath });
vm.runInThisContext(chatSource, { filename: chatPath });

const runAssistantChatTests = require("./assistant-chat-tests.js");

runAssistantChatTests()
  .then(result => {
    console.log(result);
  })
  .catch(error => {
    console.error(`FAILED: ${error && error.stack ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
