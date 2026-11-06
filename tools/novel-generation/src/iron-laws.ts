// 把世界设定里能机器核对的硬约束做成确定性检查。
// 只覆盖「数值、门槛、禁忌」这类可判定的部分；需要理解意图的仍交给终审模型。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface IronLaw {
  id: string;
  statement: string;
  source?: string;
  /** forbid：命中即违规；value：取第一个分组的值与 expect/max 比较。 */
  kind: "forbid" | "value";
  pattern: string;
  expect?: string;
  max?: number;
  problem: string;
  repair: string;
}

export interface IronLawHit {
  lawId: string;
  statement: string;
  evidence: string;
  problem: string;
  repair: string;
  index: number;
}

const MAX_EVIDENCE = 30;

function parseLaws(raw: unknown, path: string): IronLaw[] {
  const container = raw as { version?: unknown; laws?: unknown };
  if (!container || typeof container !== "object" || !Array.isArray(container.laws)) {
    throw new Error("Iron law file must contain a laws array: " + path);
  }
  return container.laws.map((item, index) => {
    const law = item as Partial<IronLaw>;
    if (!law || typeof law !== "object") throw new Error("Iron law #" + (index + 1) + " is not an object: " + path);
    if (!law.id || !law.statement || !law.pattern || !law.problem || !law.repair) {
      throw new Error("Iron law #" + (index + 1) + " is missing id/statement/pattern/problem/repair: " + path);
    }
    if (law.kind !== "forbid" && law.kind !== "value") {
      throw new Error("Iron law " + law.id + " has unsupported kind: " + String(law.kind));
    }
    try {
      new RegExp(law.pattern, "gu");
    } catch (error) {
      throw new Error("Iron law " + law.id + " has an invalid pattern: " + String(error));
    }
    return {
      id: law.id, statement: law.statement, source: law.source, kind: law.kind,
      pattern: law.pattern, expect: law.expect, max: law.max,
      problem: law.problem, repair: law.repair
    };
  });
}

/** 缺文件表示这个世界没有登记硬约束，不是错误；文件存在但格式不对则直接报错。 */
export function loadIronLaws(worldDir: string): IronLaw[] {
  const path = resolve(worldDir, "laws.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    return parseLaws(JSON.parse(text), path);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Iron law file is not valid JSON: " + path);
    throw error;
  }
}

export function checkIronLaws(text: string, laws: IronLaw[]): IronLawHit[] {
  const hits: IronLawHit[] = [];
  for (const law of laws) {
    const pattern = new RegExp(law.pattern, "gu");
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (law.kind === "value") {
        const captured = match[1];
        if (captured === undefined) continue;
        const numeric = Number(captured);
        if (!Number.isFinite(numeric)) continue;
        const acceptable = law.max !== undefined ? numeric <= law.max : law.expect !== undefined ? captured === law.expect : true;
        if (acceptable) continue;
      }
      hits.push({
        lawId: law.id,
        statement: law.statement,
        evidence: match[0].replace(/\s+/g, " ").slice(0, MAX_EVIDENCE),
        problem: law.problem,
        repair: law.repair,
        index
      });
      if (hits.length >= 6) return hits;
    }
  }
  return hits;
}

/** 把硬约束命中转成终审问题；没有场景号时由调用方补齐。 */
export function ironLawIssues(hits: IronLawHit[], scenes: number[] = []): Array<{ scenes: number[]; evidence: string; problem: string; repair: string }> {
  return hits.map(hit => ({
    scenes,
    evidence: hit.evidence,
    problem: "违反既定规则（" + hit.lawId + "）：" + hit.problem,
    repair: hit.repair
  }));
}
