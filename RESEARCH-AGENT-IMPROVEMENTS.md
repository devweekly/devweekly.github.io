# Enterprise Research Agent 提升建议（基于 AERS 参考项目）

> 参考项目：[ref-only/Auto-Empirical-Research-Skills](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills) —— **70 个 collection / 1151 个 skill 的经济学实证研究 skill 体系**。
> 核心参考：[aer-workflow](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-workflow/SKILL.md) + [design-principles](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/design-principles.md) + [desk-rejection-audit](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/desk-rejection-audit.md) + [source-register](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/source-register.md) + [claim-evidence-ledger](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/examples/replication-package-skeleton/docs/claim-evidence-ledger.csv)
> **只提建议，不改动现有代码和文档。**

---

## 一、AERS 的核心架构思想（与 Enterprise Research Agent 高度可类比）

虽然 AERS 面向"经济学实证论文"、我们的 enterprise-research-agent 面向"企业调查"，但两者本质都是 **Evidence-driven 知识生产工作流**。AERS 有 11 条 Design Principles，以下 7 条与我们的场景高度相关：

| AERS Principle | 对应到 Enterprise Research Agent |
|---------------|---------------------------------|
| 1. Identification Before Prose | **契约优先于研究**（已有 Research Contract） |
| 2. One Contribution Per Paper | **聚焦核心问题**（已有 Root Question / Plan） |
| 4. Modern Econometrics | **现代分析方法**（已有 Gap / Contradiction / Confidence） |
| 5. The Replication Package Is Part of the Paper | **报告必须可复现**（已有 Traceability Layer） |
| 6. Editor Time Is the Scarcest Resource | **用户体验优先**（每条命令、每个报告都要有 reviewable 颗粒度） |
| 7. Anticipate, Don't React | **主动分析**（已有 Decision Loop） |
| 9. Skills Are Routers, Not Replacements | **Skill 边界清晰**（当前设计已采用） |
| 11. Self-Verifying Gates | **每个阶段有 hard gate**（部分覆盖，建议补强） |

---

## 二、提升建议（10 条）

### 建议 1：建立"Stage Gate"质控门体系

**AERS 模式**（[aer-workflow §Quality Gates](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-workflow/SKILL.md#L57-L66)）：

```text
Gate A (after step 3): contribution sentence written, venue chosen, design survives
Gate B (after step 5): every claim in the draft body traces to an exhibit or a verified citation
Gate C (after step 8): aer-consistency reports all-pass
Gate D (after step 9): aer-referee-sim verdict ≥ major R&R on two consecutive fresh runs
Gate E (after step 11): aer-submission preflight all green
```

**当前实现**：通过 `set-contract` 和 `analyze` 命令做阶段控制，但**没有"门控"概念**——即使 contract 未 confirm、Claim Coverage < 0.9，研究也可继续。

**建议**：引入显式的 **Stage Gate** 机制：

| Gate | 触发条件 | 校验 | 不通过时的处理 |
|------|---------|------|----------------|
| **G0 Contract** | 第一次 add-evidence | `contract.confirmedAt != null` | 拒绝并提示 `set-contract --confirm` |
| **G1 Entity Quality** | 第一次 analyze | 所有 entity 满足 `requiredProperties` | 警告并列出缺失字段 |
| **G2 Claim Coverage** | decide → finish | `coverage ≥ contract.claimCoverageRatio` | 拒绝 Finish，列出未覆盖 claim |
| **G3 Conflict Disclosed** | report-template | `conflicts` section 完整 | 拒绝生成报告模板 |
| **G4 Budget Honored** | decide | `usage ≤ budget` | 警告 |

**实现方式**：
- 每个 gate 是一个 JS 函数 `gate_<name>(session) → {pass: bool, issues: []}`
- 关键命令（`add-evidence` / `analyze` / `decide` / `report-template`）自动调用 gate
- `decide` 默认要求所有 gate 通过才能返回 `finish`

**收益**：从"友好建议"升级为"硬约束"，避免 low-quality research 产出。

---

### 建议 2：设计"Headline Number Register"——内部一致性审计

**AERS 模式**（[aer-consistency](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-consistency/SKILL.md#L30-L54)）：

```text
NUMBER            SOURCE            ABSTRACT  INTRO  RESULTS  CONCL  MATCH
4.2 log points    Tab 3 col 4       yes       yes    yes      yes    OK
s.e. 1.1          Tab 3 col 4       yes       no     yes      no     OK
```

**当前实现**：报告是 LLM 自由生成的 Markdown，**没有 mechanism 保证**：
- Executive Summary 的数字与 keyFindings 一致
- keyFindings.evidenceIds 引用的 Evidence 真实存在
- 同一 Claim 在不同章节的描述一致

**建议**：引入 **Claim Register**（类似 AERS 的 Headline Number Register）：

```json
{
  "claimRegister": [
    {
      "id": "cr1",
      "claimId": "c1",
      "text": "RiskConcile is used by RC Migration Tool",
      "confidence": 0.92,
      "appearsIn": ["executiveSummary", "keyFindings.f1"],
      "consistent": true
    }
  ]
}
```

**CLI 扩展**：

```bash
# 自动检测 claim 一致性
node research.mjs audit-claims

# 输出
# ✓ cr1: appears in [executiveSummary, keyFindings.f1], consistent
# ✗ cr2: appears in [executiveSummary, keyFindings.f3], text mismatch:
#   - summary: "...used by 2 applications"
#   - finding: "...used by 1 application (RC Migration Tool)"
```

**实现方式**：
- `report-template` 接受 claim IDs 作为参数，自动生成 claimRegister
- `audit-claims` 命令扫描报告 JSON，提取所有 claim 出现位置，比对文本

**收益**：
- 报告内"自相矛盾"被自动发现
- 数字错误、表述不一致被系统性检测
- 报告审计从"LLM 自检"升级为"deterministic check"

---

### 建议 3：建立"Source Register"——数据源元数据

**AERS 模式**（[source-register.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/source-register.md)）：

```markdown
| Topic | Source | Repo surfaces that depend on it | Review trigger |
|---|---|---|---|
| AER submission length, abstract, disclosure | https://www.aeaweb.org/journals/aer/submissions | README.md, SKILL.md | Before each release |
```

**当前实现**：`add-evidence --source` 接受字符串（`GitHub`、`LeanIX`、`External`），但**没有 Source 元数据机制**：
- 这个 Source 来自哪个具体 URI？
- 该 Source 何时获取的？是否过期？
- 该 Source 类型的基本 authority 是多少？

**建议**：引入 **Source Register** 作为 session 内的一等对象：

```json
{
  "sourceRegister": [
    {
      "id": "src1",
      "type": "system_of_record",
      "name": "GitHub",
      "uri": "https://github.com/org/riskconcile-api",
      "authority": 0.85,
      "retrievedAt": "2026-07-20T10:00:00Z",
      "metadata": {
        "org": "org",
        "repo": "riskconcile-api",
        "lastCommit": "2026-07-19"
      }
    }
  ],
  "evidenceToSource": {
    "ev1": "src1",
    "ev2": "src1"
  }
}
```

**Source Type 体系**（按 authority 从高到低）：

| Type | Base Authority | 示例 |
|------|---------------|------|
| `system_of_record` | 0.85 | LeanIX、GitHub CODEOWNERS、ServiceNow |
| `official` | 0.92 | Vendor 官网、Regulation 原文 |
| `internal_doc` | 0.80 | Confluence、Notion |
| `engineering` | 0.65 | 技术博客、开源 repo |
| `news` | 0.45 | 科技媒体 |
| `social` | 0.25 | Twitter、Reddit |

**CLI 扩展**：

```bash
# 注册 Source
node research.mjs register-source --name GitHub --type system_of_record \
  --uri "https://github.com/org/riskconcile-api" \
  --authority 0.85 --retrieved-at 2026-07-20

# 查看 Source 列表
node research.mjs list-sources

# 检测过期 Source
node research.mjs stale-sources --threshold-days 30
```

**收益**：
- Evidence 关联的 Source 关系显式化
- Source authority 可追溯（不是硬编码常量）
- Source 过期检测自动化

---

### 建议 4：增加"Conflict Disclosure"硬约束

**AERS 模式**（[design-principles §6](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/design-principles.md#L31-L40)）：

> Editor Time Is the Scarcest Resource
> Every formatting, length, and clarity rule... is designed to make the first 10 minutes of editor review as efficient as possible

**AERS 实践**（[desk-rejection-audit](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/desk-rejection-audit.md)）：把常见 desk-rejection 原因列成 Stage 1-5 的硬性 checklist。

**当前实现**：
- `analyze-contradictions` 检测冲突，但**只是计算**，没有强制披露
- 报告中 `conflicts` 字段是 LLM 自由填写，可能隐瞒

**建议**：在 `report-template` 和 `validate-report` 阶段强制 **Conflict Disclosure**：

```javascript
// validate-report 中的硬约束
const detectedConflicts = analyzeContradictions(session);
if (detectedConflicts.length > 0 && report.conflicts.length === 0) {
  return { 
    valid: false, 
    error: `Detected ${detectedConflicts.length} conflicts not disclosed in report. Use analyze-contradictions to list them.` 
  };
}

// 必须显式说明"无冲突"
if (detectedConflicts.length === 0 && report.conflicts.length === 0) {
  report.conflicts.push({ text: "No contradictions detected across evidence sources.", severity: "info" });
}
```

**实现方式**：
- `report-template` 自动填入 detected conflicts
- `validate-report` 强制要求 `conflicts` section 包含所有 detected conflicts
- 拒绝"零冲突 + 高 confidence"的虚假报告

**收益**：
- 避免"模型隐瞒矛盾"
- 用户一眼看到所有内部证据冲突
- 报告可信度提升

---

### 建议 5：拆分为 Router + 多个专项 Skill

**AERS 模式**（[aer-workflow](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-workflow/SKILL.md) 自身就是一个 router）：

```text
aer-workflow (router)
├─ aer-topic-selection
├─ aer-literature
├─ aer-identification
├─ aer-robustness
├─ aer-paper-body
├─ aer-introduction
├─ aer-tables-figures
├─ aer-consistency
├─ aer-referee-sim
├─ aer-replication
├─ aer-submission
└─ aer-rebuttal
```

**核心思想**（[design-principles §9](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/design-principles.md#L49-L51)）：

> Skills Are Routers, Not Replacements
> Each skill in this repository solves one slice. aer-workflow exists to compose them.

**当前实现**：enterprise-research-agent 是一个**单体 skill**（82KB / 2827 行），试图覆盖 Contract、Investigation、Analysis、Report 全流程。

**建议**：按 AERS 模式拆分为 router + 多个专项 skill：

```
enterprise-research-agent/          # router
├── SKILL.md                       # 路由 + 工作流
├── research.mjs                    # 核心 CLI（保留）
├── skills/
│   ├── era-contract/              # Research Contract 管理
│   │   ├── SKILL.md
│   │   └── contract.mjs
│   ├── era-investigation/         # 调查阶段（Question Tree、Entity、Evidence）
│   │   ├── SKILL.md
│   │   └── investigation.mjs
│   ├── era-analysis/              # 分析阶段（Gap、Contradiction、Confidence）
│   │   ├── SKILL.md
│   │   └── analysis.mjs
│   ├── era-decision/              # Decision Loop
│   │   ├── SKILL.md
│   │   └── decision.mjs
│   └── era-report/                # 报告生成（Traceability、Validation）
│       ├── SKILL.md
│       └── report.mjs
```

**Router 设计**（参考 AERS）：

```markdown
# Enterprise Research Agent Router

## Default Sequence
1. era-contract — set research contract, confirm with user
2. era-investigation — question tree, entity, evidence, relationship
3. era-analysis — gap / contradiction / confidence
4. era-decision — continue or finish?
5. era-report — generate report with traceability

## Routing Map
- "Research vendor X" → era-investigation (vendor type)
- "What conflicts exist?" → era-analysis (contradiction only)
- "Is the report valid?" → era-report (validation)
```

**收益**：
- 每个专项 skill 体积小，LLM 上下文负担小
- 渐进披露（progressive disclosure）：router 轻，专项 skill 按需加载
- 复用性提升：era-analysis 可被其他 skill 复用
- 符合 AERS 设计原则 9

---

### 建议 6：建立"Claim-Evidence Ledger"——可审计账本

**AERS 模式**（[claim-evidence-ledger.csv](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/examples/replication-package-skeleton/docs/claim-evidence-ledger.csv)）：

```csv
claim_id,claim_text,claim_location,evidence_type,evidence_ref,status,notes
C-001,"[Main abstract result, stated as a complete sentence]","Abstract paragraph 1","exhibit","label:tab:main","NEEDS-EVIDENCE","..."
C-002,"[Mechanism or heterogeneity claim]","Introduction paragraph 5","exhibit","label:fig:mechanism","NEEDS-EVIDENCE","..."
```

**当前实现**：Claim 存储在 `claims[]` 数组中，每个 Claim 有 `evidenceIds`、`reasoning`、`verified`，但**没有**：
- Claim 在报告中的具体位置（哪个 section、哪个 finding）
- 报告外的 evidence 来源（如外部 PDF、URL）
- 状态流转记录（NEEDS-EVIDENCE → OK）

**建议**：引入 **Claim-Evidence Ledger**（CSV 格式，可外部审计）：

```csv
claim_id,claim_text,claim_location,evidence_type,evidence_ref,verified,notes
c1,RiskConcile used by RC Migration Tool,executiveSummary:1,evidence,ev1;ev2,true,Cross-validated with LeanIX
c3,LeanIX/GitHub owner conflict,keyFindings:f2,analysis,ev1;ev2,true,Suggests process gap
c4,Resolve owner before contract,recommendations:r1,recommendation,,false,No evidence required
```

**CLI 扩展**：

```bash
# 导出 ledger
node research.mjs export-ledger --format csv --output claim-evidence-ledger.csv

# 导入已有 ledger（合并/校验）
node research.mjs import-ledger --file claim-evidence-ledger.csv

# 审计 ledger
node research.mjs audit-ledger
# 输出
# ✓ All claims have evidence references (except recommendations)
# ✓ All evidence IDs exist in session
# ✗ c2: evidence ev99 not found
```

**收益**：
- 报告审计可使用标准 CSV 工具（Excel、awk、Pandas）
- 第三方可独立验证 Claim 是否有证据支撑
- 报告外的外部证据可显式记录
- 符合 AERS Replication Package 模式

---

### 建议 7：增强"外部审计"——对抗式 Reviewer

**AERS 模式**（[aer-referee-sim](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-referee-sim/SKILL.md)）：

> Use when a complete draft needs the adversarial desk screen and three simulated referee reports before submission.

**当前实现**：当前是**自检模式**（`validate-report` + LLM self-check），没有对抗式外部审计。

**建议**：引入 **Era-Referee-Sim** 技能（参考 AERS）：

```javascript
// 三个独立 reviewer 视角
const REVIEWERS = {
  methodologist: {
    focus: ['identification', 'sample size', 'confounders'],
    questions: [
      "Is the evidence sufficient to support this claim?",
      "Are there alternative explanations?",
      "What's the weakest link in the chain?"
    ]
  },
  domain_expert: {
    focus: ['ontology', 'entities', 'relationships'],
    questions: [
      "Are the entity types aligned with industry standards?",
      "Are critical relationships missing?",
      "Is the coverage scope correct?"
    ]
  },
  skeptic: {
    focus: ['confidence', 'contradictions', 'gaps'],
    questions: [
      "What could be wrong with this research?",
      "Where is the weakest evidence?",
      "What gaps are unacknowledged?"
    ]
  }
};
```

**CLI 扩展**：

```bash
# 运行对抗式评审
node research.mjs review-as --role skeptic
node research.mjs review-as --role methodologist
node research.mjs review-as --role domain-expert

# 完整三 reviewer 模拟
node research.mjs referee-sim
# 输出
# === Methodologist Review ===
# ✓ Sample size sufficient
# ✗ Weak evidence for c3 (only 2 sources)
# 
# === Domain Expert Review ===
# ✓ Vendor/Application/Repository entities appropriate
# ✗ Missing Contract entity
#
# === Skeptic Review ===
# ✗ c5: "RiskConcile is critical" - no evidence for "critical"
# ✗ Unacknowledged gap: no evidence of Contract
```

**收益**：
- 在用户提交报告前，先过对抗式审查
- 模拟三个不同视角的 reviewer，避免单一视角盲点
- 提前发现"模型自吹自擂"的问题

---

### 建议 8：增强"Knowledge Decay"机制——证据时效性

**AERS 模式**（[aer-replication §Data and Code Availability](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-replication/SKILL.md#L21-L35)）：

> 5-year preservation commitment, replicator assistance commitment

**当前实现**：
- Evidence 有 `lastUpdated` 字段
- `assess-confidence` 中提到 `>365 天扣分`
- **但**：没有强制 mechanism 提醒重新获取

**建议**：引入 **Knowledge Decay** 机制：

```javascript
// 检查 stale evidence
function detectStaleEvidence(session) {
  const STALE_THRESHOLDS = {
    system_of_record: 30,   // 30 天
    official: 90,
    internal_doc: 60,
    engineering: 180,
    news: 14,
    social: 7
  };
  
  const stale = [];
  for (const ev of session.evidence) {
    const sourceType = session.sourceRegister[ev.sourceId]?.type;
    const threshold = STALE_THRESHOLDS[sourceType] || 90;
    const ageDays = daysSince(ev.lastUpdated);
    if (ageDays > threshold) {
      stale.push({ evidenceId: ev.id, ageDays, threshold, sourceType });
    }
  }
  return stale;
}
```

**CLI 扩展**：

```bash
# 检测过期证据
node research.mjs stale-evidence
# 输出
# ev1 (GitHub): 45 days old, threshold 30 days
# ev5 (News): 21 days old, threshold 14 days

# 重新获取并更新
node research.mjs refresh-evidence --id ev1

# 报告生成时自动警告
node research.mjs report-template --output report.json
# ⚠ 2 stale evidence detected, consider refreshing
```

**收益**：
- 自动检测过期证据，避免基于过时数据做判断
- 知识有"保质期"，研究结果有"时间戳"
- 与 Confidence Assessment 形成闭环

---

### 建议 9：设计"Compactness"——核心可压缩视图

**AERS 模式**（[aer-workflow §Default Sequence](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-workflow/SKILL.md#L40-L55)）：

> 12 个步骤，每步 1-2 行描述。

**当前实现**：`session-status` 输出**全量 session**（contract + budget + plan + questions + graph + claims + analysis），可能非常长（数百行 JSON）。

**建议**：分层级输出，按"用户场景"提供不同粒度：

| 场景 | 命令 | 输出粒度 |
|------|------|---------|
| "我应该继续吗？" | `decide` | 1 行 + reasoning |
| "现在研究到哪了？" | `session-status --tldr` | 10-20 行（关键指标） |
| "具体细节是什么？" | `session-status --full` | 全量 JSON |
| "我有多少证据？" | `session-summary` | 统计数字（仅数字） |
| "哪些 Claim 未覆盖？" | `coverage --gaps` | 仅未覆盖 Claim 列表 |

**实现**：

```bash
# 紧凑视图
node research.mjs session-status --tldr
# Goal: Research RiskConcile
# Progress: 45/200 evidence, 12/30 questions, 8/15 claims
# Coverage: 0.85 (target 0.9)
# Decision: Continue (1 new entity in last cycle)
# Budget: depth 2/3, questions 12/40, evidence 45/300
```

**收益**：
- 用户快速理解研究状态
- LLM 上下文负担小（不需要每次加载全量 session）
- 适合"progress check"类高频查询

---

### 建议 10：建立"Reflexivity"——可重放性

**AERS 模式**：[replication-package-skeleton](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/examples/replication-package-skeleton/) 提供了**完整的可重放项目**：

```
replication-package/
├── README.md
├── LICENSE
├── data/{raw,intermediate,codebook}/
├── code/{00_setup,01_clean,02_analysis,03_tables,04_figures}.do
├── output/{tables,figures}/
└── docs/{exhibit-register.md, claim-evidence-ledger.csv}
```

**核心思想**：
- 数据 + 代码 + 文档 + 产出 = 完整可重放
- README 在项目第一天就写（不是接受后补）

**当前实现**：
- research.mjs 是 deterministic CLI（可重放）
- Session JSON 是状态文件（可重放）
- **但**：缺少"研究项目模板"概念——一个完整的 enterprise research project 应该长什么样？

**建议**：引入 **Research Project Template**：

```
research-project/
├── session.json                    # 当前 session 状态
├── README.md                       # 研究目标、scope、plan
├── evidence/
│   ├── github-ev1.json             # 缓存的 evidence
│   ├── confluence-ev2.json
│   └── ...
├── claim-evidence-ledger.csv       # 可审计账本
├── research-log.md                 # 每次 decide 的时间线
└── report/
    ├── draft-v1.json
    ├── draft-v2.json
    └── final.md
```

**CLI 扩展**：

```bash
# 初始化研究项目（创建模板）
node research.mjs init-project --goal "Research RiskConcile" --path ./research-projects/riskconcile

# 重放（从 session.json 重新生成报告）
node research.mjs replay --session ./research-projects/riskconcile/session.json

# 导出研究项目
node research.mjs export-project --output research-projects/riskconcile.tar.gz
```

**收益**：
- 完整研究项目可打包、可重放、可分享
- 第三方可独立验证研究过程
- 与 AERS Replication Package 模式对齐

---

## 三、总结：与 AERS 的差异分析

| 维度 | AERS | 当前 Enterprise Research Agent | 差距 |
|------|-----|-------------------------------|------|
| **Skill 拆分** | Router + 14 个专项 | 单体 skill | 大（建议 5） |
| **Stage Gates** | 5 个硬质控门 | 软建议 | 大（建议 1） |
| **Claim Ledger** | CSV 格式可审计 | 内存数组 | 中（建议 6） |
| **External Audit** | 对抗式 3 reviewer | LLM 自检 | 大（建议 7） |
| **Source Register** | 独立 source-register.md | 字符串 | 中（建议 3） |
| **Knowledge Decay** | 5 年承诺 + 定期 re-run | lastUpdated 字段 | 中（建议 8） |
| **Consistency Audit** | 数字一致性 + 样本量 + 单位 | 无 | 大（建议 2） |
| **Conflict Disclosure** | 强制 | 软建议 | 中（建议 4） |
| **Compactness** | 12 步 1-2 行 | 全量 JSON | 小（建议 9） |
| **Replicability** | 完整 project 模板 | session.json | 中（建议 10） |

## 四、优先级排序

| 优先级 | 建议 | 工作量 | 收益 |
|--------|------|--------|------|
| **P0** | 建议 1（Stage Gates） | 中 | 质控硬约束 |
| **P0** | 建议 2（Claim Audit） | 小 | 报告一致性 |
| **P1** | 建议 3（Source Register） | 中 | Evidence 可信度 |
| **P1** | 建议 4（Conflict Disclosure） | 小 | 报告透明度 |
| **P1** | 建议 7（Referee-Sim） | 大 | 对抗式审查 |
| **P2** | 建议 5（Skill 拆分） | 大 | LLM 上下文优化 |
| **P2** | 建议 6（Claim Ledger） | 中 | 第三方审计 |
| **P2** | 建议 8（Knowledge Decay） | 小 | 时效性管理 |
| **P3** | 建议 9（Compactness） | 小 | 用户体验 |
| **P3** | 建议 10（Replicability） | 中 | 完整工作流 |

---

## 附录：参考文件索引

| 参考文件 | 核心思想 | 对应建议 |
|---------|---------|---------|
| [aer-workflow](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-workflow/SKILL.md) | Router + 12 步 Default Sequence | #5 |
| [design-principles](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/design-principles.md) | 11 条设计原则 | 总纲 |
| [desk-rejection-audit](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/desk-rejection-audit.md) | 5 Stage 硬性 checklist | #1 |
| [aer-consistency](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-consistency/SKILL.md) | Headline Number Register | #2 |
| [source-register](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/source-register.md) | Source 元数据 | #3 |
| [aer-identification](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-identification/SKILL.md) | Master Decision Tree | 设计模式参考 |
| [aer-replication](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-replication/SKILL.md) | Replication Package 模板 | #10 |
| [claim-evidence-ledger.csv](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/examples/replication-package-skeleton/docs/claim-evidence-ledger.csv) | CSV 账本 | #6 |
| [aer-referee-sim](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/skills/aer-referee-sim/SKILL.md) | 对抗式评审 | #7 |
| [replication-package-skeleton](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/examples/replication-package-skeleton/) | 完整项目结构 | #10 |
