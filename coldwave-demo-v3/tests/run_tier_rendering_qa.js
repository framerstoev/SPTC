"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const v3Root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(v3Root, "js", "app.js"), "utf8");
const runTierRenderingTests = require("./tier-rendering-tests.js");

runTierRenderingTests({ appSource, vm })
  .then(result => {
    console.log(result);
  })
  .catch(error => {
    console.error(`FAILED: ${error && error.stack ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
