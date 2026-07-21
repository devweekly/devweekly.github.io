# Enterprise Research Agent 提升建议

> 聚焦 **Research Runtime** 核心能力，剥离 AERS 式 Catalog/QA 痕迹。
> 本建议基于当前 `.trae/skills/enterprise-research-agent/research.mjs` 单文件实现现状，只提可落地的修改，不引入外部依赖、不拆分多文件。

---

## 一、评审结论

| 原建议 | 评审结论 | 说明 |
|--------|---------|------|
| Eval Harness | ✅ 必须做 | 用 JSON/TOML 场景 + 内嵌执行器，几十个场景即可 |
| Benchmark | ✅ 必须做 | 验证 deterministic 算法：coverage、gap、confidence、ranking |
| Quality Gate | ✅ 必须做 | CI：`pnpm lint` + `node research.mjs benchmark` + `node research.mjs eval` |
| Source Register | ✅ 必须做 | Evidence 增加结构化 Source 元数据，建立 Evidence → Source → Authority 链 |
| Contract Validation | 🟡 保留思想 | 不做 CLI Gate，改为 schema validation，删除 `confirm-contract` |
| Claim Coverage | 🟡 做，但不硬 Gate | 影响 Confidence、Gaps、Recommendations，不阻止 Finish |
| Evidence Validation | 🟡 升级 | 从格式检查升级为证据质量评估（primary/secondary/hearsay/duplicate/outdated） |
| Conflict Disclosure | 🟡 自动写入报告 | 不做 Gate，报告增加 Alternative Interpretation 与 Unknown |
| SKILL.md Frontmatter | ❌ 不建议 | Catalog 需求，非 Runtime 必需，保持现有即可 |
| references/ 拆分 | ❌ 不建议 | SKILL.md 未超限，无需拆分 |
| Compact Status | ❌ 不建议 | UX 优化，优先级低 |

**采纳约 60%，舍弃约 40%。**

---

## 二、必须修改（Strong Yes）

### ✅ ① Eval Harness

**核心目标**：防止 Prompt/Workflow 改坏，防止 Agent 胡说。

**设计原则**：不照搬 AERS 的复杂场景体系，聚焦关键行为回归。

**实施方案**：

1. 在 skill 目录下新增 `eval/` 目录，存放场景文件：
   ```
   .trae/skills/enterprise-research-agent/eval/
   ├── vendor-research.json
   ├── conflict-disclosure.json
   ├── contract-first.json
   ├── claim-coverage.json
   └── multi-source.json
   ```

2. 每个场景为 JSON：
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
       { "type": "command_called", "command": "set-contract" },
       { "type": "contract_valid" },
       { "type": "claim_has_evidence", "claimType": "fact" }
     ]
   }
   ```

3. 在 `research.mjs` 中新增 `eval` 命令：
   ```bash
   # 运行全部
   node research.mjs eval

   # 运行单个
   node research.mjs eval --scenario contract-first
   ```

4. 执行器逻辑内嵌在 `research.mjs` 中，按场景 replay steps，然后对最终 session 做 assertions 校验。

**预期收益**：
- 每次修改后自动验证核心行为不回归。
- 防止跳过 contract、claim 无证据等关键问题。

---

### ✅ ② Benchmark

**核心目标**：验证 deterministic 算法的数值正确性。

**设计原则**：用静态 fixtures 直接调用内部函数，不依赖 LLM。

**实施方案**：

1. 新增 `benchmark/` 目录：
   ```
   .trae/skills/enterprise-research-agent/benchmark/
   ├── claim-coverage.json
   ├── gap-detection.json
   ├── confidence-assessment.json
   ├── evidence-ranking.json
   └── contradiction-detection.json
   ```

2. 每个 fixture 包含输入和预期输出：
   ```json
   {
     "id": "claim-coverage",
     "title": "Claim coverage ratio",
     "input": {
       "claims": [
         { "id": "c1", "type": "fact", "evidenceIds": ["ev1", "ev2"] },
         { "id": "c2", "type": "statistic", "evidenceIds": ["ev1"] },
         { "id": "c3", "type": "analysis", "reasoning": "...", "evidenceIds": [] }
       ]
     },
     "expected": {
       "coverageRatio": 0.6667,
       "verifiedRatio": 0,
       "unverifiedClaimIds": ["c1", "c2", "c3"]
     }
   }
   ```

3. 新增 `benchmark` 命令：
   ```bash
   node research.mjs benchmark
   node research.mjs benchmark --task claim-coverage
   ```

4. benchmark 直接复用 `ClaimStore`、`analyzeGaps`、`assessConfidence`、`analyzeContradictions` 等内部函数。

**预期收益**：
- Coverage、Gap、Confidence、Contradiction、Ranking 算法有数值基线。
- 支持未来 A/B 测试不同实现。

---

### ✅ ③ Quality Gate

**核心目标**：每次提交自动验证代码与行为质量。

**实施方案**：

1. 在 `.github/workflows/astro.yml` 中追加一个 job（或新建 `research-agent.yml`）：
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

2. 不引入新的测试框架，用上面两个 CLI 命令作为 Quality Gate。

**预期收益**：
- 每次提交自动验证 lint、benchmark、eval。
- 建立最小但有效的质量标准。

---

### ✅ ④ Source Register

**核心目标**：建立完整的 Evidence → Source → Authority 链。

**当前问题**：Evidence 只有 `source: string`，无法表达权威度、类型、独立性、新鲜度。

**实施方案**：

1. Evidence 增加可选 `sourceRegister` 字段：
   ```javascript
   {
     source: "GitHub",
     sourceRegister: {
       type: "system_of_record",  // primary | secondary | hearsay | generated
       authority: 0.85,
       independence: 1.0,
       retrievedAt: "2026-07-20T10:00:00Z",
       license: "public"          // public | internal | restricted
     }
   }
   ```

2. Source Type 权重（不硬编码为唯一标准，作为默认参考）：
   | Type | Authority |
   |------|----------|
   | `system_of_record` | 0.85 |
   | `official` | 0.92 |
   | `primary` | 0.80 |
   | `secondary` | 0.60 |
   | `hearsay` | 0.20 |
   | `generated` | 0.10 |

3. 新增 CLI 命令：
   ```bash
   node research.mjs register-source --name GitHub --type system_of_record \
     --uri https://github.com/org/riskconcile-api --authority 0.85

   node research.mjs list-sources

   # 添加 evidence 时直接内联 sourceRegister
   node research.mjs add-evidence --source GitHub --content "..." \
     --source-type system_of_record --source-authority 0.85
   ```

4. `ResearchSession` 增加 `sourceRegister: Map<string, Source>`。

**预期收益**：
- 每条 Evidence 都可追溯到 Source 权威度。
- 支持 Evidence Ranking 和 Confidence Assessment。

---

## 三、建议修改（保留思想，不照搬）

### 🟡 ① Contract Validation

**核心目标**：保证 Research Contract 完整有效。

**当前问题**：`confirm-contract` 只是写 `confirmedAt` 时间戳，属于 CLI Gate。

**修改方案**：

1. 删除 `confirm-contract` CLI 命令。
2. `set-contract` 时自动做 schema validation：
   - `question` 非空
   - `scope`、`expectedOutput` 为 object
   - `evidenceRequirement` 包含 `minSources`、`primarySourceRatio`、`claimCoverageRatio`
   - `depth`、`timeBudget` 在合理范围
3. Contract 对象增加 `valid: boolean` 和 `validatedAt`。
4. `validate-report` 不检查 contract 是否 confirmed，但如 contract 无效，报告中提示。

---

### 🟡 ② Claim Coverage

**核心目标**：量化 Claim 的证据覆盖，但不阻止 Finish。

**当前问题**：`validate-report` 在 coverage < threshold 时 exit 1。

**修改方案**：

1. `validate-report` 不再因 coverage 低失败。
2. 低 coverage 时：
   - `confidence.level` 降级
   - `knowledgeGaps` 增加 "insufficient_claim_coverage"
   - `recommendations` 增加 "继续收集证据以提升 coverage"
3. `decide()` 把 coverage 作为 Continue 信号之一（软信号）。

---

### 🟡 ③ Evidence Validation

**核心目标**：从格式检查升级为证据质量评估。

**当前问题**：只检查 `source` 和 `uri/content`。

**修改方案**：

1. 新增 `assessEvidenceQuality(evidence, sourceRegister)`：
   ```javascript
   {
     classification: "primary" | "secondary" | "hearsay" | "generated" | "duplicate" | "outdated",
     authority: 0.85,
     freshness: 0.7,
     independence: 1.0,
     recency: 0.9,
     qualityScore: 0.82,
     flags: ["stale_90d"]
   }
   ```

2. 在 `add-evidence` 时自动计算（若未提供 `sourceRegister`，则降级评估）。

3. 新增 `assess-evidence` 命令：
   ```bash
   node research.mjs assess-evidence --id ev1
   ```

---

### 🟡 ④ Conflict Disclosure

**核心目标**：冲突自动写入报告，不 Gate。

**当前问题**：conflict 只进 `conflicts` section，缺少 Alternative Interpretation。

**修改方案**：

1. Conflict 对象增加：
   ```javascript
   {
     alternativeInterpretations: ["不同系统对 owner 的定义可能不同", "数据同步延迟"],
     unknown: true
   }
   ```

2. `report-template` 自动填充 `alternativeInterpretations` 和 `unknown` 占位。

3. `validate-report` 不因 conflict 存在失败。

---

## 四、不建议修改（可以删掉）

### ❌ SKILL.md Frontmatter 扩展

Catalog 需求，非 Runtime 必需。当前 frontmatter 已足够，无需专门投入。

### ❌ references/ 拆分

SKILL.md 未超过需要拆分的阈值，且拆分是 Catalog 管理问题。

### ❌ Compact Status

CLI 输出优化属于 UX，当前优先级低。

---

## 五、缺失但重要的能力

### ⭐ ① Ontology Layer

**当前状态**：已有 14 种 entity type 和 relation validation。

**建议**：保持现有 Ontology，不扩展为完整 KG/OWL/RDF。当前粒度对 Research Runtime 已经足够。

---

### ⭐ ② Research Memory

**核心目标**：Session 结束后保存长期研究资产。

**实施方案**：

1. 新增 `export-memory` 命令：
   ```bash
   node research.mjs export-memory --output memory/riskconcile.json
   ```
   导出：entities、claims、sources、key findings。

2. 新增 `import-memory` 命令：
   ```bash
   node research.mjs import-memory --input memory/riskconcile.json
   ```
   在新研究中复用已确认的实体和 claim。

**优先级**：P2，长期能力。

---

### ⭐ ③ Planner

**核心目标**：从线性 Plan 升级为假设驱动的规划。

**当前状态**：Plan 是 `{ objective, status }` 骨架 list。

**修改方案**：

1. PlanItem 增加 `hypothesis` 字段：
   ```javascript
   {
     id: "p1",
     objective: "Identify vendor background",
     hypothesis: "RiskConcile is a third-party RegTech vendor",
     status: "pending"
   }
   ```

2. `add-plan-item` 增加 `--hypothesis` 选项。

3. `reject-hypothesis` 已存在，保持即可。

4. LLM Playbook 更新：Phase 1 生成可证伪的 hypothesis，而非只做任务列表。

---

### ⭐ ④ Evidence Ranking

**核心目标**：证据不应当权重相同。

**修改方案**：

1. 新增 `rankEvidence(session)`：
   ```javascript
   score = 0.3 * authority
         + 0.2 * freshness
         + 0.2 * independence
         + 0.2 * recency
         + 0.1 * (isPrimary ? 1 : 0)
         - contradictionPenalty
   ```

2. 新增 `rank-evidence` 命令：
   ```bash
   node research.mjs rank-evidence
   ```

3. `assessConfidence` 使用 ranked evidence 计算 overall confidence。

---

### ⭐ ⑤ Research Loop

**核心目标**：从线性 Collect → Finish 升级为循环。

**当前状态**：已有 QuestionTree + Decision Loop，但闭环还可更强。

**修改方案**：

1. 新增 `suggest-questions` 命令：
   ```bash
   node research.mjs suggest-questions
   ```
   基于 gaps / contradictions / uncovered claims 输出候选问题。

2. `decide()` 明确把以下情况作为 Continue 信号：
   - 新 Entity / Relationship / Conflict / Gap
   - Confidence = low
   - Coverage < threshold
   - 仍有 open/investigating question

3. LLM Playbook 更新 Phase 2-4：Question → Collect → Analyze → Gap → Next Question。

---

## 六、优先级与路线图

### P0 — 必须做

| 优先级 | 项 | 说明 |
|--------|-----|------|
| 1 | Eval Harness | 行为质量保证 |
| 2 | Benchmark | 数值正确性保证 |
| 3 | Quality Gate | CI 自动验证 |
| 4 | Source Register | 证据链完整 |

### P1 — 建议做

| 优先级 | 项 | 说明 |
|--------|-----|------|
| 5 | Contract Validation | 删除 CLI Gate，改为 schema validation |
| 6 | Claim Coverage | 软 gate，影响 confidence |
| 7 | Evidence Validation | 升级为质量评估 |
| 8 | Conflict Disclosure | 自动写入报告 |
| 9 | Evidence Ranking | 多维度证据排序 |
| 10 | Planner | Hypothesis-driven planning |
| 11 | Research Loop | suggest-questions + decide 强化 |

### P2 — 长期做

| 优先级 | 项 | 说明 |
|--------|-----|------|
| 12 | Research Memory | 导出/导入长期研究资产 |
| 13 | Ontology 扩展 | 仅在有明确需求时扩展 |

### 建议路线图

```
Week 1: P0 基础保障
├── Eval Harness
├── Benchmark
└── Quality Gate

Week 2: P0 Source Register
└── Source Register + list-sources

Week 3-4: P1 核心修正
├── Contract Validation（删除 confirm-contract）
├── Claim Coverage 软 gate 化
├── Evidence Validation 升级
└── Conflict Disclosure 完整化

Week 5-6: P1 能力增强
├── Evidence Ranking
├── Planner（hypothesis 字段）
└── Research Loop（suggest-questions）

Week 7-8: P2 长期能力
└── Research Memory（export/import）
```

---

## 七、总结

### 核心原则

**Research Runtime ≠ Skill Catalog**

| 维度 | AERS（Catalog + QA） | Enterprise Research Agent（Runtime） |
|------|---------------------|-------------------------------------|
| 目标 | 管理大量 skill | 运行单个研究任务 |
| 评估 | skill 行为 | 研究结果与证据链 |
| 规范 | frontmatter、文件拆分 | Contract、Evidence 质量、Traceability |
| 流程 | 线性 Pipeline | 循环 Research Loop |

### 当前实现已具备的优势

- 单文件约束，无外部依赖
- EvidenceGraph + QuestionTree + ClaimStore 已分离
- ONTOLOGY 已有 14 种实体类型
- Decision Loop 已存在
- Claim Coverage 已计算（只是做成了硬 gate）

### 最值得优先做的三件事

1. **Eval + Benchmark + Quality Gate**：没有它们，任何后续修改都容易回归。
2. **Source Register**：没有它，Evidence Ranking 和 Confidence 都站不住脚。
3. **删除硬 Gate（confirm-contract / coverage gate）**：把 Research 从"过门禁"变成"看信号"。

### 最终检查清单

| 项 | 状态 | 优先级 |
|----|------|--------|
| Eval Harness | 未做 | P0 |
| Benchmark | 未做 | P0 |
| Quality Gate | 未做 | P0 |
| Source Register | 未做 | P0 |
| Contract Validation（删 CLI Gate） | 需重构 | P1 |
| Claim Coverage（软 gate） | 需重构 | P1 |
| Evidence Validation（质量评估） | 需升级 | P1 |
| Conflict Disclosure（完整化） | 需升级 | P1 |
| Evidence Ranking | 未做 | P1 |
| Planner（hypothesis） | 未做 | P1 |
| Research Loop（suggest-questions） | 未做 | P1 |
| Research Memory | 未做 | P2 |
| SKILL.md Frontmatter | 保持 | 不做 |
| references/ 拆分 | 保持 | 不做 |
| Compact Status | 保持 | 不做 |
