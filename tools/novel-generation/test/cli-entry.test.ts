import assert from "node:assert/strict";
import test from "node:test";
import { buildCliEntryArgs } from "../src/server.js";

test("chapter CLI uses source runner in development and built entry in production", () => {
  assert.deepEqual(buildCliEntryArgs(["write"], false), ["--import", "tsx", "src/cli.ts", "write"]);
  assert.deepEqual(buildCliEntryArgs(["write", "--mode", "continuation"], true), ["dist/cli.js", "write", "--mode", "continuation"]);
});
