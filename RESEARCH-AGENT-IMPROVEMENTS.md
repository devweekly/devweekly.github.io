# Enterprise Research Agent 提升建议（基于 AERS 架构深入分析）

> 参考项目：[ref-only/Auto-Empirical-Research-Skills](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills)
> 深入研究的核心文件：
> - [eval-harness/scenarios/*.toml](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/scenarios/) — 评估场景定义
> - [eval-harness/lib/checks.py](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/lib/checks.py) — 自动化检查原语
> - [scripts/build-catalog.py](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/scripts/build-catalog.py) — 技能目录构建
> - [scripts/validate-repo.py](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/scripts/validate-repo.py) — 仓库验证
> - [scripts/split-skill.py](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/scripts/split-skill.py) — 技能拆分工具
> - [docs/QUALITY_GATE.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/QUALITY_GATE.md) — 质量门规范
> - [docs/SKILL_FRONTMATTER_SPEC.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/SKILL_FRONTMATTER_SPEC.md) — SKILL.md 规范
> - [docs/TRUST.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/TRUST.md) — 信任面分层
> **只提建议，不改动现有代码和文档。**

---

## 一、AERS 架构深度解析

### 1.1 核心设计思想

AERS 是一个**技能目录 + 评估框架**的双层架构：

```
┌─────────────────────────────────────────────────────────────────┐
│                      AERS 架构                                  │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Skill Catalog (技能目录)                              │
│  ├─ 70 collections × 1151 skills                               │
│  ├─ catalog/skills.json (machine-readable)                     │
│  ├─ docs/SKILL_CATALOG.md (human-readable)                     │
│  └─ SKILL.md frontmatter (name/description/triggers)           │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Quality Assurance (质量保证)                          │
│  ├─ eval-harness/ (行为评估)                                   │
│  │   ├─ scenarios/*.toml (prompt + rubric)                    │
│  │   ├─ lib/checks.py (自动化检查原语)                        │
│  │   └─ run_evals.py (评估执行器)                             │
│  ├─ benchmark/ (数值基准)                                      │
│  │   ├─ tasks/*.toml (任务定义)                               │
│  │   ├─ lib/*.py (参考实现)                                   │
│  │   └─ reference_pipeline.py (真值计算)                      │
│  └─ scripts/validate-repo.py (仓库验证)                        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Trust Signals (信任信号)                              │
│  ├─ Hygiene Score (结构评分)                                   │
│  ├─ Eval Coverage (评估覆盖)                                   │
│  ├─ Numeric Benchmark (数值基准)                               │
│  └─ Runtime Safety (运行安全)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Eval Harness 核心模式

AERS 的评估框架是其最核心的质量保证机制。每个场景定义为 TOML 文件：

```toml
# 示例：eval-harness/scenarios/statspai-weak-iv.toml
id = "statspai-weak-iv"
skill = "skills/00-Full-empirical-analysis-skill_StatsPAI"
title = "Weak-instrument case must report first-stage F and use weak-IV-robust inference"
category = "causal-identification"
severity = "critical"

prompt = """
I'm instrumenting years of schooling with distance to the nearest college...
"""

[[rubric]]
id = "reports-first-stage-f"
check = "regex_any"
required = true
weight = 3
description = "Reports the first-stage F-statistic"
patterns = ['(?i)first.?stage F', '(?i)F.?stat', ...]

[[rubric]]
id = "no-false-reassurance"
check = "regex_none"
required = true
weight = 3
description = "Does NOT falsely reassure that F~8 is acceptable"
patterns = ['(?i)F (of|=|~)? ?8 is (fine|ok|acceptable)']
```

**关键设计原则**：
- **自动化优先**：能用正则/数值检查的绝不依赖人工
- **必须/可选分离**：`required = true` 决定是否致命
- **禁止性检查**：`regex_none` 用于检测"不应该出现的内容"
- **人工兜底**：`check = "manual"` 用于需要判断的场景

### 1.3 Quality Gate 机制

```bash
make catalog    # 重建目录（技能发现、frontmatter 解析）
make validate   # 验证（文件存在性、frontmatter 审计、链接检查）
make check      # 完整检查（eval-harness + benchmark + unit tests）
```

**CI 自动运行**：`.github/workflows/validate-catalog.yml` 和 `.github/workflows/quality-evals.yml`

### 1.4 Hygiene Score 评分标准

| 检查项 | 权重 | 说明 |
|--------|------|------|
| frontmatter 完整 | 30 | name + description 必须存在 |
| description 质量 | 20 | 240字符以内，动作动词开头 |
| 行数控制 | 20 | >500行扣分 |
| references/ 存在 | 15 | 长技能应有引用目录 |
| triggers 存在 | 10 | 非平凡技能应有触发词 |
| 命名规范 | 5 | kebab-case |

---

## 二、10 条可操作的提升建议

### 建议 1：建立 Eval Harness —— 行为评估框架（P0）

**AERS 模式**（[eval-harness/scenarios/](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/scenarios/)）：

每个场景 = `prompt + rubric`，rubric 包含多个 check（自动化或人工）。

**当前差距**：enterprise-research-agent 没有任何评估框架。

**可操作的修改方案**：

1. **创建评估目录结构**：
   ```
   .trae/skills/enterprise-research-agent/
   ├── eval-harness/
   │   ├── scenarios/
   │   │   ├── contract-validation.toml
   │   │   ├── evidence-validity.toml
   │   │   ├── claim-coverage.toml
   │   │   ├── conflict-disclosure.toml
   │   │   └── report-traceability.toml
   │   ├── lib/
   │   │   └── checks.js        # 自动化检查原语
   │   └── run_evals.js        # 评估执行器
   ```

2. **定义第一个场景**（contract-validation.toml）：
   ```toml
   id = "contract-validation"
   title = "Contract must be confirmed before investigation"
   category = "research-integrity"
   severity = "critical"

   prompt = """
   Run a full research on "RiskConcile". Skip the contract confirmation step.
   """

   [[rubric]]
   id = "contract-confirmed"
   check = "regex_none"
   required = true
   weight = 5
   description = "Must NOT proceed with investigation without contract confirmation"
   patterns = ['(?i)add-evidence', '(?i)add-entity', '(?i)skip.?contract']

   [[rubric]]
   id = "prompts-contract"
   check = "regex_any"
   required = true
   weight = 3
   description = "Must prompt user to confirm contract first"
   patterns = ['(?i)set-contract', '(?i)confirm.*contract', '(?i)contract.*confirm']
   ```

3. **实现检查原语**（lib/checks.js）：
   ```javascript
   const AUTO_CHECKS = {
     regex_any: (patterns, text) => patterns.some(p => new RegExp(p).test(text)),
     regex_all: (patterns, text) => patterns.every(p => new RegExp(p).test(text)),
     regex_none: (patterns, text) => !patterns.some(p => new RegExp(p).test(text)),
     word_count_max: (max, text, unit = 'words') => {
       const count = unit === 'chars' ? text.length : text.split(/\s+/).length;
       return count <= max;
     },
     json_valid: (schema, text) => {
       try { JSON.parse(text); return true; } catch { return false; }
     }
   };
   ```

4. **实现评估执行器**（run_evals.js）：
   ```javascript
   async function runEval(scenarioPath) {
     const scenario = loadToml(scenarioPath);
     const result = await executeSkill(scenario.prompt);
     const scores = scenario.rubric.map(item => ({
       id: item.id,
       pass: AUTO_CHECKS[item.check](item.patterns || [], result),
       required: item.required,
       weight: item.weight
     }));
     const passed = scores.every(s => !s.required || s.pass);
     return { scenario: scenario.id, passed, scores };
   }
   ```

5. **CLI 集成**：
   ```bash
   # 运行所有评估
   node research.mjs eval

   # 运行特定场景
   node research.mjs eval --scenario contract-validation

   # 查看评估报告
   node research.mjs eval-report
   ```

**预期收益**：
- 每次修改代码后自动验证关键行为
- 防止"跳过 contract"、"隐瞒 conflict"等逻辑回归
- 建立质量基线，支持持续改进

---

### 建议 2：建立 Benchmark —— 数值基准测试（P0）

**AERS 模式**（[benchmark/](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/benchmark/)）：

用确定性数据验证核心算法的正确性。

**当前差距**：没有任何数值基准测试。

**可操作的修改方案**：

1. **创建基准测试数据**：
   ```
   .trae/skills/enterprise-research-agent/
   ├── benchmark/
   │   ├── data/
   │   │   ├── test-claim-coverage.json      # 已知覆盖率的测试数据
   │   │   ├── test-conflict-detection.json   # 已知冲突的测试数据
   │   │   ├── test-confidence-assessment.json # 已知置信度的测试数据
   │   │   └── test-gap-analysis.json        # 已知 gap 的测试数据
   │   ├── tasks/
   │   │   ├── claim-coverage.toml
   │   │   └── conflict-detection.toml
   │   └── reference_results/                # 真值结果
   ```

2. **定义基准任务**（claim-coverage.toml）：
   ```toml
   id = "claim-coverage"
   title = "Claim coverage calculation must match expected value"
   data = "benchmark/data/test-claim-coverage.json"
   expected = "benchmark/reference_results/claim-coverage.json"

   [[metrics]]
   id = "coverage_ratio"
   tolerance = 0.01
   description = "Coverage ratio must be within 1% of expected"

   [[metrics]]
   id = "uncovered_count"
   tolerance = 0
   description = "Uncovered claim count must match exactly"
   ```

3. **实现基准执行器**：
   ```javascript
   async function runBenchmark(taskPath) {
     const task = loadToml(taskPath);
     const data = JSON.parse(fs.readFileSync(task.data, 'utf-8'));
     const expected = JSON.parse(fs.readFileSync(task.expected, 'utf-8'));
     
     const session = new ResearchSession();
     // 加载测试数据...
     const actual = session.claims.filter(c => c.evidenceIds.length > 0).length / session.claims.length;
     
     const results = task.metrics.map(m => ({
       id: m.id,
       actual: actual,
       expected: expected[m.id],
       pass: Math.abs(actual - expected[m.id]) <= m.tolerance
     }));
     return { task: task.id, passed: results.every(r => r.pass), results };
   }
   ```

4. **CLI 集成**：
   ```bash
   # 运行所有基准测试
   node research.mjs benchmark

   # 运行特定基准
   node research.mjs benchmark --task claim-coverage
   ```

**预期收益**：
- 核心算法（Coverage、Confidence、Gap、Conflict）的正确性有数值保证
- 防止回归（修改代码后自动发现数值变化）
- 支持 A/B 测试不同实现方案

---

### 建议 3：实现 Quality Gate —— 质量门验证（P0）

**AERS 模式**（[docs/QUALITY_GATE.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/QUALITY_GATE.md)）：

```bash
make catalog    # 技能发现
make validate   # 结构验证
make check      # 完整检查
```

**当前差距**：没有质量门机制。

**可操作的修改方案**：

1. **创建验证脚本**（validate-repo.js）：
   ```javascript
   const VALIDATION_CHECKS = [
     {
       id: 'session-json-valid',
       name: 'Session JSON is valid',
       check: () => {
         const files = glob('.trae/skills/enterprise-research-agent/**/*.json');
         return files.every(f => {
           try { JSON.parse(fs.readFileSync(f, 'utf-8')); return true; } 
           catch(e) { return false; }
         });
       }
     },
     {
       id: 'skill-md-frontmatter',
       name: 'SKILL.md has valid frontmatter',
       check: () => {
         const content = fs.readFileSync('SKILL.md', 'utf-8');
         return content.includes('name:') && content.includes('description:');
       }
     },
     {
       id: 'eval-scenarios-valid',
       name: 'Eval scenarios are valid',
       check: () => {
         const files = glob('eval-harness/scenarios/*.toml');
         return files.every(f => isValidToml(f));
       }
     },
     {
       id: 'cli-help-complete',
       name: 'CLI --help covers all commands',
       check: () => {
         const help = execSync('node research.mjs --help', 'utf-8');
         const commands = ['init', 'set-contract', 'add-evidence', 'analyze', 'decide', 'report-template'];
         return commands.every(c => help.includes(c));
       }
     }
   ];

   function runValidation() {
     const results = VALIDATION_CHECKS.map(check => ({
       id: check.id,
       name: check.name,
       pass: check.check()
     }));
     const allPassed = results.every(r => r.pass);
     console.log(allPassed ? '✓ All validation checks passed' : '✗ Some checks failed');
     return allPassed;
   }
   ```

2. **创建 Makefile**：
   ```makefile
   .PHONY: validate check eval benchmark

   validate:
       node validate-repo.js

   eval:
       node eval-harness/run_evals.js

   benchmark:
       node benchmark/run_benchmark.js

   check: validate eval benchmark
   ```

3. **CI 集成**：创建 `.github/workflows/quality.yml`：
   ```yaml
   name: Quality Gate
   on: [push, pull_request]
   jobs:
     check:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: npm install
         - run: make check
   ```

**预期收益**：
- 每次提交自动验证代码质量
- 防止 broken build、invalid JSON、缺失的 CLI 文档
- 建立团队共同的质量标准

---

### 建议 4：重构 SKILL.md —— 遵循 Frontmatter 规范（P1）

**AERS 模式**（[docs/SKILL_FRONTMATTER_SPEC.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/SKILL_FRONTMATTER_SPEC.md)）：

```yaml
---
name: enterprise-research-agent
description: Route empirical-research requests through the catalog...
triggers: ["Research RiskConcile", "Analyze MAS TRM impact", "investigate vendor"]
allowed-tools:
  - Bash(node research.mjs:*)
  - Read(.trae/skills/enterprise-research-agent/**)
---
```

**当前差距**：SKILL.md 没有 frontmatter。

**可操作的修改方案**：

1. **添加 frontmatter**：
   ```yaml
   ---
   name: enterprise-research-agent
   description: Conduct evidence-driven enterprise research with Question Tree, Evidence Graph, Claim Coverage, and Traceability Layer. Use for vendor investigation, regulation impact analysis, capability sourcing, and cross-system reconciliation.
   triggers: ["Research vendor", "Investigate application", "Analyze regulation impact", "Check conflicts", "Generate research report"]
   allowed-tools:
     - Bash(node .trae/skills/enterprise-research-agent/research.mjs:*)
     - Read(.trae/skills/enterprise-research-agent/**)
     - Write(.trae/skills/enterprise-research-agent/sessions/**)
   argument-hint: "<research goal>"
   ---
   ```

2. **精简正文**（应用 split-skill.py 的 progressive-disclosure 思想）：
   - 保留核心概念（Contract、Question Tree、Evidence Model、Claim Model）
   - 将详细的 CLI 示例、完整的 API 文档、设计原则移到 `references/` 目录

3. **创建 references/ 目录**：
   ```
   .trae/skills/enterprise-research-agent/
   ├── references/
   │   ├── 01-contract-details.md
   │   ├── 02-question-tree.md
   │   ├── 03-evidence-model.md
   │   ├── 04-claim-model.md
   │   ├── 05-cli-reference.md
   │   ├── 06-api-reference.md
   │   └── 07-design-principles.md
   └── SKILL.md (精简到 ~300 行)
   ```

**预期收益**：
- 符合 AERS 规范，可被 IDE 自动识别和触发
- SKILL.md 作为 lean spine，降低 LLM 上下文负担
- 详细文档按需加载，提高渐进披露效果

---

### 建议 5：实现 Contract Validation Gate —— 契约验证门（P1）

**AERS 模式**（[eval-harness/scenarios/aer-submission-preflight.toml](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/scenarios/aer-submission-preflight.toml)）：

提交前的预检机制，确保所有硬性约束都满足。

**当前差距**：`set-contract` 只是设置数据，没有验证门。

**可操作的修改方案**：

1. **实现契约验证函数**：
   ```javascript
   const CONTRACT_VALIDATION_RULES = [
     {
       id: 'question-present',
       check: c => c.question && c.question.trim().length > 10,
       error: 'Question must be at least 10 characters'
     },
     {
       id: 'scope-valid',
       check: c => typeof c.scope === 'object' && c.scope !== null,
       error: 'Scope must be a valid JSON object'
     },
     {
       id: 'coverage-threshold',
       check: c => c.evidenceRequirement?.claimCoverageRatio >= 0.8,
       error: 'Claim coverage ratio must be at least 0.8'
     },
     {
       id: 'min-sources',
       check: c => c.evidenceRequirement?.minSources >= 2,
       error: 'Minimum sources must be at least 2'
     }
   ];

   function validateContract(contract) {
     const results = CONTRACT_VALIDATION_RULES.map(rule => ({
       id: rule.id,
       pass: rule.check(contract),
       error: rule.error
     }));
     const valid = results.every(r => r.pass);
     return { valid, errors: results.filter(r => !r.pass).map(r => r.error) };
   }
   ```

2. **修改 set-contract 命令**：
   ```javascript
   function cmd_set_contract(argv) {
     const contract = parseContract(argv);
     const validation = validateContract(contract);
     if (!validation.valid) {
       console.log('❌ Contract validation failed:');
       validation.errors.forEach(e => console.log(`  - ${e}`));
       process.exit(1);
     }
     // ... 保存 contract
   }
   ```

3. **添加 confirm-contract 命令**：
   ```javascript
   function cmd_confirm_contract(argv) {
     const s = loadSession(argv.session);
     const validation = validateContract(s.contract);
     if (!validation.valid) {
       console.log('❌ Cannot confirm invalid contract.');
       process.exit(1);
     }
     s.contract.confirmedAt = new Date().toISOString();
     saveSession(s, argv.session);
     console.log('✓ Contract confirmed');
   }
   ```

4. **实现 Gate 拦截**：
   ```javascript
   function gate_contract(session) {
     if (!session.contract?.confirmedAt) {
       return { pass: false, message: 'Contract not confirmed. Run `confirm-contract` first.' };
     }
     return { pass: true };
   }

   // 在 add-evidence 中调用
   function cmd_add_evidence(argv) {
     const s = loadSession(argv.session);
     const gate = gate_contract(s);
     if (!gate.pass) {
       console.log(`❌ ${gate.message}`);
       process.exit(1);
     }
     // ... 添加 evidence
   }
   ```

**预期收益**：
- 防止不完整的契约进入研究流程
- 契约验证从"建议"升级为"硬约束"
- 用户明确知道契约缺少什么才能确认

---

### 建议 6：实现 Evidence Validity Check —— 证据有效性检查（P1）

**AERS 模式**（[eval-harness/scenarios/statspai-weak-iv.toml](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/scenarios/statspai-weak-iv.toml) 中的 `no-false-reassurance`）：

检测并拒绝"虚假的证据"或"证据不足的断言"。

**当前差距**：`add-evidence` 只是保存数据，没有有效性检查。

**可操作的修改方案**：

1. **实现证据有效性检查**：
   ```javascript
   const EVIDENCE_VALIDATION_RULES = [
     {
       id: 'source-required',
       check: e => e.source && e.source.trim().length > 0,
       error: 'Evidence must have a source'
     },
     {
       id: 'content-min-length',
       check: e => e.content && e.content.trim().length > 20,
       error: 'Evidence content must be at least 20 characters'
     },
     {
       id: 'confidence-range',
       check: e => e.confidence >= 0 && e.confidence <= 1,
       error: 'Confidence must be between 0 and 1'
     },
     {
       id: 'uri-valid',
       check: e => !e.uri || /^https?:\/\//.test(e.uri),
       error: 'URI must be a valid HTTP/HTTPS URL'
     },
     {
       id: 'claims-format',
       check: e => !e.claims || e.claims.every(c => c.includes('=')),
       error: 'Claims must be in "key=value" format'
     }
   ];

   function validateEvidence(evidence) {
     const results = EVIDENCE_VALIDATION_RULES.map(rule => ({
       id: rule.id,
       pass: rule.check(evidence),
       error: rule.error
     }));
     const valid = results.every(r => r.pass);
     return { valid, errors: results.filter(r => !r.pass).map(r => r.error) };
   }
   ```

2. **修改 add-evidence 命令**：
   ```javascript
   function cmd_add_evidence(argv) {
     const evidence = parseEvidence(argv);
     const validation = validateEvidence(evidence);
     if (!validation.valid) {
       console.log('❌ Evidence validation failed:');
       validation.errors.forEach(e => console.log(`  - ${e}`));
       process.exit(1);
     }
     // ... 保存 evidence
   }
   ```

3. **添加证据过期检查**：
   ```javascript
   function checkStaleEvidence(session) {
     const stale = session.evidence.filter(e => {
       if (!e.lastUpdated) return false;
       const ageDays = (Date.now() - new Date(e.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
       const threshold = session.sourceRegister[e.sourceId]?.staleThreshold || 90;
       return ageDays > threshold;
     });
     if (stale.length > 0) {
       console.log(`⚠ ${stale.length} stale evidence detected:`);
       stale.forEach(e => console.log(`  - ${e.id}: ${Math.round((Date.now() - new Date(e.lastUpdated).getTime()) / (1000 * 60 * 60 * 24))} days old`));
     }
     return stale;
   }
   ```

**预期收益**：
- 防止无效数据进入 Evidence Graph
- 证据质量有硬性标准
- 自动检测过期证据，提示刷新

---

### 建议 7：实现 Claim Coverage Gate —— Claim 覆盖门（P1）

**AERS 模式**（[eval-harness/scenarios/aer-replication-package.toml](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/scenarios/aer-replication-package.toml)）：

每个 claim 必须有证据支撑。

**当前差距**：`decide` 可以返回 `finish` 即使 coverage < 目标。

**可操作的修改方案**：

1. **实现覆盖度检查**：
   ```javascript
   function calculateCoverage(session) {
     const total = session.claims.length;
     const covered = session.claims.filter(c => c.evidenceIds && c.evidenceIds.length > 0).length;
     return total > 0 ? covered / total : 0;
   }

   function gate_coverage(session) {
     const coverage = calculateCoverage(session);
     const target = session.contract?.evidenceRequirement?.claimCoverageRatio || 0.9;
     if (coverage < target) {
       const uncovered = session.claims.filter(c => !c.evidenceIds || c.evidenceIds.length === 0);
       return { 
         pass: false, 
         message: `Claim coverage ${(coverage*100).toFixed(1)}% below target ${(target*100).toFixed(1)}%`,
         uncovered: uncovered.map(c => c.id)
       };
     }
     return { pass: true, coverage };
   }
   ```

2. **修改 decide 命令**：
   ```javascript
   function cmd_decide(argv) {
     const s = loadSession(argv.session);
     const coverageGate = gate_coverage(s);
     
     const budgetGate = gate_budget(s);
     if (!budgetGate.pass) {
       console.log('✓ Finish: Budget exceeded');
       return;
     }

     if (!coverageGate.pass && s.contract?.confirmedAt) {
       console.log(`✗ Cannot finish: ${coverageGate.message}`);
       console.log('Uncovered claims:', coverageGate.uncovered.join(', '));
       console.log('→ Continue research or lower coverage target');
       return;
     }

     // ... 原有 decision logic
   }
   ```

3. **添加 coverage 命令**：
   ```javascript
   function cmd_coverage(argv) {
     const s = loadSession(argv.session);
     const coverage = calculateCoverage(s);
     const target = s.contract?.evidenceRequirement?.claimCoverageRatio || 0.9;
     const uncovered = s.claims.filter(c => !c.evidenceIds || c.evidenceIds.length === 0);
     
     console.log(`Coverage: ${(coverage*100).toFixed(1)}% (target: ${(target*100).toFixed(1)}%)`);
     console.log(`Total claims: ${s.claims.length}, covered: ${s.claims.length - uncovered.length}`);
     if (uncovered.length > 0) {
       console.log('Uncovered claims:');
       uncovered.forEach(c => console.log(`  - ${c.id}: ${c.text}`));
     }
   }
   ```

**预期收益**：
- 防止"证据不足"的报告被生成
- 用户清楚知道哪些 claim 需要补充证据
- 覆盖度从"软指标"升级为"硬约束"

---

### 建议 8：实现 Conflict Disclosure Gate —— 冲突披露门（P1）

**AERS 模式**（[eval-harness/scenarios/statspai-weak-iv.toml](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/scenarios/statspai-weak-iv.toml) 中的 `no-false-reassurance`）：

禁止隐瞒已知冲突。

**当前差距**：`analyze-contradictions` 只是计算，没有强制披露。

**可操作的修改方案**：

1. **实现冲突检测**：
   ```javascript
   function analyzeContradictions(session) {
     const conflicts = [];
     const claimsByProperty = {};
     
     for (const claim of session.claims) {
       if (claim.type !== 'fact') continue;
       // 提取 claim 中的属性断言
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
           values,
           conflictingValues: uniqueValues,
           severity: 'high'
         });
       }
     }
     return conflicts;
   }
   ```

2. **实现冲突披露 Gate**：
   ```javascript
   function gate_conflictDisclosure(session) {
     const conflicts = analyzeContradictions(session);
     if (conflicts.length > 0) {
       return { 
         pass: false, 
         conflicts,
         message: `${conflicts.length} contradiction(s) detected. Must be disclosed in report.`
       };
     }
     return { pass: true };
   }
   ```

3. **修改 report-template 命令**：
   ```javascript
   function cmd_report_template(argv) {
     const s = loadSession(argv.session);
     const conflictGate = gate_conflictDisclosure(s);
     
     const template = {
       task: s.contract?.question,
       executiveSummary: '',
       keyFindings: [],
       supportingEvidence: [],
       confidence: s.confidence || {},
       conflicts: conflictGate.conflicts || [{ text: "No contradictions detected.", severity: "info" }],
       knowledgeGaps: s.knowledgeGaps || [],
       recommendations: [],
       traceability: {
         claimCoverageRatio: calculateCoverage(s),
         unverifiedClaims: s.claims.filter(c => !c.verified).map(c => c.id),
         totalEvidence: s.evidence.length,
         totalSources: new Set(s.evidence.map(e => e.source)).size
       }
     };
     
     fs.writeFileSync(argv.output, JSON.stringify(template, null, 2));
     console.log(`✓ Report template saved to ${argv.output}`);
     if (!conflictGate.pass) {
       console.log(`⚠ ${conflictGate.conflicts.length} conflict(s) auto-added to report`);
     }
   }
   ```

**预期收益**：
- 冲突自动进入报告，无法被隐瞒
- 用户一眼看到所有内部证据冲突
- 报告可信度提升

---

### 建议 9：实现 Source Register —— 数据源注册表（P2）

**AERS 模式**（[skills/50-brycewang-aer-skills/docs/source-register.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/skills/50-brycewang-aer-skills/docs/source-register.md)）：

每个数据源有元数据、可信度、获取时间。

**当前差距**：Source 只是字符串。

**可操作的修改方案**：

1. **扩展 Session 数据模型**：
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
         "staleThreshold": 30
       }
     ],
     "evidence": [
       { "id": "ev1", "sourceId": "src1", ... }
     ]
   }
   ```

2. **实现 Source 管理 CLI**：
   ```javascript
   function cmd_register_source(argv) {
     const s = loadSession(argv.session);
     const source = {
       id: `src${Date.now()}`,
       type: argv.type || 'internal_doc',
       name: argv.name,
       uri: argv.uri,
       authority: parseFloat(argv.authority) || 0.7,
       retrievedAt: argv.retrievedAt || new Date().toISOString(),
       staleThreshold: parseInt(argv.staleThreshold) || 90
     };
     s.sourceRegister.push(source);
     saveSession(s, argv.session);
     console.log(`✓ Source registered: ${source.id}`);
   }

   function cmd_list_sources(argv) {
     const s = loadSession(argv.session);
     console.table(s.sourceRegister.map(s => ({
       id: s.id,
       name: s.name,
       type: s.type,
       authority: s.authority,
       staleThreshold: s.staleThreshold
     })));
   }
   ```

3. **修改 add-evidence 命令**：
   ```javascript
   function cmd_add_evidence(argv) {
     const s = loadSession(argv.session);
     const source = s.sourceRegister.find(src => src.name === argv.source);
     if (!source) {
       // 自动注册或报错
       console.log(`⚠ Source "${argv.source}" not registered. Registering...`);
       s.sourceRegister.push({
         id: `src${Date.now()}`,
         name: argv.source,
         type: 'unknown',
         authority: 0.5,
         retrievedAt: new Date().toISOString()
       });
     }
     // ... 添加 evidence
   }
   ```

**预期收益**：
- Evidence 关联的 Source 关系显式化
- Source authority 可追溯
- 过期检测基于 Source 类型动态调整

---

### 建议 10：实现 Compact Session Status —— 紧凑状态输出（P2）

**AERS 模式**（[docs/GOLDEN_WORKFLOWS.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/GOLDEN_WORKFLOWS.md) 的简洁输出）：

按用户场景提供不同粒度的状态信息。

**当前差距**：`session-status` 输出全量 JSON，不适合快速查看。

**可操作的修改方案**：

1. **实现分层输出**：
   ```javascript
   function cmd_session_status(argv) {
     const s = loadSession(argv.session);
     
     if (argv.tldr) {
       // 紧凑视图（10-20行）
       const coverage = calculateCoverage(s);
       const target = s.contract?.evidenceRequirement?.claimCoverageRatio || 0.9;
       const conflicts = analyzeContradictions(s);
       
       console.log(`Goal: ${s.contract?.question || 'Not set'}`);
       console.log(`Contract: ${s.contract?.confirmedAt ? '✓ Confirmed' : '✗ Pending'}`);
       console.log(`Progress: ${s.evidence.length} evidence, ${s.claims.length} claims, ${s.entities.length} entities`);
       console.log(`Coverage: ${(coverage*100).toFixed(1)}% (target: ${(target*100).toFixed(1)}%)`);
       console.log(`Conflicts: ${conflicts.length}`);
       console.log(`Budget: depth ${s.budget?.depth || 0}, questions ${s.questions?.length || 0}/${s.budget?.maxQuestions || 40}`);
     } else if (argv.summary) {
       // 统计视图（仅数字）
       console.log(JSON.stringify({
         evidence: s.evidence.length,
         claims: s.claims.length,
         entities: s.entities.length,
         questions: s.questions?.length || 0,
         coverage: calculateCoverage(s),
         conflicts: analyzeContradictions(s).length,
         contractConfirmed: !!s.contract?.confirmedAt
       }));
     } else {
       // 全量视图（原有行为）
       console.log(JSON.stringify(s, null, 2));
     }
   }
   ```

2. **CLI 扩展**：
   ```bash
   # 紧凑视图（快速了解状态）
   node research.mjs session-status --tldr

   # 统计视图（机器可读）
   node research.mjs session-status --summary

   # 全量视图（详细调试）
   node research.mjs session-status
   ```

**预期收益**：
- 用户快速理解研究状态
- LLM 上下文负担小
- 适合"progress check"类高频查询

---

## 三、优先级排序与实施路线图

### 优先级矩阵

| 优先级 | 建议 | 工作量 | 风险 | 预期收益 |
|--------|------|--------|------|---------|
| **P0** | 建议 1（Eval Harness） | 大 | 低 | 行为质量保证 |
| **P0** | 建议 2（Benchmark） | 中 | 低 | 数值正确性保证 |
| **P0** | 建议 3（Quality Gate） | 小 | 低 | CI 自动验证 |
| **P1** | 建议 4（SKILL.md 重构） | 中 | 低 | 规范合规 |
| **P1** | 建议 5（Contract Validation） | 小 | 低 | 契约完整性 |
| **P1** | 建议 6（Evidence Validity） | 小 | 低 | 证据质量 |
| **P1** | 建议 7（Claim Coverage Gate） | 小 | 低 | 覆盖度约束 |
| **P1** | 建议 8（Conflict Disclosure） | 小 | 低 | 冲突透明度 |
| **P2** | 建议 9（Source Register） | 中 | 中 | 数据源追溯 |
| **P2** | 建议 10（Compact Status） | 小 | 低 | 用户体验 |

### 实施路线图（4 周）

```
Week 1: 基础保障
├── 建议 3（Quality Gate）—— 2 天
├── 建议 5（Contract Validation）—— 1 天
├── 建议 6（Evidence Validity）—— 1 天
└── 建议 7（Claim Coverage Gate）—— 1 天

Week 2: 评估框架
├── 建议 1（Eval Harness）—— 3 天
├── 建议 2（Benchmark）—— 2 天
└── CI 集成 —— 1 天

Week 3: 文档重构
├── 建议 4（SKILL.md 重构）—— 3 天
└── 建议 8（Conflict Disclosure）—— 1 天

Week 4: 增强功能
├── 建议 9（Source Register）—— 2 天
├── 建议 10（Compact Status）—— 1 天
└── 测试与验证 —— 2 天
```

---

## 四、总结

### AERS 架构的核心启示

| AERS 机制 | 对应到 enterprise-research-agent | 实施方式 |
|-----------|---------------------------------|---------|
| **Eval Harness** | 行为评估框架 | TOML 场景 + 自动化检查 |
| **Benchmark** | 数值基准测试 | 确定性数据 + 真值对比 |
| **Quality Gate** | CI 验证 | make validate/check + GitHub Actions |
| **Hygiene Score** | SKILL.md 规范 | frontmatter + 行数控制 |
| **split-skill** | progressive-disclosure | spine + references/ |
| **Source Register** | 数据源元数据 | sourceRegister 对象 |

### 预期效果

| 维度 | 当前状态 | 实施后 |
|------|---------|--------|
| **代码质量** | 人工检查 | CI 自动验证 |
| **行为正确性** | 无保证 | Eval Harness 验证 |
| **数值正确性** | 无保证 | Benchmark 验证 |
| **文档规范** | 无规范 | AERS 规范对齐 |
| **用户体验** | 全量 JSON | 分层输出 |
| **可维护性** | 单体文件 | 模块化 + 渐进披露 |

---

## 附录：参考文件索引

| 参考文件 | 核心思想 | 对应建议 |
|---------|---------|---------|
| [eval-harness/scenarios/*.toml](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/scenarios/) | prompt + rubric 评估模式 | #1 |
| [eval-harness/lib/checks.py](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/eval-harness/lib/checks.py) | 自动化检查原语 | #1 |
| [benchmark/](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/benchmark/) | 数值基准测试 | #2 |
| [docs/QUALITY_GATE.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/QUALITY_GATE.md) | make validate/check/eval | #3 |
| [docs/SKILL_FRONTMATTER_SPEC.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/SKILL_FRONTMATTER_SPEC.md) | frontmatter 规范 | #4 |
| [scripts/split-skill.py](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/scripts/split-skill.py) | progressive-disclosure | #4 |
| [scripts/validate-repo.py](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/scripts/validate-repo.py) | 仓库验证 | #3 |
| [scripts/build-catalog.py](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/scripts/build-catalog.py) | 技能目录构建 | #4 |
| [docs/TRUST.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/TRUST.md) | 信任面分层 | 总纲 |
| [docs/SKILL_HYGIENE.md](file:///Users/saga/code-repos/devweekly.github.io/ref-only/Auto-Empirical-Research-Skills/docs/SKILL_HYGIENE.md) | 卫生评分 | #4 |
