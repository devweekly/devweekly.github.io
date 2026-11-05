import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  parseCredits, decodeProductConfig, expandModelAlias, resolveAgentModel,
  readConfiguredModel, readModelCatalog, buildQueryOptions, detachedCliOptions,
  MODEL_PREFERENCE, DEFAULT_MODEL_ID, type CatalogModel
} from "../src/agent-runtime.js";

const catalog: CatalogModel[] = [
  { id: "hy4free", credits: 0 },
  { id: "deepseek-v4.1-flash", credits: 0.11 },
];

const missingConfig = join(tmpdir(), "novel-generation-config-does-not-exist.json");

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

test("hy4 alias resolves to the free hy4 model", () => {
  assert.deepEqual(expandModelAlias("hy4", catalog), ["hy4free"]);
  assert.deepEqual(expandModelAlias("hy4", []), ["hy4free"]);
  assert.deepEqual(expandModelAlias("hy4free", catalog), ["hy4free"]);
  assert.deepEqual(expandModelAlias("deepseek-v4.1-flash", catalog), ["deepseek-v4.1-flash"]);
});

test("default model is deepseek-v4.1-flash with a free hy4 fallback", () => {
  assert.equal(DEFAULT_MODEL_ID, "deepseek-v4.1-flash");
  assert.deepEqual([...MODEL_PREFERENCE], ["deepseek-v4.1-flash", "hy4free"]);
  withoutModelEnv(() => {
    const resolved = resolveAgentModel(undefined, catalog, missingConfig);
    assert.equal(resolved.model, "deepseek-v4.1-flash");
    assert.deepEqual(resolved.fallbacks, ["hy4free"]);
    assert.equal(resolved.source, "default");
  });
});

test("model resolution order: --model > env > config > default", () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-model-"));
  const config = join(dir, "novel-generation.config.json");
  writeFileSync(config, JSON.stringify({ model: "glm-5.3-flash" }), "utf8");
  try {
    withoutModelEnv(() => {
      assert.equal(readConfiguredModel(config), "glm-5.3-flash");
      assert.equal(readConfiguredModel(join(dir, "missing.json")), undefined);
      assert.equal(resolveAgentModel(undefined, catalog, config).model, "glm-5.3-flash");
      assert.equal(resolveAgentModel(undefined, catalog, config).source, "config");
      process.env.NOVEL_AGENT_MODEL = "hy4free";
      assert.equal(resolveAgentModel(undefined, catalog, config).model, "hy4free");
      assert.equal(resolveAgentModel(undefined, catalog, config).source, "env");
      assert.equal(resolveAgentModel("deepseek-v4.1-flash", catalog, config).model, "deepseek-v4.1-flash");
      assert.equal(resolveAgentModel("auto", catalog, config).model, "hy4free");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit model overrides the preference chain", () => {
  withoutModelEnv(() => {
    assert.equal(resolveAgentModel("hy4", catalog, missingConfig).model, "hy4free");
    assert.equal(resolveAgentModel("auto", catalog, missingConfig).model, "deepseek-v4.1-flash");
    assert.equal(resolveAgentModel("  AUTO  ", catalog, missingConfig).source, "default");
  });
});

test("catalog falls back to local storage when ACC_PRODUCT_CONFIG_PATH is unreadable", () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-catalog-"));
  const previous = process.env.ACC_PRODUCT_CONFIG_PATH;
  writeFileSync(join(dir, "not-product.info"), "not json", "utf8");
  writeFileSync(join(dir, "product.info"), JSON.stringify({
    models: [{ id: "deepseek-v4.1-flash", credits: "x0.11" }]
  }), "utf8");
  process.env.ACC_PRODUCT_CONFIG_PATH = join(dir, "missing.json");
  try {
    const models = readModelCatalog({
      localStorageDir: dir,
      userModelsPath: join(dir, "no-models.json"),
      projectRoot: dir
    });
    assert.deepEqual(models, [{ id: "deepseek-v4.1-flash", credits: 0.11 }]);
  } finally {
    if (previous === undefined) delete process.env.ACC_PRODUCT_CONFIG_PATH;
    else process.env.ACC_PRODUCT_CONFIG_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("managed sessions get a detached CLI environment and an auto-selected port", () => {
  const previous = process.env.CODEBUDDY_SESSION_ID;
  process.env.CODEBUDDY_SESSION_ID = "test-session";
  try {
    const controller = new AbortController();
    const options = buildQueryOptions("deepseek-v4.1-flash", { cwd: "/tmp", abortController: controller });
    assert.deepEqual(options.extraArgs, { port: "0" });
    assert.equal(options.env.CODEBUDDY_SESSION_ID, undefined);
    assert.equal(options.env.ACC_PRODUCT_CONFIG_PATH, undefined);
  } finally {
    if (previous === undefined) delete process.env.CODEBUDDY_SESSION_ID;
    else process.env.CODEBUDDY_SESSION_ID = previous;
  }
  assert.equal(detachedCliOptions().extraArgs.port, "0");
});

test("query options disable tools, sessions and host settings", () => {
  const controller = new AbortController();
  const options = buildQueryOptions("deepseek-v4.1-flash", {
    cwd: "/tmp", abortController: controller, fallbackModel: "hy4free"
  });
  assert.equal(options.model, "deepseek-v4.1-flash");
  assert.equal(options.fallbackModel, "hy4free");
  assert.equal(options.maxTurns, 1);
  assert.equal(options.persistSession, false);
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.abortController, controller);
});
