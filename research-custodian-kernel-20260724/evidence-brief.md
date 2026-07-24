# 证据简报：custodian-kernel

> 生成时间：2026-07-23，由 research-repo skill（确定性分析）生成。
> 本简报是 LLM 报告生成的**输入**，并非最终报告。
> LLM 应阅读本简报，然后按照最后一节的提示撰写 `report.md`。

## 0. 研究原则

LLM 在撰写报告时必须遵循以下原则：

- **证据优于假设** — 每个结论必须引用具体证据（文件路径、指标、简报章节）。
- **多个弱信号优于一个强信号** — 交叉验证，避免单一来源偏差。
- **区分事实与解读** — 事实是「代码中存在 X」，解读是「这意味着 Y」。
- **显式声明不确定性** — 证据不足时说「未知」，不要默认「有」。
- **分离观察与结论** — 观察是「检测到 X」，结论是「因此 Y」。
- **不要仅从命名推断架构** — 函数名不等于功能，需查看调用链。
- **测试是一等证据** — 测试代码揭示真实意图和使用方式。
- **示例是可执行文档** — example/ 目录的价值不低于 README。
- **关注可复用模式而非实现细节** — 提取模式，不陷于细节。
- **Negative Finding 同样重要** — 「未找到 X」与「找到 Y」具有同等研究价值。

## 1. Executive Brief

| Dimension | Value |
|-----------|-------|
| Repository | custodian-kernel |
| Manifest | pyproject.toml (python) |
| Version | 0.4.0 |
| Source files | 304 |
| Top languages | .py (304), .md (109), .json (23), .yaml (8), .txt (5) |
| Top-level dirs | caduceus, custodian, custodian_kernel.egg-info, paladin, tests |
| Commits | 10 |
| Contributors | 2 |
| CI provider | none |
| **Project stage** | early-stage (10 commits, 2 contributors) |
| **Ecosystem** | Python ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 304 | — |
| Import edges | 474 | edge/node ratio: 1.56 |
| Import cycles | 2 | ⚠ tight coupling detected |
| Functions | 1899 | 6.2 funcs/module |
| Classes | 307 | 1.0 classes/module |

**Coupling assessment**: edge/node ratio 1.56 → moderate — typical for mid-size projects

**Import cycles** (potential design issues):
  - `custodian.cli.main → custodian.cli.menu → custodian.cli.main`
  - `paladin.cli → paladin.menu → paladin.cli`

**Most depended-upon modules** (high in-degree = core/foundation):
  - `custodian.types` (in-degree: 69)
  - `custodian.packs.base` (in-degree: 25)
  - `custodian.exceptions` (in-degree: 21)
  - `custodian.storage.sqlite` (in-degree: 20)
  - `custodian.policy.schema` (in-degree: 19)
  - `custodian.tools.registry` (in-degree: 18)
  - `custodian.adapters.base` (in-degree: 17)
  - `paladin.cli` (in-degree: 16)
  - `custodian.policy.evaluator` (in-degree: 15)
  - `paladin.errors` (in-degree: 14)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `custodian.types` (PageRank: 0.0661)
  - `custodian.exceptions` (PageRank: 0.0451)
  - `custodian.adapters.base` (PageRank: 0.0348)
  - `custodian.packs.base` (PageRank: 0.0300)
  - `custodian.policy.schema` (PageRank: 0.0207)
  - `paladin.errors` (PageRank: 0.0178)
  - `custodian.storage.sqlite` (PageRank: 0.0130)
  - `caduceus.errors` (PageRank: 0.0120)
  - `custodian.tools.registry` (PageRank: 0.0109)
  - `paladin.cli` (PageRank: 0.0102)

**Entry points**: 73 total (cli: 7, tool: 66)
  Sample entry points:
  - [cli] `caduceus/cli.py` — cli entrypoint file
  - [cli] `custodian/cli/main.py` — main entrypoint file
  - [cli] `paladin/cli.py` — cli entrypoint file
  - [tool] `custodian/bundled_skills/calendar/calendar-event-create/scripts/execute.py` — .py function: main() (AST) (deep/bundled)
  - [tool] `custodian/bundled_skills/calendar/calendar-event-list/scripts/execute.py` — .py function: main() (AST) (deep/bundled)
  - [tool] `custodian/bundled_skills/communication/discord-webhook/scripts/execute.py` — .py function: main() (AST) (deep/bundled)
  - [tool] `custodian/bundled_skills/communication/email-send/scripts/execute.py` — .py function: main() (AST) (deep/bundled)
  - [tool] `custodian/bundled_skills/communication/push-notification/scripts/execute.py` — .py function: main() (AST) (deep/bundled)

## 3. AI / Agent Design

**Prompts**: 4 detected
  By type: system (4)
  Sample prompts:
  - [system] `custodian/cli/cmd_generate_report.py:31` _SYSTEM_PROMPT = """You are a senior AI security engineer performing a governance audit for a
paying customer. You think...
  - [system] `custodian/packs/cloud/extractor.py:25` SYSTEM_PROMPT = """You are a cloud-ops analyst for a business. You read a
compute provisioning request and produce a STR...
  - [system] `custodian/packs/purchasing/extractor.py:26` SYSTEM_PROMPT = """You are an accounts-payable analyst for a business. You read a
vendor's invoice message and produce a...
  - [system] `custodian/packs/refunds/extractor.py:36` SYSTEM_PROMPT = """You are a refund-triage analyst for an e-commerce business. You read a
customer's message and produce...

**Tools**: 71 detected
  By framework: decorator-tool (3), class-Tool (2), script-tool (66)
  Sample tools:
  - [decorator-tool] `wrapper` — `custodian/govern.py`
  - [decorator-tool] `sandbox_available` — `custodian/sandbox.py`
  - [class-Tool] `CustodianTool` — `custodian/tools/registry.py`
  - [decorator-tool] `sandbox_available` — `paladin/sandbox.py`
  - [class-Tool] `TestHashTool` — `tests/test_tools.py`
  - [script-tool] `calendar-event-create` — `custodian/bundled_skills/calendar/calendar-event-create/scripts/execute.py`
  - [script-tool] `calendar-event-list` — `custodian/bundled_skills/calendar/calendar-event-list/scripts/execute.py`
  - [script-tool] `discord-webhook` — `custodian/bundled_skills/communication/discord-webhook/scripts/execute.py`

**Design archetype** (derived):
  - Tools/Prompts ratio: 17.8 → tool-heavy design (capabilities primarily tool-driven)

## 4. Testing & Evaluation

**Testing**: 48 test files, 764 test functions
  Test/source ratio: 0.16 → adequate coverage
  Test patterns detected: corpus, poison, regression, stress, verify-kit
  Tests by module (top 5):
    - `tools`: 68 tests
    - `stress`: 53 tests
    - `policy`: 44 tests
    - `generate_report`: 41 tests
    - `packs_base`: 36 tests

**Evaluation**: Detected
  Eval files: 2
    - `custodian/cli/cmd_earn_and_buy.py`
    - `custodian/policy/evaluator.py`
  Metrics: score
  Patterns: score, benchmark, judge, evaluation, eval

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 304 |
| Import edges | 474 |
| Import cycles | 2 |
| Functions indexed | 1899 |
| Call relations | 11737 |
| Test files | 48 |
| Total commits | 10 |
| Contributors | 2 |

**Derived indicators**:
  - Coupling density: 1.56 edges/module
  - Cycle count: 2 — minor coupling issues
  - Call density: 6.2 calls/function
  - Commit intensity: 5 commits/contributor
  - CI: none detected ⚠

**Architecture signal directories** (high structural importance):
  - `custodian/bundled_skills/memory`
  - `custodian/bundled_skills/memory/kv-delete`
  - `custodian/bundled_skills/memory/kv-delete/scripts`
  - `custodian/bundled_skills/memory/kv-get`
  - `custodian/bundled_skills/memory/kv-get/scripts`
  - `custodian/bundled_skills/memory/kv-list`
  - `custodian/bundled_skills/memory/kv-list/scripts`
  - `custodian/bundled_skills/memory/kv-set`
  - `custodian/bundled_skills/memory/kv-set/scripts`
  - `custodian/bundled_skills/memory/sqlite-query`

## 5.5. Ontology View（对象视图）

> 受 Palantir Ontology 启发：将仓库视为工程对象图，而非文件集合。
> 每个重要概念都是一个对象，对象之间有语义关系，证据关联到对象。

### 对象类型分布

| 类型 | 数量 |
|------|------|
| function | 1764 |
| class | 298 |
| tool | 71 |
| runner | 41 |
| planner | 9 |
| workflow | 5 |
| agent | 5 |
| prompt | 4 |
| evaluation | 4 |

### 关系类型分布

| 关系 | 数量 |
|------|------|
| calls | 11737 |
| imports | 1732 |
| uses | 49 |
| evaluatedBy | 4 |

### 语义对象（非 function/class）

| 类型 | 名称 | 文件 | 属性 |
|------|------|------|------|
| prompt | system | custodian/cli/cmd_generate_report.py | promptType=system, variables=, line=31 |
| prompt | system | custodian/packs/cloud/extractor.py | promptType=system, variables=, line=25 |
| prompt | system | custodian/packs/purchasing/extractor.py | promptType=system, variables=, line=26 |
| prompt | system | custodian/packs/refunds/extractor.py | promptType=system, variables=, line=36 |
| tool | wrapper | custodian/govern.py | framework=decorator-tool, schema=null |
| tool | sandbox_available | custodian/sandbox.py | framework=decorator-tool, schema=null |
| tool | CustodianTool | custodian/tools/registry.py | framework=class-Tool, schema=null |
| tool | sandbox_available | paladin/sandbox.py | framework=decorator-tool, schema=null |
| tool | TestHashTool | tests/test_tools.py | framework=class-Tool, schema=null |
| tool | calendar-event-create | custodian/bundled_skills/calendar/calendar-event-create/scripts/execute.py | framework=script-tool, schema=null |
| tool | calendar-event-list | custodian/bundled_skills/calendar/calendar-event-list/scripts/execute.py | framework=script-tool, schema=null |
| tool | discord-webhook | custodian/bundled_skills/communication/discord-webhook/scripts/execute.py | framework=script-tool, schema=null |
| tool | email-send | custodian/bundled_skills/communication/email-send/scripts/execute.py | framework=script-tool, schema=null |
| tool | push-notification | custodian/bundled_skills/communication/push-notification/scripts/execute.py | framework=script-tool, schema=null |
| tool | slack-channel-list | custodian/bundled_skills/communication/slack-channel-list/scripts/execute.py | framework=script-tool, schema=null |
| tool | slack-message | custodian/bundled_skills/communication/slack-message/scripts/execute.py | framework=script-tool, schema=null |
| tool | sms-send | custodian/bundled_skills/communication/sms-send/scripts/execute.py | framework=script-tool, schema=null |
| tool | webhook-post | custodian/bundled_skills/communication/webhook-post/scripts/execute.py | framework=script-tool, schema=null |
| tool | docker-exec | custodian/bundled_skills/docker/docker-exec/scripts/execute.py | framework=script-tool, schema=null |
| tool | docker-list | custodian/bundled_skills/docker/docker-list/scripts/execute.py | framework=script-tool, schema=null |
| tool | docker-logs | custodian/bundled_skills/docker/docker-logs/scripts/execute.py | framework=script-tool, schema=null |
| tool | docker-start | custodian/bundled_skills/docker/docker-start/scripts/execute.py | framework=script-tool, schema=null |
| tool | docker-stop | custodian/bundled_skills/docker/docker-stop/scripts/execute.py | framework=script-tool, schema=null |
| tool | file-list | custodian/bundled_skills/files/file-list/scripts/execute.py | framework=script-tool, schema=null |
| tool | file-read | custodian/bundled_skills/files/file-read/scripts/execute.py | framework=script-tool, schema=null |
| tool | file-write | custodian/bundled_skills/files/file-write/scripts/execute.py | framework=script-tool, schema=null |
| tool | shell-exec | custodian/bundled_skills/files/shell-exec/scripts/execute.py | framework=script-tool, schema=null |
| tool | github-comment | custodian/bundled_skills/github/github-comment/scripts/execute.py | framework=script-tool, schema=null |
| tool | github-file-read | custodian/bundled_skills/github/github-file-read/scripts/execute.py | framework=script-tool, schema=null |
| tool | github-issue-create | custodian/bundled_skills/github/github-issue-create/scripts/execute.py | framework=script-tool, schema=null |

### 问题驱动查询示例

> 以下是基于对象图的研究查询路径（Question → Object → Relationship → Evidence）

**查询**: 仓库中有多少 prompt 对象？它们的类型分布是什么？
  Prompt 对象: 4 个

> LLM 应在报告中使用对象驱动语言（如「Agent 对象通过 uses 关系连接到 Tool 对象」），
> 而非文件驱动语言（如「agent.ts 导入了 tool.ts」）。

## 6. Negative Findings（未找到什么）

> 这些 "未找到" 的发现同样重要 — 它们防止 LLM 默认假设 "存在"。

- 未检测到 CI/CD 配置
- 未找到 CONTRIBUTING 指南（外部贡献流程不明）
- 未找到 SECURITY 策略（漏洞报告流程不明）
- 未找到 CHANGELOG（版本演进缺乏结构化记录）
- 未找到 AI Agent 指令文件（AGENTS.md / CLAUDE.md 等）

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `paladin/cli.py` | 120 | high in-degree (+40); high PageRank (+50); entrypoint (+30) |
| 2 | `README.md` | 90 | README (+50); important file (+40) |
| 3 | `custodian/adapters/base.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 4 | `custodian/exceptions.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 5 | `custodian/packs/base.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 6 | `custodian/policy/schema.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 7 | `custodian/storage/sqlite.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 8 | `custodian/tools/registry.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 9 | `custodian/types.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 10 | `paladin/errors.py` | 90 | high in-degree (+40); high PageRank (+50) |
| 11 | `caduceus/errors.py` | 50 | high PageRank (+50) |
| 12 | `custodian/packs/test_runner.py` | 50 | test (+20); entrypoint (+30) |
| 13 | `LICENSE` | 40 | important file (+40) |
| 14 | `custodian/policy/evaluator.py` | 40 | high in-degree (+40) |
| 15 | `caduceus/cli.py` | 30 | entrypoint (+30) |
| 16 | `custodian/bundled_skills/calendar/calendar-event-create/scripts/execute.py` | 30 | entrypoint (+30) |
| 17 | `custodian/bundled_skills/calendar/calendar-event-list/scripts/execute.py` | 30 | entrypoint (+30) |
| 18 | `custodian/bundled_skills/communication/discord-webhook/scripts/execute.py` | 30 | entrypoint (+30) |
| 19 | `custodian/bundled_skills/communication/email-send/scripts/execute.py` | 30 | entrypoint (+30) |
| 20 | `custodian/bundled_skills/communication/push-notification/scripts/execute.py` | 30 | entrypoint (+30) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide（阅读指南）

### 30 分钟速览
如果只有 30 分钟，阅读以下文件：

1. `LICENSE` — important file (+40)
2. `paladin/cli.py` — high in-degree (+40); high PageRank (+50); entrypoint (+30)
3. `custodian/adapters/base.py` — high in-degree (+40); high PageRank (+50)
4. `custodian/exceptions.py` — high in-degree (+40); high PageRank (+50)
5. `custodian/packs/base.py` — high in-degree (+40); high PageRank (+50)

### 2 小时深入
继续阅读：

1. `custodian/policy/schema.py` — high in-degree (+40); high PageRank (+50)
2. `custodian/storage/sqlite.py` — high in-degree (+40); high PageRank (+50)
3. `custodian/tools/registry.py` — high in-degree (+40); high PageRank (+50)
4. `custodian/types.py` — high in-degree (+40); high PageRank (+50)
5. `paladin/errors.py` — high in-degree (+40); high PageRank (+50)
6. `caduceus/errors.py` — high PageRank (+50)
7. `custodian/packs/test_runner.py` — test (+20); entrypoint (+30)
8. `custodian/policy/evaluator.py` — high in-degree (+40)
9. `caduceus/cli.py` — entrypoint (+30)
10. `custodian/bundled_skills/calendar/calendar-event-create/scripts/execute.py` — entrypoint (+30)

> LLM 应在报告的「阅读指南」章节中复现并扩展此列表，按洞察密度排序。

## 9. Research Plan & Open Questions

### Hypotheses (from evidence)
- **✓ H1-purpose** (high): The repository purpose and target audience can be inferred from README and manifest
- **✓ H2-ai-agent** (high): This is an AI-agent / LLM-related project with prompts and/or tools
- **✓ H3-modular** (high): The codebase has a modular architecture with identifiable dependency layers
- **✓ H4-testing** (high): The project relies on automated tests for correctness
- **✓ H5-entrypoints** (high): Entry points reveal the primary interfaces (CLI, server, SDK)
- **✓ H6-evaluation** (high): The project measures quality through benchmarks or evaluations
- **? H7-maturity** (medium): The project is actively maintained with a non-trivial development history

### Open Questions (from evidence gaps)
- [medium] **architecture**: How is responsibility divided among the top modules, and where are the dependency boundaries?
- [medium] **entrypoints**: What commands or APIs does the CLI/server expose?
- [medium] **prompts**: What role do system, assistant, and few-shot prompts play?
- [low] **prompts**: Are prompts statically defined or dynamically assembled?
- [low] **tools**: Are tools decorated, wrapped, or provided by a framework?

---

## LLM 分析指令

你是一位经验丰富的软件架构师。基于上述证据，为 **custodian-kernel** 撰写一份工程研究报告。
请将报告保存为工作目录下的 `report.md`。

### 核心方法论：Ontology-driven Research（对象驱动研究）

将仓库视为工程对象图（简报 §5.5），而非文件集合。每个重要概念是一个 Object（Agent、Tool、Prompt、Test 等），
Object 之间有语义关系（uses、testedBy、configuredBy 等）。

Research Trace 应使用对象驱动语言：
- ❌「agent.ts 导入了 tool.ts」
- ✅「Agent 对象通过 uses 关系连接到 Tool 对象」

查询路径：Question → Object → Relationship → Evidence → Answer

### 核心方法论：Research Trace

**每个重要结论必须展示完整推导链条**，而非仅给出结论。格式如下：

```markdown
### [结论标题]

**问题**: 这个结论回答了什么问题？

**证据**:
- 证据1（文件路径 + 简报章节）
- 证据2（指标 + 解读）
- 证据3（交叉验证来源）

**分析**: 基于证据的推理过程。区分事实与解读。

**反证**: 是否有矛盾证据？如无，说明「未发现反证」。

**结论**: 推导出的结论。

**置信度**: 高/中/低 — 说明为何这个置信度。
```

### 报告结构

1. **执行摘要** — 这是什么项目？最有趣的发现是什么？（不超过 3 段）

2. **Research Traces** — 对 5-8 个核心发现，每个使用上述 Research Trace 格式。
   选择最有研究价值的发现，而非面面俱到。例如：
   - 核心架构模式是什么？
   - Agent 如何防止无限循环？
   - 上下文工程策略是什么？
   - 测试策略是否充分？
   - 是否有评估基础设施？

3. **Negative Findings** — 明确列出「未找到什么」。这些不是缺陷，而是研究边界。
   - 引用简报 §6 的发现
   - 补充你在阅读源码时发现的「未找到」
   - 每条说明：为什么这个缺失重要？

4. **Architecture Smells** — 潜在的设计风险。注意：都是「Potential」，不是断言。
   - Potential Tight Coupling（引用循环数据）
   - Potential Over-engineering
   - Potential Hidden Complexity
   - Potential Scalability Issues
   每条说明：为什么这是潜在风险？证据是什么？置信度如何？

5. **Interesting Decisions** — 几个「看起来奇怪但可能很聪明」的设计决策。
   每条包含：决策内容 / 为什么有趣 / 替代方案 / 权衡。

6. **Repository Positioning** — 生态定位（不是 Feature Matrix）。
   | 维度 | 当前成熟度 | 说明 |
   维度包括：Planning, Execution, Memory, Evaluation, Guardrails, Prompt, Tooling, Observability
   成熟度：Emerging / Common / Advanced / Unique

7. **Reusable Pattern Catalog** — 可复用模式目录（结构化表格）。
   | 模式 | 描述 | 位置 | 可复用性 |
   可复用性：✅ 通用 / ⚠ 需适配 / ❌ 特定场景

8. **Architecture Evolution** — 架构演进（基于 Git 历史）。
   - 主要重构事件
   - 已移除的设计
   - 已弃用的 API
   - 历史决策的痕迹

9. **Reading Guide** — 阅读指南（基于简报 §8 扩展）。
   - 30 分钟速览：最关键的 5 个文件
   - 2 小时深入：+ 10 个文件
   - 按洞察密度排序，说明每个文件为什么值得读

10. **Open Questions** — 待解决问题（用于第二轮研究）。
    每条包含：问题 / 为什么重要 / 建议的调查方法。

### 规则

- 遵循简报 §0 的研究原则。
- 每个论断必须引用证据（文件路径、简报章节、指标）。
- 对主要结论使用高/中/低置信度标签，并说明原因。
- 没有证据时说「未知」，不要默认「存在」。
- 不要只复述数字 — 解释它们对工程决策意味着什么。
- Negative Findings 与正面发现同等重要。
- Architecture Smells 使用「Potential」而非断言。
- Interesting Decisions 关注「为什么有趣」而非「好不好」。

### 用于深入调查的证据文件

以下 JSON 文件包含完整证据（如需更多细节请阅读）：
- `evidence-store/full.json` — 完整分析输出
- `evidence-store/symbols.json` — 函数/类/导入/调用索引
- `evidence-store/architecture.json` — 依赖图 + 中心性
- `evidence-store/interesting_files.json` — 排序后的文件阅读优先级
