import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkIronLaws, ironLawIssues, loadIronLaws, type IronLaw } from "../src/iron-laws.js";

const LAWS: IronLaw[] = [
  {
    id: "rank-ceiling", kind: "forbid", statement: "不得晋升七宫",
    pattern: "李阎[^。\\n]{0,12}(?:晋升|突破|成为)[^。\\n]{0,6}七宫",
    problem: "越过了位阶天花板", repair: "改回八极之内"
  },
  {
    id: "permission-cap", kind: "value", max: 250, statement: "购买权限最高 250%",
    pattern: "购买权限[^。\\n0-9]{0,10}(\\d{1,3})%",
    problem: "超过最高额度", repair: "压回 250% 以内"
  },
  {
    id: "shared-death", kind: "value", expect: "10", statement: "与共者死亡降 10%",
    pattern: "与共者[^。\\n]{0,20}觉醒(?:度|程度)?[^。\\n]{0,10}(?:下降|降低)[^0-9]{0,4}(\\d+)%",
    problem: "跌幅与规则不符", repair: "改为 10%"
  }
];

test("硬约束命中越阶与超额，未越界时不报", () => {
  const violating = "李阎在这一战之后正式晋升七宫。结算报告：购买权限额度：320%。";
  const hits = checkIronLaws(violating, LAWS);
  assert.deepEqual(hits.map(hit => hit.lawId).sort(), ["permission-cap", "rank-ceiling"]);

  const clean = "李阎仍是八极行走。结算报告：购买权限额度：250%。";
  assert.equal(checkIronLaws(clean, LAWS).length, 0);
});

test("数值类规则只在数值不符时命中", () => {
  assert.equal(checkIronLaws("与共者之一死亡，其他人觉醒程度下降 10%。", LAWS).length, 0);
  const hit = checkIronLaws("与共者之一死亡，其他人觉醒程度下降 30%。", LAWS);
  assert.equal(hit.length, 1);
  assert.equal(hit[0]?.lawId, "shared-death");
});

test("命中项可直接转成带场景号的必改问题", () => {
  const issues = ironLawIssues(checkIronLaws("李阎晋升七宫。", LAWS), [3]);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0]?.scenes, [3]);
  assert.match(String(issues[0]?.evidence), /李阎晋升七宫/);
});

test("缺 laws.json 视为没有约束，格式错误则直接报错", async () => {
  const root = await mkdtemp(join(tmpdir(), "iron-laws-"));
  const worldDir = join(root, "world");
  try {
    assert.deepEqual(loadIronLaws(worldDir), []);
    await writeFile(join(root, "world", "laws.json"), "{ not json", "utf8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(worldDir, { recursive: true });
      await writeFile(join(worldDir, "laws.json"), "{ not json", "utf8");
    });
    assert.throws(() => loadIronLaws(worldDir), /not valid JSON/);
    await writeFile(join(worldDir, "laws.json"), JSON.stringify({ version: 1, laws: [{ id: "x", kind: "forbid", statement: "s", pattern: "(", problem: "p", repair: "r" }] }), "utf8");
    assert.throws(() => loadIronLaws(worldDir), /invalid pattern/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("仓库内的 laws.json 能被解析", () => {
  const laws = loadIronLaws("worlds/conghuoniao");
  assert.ok(laws.length >= 3);
  assert.ok(laws.every(law => law.statement && law.pattern && law.problem && law.repair));
});
