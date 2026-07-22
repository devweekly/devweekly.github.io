# Enterprise Research Agent 提升建议

> 聚焦 **Enterprise Research Runtime** 核心能力：推理质量、证据质量、可验证性。
> 不引入 Catalog/QA 式管理子系统，不维护额外的生命周期对象。
> 本建议基于当前 `.trae/skills/enterprise-research-agent/research.mjs` 单文件实现现状。

---

## 一、评审结论

| 原建议 | 评审结论 | 说明 |
|--------|---------|------|
| Eval Harness | ✅ 必须做 | JSON Scenario → Replay → Assertions |
| Benchmark | ✅ 必须做 | 验证 deterministic 算法 |
| Quality Gate | ✅ 必须做 | lint + benchmark + eval |
| Embedded Source Metadata | ✅ 必须做 | Evidence 内嵌 source metadata，不做独立 Source Register |
| Coverage → Confidence | ✅ 必须做 | Coverage 不硬 Gate，只影响 Confidence |
| Conflict Disclosure | ✅ 必须做 | 自动写入报告，含 Alternative Interpretation |
| Evidence Quality | ✅ 必须做 | 评估 primary/secondary/hearsay/duplicate/outdated |
| Completion Assessment | ✅ 必须做 | 综合 Coverage / Confidence / Unknowns / Risks / Open Questions |
| Evidence Ranking Policy | 🟡 保留思想 | 不固定权重，用可扩展 RankingPolicy |
| Planner | 🟡 暂缓 | 只做字段收益低，完整实现又太重 |
| Research Loop | 🟡 暂缓 | 当前 QuestionTree + decide 已可用 |
| Research Memory | ❌ 不建议现在做 | Runtime 未稳定，Memory 会引入 Merge/Version/Conflict/TTL |
| SKILL.md Frontmatter | ❌ 不建议 | Catalog 需求 |
| references/ 拆分 | ❌ 不建议 | 当前无需拆分 |
| Compact Status | ❌ 不建议 | UX 优化，优先级低 |

---

## 二、必须修改（P0–P1）

### ✅ ① Eval Harness

**核心目标**：防止 Prompt/Workflow 改坏，防止 Agent 胡说。

**设计原则**：不照搬 AERS 的 Rubric 体系，用最小可运行的 Scenario Replay。

**实施方案**：

```
.trae/skills/enterprise-research-agent/eval/
├── contract-first.json
├── multi-source.json
├── claim-coverage.json
├── conflict-disclosure.json
└── vendor-research.json
```

每个场景：

```json
{
  "id": "contract-first",
  "title": "Research must start with a valid contract",
  "steps": [
    "init --goal 'Research RiskConcile'",
    "set-contract --question 'What is RiskConcile?' --scope '{}' --expected-output '{}'",
    "add-evidence --source GitHub --content '...'",
    "add-claim --text 'RiskConcile is a vendor' --type fact --evidence ev1"
  ],
  "assertions": [
    { "type": "contract_valid" },
    { "type": "claim_has_evidence", "claimType": "fact" }
  ]
}
```

执行：

```bash
node research.mjs eval
node research.mjs eval --scenario contract-first
```

执行器内嵌在 `research.mjs` 中，按 `steps` replay，最终对 session 做 assertions。

---

### ✅ ② Benchmark

**核心目标**：验证 deterministic 算法的数值正确性。

**覆盖算法**：

- Claim Coverage
- Gap Detection
- Contradiction Detection
- Confidence Assessment
- Evidence Quality Classification

**实施方案**：

```
.trae/skills/enterprise-research-agent/benchmark/
├── claim-coverage.json
├── gap-detection.json
├── contradiction-detection.json
├── confidence-assessment.json
└── evidence-quality.json
```

执行：

```bash
node research.mjs benchmark
node research.mjs benchmark --task claim-coverage
```

直接复用内部函数，不依赖 LLM。

---

### ✅ ③ Quality Gate

**核心目标**：每次提交自动验证。

**实施方案**：

在 `.github/workflows/astro.yml` 追加 job：

```yaml
research-agent-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with:
        version: 10.24.0
    - run: pnpm install
    - run: pnpm lint
    - run: node .trae/skills/enterprise-research-agent/research.mjs benchmark
    - run: node .trae/skills/enterprise-research-agent/research.mjs eval
```

不再引入其他测试框架。

---

### ✅ ④ Embedded Source Metadata

**核心目标**：建立 Evidence → Source → Authority 链，但**不做独立 Source Register**。

**当前问题**：Evidence 只有 `source: string`。

**修改方案**：

Evidence 内嵌 `source` 字段扩展为 object：

```javascript
{
  source: "GitHub",
  sourceMetadata: {
    type: "system_of_record",  // primary | secondary | hearsay | generated
    authority: 0.85,
    independence: 1.0,
    freshness: "daily",        // 源更新频率
    retrievedAt: "2026-07-20T10:00:00Z"
  }
}
```

为什么不做独立 Source Register：

- Research Runtime 不是 MDM。
- 独立 Register 会引入 Source Merge / Update / Delete / Version 等生命周期。
- 内嵌 metadata 足够支撑 Evidence Quality 和 Ranking。

CLI：

```bash
node research.mjs add-evidence --source GitHub --content "..." \
  --source-type system_of_record --source-authority 0.85
```

`source` 字段保持 string 用于向后兼容；新增可选 `sourceMetadata`。

---

### ✅ ⑤ Evidence Quality

**核心目标**：从格式检查升级为证据质量评估。

**修改方案**：

新增 `assessEvidenceQuality(evidence)`：

```javascript
{
  classification: "primary" | "secondary" | "hearsay" | "generated" | "duplicate" | "outdated",
  authority: 0.85,
  freshnessScore: 0.7,
  independenceScore: 1.0,
  qualityScore: 0.82,
  flags: ["stale_90d"]
}
```

- `classification` 由 `sourceMetadata.type` 和 `lastUpdated` 共同决定。
- `duplicate` 通过 content hash / uri 去重检测。
- `outdated` 通过 `lastUpdated` 与阈值比较。

CLI：

```bash
node research.mjs assess-evidence --id ev1
```

---

### ✅ ⑥ Coverage → Confidence

**核心目标**：Coverage 是信号，不是 Gate。

**当前问题**：`validate-report` 在 coverage < threshold 时 exit 1。

**修改方案**：

1. 删除 coverage 硬 gate。
2. 低 coverage 时：
   - `confidence.level` 降级
   - `knowledgeGaps` 增加 "insufficient_claim_coverage"
   - `recommendations` 增加继续研究的建议
3. `decide()` 把 coverage 作为 Continue 软信号。

---

### ✅ ⑦ Conflict Disclosure

**核心目标**：冲突透明写入报告，不阻止流程。

**修改方案**：

Conflict 对象增加：

```javascript
{
  alternativeInterpretations: ["不同系统对 owner 的定义可能不同"],
  unknown: true
}
```

`report-template` 自动填充这些字段；`validate-report` 不因 conflict 失败。

---

### ✅ ⑧ Completion Assessment（新增）

**核心目标**：让 Research 的结束条件从单一指标升级为综合评分。

**当前问题**：`decide()` 只看 Coverage / Budget / Open Questions，缺少对研究完整度的综合判断。

**修改方案**：

新增 `assessCompletion(session)`：

```javascript
{
  coverage: 0.75,
  confidence: "medium",
  remainingUnknowns: 2,
  remainingRisks: 1,
  openQuestions: 3,
  completionScore: 0.68,
  recommendation: "continue" | "finish_with_gaps" | "finish"
}
```

`decide()` 综合以上指标输出 Continue / Finish，而不是单一阈值。

报告 traceability section 增加 completion assessment。

---

## 三、暂缓或不建议现在做

### 🟡 Evidence Ranking Policy

**保留思想**：证据权重因研究领域而异。

**不建议现在实现完整 RankingPolicy 系统的原因**：

- Runtime 当前证据量不大，固定权重已有 80% 效果。
- 引入 Policy 系统会增加配置复杂度。

**折中方案**：

- 先保留 `SOURCE_WEIGHTS` 默认表。
- 把 `sourceMetadata.type` 作为权重输入。
- 未来若需要 Academic / Vendor / Security 等差异化策略，再抽象为 `RankingPolicy` 接口。

---

### 🟡 Planner

**当前问题**：只在 PlanItem 加一个 `hypothesis` 字段收益很低。

**完整 Planner 需要**：

```
Question
  ↓
Hypothesis
  ↓
Evidence Needed
  ↓
Verification Method
  ↓
Success Criteria
```

完整实现会显著增加复杂度。

**建议**：Runtime 稳定前暂缓。当前 Plan + QuestionTree 已足够。

---

### 🟡 Research Loop

**当前状态**：QuestionTree + decide 已构成基础循环。

**建议**：先通过 `suggest-questions` 命令增强（基于 gaps / conflicts / uncovered claims），不急着做自动循环执行器。

---

### ❌ Research Memory

**不建议现在做的原因**：

- Memory 真正难的是 Merge / Version / Conflict / TTL / Dedup，不是 Export JSON。
- Runtime 未稳定前引入 Memory，会同时维护两个知识库（session + memory）。
- 当前每次 research 从空 session 开始即可。

**未来触发条件**：

- 同一个 Vendor/Technology 被研究 5 次以上
- 用户明确说"基于上次研究继续"

---

## 四、明确不做

| 项 | 理由 |
|----|------|
| SKILL.md Frontmatter 扩展 | Catalog 需求 |
| references/ 拆分 | 当前无需拆分 |
| Compact Status | UX 优化，优先级低 |
| 独立 Source Register / Source DB | 会引入 MDM 生命周期 |
| Research Memory（现在） | Runtime 未稳定 |
| 完整 Planner 系统 | 复杂度过高，收益有限 |

---

## 五、优先级与路线图

### P0 — 立即做

| 项 | 说明 |
|----|------|
| Eval Harness | 行为回归保护 |
| Benchmark | 算法数值基线 |
| Quality Gate | CI 自动验证 |

### P1 — 核心能力补齐

| 项 | 说明 |
|----|------|
| Embedded Source Metadata | Evidence 内嵌 source metadata |
| Evidence Quality | primary/secondary/hearsay/duplicate/outdated |
| Coverage → Confidence | 删除硬 gate |
| Conflict Disclosure | Alternative Interpretation + Unknown |
| Completion Assessment | 综合结束条件 |

### P2 — 能力增强（Runtime 稳定后）

| 项 | 说明 |
|----|------|
| Evidence Ranking Policy | Academic/Vendor/Security 可扩展策略 |
| Planner | 完整 Hypothesis → Evidence → Verification → Success Criteria |
| Research Loop | suggest-questions + 自动循环执行 |

### P3 — 长期能力

| 项 | 说明 |
|----|------|
| Research Memory | export/import 长期研究资产 |

### 建议路线图

```
Week 1: P0 基础保障
├── Eval Harness
├── Benchmark
└── Quality Gate

Week 2: P1 Evidence 基础
├── Embedded Source Metadata
└── Evidence Quality

Week 3: P1 结束条件
├── Coverage → Confidence
├── Conflict Disclosure
└── Completion Assessment

Week 4: 验证与收敛
├── 跑 eval + benchmark
├── 修复回归
└── 更新 SKILL.md

P2/P3：Runtime 稳定后再评估是否启动。
```

---

## 六、设计原则

### Runtime First

> 优先增强研究运行时的推理质量、证据质量和可验证性；避免引入仅服务于 Catalog 管理、文档组织或平台治理的复杂机制。新增能力应优先复用现有数据结构和命令，而不是增加新的生命周期对象或管理子系统。

这一原则用于约束后续演进，防止系统逐渐变成"小型 Palantir"或"知识管理平台"，而偏离 **Enterprise Research Runtime** 的定位。

### 不做第二个知识库

- Session 是当前唯一的工作记忆。
- 不引入独立的 Source DB、Memory DB、Knowledge Base。
- 所有元数据尽量内嵌在现有对象中。

### Gate → Signal

- Coverage、Conflict、Contract Invalid 都不应阻止 Finish。
- 它们只影响 Confidence、Gaps、Recommendations、Completion Assessment。

### Deterministic First

- Coverage、Gap、Confidence、Contradiction、Evidence Quality、Completion Assessment 都应是 deterministic 函数。
- 这些函数必须有 Benchmark 覆盖。

---

## 七、总结

### 最值得优先做的五件事

1. **Eval Harness** — 没有它，后续任何改动都无法保证不回归。
2. **Benchmark** — deterministic 算法必须有数值基线。
3. **Quality Gate** — 把 eval + benchmark 进 CI。
4. **Embedded Source Metadata** — 不做独立 Register，直接内嵌到 Evidence。
5. **Completion Assessment** — 让 Research 结束条件从单一指标变成综合评分。

### 当前实现应保留的优势

- 单文件约束
- EvidenceGraph + QuestionTree + ClaimStore 已分离
- Decision Loop 已存在
- Claim Coverage 已计算（只需去掉硬 gate）

### 最终检查清单

| 项 | 状态 | 优先级 |
|----|------|--------|
| Eval Harness | 未做 | P0 |
| Benchmark | 未做 | P0 |
| Quality Gate | 未做 | P0 |
| Embedded Source Metadata | 未做 | P1 |
| Evidence Quality | 未做 | P1 |
| Coverage → Confidence | 需重构 | P1 |
| Conflict Disclosure | 需升级 | P1 |
| Completion Assessment | 未做 | P1 |
| Evidence Ranking Policy | 暂缓 | P2 |
| Planner | 暂缓 | P2 |
| Research Loop | 暂缓 | P2 |
| Research Memory | 不建议现在做 | P3 |
| SKILL.md Frontmatter | 保持 | 不做 |
| references/ 拆分 | 保持 | 不做 |
| Compact Status | 保持 | 不做 |
