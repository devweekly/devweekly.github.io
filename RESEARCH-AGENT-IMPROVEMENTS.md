# Enterprise Research Agent 提升建议（修订版）

> 基于 AERS 架构思想的精华提取，聚焦 **Research Runtime** 核心能力，而非 Skill Catalog 管理。
> **只提建议，不改动现有代码和文档。**

---

## 一、评审结论

| 原建议 | 评审结论 | 说明 |
|--------|---------|------|
| Eval Harness | ✅ 必须做 | 缩小范围，几十个 Scenario 即可 |
| Benchmark | ✅ 必须做 | deterministic 算法必须验证 |
| Quality Gate | ✅ 必须做 | CI：lint + test + eval + benchmark |
| Source Register | ✅ 必须做 | 完整的 Source 元数据链 |
| Contract Validation | 🟡 保留思想 | 不搞 CLI Gate，做 Research Contract Validation |
| Claim Coverage | 🟡 做，但不硬 Gate | 影响 Confidence，不阻止 Finish |
| Evidence Validation | 🟡 升级 | 从格式检查升级为证据质量评估 |
| Conflict Disclosure | 🟡 自动写入报告 | 不做 Gate，自动增加到报告 |
| SKILL.md Frontmatter | ❌ 不建议 | 属于 Catalog 需求，非 Runtime |
| references/ 拆分 | ❌ 不建议 | SKILL.md < 400 行无需拆 |
| Compact Status | ❌ 不建议 | UX 优化，优先级低 |

**采纳约 60%，舍弃约 40%。**

---

## 二、必须修改（Strong Yes）

### ✅ ① Eval Harness — 行为评估框架

**核心目标**：防止 Prompt 改坏、Workflow 改坏、Agent 胡说。

**设计思路**：不照搬 AERS 的复杂场景体系，聚焦几十个关键 Scenario。

**实施方案**：

```
.trae/skills/enterprise-research-agent/
├── eval/
│   ├── vendor-search.toml
│   ├── regulation-impact.toml
│   ├── capability-sourcing.toml
│   ├── conflict-detection.toml
│   ├── evidence-collection.toml
│   └── run.js                    # 评估执行器
```

**场景定义**（vendor-search.toml）：

```toml
id = "vendor-search"
title = "Vendor research should follow Contract → Evidence → Claim workflow"
severity = "critical"

prompt = """
Research RiskConcile as a vendor.
"""

expected = [
  "set-contract called",
  "evidence collected from ≥2 sources",
  "claims have evidenceIds",
  "no skip-contract detected",
  "conflicts disclosed if any"
]

[[checks]]
id = "contract-first"
type = "regex_any"
patterns = ['(?i)set-contract', '(?i)contract.*confirmed']

[[checks]]
id = "multiple-sources"
type = "count_min"
target = 2
field = "evidence.source"

[[checks]]
id = "claims-linked"
type = "regex_any"
patterns = ['evidenceIds']

[[checks]]
id = "no-skip-contract"
type = "regex_none"
patterns = ['(?i)skip.?contract', '(?i)bypass.?contract']
```

**评估执行器**（run.js）：

```javascript
async function runEval(scenario) {
  const result = await executeSkill(scenario.prompt);
  const passed = scenario.checks.every(check => {
    switch(check.type) {
      case 'regex_any': 
        return check.patterns.some(p => new RegExp(p).test(result));
      case 'regex_none':
        return !check.patterns.some(p => new RegExp(p).test(result));
      case 'count_min':
        return countField(result, check.field) >= check.target;
      default:
        return true;
    }
  });
  return { scenario: scenario.id, passed };
}
```

**CLI 集成**：

```bash
# 运行所有评估
node research.mjs eval

# 运行特定场景
node research.mjs eval --scenario vendor-search
```

**预期收益**：
- 每次修改后自动验证关键行为
- 防止"跳过 contract"、"证据不足"等回归
- 建立行为质量基线

---

### ✅ ② Benchmark — 数值基准测试

**核心目标**：验证 deterministic 算法的正确性。

**设计思路**：用确定性数据验证核心算法。

**实施方案**：

```
.trae/skills/enterprise-research-agent/
├── benchmark/
│   ├── data/
│   │   ├── claim-coverage.json
│   │   ├── confidence-assessment.json
│   │   ├── gap-detection.json
│   │   └── evidence-ranking.json
│   └── run.js
```

**测试数据**（claim-coverage.json）：

```json
{
  "claims": [
    { "id": "c1", "evidenceIds": ["ev1", "ev2"] },
    { "id": "c2", "evidenceIds": ["ev1"] },
    { "id": "c3", "evidenceIds": [] },
    { "id": "c4", "evidenceIds": ["ev3"] }
  ],
  "expected": {
    "coverage_ratio": 0.75,
    "uncovered_count": 1,
    "covered_count": 3
  }
}
```

**基准执行器**（run.js）：

```javascript
async function runBenchmark(task) {
  const data = JSON.parse(fs.readFileSync(task.data));
  const expected = data.expected;
  
  const session = new ResearchSession();
  session.claims = data.claims;
  
  const actual = {
    coverage_ratio: calculateCoverage(session),
    uncovered_count: session.claims.filter(c => !c.evidenceIds?.length).length,
    covered_count: session.claims.filter(c => c.evidenceIds?.length).length
  };
  
  const passed = Object.keys(expected).every(key => 
    Math.abs(actual[key] - expected[key]) < 0.001
  );
  
  return { task: task.id, passed, actual, expected };
}
```

**CLI 集成**：

```bash
# 运行所有基准测试
node research.mjs benchmark

# 运行特定基准
node research.mjs benchmark --task claim-coverage
```

**预期收益**：
- Claim Coverage、Confidence、Gap Detection、Evidence Ranking 算法正确性有数值保证
- 防止回归
- 支持 A/B 测试不同实现方案

---

### ✅ ③ Quality Gate — CI 质量门

**核心目标**：每次提交自动验证代码质量。

**实施方案**：

```makefile
.PHONY: lint test eval benchmark check

lint:
    pnpm lint

test:
    node test/run.js

eval:
    node eval/run.js

benchmark:
    node benchmark/run.js

check: lint test eval benchmark
```

**CI 配置**（.github/workflows/quality.yml）：

```yaml
name: Quality Gate
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: make check
```

**预期收益**：
- 每次提交自动验证
- 防止 broken build、lint 错误、测试失败
- 建立团队质量标准

---

### ✅ ④ Source Register — 数据源注册表

**核心目标**：建立完整的证据链：Evidence → Source → Authority。

**实施方案**：

**扩展 Session 数据模型**：

```json
{
  "sourceRegister": [
    {
      "id": "src1",
      "name": "GitHub",
      "type": "system_of_record",
      "uri": "https://github.com/org/riskconcile-api",
      "authority": 0.85,
      "retrievedAt": "2026-07-20T10:00:00Z",
      "license": "MIT",
      "freshness": "daily",
      "confidence": 0.9
    }
  ],
  "evidence": [
    { "id": "ev1", "sourceId": "src1", "content": "..." }
  ]
}
```

**Source Type 体系**：

| Type | Authority | 说明 |
|------|----------|------|
| `system_of_record` | 0.85 | LeanIX、GitHub CODEOWNERS、ServiceNow |
| `official` | 0.92 | Vendor 官网、Regulation 原文 |
| `primary` | 0.80 | 原始数据、第一手资料 |
| `secondary` | 0.60 | 转述、分析报告 |
| `hearsay` | 0.20 | 道听途说、非正式来源 |
| `generated` | 0.10 | AI 生成内容 |

**CLI 集成**：

```bash
# 注册 Source
node research.mjs register-source --name GitHub --type system_of_record \
  --uri "https://github.com/org/riskconcile-api" --authority 0.85

# 查看 Source 列表
node research.mjs list-sources

# 添加 Evidence 时自动关联 Source
node research.mjs add-evidence --source GitHub --content "..."
```

**预期收益**：
- 完整的证据链：Evidence → Source → Authority
- Source 元数据可追溯
- 过期检测基于 Source 类型动态调整

---

## 三、建议修改（保留思想，不照搬）

### 🟡 ① Contract Validation — 研究契约验证

**核心目标**：验证 Research Contract 是否完整。

**设计思路**：不搞 CLI Gate，做 Research Contract Validation。

**实施方案**：

**Research Contract Schema**：

```javascript
const CONTRACT_SCHEMA = {
  goal: { required: true, minLength: 10 },
  scope: { required: true, type: 'object' },
  deliverables: { required: true, type: 'array' },
  depth: { required: false, default: 3, min: 1, max: 5 },
  timeBudget: { required: false, default: 8, min: 1, max: 24 },
  acceptanceCriteria: { required: true, type: 'object' }
};

function validateContract(contract) {
  const errors = [];
  for (const [field, rules] of Object.entries(CONTRACT_SCHEMA)) {
    if (rules.required && !contract[field]) {
      errors.push(`${field} is required`);
    }
    if (contract[field] && rules.minLength && contract[field].length < rules.minLength) {
      errors.push(`${field} must be at least ${rules.minLength} characters`);
    }
    if (contract[field] && rules.type && typeof contract[field] !== rules.type) {
      errors.push(`${field} must be ${rules.type}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
```

**使用方式**：

```bash
# set-contract 时自动验证
node research.mjs set-contract --goal "Research RiskConcile" \
  --scope '{"industry":"RegTech"}' \
  --deliverables '["vendor-intel-report"]' \
  --acceptance-criteria '{"coverage":0.9}'

# 输出：✓ Contract validated successfully
```

**预期收益**：
- Contract 完整性有保证
- 用户清楚知道缺少什么
- 不增加额外的 CLI 步骤

---

### 🟡 ② Claim Coverage — 覆盖度评估

**核心目标**：评估 Claim 的证据覆盖情况。

**设计思路**：Coverage 影响 Confidence，不阻止 Finish。

**实施方案**：

```javascript
function calculateCoverage(session) {
  const total = session.claims.length;
  const covered = session.claims.filter(c => c.evidenceIds?.length > 0).length;
  return total > 0 ? covered / total : 0;
}

function updateConfidenceFromCoverage(session) {
  const coverage = calculateCoverage(session);
  if (coverage >= 0.9) {
    session.confidence.level = 'high';
  } else if (coverage >= 0.6) {
    session.confidence.level = 'medium';
  } else {
    session.confidence.level = 'low';
  }
  session.confidence.coverage = coverage;
}
```

**Report 输出**：

```markdown
## Confidence Assessment

Overall: medium (0.475)
Claim Coverage: 75%

⚠ Evidence is insufficient.
Suggested actions:
- Continue research to increase coverage to 90%
- Focus on: c3 (no evidence)
```

**预期收益**：
- Coverage 量化显示
- 影响 Confidence，不阻止 Finish
- 提供继续研究的建议

---

### 🟡 ③ Evidence Validation — 证据质量评估

**核心目标**：评估证据质量，而非格式检查。

**设计思路**：从格式检查升级为证据质量评估。

**实施方案**：

```javascript
function assessEvidenceQuality(evidence, sourceRegister) {
  const source = sourceRegister.find(s => s.id === evidence.sourceId);
  const score = {
    authority: source?.authority || 0.5,
    freshness: calculateFreshnessScore(evidence),
    independence: calculateIndependenceScore(evidence, sourceRegister),
    isPrimary: isPrimarySource(source),
    recency: calculateRecencyScore(evidence)
  };
  
  const overall = (score.authority * 0.3 + score.freshness * 0.2 + 
                   score.independence * 0.2 + score.recency * 0.2 + 
                   (score.isPrimary ? 0.1 : 0));
  
  return { ...score, overall };
}

function isPrimarySource(source) {
  return source?.type === 'primary' || source?.type === 'system_of_record';
}

function calculateFreshnessScore(evidence) {
  if (!evidence.lastUpdated) return 0.5;
  const days = (Date.now() - new Date(evidence.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 30) return 1.0;
  if (days < 90) return 0.7;
  if (days < 365) return 0.4;
  return 0.1;
}

function calculateIndependenceScore(evidence, sourceRegister) {
  // 同一 Source 的 Evidence 独立性较低
  const sameSourceCount = sourceRegister.filter(s => 
    s.id === evidence.sourceId
  ).length;
  return sameSourceCount > 3 ? 0.3 : 1.0;
}

function calculateRecencyScore(evidence) {
  // 最近获取的证据权重更高
  if (!evidence.retrievedAt) return 0.5;
  const hours = (Date.now() - new Date(evidence.retrievedAt).getTime()) / (1000 * 60 * 60);
  if (hours < 24) return 1.0;
  if (hours < 168) return 0.7;
  return 0.3;
}
```

**CLI 集成**：

```bash
# 评估证据质量
node research.mjs assess-evidence --id ev1

# 输出：
# Authority: 0.85 (system_of_record)
# Freshness: 0.7 (90-365 days)
# Independence: 1.0 (unique source)
# Primary: true
# Recency: 0.7 (1 week)
# Overall: 0.815
```

**预期收益**：
- 证据质量有量化评估
- 区分 Primary/Secondary/Hearsay/Generated
- 自动检测 Duplicate 和 Outdated

---

### 🟡 ④ Conflict Disclosure — 冲突披露

**核心目标**：自动将冲突写入报告。

**设计思路**：不做 Gate，自动增加到报告。

**实施方案**：

```javascript
function analyzeContradictions(session) {
  const conflicts = [];
  const claimsByProperty = {};
  
  for (const claim of session.claims) {
    if (claim.type !== 'fact') continue;
    const matches = claim.text.match(/(\w+)\s*[=:]\s*([^\s.,]+)/g);
    if (matches) {
      for (const match of matches) {
        const [key, value] = match.split(/[=:]/).map(s => s.trim());
        if (!claimsByProperty[key]) claimsByProperty[key] = [];
        claimsByProperty[key].push({ claimId: claim.id, value, evidenceIds: claim.evidenceIds });
      }
    }
  }
  
  for (const [property, values] of Object.entries(claimsByProperty)) {
    const uniqueValues = [...new Set(values.map(v => v.value.toLowerCase()))];
    if (uniqueValues.length > 1) {
      conflicts.push({
        property,
        conflictingValues: uniqueValues,
        sources: [...new Set(values.flatMap(v => v.evidenceIds))],
        severity: 'high'
      });
    }
  }
  return conflicts;
}
```

**Report 自动填充**：

```markdown
## Conflicting Evidence

### Property: owner

**Conflicting Values**: Team A, Team B

**Sources**: ev1 (LeanIX), ev2 (GitHub)

**Alternative Interpretation**: Ownership may be assigned differently in different systems.

---

### Unknown

**Evidence**: ev3 (Confluence) indicates "pending transfer"

**Status**: Resolution pending
```

**预期收益**：
- 冲突自动进入报告
- 提供 Alternative Interpretation
- 不阻止研究流程

---

## 四、缺失但重要的内容

### ⭐ ① Ontology Layer — 本体层

**核心目标**：建立完整的推理链：Evidence → Entity → Relationship → Claim。

**设计思路**：Research 不应该只有 Evidence → Claim，应该有中间层。

**实施方案**：

```json
{
  "entities": [
    {
      "id": "e1",
      "type": "Vendor",
      "name": "RiskConcile",
      "properties": {
        "website": "https://riskconcile.com",
        "category": "RegTech"
      },
      "evidenceIds": ["ev1", "ev2"]
    }
  ],
  "relationships": [
    {
      "id": "r1",
      "from": "e1",
      "to": "e2",
      "type": "used_by",
      "evidenceIds": ["ev3"]
    }
  ],
  "claims": [
    {
      "id": "c1",
      "text": "RiskConcile is used by RC Migration Tool",
      "entityIds": ["e1", "e2"],
      "relationshipIds": ["r1"],
      "evidenceIds": ["ev1", "ev2", "ev3"]
    }
  ]
}
```

**推理链**：

```
Evidence (ev1) → Entity (Vendor: RiskConcile)
Evidence (ev2) → Entity (Application: RC Migration Tool)
Evidence (ev3) → Relationship (Vendor → used_by → Application)
Entity + Relationship → Claim (RiskConcile is used by RC Migration Tool)
```

**预期收益**：
- 跨文档推理能力大幅增强
- Entity 和 Relationship 可复用
- Claim 有完整的推导路径

---

### ⭐ ② Research Memory — 研究记忆

**核心目标**：Session 结束后，保存长期研究资产。

**设计思路**：形成持续研究资产，而非一次性结果。

**实施方案**：

```
.trae/skills/enterprise-research-agent/
├── memory/
│   ├── vendors/
│   │   ├── riskconcile.json
│   │   └── ...
│   ├── technologies/
│   │   ├── java.json
│   │   └── ...
│   ├── findings/
│   │   ├── 2026-q3-riskconcile-usage.json
│   │   └── ...
│   └── evidence/
│       └── ...
```

**Memory Schema**：

```json
{
  "type": "vendor",
  "id": "riskconcile",
  "name": "RiskConcile",
  "properties": {
    "website": "https://riskconcile.com",
    "category": "RegTech",
    "lastUpdated": "2026-07-20"
  },
  "evidenceIds": ["ev1", "ev2"],
  "relatedEntities": ["e2", "e3"],
  "history": [
    { "date": "2026-07-10", "session": "sess-001" },
    { "date": "2026-07-20", "session": "sess-002" }
  ]
}
```

**CLI 集成**：

```bash
# 保存研究资产
node research.mjs save-memory --session research-session.json

# 查询研究记忆
node research.mjs query-memory --type vendor --name RiskConcile

# 引用历史证据
node research.mjs recall-evidence --vendor RiskConcile
```

**预期收益**：
- 研究结果可复用
- 形成持续研究资产
- 新研究可基于历史证据

---

### ⭐ ③ Planner — 研究规划器

**核心目标**：从线性流程升级为假设驱动的规划。

**设计思路**：Hypothesis → Research Plan → Evidence Collection → Gap → Next Question。

**实施方案**：

```javascript
class Planner {
  constructor(session) {
    this.session = session;
    this.hypotheses = [];
    this.plan = [];
  }
  
  addHypothesis(text) {
    this.hypotheses.push({
      id: `h${Date.now()}`,
      text,
      status: 'pending',
      evidenceIds: []
    });
  }
  
  generatePlan() {
    this.plan = this.hypotheses.map(hypothesis => ({
      id: `p${Date.now()}`,
      hypothesisId: hypothesis.id,
      steps: [
        `Collect evidence for: ${hypothesis.text}`,
        `Analyze evidence`,
        `Check for gaps`,
        `Verify or reject hypothesis`
      ],
      status: 'pending'
    }));
  }
  
  nextQuestion() {
    const pendingPlan = this.plan.find(p => p.status === 'pending');
    if (!pendingPlan) return null;
    
    const hypothesis = this.hypotheses.find(h => h.id === pendingPlan.hypothesisId);
    return {
      text: `How can we verify: ${hypothesis.text}`,
      planId: pendingPlan.id,
      hypothesisId: hypothesis.id
    };
  }
}
```

**CLI 集成**：

```bash
# 添加假设
node research.mjs add-hypothesis --text "RiskConcile is used by RC Migration Tool"

# 生成研究计划
node research.mjs generate-plan

# 获取下一个问题
node research.mjs next-question

# 更新计划状态
node research.mjs update-plan --id p1 --status in_progress
```

**预期收益**：
- Research 从线性升级为假设驱动
- Agent 更聪明，知道为什么问这个问题
- 避免重复探索

---

### ⭐ ④ Evidence Ranking — 证据排序

**核心目标**：不是所有证据权重一样。

**设计思路**：基于多维度计算 Evidence Score。

**实施方案**：

```javascript
function rankEvidence(session) {
  return session.evidence.map(ev => {
    const quality = assessEvidenceQuality(ev, session.sourceRegister);
    return {
      ...ev,
      score: quality.overall,
      ranking: {
        authority: quality.authority,
        freshness: quality.freshness,
        independence: quality.independence,
        recency: quality.recency
      }
    };
  }).sort((a, b) => b.score - a.score);
}
```

**Score 分布**：

```
Score Range | Meaning
----------- | -------
0.8-1.0     | Strong evidence (primary, fresh, independent)
0.6-0.8     | Good evidence (secondary, reasonably fresh)
0.4-0.6     | Weak evidence (older, less independent)
0.0-0.4     | Unreliable evidence (hearsay, generated, outdated)
```

**CLI 集成**：

```bash
# 排序证据
node research.mjs rank-evidence

# 输出：
# 1. ev2 (GitHub): 0.92 — primary, fresh, independent
# 2. ev1 (LeanIX): 0.85 — system_of_record, recent
# 3. ev3 (Confluence): 0.60 — secondary, moderate freshness
# 4. ev4 (Twitter): 0.25 — hearsay, outdated
```

**预期收益**：
- 证据权重有量化评估
- 区分 Strong/Good/Weak/Unreliable
- 支持基于证据质量的决策

---

### ⭐ ⑤ Research Loop — 研究循环

**核心目标**：从 Collect → Finish 升级为持续循环。

**设计思路**：Question → Collect → Analyze → Gap → Next Question。

**实施方案**：

```javascript
async function researchLoop(session) {
  while (true) {
    const question = session.nextQuestion();
    if (!question) break;
    
    console.log(`Question: ${question.text}`);
    
    const evidence = await collectEvidence(question);
    session.addEvidence(evidence);
    
    session.analyze();
    
    const gaps = session.findGaps();
    if (gaps.length === 0) {
      console.log('✓ No gaps found');
      break;
    }
    
    console.log(`✗ ${gaps.length} gap(s) found:`);
    gaps.forEach(g => console.log(`  - ${g.text}`));
    
    session.nextQuestion(gaps);
  }
  
  return session.generateReport();
}
```

**循环流程**：

```
Question: "What applications use RiskConcile?"
↓
Collect Evidence: ev1 (LeanIX), ev2 (GitHub)
↓
Analyze: Found RC Migration Tool
↓
Gap: "No Contract information found"
↓
Next Question: "Is there a Contract for RiskConcile?"
↓
Collect Evidence: ev3 (Confluence)
↓
Analyze: Contract pending
↓
Gap: None
↓
Finish → Generate Report
```

**预期收益**：
- 真正的 Research Loop，而非线性流程
- 自动发现 Gap 并继续研究
- 这是 Research Agent 与 Search Agent 的本质区别

---

## 五、不建议修改（可以删掉）

### ❌ SKILL.md Frontmatter

属于 AERS Catalog 需求，非 Research Runtime 需求。

如果 Trae/Claude/Cursor 支持，再考虑添加。

### ❌ references/ 拆分

SKILL.md 已经精简到 ~865 行，且已包含核心概念。

Split Skill 是 Catalog 管理问题，不是 Research 问题。

### ❌ Compact Status

CLI 输出优化，属于 UX。

优先级低，以后再做。

---

## 六、优先级排序

### 必须做（P0）

| 优先级 | 建议 | 工作量 | 预期收益 |
|--------|------|--------|---------|
| 1 | Eval Harness | 中 | 行为质量保证 |
| 2 | Benchmark | 中 | 数值正确性保证 |
| 3 | Quality Gate | 小 | CI 自动验证 |
| 4 | Source Register | 中 | 证据链完整 |

### 建议做（P1）

| 优先级 | 建议 | 工作量 | 预期收益 |
|--------|------|--------|---------|
| 5 | Ontology Layer | 大 | 跨文档推理 |
| 6 | Research Loop | 大 | 持续研究能力 |
| 7 | Planner | 中 | 假设驱动规划 |
| 8 | Evidence Ranking | 中 | 证据质量评估 |
| 9 | Contract Validation | 小 | 契约完整性 |
| 10 | Claim Coverage | 小 | 覆盖度量化 |
| 11 | Evidence Validation | 小 | 证据质量检测 |
| 12 | Conflict Disclosure | 小 | 冲突透明 |

### 建议做（P2）

| 优先级 | 建议 | 工作量 | 预期收益 |
|--------|------|--------|---------|
| 13 | Research Memory | 大 | 持续研究资产 |

---

## 七、实施路线图（8 周）

```
Week 1-2: 基础保障
├── P0: Eval Harness — 3 天
├── P0: Benchmark — 3 天
└── P0: Quality Gate — 2 天

Week 3-4: 核心能力
├── P0: Source Register — 3 天
├── P1: Ontology Layer — 5 天
└── P1: Research Loop — 5 天

Week 5-6: 增强功能
├── P1: Planner — 3 天
├── P1: Evidence Ranking — 3 天
├── P1: Contract Validation — 1 天
├── P1: Claim Coverage — 1 天
├── P1: Evidence Validation — 1 天
└── P1: Conflict Disclosure — 1 天

Week 7-8: 长期能力
├── P2: Research Memory — 5 天
└── 测试与验证 — 3 天
```

---

## 八、总结

### 核心思想

**Research Runtime ≠ Skill Catalog**

| 维度 | AERS（Catalog + QA） | Enterprise Research Agent（Runtime） |
|------|---------------------|-------------------------------------|
| 目标 | 管理 1151 个 skill | 运行单个研究任务 |
| 评估 | 评估 skill 行为 | 评估研究结果 |
| 规范 | frontmatter、行数控制 | Contract、Evidence 质量 |
| 流程 | 线性 Pipeline | 循环 Research Loop |

### 真正的核心能力

1. **Ontology Layer** — 跨文档推理的基础
2. **Research Loop** — 持续研究的核心
3. **Planner** — 假设驱动的规划
4. **Evidence Ranking** — 证据质量评估
5. **Research Memory** — 持续研究资产

### 预期效果

| 维度 | 当前状态 | 实施后 |
|------|---------|--------|
| **推理能力** | Evidence → Claim | Evidence → Entity → Relationship → Claim |
| **研究流程** | 线性 Collect → Finish | 循环 Question → Collect → Analyze → Gap |
| **规划能力** | 无 | Hypothesis → Plan → Execution |
| **证据评估** | 无 | Authority + Freshness + Independence + Primary |
| **研究资产** | 一次性 | 持续积累 |

---

## 九、附录：参考文件索引

| 参考文件 | 核心思想 | 对应建议 |
|---------|---------|---------|
| [AERS eval-harness/scenarios/](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/scenarios/) | prompt + rubric 评估模式 | ✅ Eval Harness |
| [AERS benchmark/](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/benchmark/) | 数值基准测试 | ✅ Benchmark |
| [AERS docs/QUALITY_GATE.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/QUALITY_GATE.md) | CI 质量门 | ✅ Quality Gate |
| [AERS docs/TRUST.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/TRUST.md) | 信任面分层 | ✅ Source Register |
| [v4.md](file:///Users/saga/code-repos/devweekly.github.io/temp/research-agent/v4.md) | Question Tree、5 原则 | ⭐ Research Loop、Planner |
| [可追踪.md](file:///Users/saga/code-repos/devweekly.github.io/temp/research-agent/可追踪.md) | Claim-Evidence-Source Graph | ⭐ Ontology Layer、Evidence Ranking |
| [本体论.md](file:///Users/saga/code-repos/devweekly.github.io/temp/research-agent/本体论.md) | 最小 Ontology | ⭐ Ontology Layer |
