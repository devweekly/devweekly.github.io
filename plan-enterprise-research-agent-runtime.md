# Plan: Enterprise Research Agent — Runtime 聚焦版

> 基于对 `RESEARCH-AGENT-IMPROVEMENTS.md` 的评审反馈调整：聚焦 **Research Runtime** 核心能力，剥离 AERS Catalog/QA 痕迹。

---

## 一、评审结论映射

| 建议 | 用户结论 | 当前实现状态 | 是否纳入本 Plan |
|------|---------|-------------|----------------|
| Eval Harness | ✅ 必须做 | ❌ 未做 | ✅ 纳入 |
| Benchmark | ✅ 必须做 | ❌ 未做 | ✅ 纳入 |
| Quality Gate (CI) | ✅ 必须做 | ⚠️ 只有 lint/build，无 eval/benchmark | ✅ 纳入 |
| Source Register | ✅ 必须做 | ❌ Evidence 只有 `source: string`，无 Source 元数据 | ✅ 纳入 |
| Contract Validation | 🟡 保留思想，不做 CLI Gate | ❌ 当前是 `set-contract --confirm` + `confirm-contract` CLI Gate | ✅ 纳入重构 |
| Claim Coverage | 🟡 做，但不硬 Gate | ❌ `validate-report` 在 coverage < threshold 时 exit 1 | ✅ 纳入重构 |
| Evidence Validation | 🟡 升级为证据质量评估 | ❌ 只检查 `source + (uri \|\| content)` | ✅ 纳入 |
| Conflict Disclosure | 🟡 自动写入报告，不做 Gate | ⚠️ `report-template` 会预填 conflicts，但无 "Alternative Interpretation" | ✅ 纳入 |
| SKILL.md Frontmatter | ❌ 不建议 | ✅ 已有 frontmatter | ❌ 不改动 |
| references/ 拆分 | ❌ 不建议 | ✅ 未拆分 | ❌ 不改动 |
| Compact Status | ❌ 不建议 | ⚠️ `session-status` 输出较详细 | ❌ 不改动 |

**新增但未在原文档中的高价值项**（用户评审中单独提出）：

| 能力 | 当前状态 | 是否纳入本 Plan |
|------|---------|----------------|
| Ontology Layer | ✅ 已有 ONTOLOGY | ⚠️ 保持，不强化为完整 KG |
| Research Memory | ❌ 仅 session JSON，无长期资产 | 🟡 纳入 Phase 3（可选） |
| Planner (Hypothesis-driven) | ❌ Plan 只是骨架 list | ✅ 纳入 Phase 2 |
| Evidence Ranking | ⚠️ 只有 SOURCE_WEIGHTS | ✅ 纳入 Phase 2 |
| Research Loop | ⚠️ 已有 Question Tree + Decision，但闭环不够 | ✅ 纳入 Phase 2 |

---

## 二、目标

在 **不拆分文件、不引入新依赖、不损失现有功能** 的前提下：

1. **剥离 AERS 痕迹**：把 Contract/Coverage/Conflict 从 "Gate" 改为 "信号"。
2. **补齐 Runtime 核心能力**：Source Register、Evidence Ranking、Planner、Research Loop、Eval、Benchmark。
3. **保留并优化原有精简成果**：代码内部重复度降低，但优先级低于能力补齐。

---

## 三、当前实现中的具体问题

### 问题 1：Contract 做成了 CLI Gate

当前：

```bash
node research.mjs set-contract --question "..." --confirm
# 或
node research.mjs set-contract --question "..."
node research.mjs confirm-contract
```

问题：
- `confirm-contract` 是一个无实际校验的 CLI Gate，只是写 `confirmedAt` 时间戳。
- 对 LLM 来说，这只是多一步命令，不是真正的 "Research Contract Validation"。

改为：
- 删除 `confirm-contract` 命令。
- `set-contract` 直接设置 contract，并自动做 schema validation：
  - `question` 非空
  - `scope` / `expectedOutput` 是 object
  - `evidenceRequirement` 包含 minSources / primarySourceRatio / claimCoverageRatio
  - `depth` / `timeLimitMinutes` 合理范围
- contract 状态改为 `valid`（schema 校验通过）而非 `confirmedAt`。
- LLM 仍然需要先 set-contract，但这是 **schema validation**，不是用户确认 Gate。

### 问题 2：Claim Coverage 做成了硬 Gate

当前：`validate-report` 在 `coverageRatio < threshold` 时返回 exit code 1，阻止报告生成。

改为：
- `validate-report` 不再因 coverage 低而失败。
- coverage 低时，在报告中自动生成：
  - `confidence.overall` 降级
  - `knowledgeGaps` 增加 "insufficient_claim_coverage"
  - `recommendations` 增加 "继续收集证据"
- `decide()` 中把低 coverage 作为 Continue 的一个信号（但非强制）。

### 问题 3：Evidence 没有 Source Register

当前 Evidence：

```javascript
{
  source: "GitHub",
  uri: "...",
  content: "...",
  confidence: 0.9,
  lastUpdated: "2025-09-12",
  claims: [...]
}
```

问题：
- `source` 只是字符串，无法表达 authority / type / independence / primary vs secondary。

改为：
- Evidence 新增可选字段 `sourceRegister`（或复用 `metadata.sourceRegister`）：
  ```javascript
  {
    source: "GitHub",
    sourceRegister: {
      type: "primary",        // primary | secondary | hearsay | generated
      authority: 0.9,         // 源权威度
      independence: 1.0,      // 与其他 evidence 的独立性
      retrievedAt: "2026-07-20",
      license: "public"       // public | internal | restricted
    }
  }
  ```
- 不强制要求 LLM 填写，但如果填写则参与 confidence / evidence ranking。
- 新增 `add-source` CLI 命令，或在 `add-evidence` 中增加 `--source-type` / `--source-authority` 等选项。

### 问题 4：Evidence Validation 只有格式检查

当前 `add-evidence` 校验：

```javascript
if (!source) throw new Error('Evidence source is required');
if (!uri && !content) throw new Error('Evidence must have uri or content');
```

改为：
- 新增证据质量评估函数 `assessEvidenceQuality(evidence)`，输出：
  - `qualityScore`：综合 authority / freshness / independence / primary / recency
  - `classification`：primary / secondary / hearsay / generated / duplicate / outdated
  - `flags`：["outdated", "single_source", "low_authority"]
- 在 `add-evidence` 时自动计算并存储。
- `analyze` 时把 evidence quality 纳入 confidence 计算。

### 问题 5：Conflict Disclosure 不够完整

当前：
- `analyze-contradictions` 检测冲突。
- `report-template` 自动填充 `conflicts`。

改为：
- 每个 conflict 增加 `alternativeInterpretations` 字段（LLM 在写报告时填写）。
- `report-template` 自动为每个 conflict 生成占位：
  ```json
  {
    "description": "...",
    "entityId": "e2",
    "property": "owner",
    "values": [...],
    "alternativeInterpretations": ["可能是数据同步延迟", "可能是不同系统定义不同"],
    "unknown": true
  }
  ```
- `validate-report` 不因为 conflict 存在而失败。

### 问题 6：Plan 只是骨架，没有 Hypothesis-driven Planning

当前 Plan：

```javascript
{ id: "p1", objective: "Identify vendor background", status: "pending" }
```

改为：
- PlanItem 增加 `hypothesis` 字段（可空）。
- LLM 在 Phase 1 生成：
  - 每个 plan item 对应一个 testable hypothesis
  - 例如："RiskConcile 是内部自研工具" → 可被证据证伪
- 新增 `reject-hypothesis` 已经存在，但 Plan 层应该显式连接 hypothesis。

### 问题 7：Evidence Ranking 过简

当前 `SOURCE_WEIGHTS`：

```javascript
{ GitHub: 0.8, LeanIX: 0.85, Vendor: 0.9, ... }
```

改为：
- 引入 `evidenceRank(evidence)` 综合函数：
  ```javascript
  score = w1 * sourceAuthority
        + w2 * freshness
        + w3 * independence
        + w4 * primaryBonus
        - w5 * contradictionPenalty
  ```
- 该 score 参与 confidence assessment。

### 问题 8：Research Loop 已经存在，但需要闭环优化

当前已有：

```
Question → Evidence → Entity → Relationship → New Question → decide()
```

优化：
- `decide()` 把 "low coverage" / "low confidence" / "open gaps" 作为 Continue 信号。
- 新增 `next-question` 建议命令：基于当前 graph/gaps/conflicts，由 JS 输出候选问题列表（LLM 选择或直接使用）。

---

## 四、执行计划（分 Phase）

### Phase 0：基础设施（必须先做）

1. **Eval Harness**：
   - 在 `.trae/skills/enterprise-research-agent/eval/` 下创建 TOML/JSON 场景文件。
   - 新增 `eval` CLI 命令：`node research.mjs eval [--scenario <id>]`。
   - 场景覆盖：contract-first、multi-source、claim-linked、conflict-disclosed、coverage-aware。

2. **Benchmark**：
   - 在 `.trae/skills/enterprise-research-agent/benchmark/` 下创建 JSON fixture。
   - 新增 `benchmark` CLI 命令。
   - 覆盖：claim coverage、gap detection、confidence assessment、contradiction detection、evidence ranking。

3. **Quality Gate**：
   - 更新 GitHub Actions workflow（`.github/workflows/astro.yml` 或新建 `.github/workflows/research-agent.yml`）：
     - `pnpm lint`
     - `node .trae/skills/enterprise-research-agent/research.mjs benchmark`
     - `node .trae/skills/enterprise-research-agent/research.mjs eval`
   - 不引入测试框架，用 CLI 命令本身作为测试入口。

### Phase 1：剥离 AERS Gate（高优先级）

1. **Contract Validation 重构**：
   - 删除 `confirm-contract` CLI 命令。
   - `set-contract` 自动校验 schema。
   - contract 字段改为 `valid: boolean` + `validatedAt`。
   - 更新 `SKILL.md` 中相关说明。

2. **Claim Coverage 软 Gate 化**：
   - `validate-report` 不再因 coverage 低失败。
   - 低 coverage 自动影响 confidence + gaps + recommendations。
   - `decide()` 把 coverage 作为 Continue 信号。

3. **Conflict Disclosure 完整化**：
   - conflict 对象增加 `alternativeInterpretations` 和 `unknown`。
   - `report-template` 自动填充这些字段的占位。
   - `validate-report` 不因为 conflict 失败。

### Phase 2：Runtime 核心能力补齐

1. **Source Register**：
   - Evidence 增加 `sourceRegister` 字段。
   - `add-evidence` 增加 `--source-type` / `--source-authority` / `--source-independence` / `--retrieved-at` 选项。
   - 新增 `list-sources` CLI 命令。

2. **Evidence Quality Assessment**：
   - 新增 `assessEvidenceQuality(evidence)` 函数。
   - 在 `add-evidence` 时自动调用。
   - 输出 classification / qualityScore / flags。

3. **Evidence Ranking**：
   - 新增 `rankEvidence(graph)` 函数，基于 sourceRegister + freshness + independence + contradiction。
   - 更新 `assessConfidence` 使用 evidence rank。

4. **Hypothesis-driven Planner**：
   - PlanItem 增加 `hypothesis` 字段。
   - `add-plan-item` 增加 `--hypothesis` 选项。
   - LLM Playbook 更新 Phase 1 生成 hypothesis。

5. **Next Question 建议**：
   - 新增 `suggest-questions` CLI 命令。
   - 基于 gaps / contradictions / uncovered claims 生成候选问题。

### Phase 3：Research Memory（可选，后续再做）

1. 新增 `export-memory --output <file>`：把 entities / claims / sources 导出为长期资产。
2. 新增 `import-memory --input <file>`：在新研究中复用已确认的实体和 claim。
3. 这会让 Research Agent 从 "单次研究" 进化为 "持续研究资产"。

### Phase 4：内部精简（低优先级）

在完成 Phase 0–2 后，再执行原 `plan-slim-enterprise-research-agent.md` 中的内部精简：
- CLI 样板统一
- ResearchSession 委托方法自动化
- EvidenceGraph 辅助方法合并
- QuestionTree/ClaimStore 通用 IdStore
- help 动态生成

---

## 五、明确不做

| 项 | 理由 |
|----|------|
| SKILL.md Frontmatter 扩展 | Catalog 需求，非 Runtime |
| references/ 拆分 | SKILL.md 未过 400 行，无需拆 |
| Compact Status 优化 | UX 优化，优先级低 |
| 多文件拆分 | 违反单文件约束 |
| 外部数据库 / 图数据库 | 违反只做 JSON 的承诺 |
| Multi-Agent 框架 | 违反不做 Multi-Agent 的边界 |

---

## 六、风险与回退

| 风险 | 缓解 |
|------|------|
| 删除 `confirm-contract` 影响已有 session | `fromJSON` 兼容旧 `confirmedAt` 字段 |
| `validate-report` 不再 gate coverage 可能让低质量报告通过 | 改为 confidence 降级 + gaps + recommendations 显性提示 |
| Source Register 字段增加导致 session JSON 变大 | 字段均为可选，不强制填写 |
| Eval/Benchmark 依赖文件路径 | 使用相对路径，并在 CI 中从仓库根目录运行 |

---

## 七、预期效果

| 指标 | 当前 | 目标 |
|------|------|------|
| CLI 命令数 | 36 | 38–40（新增 eval/benchmark/list-sources/suggest-questions，删除 confirm-contract） |
| Eval 场景 | 0 | ≥10 |
| Benchmark 任务 | 0 | ≥4 |
| CI Quality Gate | lint/build | lint/build + benchmark + eval |
| Source Register | 无 | 可选结构化字段 |
| Coverage Gate | 硬 Gate | 软信号 |
| Contract Gate | CLI Gate | Schema Validation |

---

## 八、下一步

确认本 plan 后，按 Phase 0 → Phase 1 → Phase 2 顺序执行。每完成一个 Phase 跑一遍 `eval` + `benchmark` 验证无回归。
