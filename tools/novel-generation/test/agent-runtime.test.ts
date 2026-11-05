import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  parseCredits, decodeProductConfig, expandModelAlias, resolveAgentModel,
  buildQueryOptions, MODEL_PREFERENCE, type CatalogModel
} from "../src/agent-runtime.js";

const catalog: CatalogModel[] = [
  { id: "hy4std", credits: 0.29 },
  { id: "hy4free", credits: 0 },
  { id: "deepseek-v4.1-flash", credits: 0.11 },
  { id: "hy3", credits: 0 }
];

function withoutModelEnv<T>(fn: () => T): T {
  const a = process.env.NOVEL_AGENT_MODEL;
  const b = process.env.CODEBUDDY_DEFAULT_MODEL;
  delete process.env.NOVEL_AGENT_MODEL;
  delete process.env.CODEBUDDY_DEFAULT_MODEL;
  try { return fn(); }
  finally {
    if (a !== undefined) process.env.NOVEL_AGENT_MODEL = a;
    if (b !== undefined) process.env.CODEBUDDY_DEFAULT_MODEL = b;
  }
}

test("parseCredits handles all catalog formats", () => {
  assert.equal(parseCredits("x0.00"), 0);
  assert.equal(parseCredits("x0.29 credits"), 0.29);
  assert.equal(parseCredits(""), null);
  assert.equal(parseCredits(undefined), null);
});

test("decodeProductConfig reads plain and gzipped catalogs", () => {
  const config = { models: [{ id: "hy4free", credits: "x0.00" }] };
  assert.deepEqual(decodeProductConfig(JSON.stringify(config)), [{ id: "hy4free", credits: 0 }]);
  const encoded = JSON.stringify(gzipSync(Buffer.from(JSON.stringify(config))).toString("base64"));
  assert.deepEqual(decodeProductConfig(encoded), [{ id: "hy4free", credits: 0 }]);
  assert.deepEqual(decodeProductConfig("not json"), []);
});

test("hy4 alias resolves to the free hy4 model first", () => {
  assert.deepEqual(expandModelAlias("hy4", catalog), ["hy4free", "hy4std"]);
  assert.deepEqual(expandModelAlias("hy4", []), ["hy4free"]);
  assert.deepEqual(expandModelAlias("deepseek-v4.1-flash", catalog), ["deepseek-v4.1-flash"]);
});

test("auto resolution follows hy4 then deepseek preference", () => {
  withoutModelEnv(() => {
    const resolved = resolveAgentModel(undefined, catalog);
    assert.equal(resolved.model, "hy4free");
    assert.deepEqual(resolved.fallbacks, ["deepseek-v4.1-flash"]);
    assert.equal(resolved.source, "catalog");
    assert.deepEqual([...MODEL_PREFERENCE], ["hy4", "deepseek-v4.1-flash"]);
  });
});

test("explicit model overrides the preference chain", () => {
  withoutModelEnv(() => {
    assert.equal(resolveAgentModel("deepseek-v4.1-flash", catalog).model, "deepseek-v4.1-flash");
    assert.equal(resolveAgentModel("auto", catalog).model, "hy4free");
    assert.equal(resolveAgentModel("hy4", catalog).model, "hy4free");
  });
});

test("query options disable tools, sessions and host settings", () => {
  const controller = new AbortController();
  const options = buildQueryOptions("hy4free", { cwd: "/tmp", abortController: controller, fallbackModel: "deepseek-v4.1-flash" });
  assert.equal(options.model, "hy4free");
  assert.equal(options.fallbackModel, "deepseek-v4.1-flash");
  assert.equal(options.maxTurns, 1);
  assert.equal(options.persistSession, false);
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.abortController, controller);
});
