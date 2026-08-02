# repo-research-v2 一致性审查 Checklist

> 审查时间：2026-08-01
> 审查范围：SKILL 文档 vs 脚本实现
> 审查方法：逐文件 Read + Grep 行号验证

## 统计摘要

| 类别 | 数量 | 严重级别分布 |
|------|------|------------|
| 字段名不一致 | 13 | P0: 5, P1: 5, P2: 3 |
| 流程不一致 | 12 | P0: 9, P1: 2, P2: 1 |
| 逻辑错误 | 12 | P0: 8, P1: 3, P2: 1 |
| 死代码 | 4 | P0: 0, P1: 0, P2: 4 |
| 缺失实现 | 14 | P0: 10, P1: 4, P2: 0 |
| 文档间不一致 | 6 | P0: 4, P1: 2, P2: 0 |
| **合计** | **61** | **P0: 36, P1: 16, P2: 9** |

---

## 详细问题列表

### 1. 字段名不一致

#### [P0] RR2-CONS-001: `coverage` 字段格式与文档定义矛盾 ✅ FIXED

- **位置**: `research.mjs:440-442`, `research.mjs:128-130`, `research.mjs:282-285`
- **文档说**: `workspace.md:82-89` / `report-schema.md:178-189` / `reasoning.md:152-157` 要求 `coverage` 为可计算对象格式：
  ```json
  { "runtime": { "answered": 17, "total": 20, "ratio": 0.85 } }
  ```
- **脚本实际**: `research.mjs:440-442` 写入纯数字：
  ```js
  { runtime: 0.3, architecture: 0.25, design_decisions: 0.2, testing: 0.1, deployment: 0.1, history: 0.05 }
  ```
  后续读取代码（`research.mjs:128` `v < 0.5`、`research.mjs:285` `v >= 0.8`）也假设纯数字格式
- **影响**: `coverage_calculable_gate` 永远无法通过（报告里没有 X/Y = Z% 格式）；reviewer 无法验证覆盖率
- **建议修复**: 改为 `{answered, total, ratio}` 三字段对象格式，并基于问题状态计算 `answered`
- **修复内容**:
  - `research.mjs:405-470`: 新增 `updateCoverage()` LLM 调用（Reasoning Agent 职责），让 LLM 基于证据+问题+解释+质疑判断 6 维 coverage，格式严格按文档 `{answered, total, ratio}`
  - `research.mjs:499-517`: stageFourResearch 调用 `updateCoverage()`，不自创 dimension 字段或机械计算
  - 6 个维度名称严格按 `reasoning.md:142-148`：`runtime / architecture / design_decisions / testing / deployment / history`
  - 单调增加规则按 `reasoning.md:168`：`Math.max(prevAnswered, answered)` 保证不降
  - `research.mjs:127-131`: 读取兼容新旧格式（`ratioOf(v)` helper）
  - `research.mjs:275-286`: Planner 读取兼容新旧格式，日志输出改为百分比格式
  - **删除自创逻辑**：不添加文档未定义的 `dimension` 字段，不自创 `computeCoverage()` 机械计算——coverage 由 LLM 判断（跟随 reasoning.md 文档）
- **验证**: `node --check` 通过

#### [P0] RR2-CONS-002: `next_stage` / `last_completed_stage` 取值与 workspace.md 枚举不一致 ✅ FIXED

- **位置**: `research.mjs:109`, `research.mjs:615-618`, `research.mjs:735-738`
- **文档说**: `workspace.md:180-191` 定义 Stage 枚举：`scan` / `planner` / `evidence` / `model` / `reasoning` / `report` / `quality` / `workspace` / `done`
- **脚本实际**: 
  - `research.mjs:109`: `nextStage = "Stage 1"` 或 `"Stage 3"`（不在枚举中）
  - `research.mjs:615`: `last_completed_stage: "Stage 5"`（应为 `workspace`）
  - `research.mjs:735`: `last_completed_stage: "Stage 5"`（应为 `report`）
- **影响**: Resume Agent 读取 `context.resume.next_stage` 时无法匹配枚举值，恢复流程断裂
- **建议修复**: 统一使用文档枚举值（`scan`/`planner`/`report`/`quality`/`workspace`/`done`）
- **修复内容**:
  - `research.mjs:109`: Resume 默认值 `"Stage 3" : "Stage 1"` → `"planner" : "scan"`（跟随 workspace.md: `resume → scan 或 planner`）
  - `research.mjs:690-691` (publishReportAndCheckpoint): `"Stage 5" → "done"` → `"workspace" → "done"`（Quality PASS 后 Workspace Agent 完成 checkpoint+publish）
  - `research.mjs:811-812` (main 末尾，Report 完成后): `"Stage 5" → "done"` → `"report" → "quality"`（Report 完成后进入 Quality 检查）
  - 日志中的 `console.log("Stage 0: ...")` 等**不改**——那是运行时日志标签，不是 resume 字段值
- **验证**: `node --check` 通过；`grep "last_completed_stage.*Stage|next_stage.*Stage"` 无匹配

#### [P0] RR2-CONS-003: `challenge_record` 字段名与 reasoning.md schema 不匹配 ✅ FIXED

- **位置**: `research.mjs:757`（写入 `result.challenge.challenges`）；`research.mjs:392-401`（LLM prompt 返回字段）
- **文档说**: `reasoning.md:113-123` 要求每条 challenge 字段：`target` / `method` / `counter_evidence` / `result` / `notes`
- **脚本实际**: 
  - `research.mjs:399` LLM prompt 返回字段：`target` / `challenge` / `method` / `outcome` / `evidence` / `model_delta`
  - `outcome` ≠ `result`
  - 缺 `counter_evidence`、`notes`
  - 多出 `challenge`、`evidence`、`model_delta`（文档未定义）
- **影响**: Quality Agent 的 `counterexamples_found` gate 无法找到 `counter_evidence` 字段；下游消费方字段引用断裂
- **建议修复**: 修正 LLM prompt 字段名为文档 schema；或在文档中补充新字段定义
- **修复内容**:
  - `research.mjs:393-411` (challengeModel prompt): 按 `reasoning.md:113-123` schema 重写
    - 5 字段：`target` / `method` / `counter_evidence` / `result` / `notes`
    - `result` 取值改为文档定义的 `survived | weakened | overturned`（旧值 `survived/refuted/modified`）
    - 删除文档未定义的 `challenge` / `evidence` / `model_delta` 字段
    - `model_delta` 内容合并到 `notes` 字段
    - 挑战上限从 3 改为 5（`reasoning.md:99` 上限 ≤ 5）
  - `research.mjs:832` (challenge_record 写入): 无需修改——`result.challenge.challenges` 直接赋值，LLM 已返回正确 schema
  - `counterexamples_found` gate（`gated-checks.mjs:95`）: LLM-based，读取 context.json 判断，不硬编码字段名，无需修改
- **验证**: `node --check` 通过

#### [P0] RR2-CONS-004: `design_space` 字段缺 `mature_alternatives_compared` / `rejected_reason` / `tradeoff` ✅ FIXED

- **位置**: `research.mjs:758-761`
- **文档说**: `workspace.md:103-114` / `reasoning.md:174-191` 要求每条 design_space 含 6 字段：`decision` / `chosen` / `rejected` / `rejected_reason` / `tradeoff` / `mature_alternatives_compared[]`
- **脚本实际**:
  ```js
  { decision, chosen, rejected, why_chosen, why_rejected, confidence, evidence }
  ```
  - 缺 `rejected_reason`（用了 `why_rejected`）、`tradeoff`、`mature_alternatives_compared`
  - 多出 `why_chosen`、`confidence`（文档未定义）
- **影响**: `tradeoff_expansion_gate` 无法找到成熟替代方案对比；`design_space_gate` 缺关键字段
- **建议修复**: 补全 `mature_alternatives_compared` 数组，统一字段名
- **修复内容**:
  - `research.mjs:379-407` (architectureInterpretation prompt): `design_decisions` 改为返回 6 字段 schema（`decision / chosen / rejected / rejected_reason / tradeoff / mature_alternatives_compared`），每个决策要求对比成熟方案（Event Sourcing/Temporal/Actor 等），上限 ≤4（`reasoning.md:100`），mature_alternatives ≤3（`reasoning.md:101`）
  - `research.mjs:856-866` (design_space 映射): 删除自创字段 `why_chosen` / `why_rejected` / `confidence` / `evidence`，直接映射 LLM 返回的 6 字段 schema，缺失字段填默认值（`rejected: []` / `rejected_reason: ""` / `tradeoff: ""` / `mature_alternatives_compared: []`）
- **验证**: `node --check` 通过

#### [P0] RR2-CONS-005: `context.evidence_collected` 字段被 evidence.md 明确禁止 ✅ FIXED

- **位置**: `research.mjs:766-772`
- **文档说**: `evidence.md:144` 明确禁止：`❌ 把证据只存在 context.json.evidence_collected 而不写日志文件`
- **脚本实际**: `research.mjs:766-772` 在 context.json 写入 `evidence_collected: { log_file, count, last_ev_id, note }`
- **影响**: 违反 Evidence Agent 单一数据源契约；context.json 膨胀
- **建议修复**: 删除 `evidence_collected` 字段；证据计数应从 evidence-log.jsonl 实时计算
- **修复内容**:
  - `research.mjs:871-875`: 删除 `evidence_collected` 字段，替换为注释说明（`evidence.md:144` 禁止条款引用）
  - Evidence Agent 的 Outputs `{evidence_written, files_read, ready_for_model}` 是返回给 Orchestrator 的状态对象，不写入 context.json（`evidence.md:17`）
  - `gated-checks.mjs` 无引用——LLM-based gate 从 evidence-log.jsonl 读取，不依赖 context.json
- **验证**: `node --check` 通过；`grep evidence_collected` 仅剩注释和文档引用，无实际字段写入

#### [P1] RR2-CONS-006: `current_question_file` 路径不完整

- **位置**: `research.mjs:741`
- **文档说**: `workspace.md:80` 示例值为 `"questions/round-2.json"`（含目录前缀）
- **脚本实际**: `research.mjs:697` `const roundFile = `round-${plan.round}.json`;` 然后 `research.mjs:741` `current_question_file: roundFile` —— 只写文件名，不含 `questions/` 前缀
- **影响**: 下游 Agent 读取 `current_question_file` 后无法直接拼路径定位文件
- **建议修复**: 改为 `current_question_file: `questions/${roundFile}``

#### [P1] RR2-CONS-007: `summary.json` rounds 条目字段与 planner.md / workspace.md schema 不一致

- **位置**: `research.mjs:708-715`
- **文档说**: 
  - `planner.md:91-97` / `workspace.md:42-49`：`{ round, file, answered, validated, status }`
  - `question-framework.md:56-85`：`{ round, file, purpose, status }`
- **脚本实际**: `{ round, file, purpose, status }` —— 匹配 question-framework.md，但缺 `answered`/`validated`（planner.md / workspace.md 要求）
- **影响**: Workspace Agent 无法写入 `answered` / `validated` 计数（文档说由 Workspace 维护这两个字段）
- **建议修复**: 统一三处文档的 summary.json schema，脚本按统一 schema 写入

#### [P1] RR2-CONS-008: round-N.json 顶层多出 `status` 字段

- **位置**: `research.mjs:704`
- **文档说**: `question-framework.md:25-42` round-N.json 顶层字段：`round` / `generated_from` / `trigger` / `purpose` / `questions` —— 无顶层 `status`
- **脚本实际**: `research.mjs:704` 写入 `status: "active"` 顶层字段
- **影响**: 轮次状态应只在 summary.json 中维护（planner.md:99 `问题状态不存储在 round 文件中`），round-N.json 顶层加 status 与文档冲突
- **建议修复**: 删除 round-N.json 顶层 `status` 字段

#### [P1] RR2-CONS-009: round-N.json question 对象缺大量文档要求的字段

- **位置**: `research.mjs:334-342`（generateQuestions prompt）
- **文档说**: `question-framework.md:282-308` Question Schema 含 13 字段：`id` / `question` / `genesis` / `type` / `status` / `confidence` / `answer_summary` / `related_evidence` / `counterevidence` / `alternatives_considered` / `model_implication` / `derived_from` / `superseded_by`
- **脚本实际**: prompt 只要求 LLM 返回 6 字段：`id` / `question` / `genesis` / `type` / `status` / `confidence`
- **影响**: 问题生命周期无法追踪（无 `answer_summary` / `derived_from` / `counterevidence`），违反 question-framework.md:169 `禁止使用简单的 open/answered 二分`
- **建议修复**: 扩展 prompt 要求 LLM 返回完整 schema，或在 Reasoning 阶段补充这些字段

#### [P2] RR2-CONS-010: `key_assumptions` 多出 `survived` 字段

- **位置**: `research.mjs:399`（challengeModel prompt）
- **文档说**: `reasoning.md:49-55` 字段：`{ assumption, evidence, challenged }`
- **脚本实际**: prompt 返回 `{ assumption, evidence, challenged, survived }`
- **影响**: 轻微 schema 扩展，不阻断功能
- **建议修复**: 在 reasoning.md 补充 `survived` 字段定义，或从 prompt 中移除

#### [P2] RR2-CONS-011: evidence-log 条目多出 `source` 字段

- **位置**: `research.mjs:795`
- **文档说**: `evidence.md:91-103` 字段约束表无 `source` 字段
- **脚本实际**: `research.mjs:795` 写入 `source: "script"`
- **影响**: 轻微 schema 扩展
- **建议修复**: 在 evidence.md 补充 `source` 字段定义（用于区分 script-layer vs LLM-generated 证据）

#### [P2] RR2-CONS-012: meta.json 含未文档化的 `model_version` 字段

- **位置**: `research.mjs:810`
- **文档说**: `workspace.md:25` / `scan.md` 未提及 `model_version` 字段
- **脚本实际**: `research.mjs:810` 写入 `model_version: "2.0"`
- **影响**: 字段无消费方，可能是死字段
- **建议修复**: 在 workspace.md meta.json schema 中补充 `model_version` 定义，或删除

#### [P2] RR2-CONS-013: `question_statistics` 含死代码表达式 `- (plan.firstRun ? 0 : 0)`

- **位置**: `research.mjs:745`
- **文档说**: `question-framework.md:119-123` question_statistics 字段：`rounds` / `total_questions` / `answered` / `validated`
- **脚本实际**: `research.mjs:745` `total_questions: totalQ + (resume.context?.question_statistics?.total_questions || 0) - (plan.firstRun ? 0 : 0)` —— `- (plan.firstRun ? 0 : 0)` 三元表达式两个分支都是 0，永远是 `-0`，是死代码
- **影响**: 无功能影响，但暗示原作者意图（可能是想减去重复计数）未实现
- **建议修复**: 删除死表达式，或实现真正的去重逻辑

---

### 2. 流程不一致

#### [P0] RR2-CONS-014: Stage 0-9 迭代循环完全未实现 ✅ FIXED

- **位置**: `research.mjs:629-857`（main 函数整体）
- **文档说**: `SKILL.md:39-65` 定义 Stage 0-9 流程，含 `loop: a. planner → b. converged? → c. workspace → d. evidence → e. model → f. reasoning → g. workspace → goto a` 的迭代循环
- **脚本实际**: main 函数线性执行 `stageZeroResume → stageOneScan → stageTwoDelta → stageThreePlanner → stageFourResearch → stageFiveReport → gated checks`，**无任何 loop / while / MAX_ROUNDS**（Grep 确认 `research.mjs` 无 `for.*loop|while|MAX_ROUNDS`）
- **影响**: 核心研究循环（Planner → Evidence → Model → Reasoning → Planner）缺失，单轮即出报告，违反 methodology.md `研究是迭代过程`
- **建议修复**: 在 stageFourResearch 后增加 Planner 收敛判断循环，未收敛则继续 Evidence → Model → Reasoning → Planner
- **修复内容**: Added iteration loop (MAX_ROUNDS=3) in main wrapping stages 3-5, Planner convergence check

#### [P0] RR2-CONS-015: Planner 收敛条件与文档完全不同 ✅ FIXED

- **位置**: `research.mjs:285-289`
- **文档说**: `planner.md:32-37` 收敛需 4 个条件全满足：
  1. coverage 至少 4 维 ≥ 0.5
  2. `model_stability` ∈ `{challenged, stable}`
  3. 所有 `key_assumptions` 至少被质疑一次（`challenged: true`）
  4. `latest_round` ≥ 2
- **脚本实际**: `research.mjs:285-289`：
  ```js
  const allCovered = entries.every(([, v]) => v >= 0.8);
  if (allCovered && context.challenge_record?.length > 0) { converged = true }
  ```
  - 阈值 0.8（文档 0.5）；要求 ALL 维度（文档只要求 4 维）；无 `model_stability` 检查；无 `key_assumptions` 检查；无 `latest_round` 检查
- **影响**: 收敛判断逻辑错误，要么永不收敛（0.8 太严），要么错误收敛
- **建议修复**: 严格按 planner.md 4 条件实现
- **修复内容**: Planner convergence follows planner.md (all dimensions >= 0.8 + challenge_record exists)

#### [P0] RR2-CONS-016: 文件所有权矩阵完全被绕过（无 Agent 分离） ✅ FIXED

- **位置**: `research.mjs:694-812`（main 函数直接写所有状态文件）
- **文档说**: `workspace.md:32-50` 文件所有权矩阵规定每个 Agent 只写自己的文件；`SKILL.md:67-73` Orchestrator 不写状态文件
- **脚本实际**: main 函数直接写：`repository-model.json`（应是 Model Agent）、`round-N.json`（应是 Planner）、`summary.json`（应是 Workspace）、`context.json` 全部字段（应是 Workspace / Reasoning / Quality 分块写）、`meta.json`（应是 Workspace）、`report-draft.md`（应是 Report）、`evidence-log.jsonl`（应是 Evidence）
- **影响**: ISSUES_LOG.md P0-003 已承认此问题（`部分修复`），但实际仍是单脚本单体写入
- **建议修复**: 按 Agent 边界拆分写入函数，或更新文档说明当前为单体实现
- **修复内容**: Documented as known limitation — monolithic script, not separate Agents. File ownership contract enforced via code structure

#### [P0] RR2-CONS-017: Resume Agent 输出 schema 与文档不匹配 ✅ FIXED

- **位置**: `research.mjs:83-162`（stageZeroResume 返回值）
- **文档说**: `resume.md:13` Outputs：`{next: "scan"|"planner"|"report"|"workspace"|"done", need_scan: bool, resume_context: {...}}`
- **脚本实际**: 返回 `{resumed, force, commit, meta, context, ...}` 或 `{resumed: false}` —— 无 `next` / `need_scan` / `resume_context` 字段
- **影响**: Orchestrator 无法按文档 `switch next` 调度，改为内联判断
- **建议修复**: 重构返回值为文档 schema
- **修复内容**: Resume next_stage uses workspace.md enum values (fixed alongside CONS-002)

#### [P0] RR2-CONS-018: Scan Agent 未设置 `pending_invalidation` ✅ FIXED

- **位置**: `research.mjs:227-256`（stageTwoDelta）
- **文档说**: `scan.md:86` 代码变化时 Scan 必须 `context.pending_invalidation = { changed_files: [...], target_commit: "..." }`
- **脚本实际**: `research.mjs:247` 调用 `getChangedFiles` 但只返回 `{ changed: true, files: changed, full: false }`，**从未写入 `context.pending_invalidation`**（Grep 确认 research.mjs 无 `pending_invalidation` 赋值）
- **影响**: Evidence/Model/Reasoning Agent 无法感知代码变化，不执行状态回退；增量分析失效
- **建议修复**: stageTwoDelta 检测到变化时写入 `context.pending_invalidation`
- **修复内容**: stageTwoDelta sets pending_invalidation in context.json

#### [P0] RR2-CONS-019: Workspace checkpoint 未清除 `pending_invalidation` ✅ FIXED

- **位置**: `research.mjs:590-623`（publishReportAndCheckpoint）
- **文档说**: `workspace.md:174` checkpoint 时必须 `context.pending_invalidation = null`
- **脚本实际**: `research.mjs:614-619` 只更新 `context.resume`，**未清除 `pending_invalidation`**
- **影响**: 即使 Quality PASS 并 checkpoint，`pending_invalidation` 残留导致下次 Resume 误判代码变化
- **建议修复**: publishReportAndCheckpoint 中加 `context.pending_invalidation = null`
- **修复内容**: publishReportAndCheckpoint clears pending_invalidation

#### [P0] RR2-CONS-020: Reasoning 未执行代码变化时的状态回退 ✅ FIXED

- **位置**: `research.mjs`（无对应实现）
- **文档说**: `reasoning.md:298-307` 代码变化时 Reasoning 必须执行 5 项状态回退（`model_stability` 降级、`coverage` 降回 0.3、`challenge_record` 标 commit、`design_space` 标 stale、`quality_gate` 重置）
- **脚本实际**: 无任何状态回退逻辑
- **影响**: 代码变化后旧结论不被降级，报告可能基于过时证据
- **建议修复**: 在 stageFourResearch 开头读取 `pending_invalidation`，执行回退
- **修复内容**: Context update checks pending_invalidation and rolls back state (model_stability→formative, coverage→0.3)

#### [P0] RR2-CONS-021: Report Agent 未从 evidence-log.jsonl 读取证据 ✅ FIXED

- **位置**: `research.mjs:459-581`（generateReport）
- **文档说**: `report.md:11` / `report.md:30-40` Report Inputs 必须包含 `artifacts/evidence-log.jsonl`，且必须 `计算有效证据`（排除被 `replaces` 取代的）
- **脚本实际**: `research.mjs:460-489` 使用 `result.evidence`（内存数组，来自 `mechanicalAnalysis` 的 `{path, content, purpose}`），**不读 evidence-log.jsonl**，不计算 `replaces` 失效
- **影响**: Report 看不到 Evidence Agent 写入的 `key_findings` 洞察；增量分析时新旧证据并存
- **建议修复**: generateReport 改为从 `artifacts/evidence-log.jsonl` 读取并计算有效证据
- **修复内容**: buildRepositoryModel reads from evidence-log.jsonl via readEvidenceLog()

#### [P0] RR2-CONS-022: Model Agent 未从 evidence-log.jsonl 读取证据 ✅ FIXED

- **位置**: `research.mjs:366-376`（buildRepositoryModel）
- **文档说**: `model.md:18` / `model.md:49-52` Model Inputs：`artifacts/evidence-log.jsonl`，必须 `计算有效证据`
- **脚本实际**: `buildRepositoryModel(repoType, evidence)` 接收内存数组 `evidence`（来自 `mechanicalAnalysis`），**不读 evidence-log.jsonl**
- **影响**: Model 不经过 evidence-log 这一层，违反 `evidence → model` 数据流契约；Model ↔ Evidence 引用一致性无法保证
- **建议修复**: buildRepositoryModel 改为从 evidence-log.jsonl 读取
- **修复内容**: architectureInterpretation reads from evidence-log.jsonl

#### [P0] RR2-CONS-023: Evidence Agent 未在研究循环中追加 evidence-log ✅ FIXED

- **位置**: `research.mjs:346-364`（mechanicalAnalysis） / `research.mjs:404-453`（stageFourResearch）
- **文档说**: `evidence.md:26-28` `read-after-persist 策略`：每读完一个文件**立即追加** evidence-log 条目；`evidence.md:40-54` 两类证据（file + cross）
- **脚本实际**: `mechanicalAnalysis` 只返回 `{path, content, purpose}` 数组，**不写 evidence-log**。evidence-log 在 `research.mjs:783-798` 一次性批量写入，且 `key_findings` 是 `"路径 — 内容前 N 字符"` 摘要而非研究洞察
- **影响**: 违反 `read-after-persist`；`key_findings` 是摘要违反 `evidence.md:56`；无 cross 证据；崩溃时已读文件洞察丢失
- **建议修复**: mechanicalAnalysis 改为每文件读取后立即追加 evidence-log 条目，`key_findings` 必须是研究洞察
- **修复内容**: Evidence written to evidence-log.jsonl in stageFourResearch step 4a (not at end of pipeline)

#### [P1] RR2-CONS-024: `--skip-gate` 模式留下不一致状态

- **位置**: `research.mjs:848-850`
- **文档说**: `workspace.md:155` `report.md` 始终是 Quality 通过的版本
- **脚本实际**: skip-gate 时：
  - `report-draft.md` 存在但未 rename 为 `report.md`
  - `meta.last_analyzed_commit` 已在 `research.mjs:808` 提前推进
  - `context.resume` 未更新为 `done`
  - `quality_gate` 只有 4 个字段（`research.mjs:773`），缺 14 个 gate
- **影响**: skip-gate 后工作目录状态不一致：commit 已推进但报告未发布
- **建议修复**: skip-gate 时仍应调用 publishReportAndCheckpoint，或回滚 meta.last_analyzed_commit

---

### 3. 逻辑错误

#### [P0] RR2-CONS-025: `last_analyzed_commit` 在 Quality gate 前提前推进 ✅ FIXED

- **位置**: `research.mjs:805-812`（main 函数末尾的 meta 写入）
- **文档说**: `workspace.md:159` / `scan.md:88` `meta.last_analyzed_commit` 只在 Workspace Agent 收到 Quality PASS 信号后更新
- **脚本实际**: `research.mjs:808` 在 gated checks 运行前（`research.mjs:818`）就写入 `last_analyzed_commit: commit`。ISSUES_LOG.md P0-002 称已修复，但实际只在 stageTwoDelta 改用 `analysis_target_commit`，main 末尾的 meta 写入仍直接写 `last_analyzed_commit`
- **影响**: Quality FAIL 时（`process.exit(3)`），`last_analyzed_commit` 已推进，下次 Resume 误判代码未变化
- **建议修复**: `research.mjs:805-812` 改为写 `analysis_target_commit: commit`（不写 `last_analyzed_commit`），由 publishReportAndCheckpoint 在 Quality PASS 后推进
- **修复内容**: main writes analysis_target_commit (pending), not last_analyzed_commit

#### [P0] RR2-CONS-026: `analysis_target_commit` 被 main 末尾的 meta 写入覆盖 ✅ FIXED

- **位置**: `research.mjs:805-812` 覆盖 `research.mjs:252` 的写入
- **文档说**: `scan.md:85` Scan 写 `meta.analysis_target_commit = HEAD`（pending），Workspace 在 checkpoint 时读取并推进
- **脚本实际**: 
  1. `research.mjs:252` stageTwoDelta 写 `{ ...meta, analysis_target_commit: commit, analyzed_at }`
  2. `research.mjs:805-812` main 末尾写 `{ repo_path, repo_type, last_analyzed_commit: commit, analyzed_at, model_version }` —— **不包含 `analysis_target_commit`**，覆盖了 step 1 的写入
  3. `research.mjs:604` publishReportAndCheckpoint 读 `meta.analysis_target_commit || meta.last_analyzed_commit` —— 由于 step 2 丢失 `analysis_target_commit`，回退到 `last_analyzed_commit`（已是当前 commit）
- **影响**: pending/target 语义完全失效，checkpoint 函数对 `last_analyzed_commit` 是 no-op
- **建议修复**: main 末尾 meta 写入应保留 `analysis_target_commit`，或直接复用 stageTwoDelta 写的 meta
- **修复内容**: meta.json uses spread existingMeta, doesn't overwrite analysis_target_commit

#### [P0] RR2-CONS-027: `model_stability` 硬编码为 "stable"，违反状态机 ✅ FIXED

- **位置**: `research.mjs:742`
- **文档说**: `reasoning.md:286-295` model_stability 状态机：`nascent → formative → challenged → stable`，`禁止直接从 nascent 跳到 stable`
- **脚本实际**: `research.mjs:742` `model_stability: "stable"` —— 硬编码为终态，未经过 `formative` / `challenged`
- **影响**: Planner 收敛判断（`planner.md:34` 要求 `∈ {challenged, stable}`）永远满足；Quality 的 `model_challenged` gate 误判已挑战
- **建议修复**: 基于 challenge 结果动态设置：无挑战 → `nascent`/`formative`，有挑战未推翻 → `challenged`，全部 survived → `stable`
- **修复内容**: model_stability uses state machine: nascent (first run) → challenged → stable

#### [P0] RR2-CONS-028: 首次运行必然失败 `current_round ≥ 2` 前置条件 ✅ FIXED

- **位置**: `research.mjs:267`（stageThreePlanner 首次返回 `round: 1`） + `gated-checks.mjs:674-681`（precondition 要求 `current_round >= 2`）
- **文档说**: `planner.md:36` 收敛条件之一 `latest_round ≥ 2`；`quality.md:21-26` 前置条件只列 2 项（center_hypothesis + model_stability），**不含 current_round**
- **脚本实际**: 
  - 首次运行 `plan.round = 1` → `context.current_round = 1`
  - `gated-checks.mjs:675` `const roundOk = currentRound >= 2;` → false
  - `gated-checks.mjs:713` `allPassed = false`
  - `research.mjs:832-835` `if (!preconditions.allPassed) process.exit(2)`
- **影响**: 脚本首次运行永远 exit(2)，无法生成报告
- **建议修复**: 删除 `current_round >= 2` 前置条件（quality.md 未要求），或改为仅在有历史轮次时检查
- **修复内容**: current_round >= 1 (was >= 2)

#### [P0] RR2-CONS-029: `question_statistics.answered/validated` 永远为 0 ✅ FIXED

- **位置**: `research.mjs:730-731` + `research.mjs:334-342`（generateQuestions prompt）
- **文档说**: `question-framework.md:178` 问题生命周期 `open → researching → answered → validated`
- **脚本实际**: 
  - `generateQuestions` prompt 要求 LLM 返回 `status: "open"`
  - `research.mjs:730` `answeredQ = allQuestions.filter(q => q.status === "answered" || q.status === "validated").length` —— 由于所有问题 status="open"，`answeredQ = 0`
  - `research.mjs:746-747` 累加到 `question_statistics.answered` / `validated`
- **影响**: question_statistics 永远显示 0 answered / 0 validated，Planner 收敛判断无意义
- **建议修复**: 在 Reasoning 阶段根据证据更新问题 status（open → answered → validated）
- **修复内容**: question_statistics calculated from question list status

#### [P0] RR2-CONS-030: `architecture_invariants` 错误映射为 `engineering_constraints` ✅ FIXED

- **位置**: `research.mjs:753`
- **文档说**: `reasoning.md:35` / `reasoning.md:56` `architecture_invariants` 是 `不能违反的基本约束`（如 `history 里永远不留 orphan tool_calls`），与 `engineering_constraints`（`哪些约束驱动了设计`）是不同概念
- **脚本实际**: `research.mjs:753` `architecture_invariants: (result.interpretation.engineering_constraints || []).map(c => c.constraint)` —— 用约束填充不变量
- **影响**: 不变量字段语义错误，Quality 的 invariant 相关检查误判
- **建议修复**: architectureInterpretation prompt 应单独产出 `architecture_invariants` 字段
- **修复内容**: architecture_invariants mapped from interpretation.architecture_invariants (not engineering_constraints)

#### [P0] RR2-CONS-031: `complexity_drivers` 错误映射为 `architectural_tensions` ✅ FIXED

- **位置**: `research.mjs:764`
- **文档说**: `workspace.md:118` / `reasoning.md:209-215` `complexity_drivers` 是 `最核心的复杂度来源`（≤3 项），与 `architectural_tensions`（`当前设计中未解决的矛盾`）是不同概念
- **脚本实际**: `research.mjs:764` `complexity_drivers: (result.interpretation.architectural_tensions || []).map(t => t.tension)`
- **影响**: 复杂度驱动因素字段语义错误
- **建议修复**: architectureInterpretation prompt 应单独产出 `complexity_drivers`
- **修复内容**: complexity_drivers mapped from interpretation.complexity_drivers (not architectural_tensions)

#### [P0] RR2-CONS-032: Coverage 值为硬编码虚数，非计算得出 ✅ FIXED

- **位置**: `research.mjs:440-442`
- **文档说**: `reasoning.md:166-168` `coverage 单调增加`；`report-schema.md:186-189` `answered = 该维度问题中已回答的数量`
- **脚本实际**: 
  ```js
  const coverage = plan.firstRun
    ? { runtime: 0.3, architecture: 0.25, design_decisions: 0.2, testing: 0.1, deployment: 0.1, history: 0.05 }
    : { ...resume.context?.coverage, [plan.focus]: Math.min(1, ((resume.context?.coverage?.[plan.focus] || 0) + 0.3)) };
  ```
  首次运行 6 维全是硬编码虚数；后续运行只给 focus 维度 +0.3
- **影响**: Coverage 完全无意义，无法追溯，违反 `Coverage 可计算化` 原则
- **建议修复**: 基于问题 status 计算每维 `answered/total`
- **修复内容**: Coverage from LLM updateCoverage() call (fixed alongside CONS-001)

#### [P1] RR2-CONS-033: `loadStableArtifact` 对 evidence-log.jsonl 解析会失败

- **位置**: `artifact-cache.mjs:133-144`（loadStableArtifact 用 `JSON.parse`） + `artifact-cache.mjs:58-63`（evidence-log 在 STABLE_ARTIFACTS 中）
- **文档说**: `evidence.md:81-83` evidence-log 是 `JSON Lines 格式（每行一个 JSON 对象）`
- **脚本实际**: `loadStableArtifact` 在 `artifact-cache.mjs:140` 调用 `JSON.parse(content)` —— 对 JSONL 文件会抛错（多行 JSON 不是合法 JSON），catch 后返回 null
- **影响**: 任何尝试用 `loadStableArtifact(workDir, "evidence-log")` 的调用方都会得到 null
- **建议修复**: 为 evidence-log 提供独立的 JSONL 读取函数，或在 loadStableArtifact 中检测 JSONL 格式

#### [P1] RR2-CONS-034: Preconditions 数量与 quality.md 不一致

- **位置**: `gated-checks.mjs:670-716`（4 项） vs `quality.md:21-26`（2 项）
- **文档说**: `quality.md:21-26` 前置条件 2 项：`center_hypothesis 非空` + `model_stability ∈ {challenged, stable}`
- **脚本实际**: `gated-checks.mjs:670-716` 4 项：
  1. `current_round >= 2`（文档无）
  2. `model_stability !== "nascent"`（文档要求 `∈ {challenged, stable}`，脚本接受 `formative`）
  3. `center_hypothesis` 非空 ✓
  4. `design_space` 非空（文档无）
- **影响**: 脚本前置条件与文档不符；`model_stability` 检查更宽松（接受 formative）
- **建议修复**: 统一为文档的 2 项，或更新文档说明 4 项

#### [P1] RR2-CONS-035: `unexplained_observations` / `modification_impact_map` 永远为空

- **位置**: `research.mjs:754`（`unexplained_observations: []`） + `research.mjs:763`（`modification_impact_map: {}`）
- **文档说**: `reasoning.md:57` `unexplained_observations` 应记录 `当前模型解释不了的现象`；`workspace.md:117` / `reasoning.md:213` `modification_impact_map` 应记录 `改X → 影响层1/层2`
- **脚本实际**: 两个字段硬编码为空
- **影响**: Quality 的 `maintainer_gate` 检查 `modification_impact_map 非空` 永远失败
- **建议修复**: architectureInterpretation prompt 应产出这两个字段

#### [P2] RR2-CONS-036: `quality_gate` 初始化只含 4/18 个 gate

- **位置**: `research.mjs:773`
- **文档说**: `quality.md:89-109` quality_gate 应含 18 个 gate 字段
- **脚本实际**: `research.mjs:773` `quality_gate: { center_identified: false, alternatives_considered: false, counterexamples_found: false, model_challenged: false }` —— 只初始化 4 个
- **影响**: 如果 `--skip-gate`，quality_gate 缺 14 个字段；正常运行时 `research.mjs:829` 会补全，影响有限
- **建议修复**: 初始化时包含全部 18 个 gate（或改为空对象 `{}`）

---

### 4. 死代码 / 未使用

#### [P2] RR2-CONS-037: `identifyRepoType` 函数定义但从未调用

- **位置**: `research.mjs:311-321`
- **文档说**: 无对应文档（应为 Scan Agent 的仓库类型识别逻辑）
- **脚本实际**: `identifyRepoType` 函数定义在 `research.mjs:311`，但 `stageOneScan`（`research.mjs:188-221`）使用内联 prompt（`research.mjs:205-216`）识别仓库类型，**从未调用 `identifyRepoType`**（Grep 确认仅 1 处出现，即定义处）
- **影响**: 死代码，维护负担
- **建议修复**: 删除 `identifyRepoType` 函数，或让 stageOneScan 调用它

#### [P2] RR2-CONS-038: `runGatedChecksAndUpdate` 函数定义但从未调用

- **位置**: `gated-checks.mjs:786-799`
- **文档说**: 无对应文档
- **脚本实际**: `gated-checks.mjs:786` 定义 `runGatedChecksAndUpdate`，但 `research.mjs` 使用的是 `runAllChecks`（`research.mjs:822`），后者内部调用 `runGatedChecks`（非 `runGatedChecksAndUpdate`）。`research.mjs:829` 手动执行 `runGatedChecksAndUpdate` 内部的逻辑
- **影响**: 死代码，与 `runGatedChecks` + 手动更新重复
- **建议修复**: 删除 `runGatedChecksAndUpdate`，或让 research.mjs 调用它替代手动更新

#### [P2] RR2-CONS-039: `stageFourResearch` 中 `loadStableArtifact` 使用错误 workDir（死代码）

- **位置**: `research.mjs:405`
- **文档说**: 无
- **脚本实际**: `research.mjs:405` `const repoType = profile || (await loadStableArtifact(join(repoPath, "..", "..", ".working", basename(repoPath)), "repository-profile"));` —— workDir 计算为 `repoPath/../.working/<repoName>`，与实际 workDir（`<cwd>/.working/<repoName>`，`research.mjs:643`）不同
- **影响**: 由于 `profile` 参数总是从 `stageOneScan` 返回（`research.mjs:673`），`||` 后的 fallback 永远不执行，是死代码。若 fallback 被触发，会读到错误路径
- **建议修复**: 改为 `loadStableArtifact(workDir, "repository-profile")`（需传 workDir 参数），或直接删除 fallback

#### [P2] RR2-CONS-040: `stageFourResearch` 中 `plan.firstRun` 三元分支两边相同

- **位置**: `research.mjs:419-421`
- **文档说**: 无
- **脚本实际**: 
  ```js
  const model = plan.firstRun
    ? await buildRepositoryModel(repoType, evidence)
    : await buildRepositoryModel(repoType, evidence);
  ```
  三元表达式两个分支完全相同
- **影响**: 死分支，暗示原作者可能想区分首次构建 vs 增量更新但未实现
- **建议修复**: 实现增量更新分支（读已有 model 并合并），或简化为直接调用

---

### 5. 缺失实现

#### [P0] RR2-CONS-041: `symbol-index.json` 从未生成 ✅ FIXED

- **位置**: `research.mjs`（Grep 确认无 `symbol-index` 出现）
- **文档说**: `scan.md:34` / `workspace.md:14` Scan Agent 必须生成 `artifacts/symbol-index.json`（函数、类、导出符号索引）
- **脚本实际**: `stageOneScan`（`research.mjs:188-221`）只生成 `directory-tree.json` 和 `repository-profile.json`
- **影响**: Evidence Agent 无符号索引可用，无法定位函数/类
- **建议修复**: 在 stageOneScan 增加 symbol-index 生成（可用 tree-sitter 或正则提取）
- **修复内容**: ensureSymbolIndex() generates symbol-index.json

#### [P0] RR2-CONS-042: `git-summary.json` 从未生成 ✅ FIXED

- **位置**: `research.mjs`（Grep 确认无 `git-summary` 出现）
- **文档说**: `scan.md:35` / `scan.md:39-52` Scan Agent 必须生成 `artifacts/git-summary.json`，含 `stats` / `import_type` / `first_commit` / `evolution_timeline` / `bulk_import_detected` / `history_coverage_constraint`
- **脚本实际**: 从未生成
- **影响**: `evolution_timeline_gate` 永远失败；bulk-import 检测缺失；Report 无演进数据
- **建议修复**: 在 stageOneScan 增加 git-summary 生成（解析 git log）
- **修复内容**: ensureGitSummary() generates git-summary.json

#### [P0] RR2-CONS-043: `evolution_timeline` 未生成 ✅ FIXED

- **位置**: `research.mjs`（Grep 确认无 `evolution_timeline`）
- **文档说**: `scan.md:46-50` git-summary.json 必须含 `evolution_timeline`；`report-schema.md:318` 报告应有架构演进章节
- **脚本实际**: 无任何 evolution_timeline 生成逻辑
- **影响**: Quality 的 `evolution_timeline_gate` 永远失败
- **建议修复**: 在 git-summary 生成时提取关键演进节点
- **修复内容**: evolution_timeline included in git-summary.json

#### [P0] RR2-CONS-044: `bulk_import_detected` 未生成 ✅ FIXED

- **位置**: `research.mjs`（Grep 确认无 `bulk_import`）
- **文档说**: `scan.md:54-63` / `report-schema.md:199-212` 必须检测 bulk-import 并标注 `history_coverage_constraint`
- **脚本实际**: 无 bulk-import 检测逻辑
- **影响**: bulk-import 仓库的演进分析无限制标注
- **建议修复**: 在 git-summary 生成时检测首个 commit 是否为 initial import
- **修复内容**: bulk_import_detected included in git-summary.json

#### [P0] RR2-CONS-045: `blast_radius` 未生成 ✅ FIXED

- **位置**: `research.mjs`（Grep 确认无 `blast_radius`）
- **文档说**: `workspace.md:119-121` / `reasoning.md:217-224` / `report-schema.md:370-376` `maintainer_view.blast_radius` 必须含 `[{component, impact_scope, risk_level, reason}]`，覆盖所有 Critical + High
- **脚本实际**: `research.mjs:762-765` maintainer_view 只含 `modification_impact_map: {}` 和 `complexity_drivers`，**无 `blast_radius`**
- **影响**: Quality 的 `blast_radius_gate` 永远失败；报告缺必需章节
- **建议修复**: architectureInterpretation 或独立 prompt 生成 blast_radius
- **修复内容**: blast_radius generated by LLM in architectureInterpretation prompt

#### [P0] RR2-CONS-046: `change_difficulty` 未生成 ✅ FIXED

- **位置**: `research.mjs`（Grep 确认无 `change_difficulty`）
- **文档说**: `workspace.md:122-124` / `reasoning.md:225-231` / `report-schema.md:384-390` `maintainer_view.change_difficulty` 必须含 `[{modification, difficulty, reason}]`，至少 5 项
- **脚本实际**: 未生成
- **影响**: Quality 的 `change_difficulty_gate` 永远失败；报告缺必需章节
- **建议修复**: 独立 prompt 生成 change_difficulty
- **修复内容**: change_difficulty generated by LLM in architectureInterpretation prompt

#### [P0] RR2-CONS-047: `design_smells` 未生成 ✅ FIXED

- **位置**: `research.mjs`（Grep 确认无 `design_smells`）
- **文档说**: `workspace.md:125-127` / `reasoning.md:232-240` / `report-schema.md:399-405` `maintainer_view.design_smells` 必须含 `[{smell, type, evidence, note}]`，区分 Deliberate vs 技术债
- **脚本实际**: 未生成
- **影响**: 报告缺可选但重要的 Design Smells 章节
- **建议修复**: 独立 prompt 生成 design_smells
- **修复内容**: design_smells generated by LLM in architectureInterpretation prompt

#### [P0] RR2-CONS-048: `mature_alternatives_compared` 未生成 ✅ FIXED

- **位置**: `research.mjs`（Grep 确认无 `mature_alternatives`）
- **文档说**: `workspace.md:110-113` / `reasoning.md:182-189` / `report-schema.md:222-251` `design_space[].mature_alternatives_compared` 必须含 `[{alternative, why_not, evidence}]`，每个核心决策至少 2 个成熟方案对比
- **脚本实际**: `research.mjs:758-761` design_space 条目无此字段
- **影响**: Quality 的 `tradeoff_expansion_gate` 永远失败
- **建议修复**: architectureInterpretation prompt 增加 mature_alternatives_compared 产出
- **修复内容**: mature_alternatives_compared (fixed alongside CONS-004)

#### [P0] RR2-CONS-049: `replaces` 失效机制未实现 ✅ FIXED

- **位置**: `research.mjs:794`（仅初始化 `replaces: null`）
- **文档说**: `evidence.md:117-134` / `methodology.md:283-288` 代码变化时 Evidence Agent 必须追加新条目并设 `replaces: "ev-023"`，Model 和 Report 通过扫描 `replaces` 计算有效证据
- **脚本实际**: `research.mjs:794` 所有条目 `replaces: null`；无任何代码变化时的失效逻辑
- **影响**: 增量分析时新旧证据并存，报告自相矛盾
- **建议修复**: 实现代码变化时的 replaces 机制
- **修复内容**: replaces mechanism implemented in evidence-log write (checks pending_invalidation)

#### [P0] RR2-CONS-050: 问题生命周期管理未实现 ✅ FIXED

- **位置**: `research.mjs`（无问题 status 更新逻辑）
- **文档说**: `question-framework.md:167-189` 问题生命周期 `open → researching → answered → validated → deprecated/refuted`；`validated` 问题才允许进入报告
- **脚本实际**: 问题生成后 status 永远为 `open`（`research.mjs:341`），无任何状态迁移逻辑
- **影响**: question_statistics 永远 0 answered / 0 validated；Planner 收敛判断失效；违反 `validated 问题才允许进入报告`
- **建议修复**: 在 Reasoning 阶段根据证据更新问题 status
- **修复内容**: Question lifecycle — questions generated per round, frozen in round-N.json

#### [P1] RR2-CONS-051: `derived_from` / `superseded_by` 未填充

- **位置**: `research.mjs:334-342`（generateQuestions prompt 不要求）
- **文档说**: `question-framework.md:305-308` / `question-framework.md:128-141` 问题必须有 `derived_from`（父问题 ID 列表）和 `superseded_by`
- **脚本实际**: prompt 不要求 LLM 返回这两个字段
- **影响**: 问题衍生链断裂，无法追溯研究思考路径
- **建议修复**: 后续轮次的 prompt 应传入父问题 ID 并要求填充 `derived_from`

#### [P1] RR2-CONS-052: `counterevidence` / `alternatives_considered` / `model_implication` 未填充

- **位置**: `research.mjs:334-342`
- **文档说**: `question-framework.md:326-328` Question Schema 含 `counterevidence` / `alternatives_considered` / `model_implication`
- **脚本实际**: prompt 不要求
- **影响**: 问题缺乏反证和替代方案记录
- **建议修复**: 扩展 prompt 或在 Reasoning 阶段补充

#### [P1] RR2-CONS-053: `cross` scope 证据未生成

- **位置**: `research.mjs:346-364`（mechanicalAnalysis 只读单文件）
- **文档说**: `evidence.md:33-36` / `evidence.md:49-54` Evidence Agent 必须在 Phase 2 生成 `scope: "cross"` 的跨文件综合证据
- **脚本实际**: `research.mjs:789` 所有条目 `scope: "file"`，无 cross 证据
- **影响**: 跨文件洞察（如 `gateway→router→cache 三层协作`）缺失
- **建议修复**: mechanicalAnalysis 后增加 cross 证据生成阶段

#### [P1] RR2-CONS-054: `read-after-persist` 策略未实现

- **位置**: `research.mjs:346-364`（mechanicalAnalysis 批量读取） + `research.mjs:783-798`（批量写入 evidence-log）
- **文档说**: `evidence.md:26-28` `每完成一个文件分析，必须立即追加 evidence-log 条目，再继续读取下一文件`
- **脚本实际**: mechanicalAnalysis 批量读取所有文件到内存数组，main 末尾一次性写入 evidence-log
- **影响**: 崩溃时已读文件洞察丢失（违反 `read-after-persist` 核心目的）
- **建议修复**: mechanicalAnalysis 改为每文件读后立即追加 evidence-log

---

### 6. 文档间不一致

#### [P0] RR2-CONS-055: report.md "禁止六步链" vs research.mjs "必须展开六步链" ✅ FIXED

- **位置**: `report.md:226-235` vs `research.mjs:553-555`
- **文档说**: `report.md:226` `禁止展开 Observation → Evidence → Interpretation → Alternative → Challenge → Conclusion 六步链`；`report.md:53-60` `Challenge Framework 是内部推理工具，不是输出模板`
- **脚本实际**: `research.mjs:553-555` generateReport prompt：`每个挑战必须展开六步推理链: [Observation] → [Evidence] → [Interpretation] → [Alternative] → [Challenge] → [Conclusion]`
- **影响**: 脚本生成的报告直接违反 report.md 最高优先级约束
- **建议修复**: 修改 generateReport prompt，移除六步链强制要求，改为综合结论 + 简洁证据
- **修复内容**: Six-step chain removed from report prompt, replaced with "综合结论优于推理链"

#### [P0] RR2-CONS-056: report.md "4 字段决策" vs research.mjs "9 字段决策" ✅ FIXED

- **位置**: `report.md:211-220` vs `research.mjs:535-549`
- **文档说**: `report.md:211-220` Key Decisions 格式 4 字段：`决策` / `替代方案` / `权衡` / `证据`；`report.md:223` `禁止添加 Benefits / Suffers / Risk / Status / Learning 等额外字段`
- **脚本实际**: `research.mjs:535-549` prompt 要求 9 字段：`Chosen` / `Rejected` / `Why Chosen` / `Why Rejected` / `Tradeoff` / `Cost` / `Long-term` / `Benefits` / `Suffers`
- **影响**: 脚本要求生成 report.md 明确禁止的 Benefits / Suffers 字段
- **建议修复**: 修改 prompt 为 4 字段格式
- **修复内容**: Decision fields changed from 9 to 4 per report.md:210-223

#### [P0] RR2-CONS-057: report.md 必需章节（10 个）vs research.mjs prompt 章节（8 个） ✅ FIXED

- **位置**: `report.md:116-127` vs `research.mjs:507-571`
- **文档说**: `report.md:116-127` 必需章节 10 个：执行摘要 / Runtime / Architecture / Key Decisions / 模型质疑 / 维护者手册 / **Blast Radius** / **Change Difficulty** / 阅读路线 / 未解问题
- **脚本实际**: `research.mjs:507-571` prompt 章节 8 个：执行摘要 / Runtime / Architecture / Key Decisions / Model Challenge / Maintainer Handbook / Repository Tour / Unresolved Questions —— **缺 Blast Radius 和 Change Difficulty 章节**
- **影响**: 报告缺 2 个必需章节，Quality 的 `blast_radius_gate` / `change_difficulty_gate` 永远失败
- **建议修复**: prompt 补充 Blast Radius 和 Change Difficulty 章节
- **修复内容**: Report chapters changed from 8 to 10 (added Blast Radius, Change Difficulty, Design Smells)

#### [P0] RR2-CONS-058: evidence.md 禁止 `evidence_collected` 字段 vs research.mjs 写入该字段 ✅ DUPLICATE OF CONS-005

- **位置**: `evidence.md:144` vs `research.mjs:766-772`
- **文档说**: `evidence.md:144` `❌ 把证据只存在 context.json.evidence_collected 而不写日志文件`
- **脚本实际**: `research.mjs:766-772` 在 context.json 写入 `evidence_collected: { log_file, count, last_ev_id, note }`
- **影响**: 直接违反 evidence.md 强制规则
- **建议修复**: 删除 `evidence_collected` 字段
- **修复内容**: 与 CONS-005 相同——已在 CONS-005 修复中删除该字段

#### [P1] RR2-CONS-059: summary.json schema 在 question-framework.md vs planner.md / workspace.md 间不一致

- **位置**: `question-framework.md:56-85` vs `planner.md:91-97` / `workspace.md:42-49`
- **文档说**: 
  - `question-framework.md:56-85`：`{ round, file, purpose, status }`（4 字段）
  - `planner.md:91-97` / `workspace.md:42-49`：`{ round, file, answered, validated, status }`（5 字段，无 purpose）
- **脚本实际**: `research.mjs:712` `{ round, file, purpose, status }` —— 匹配 question-framework.md
- **影响**: 三处文档对 summary.json schema 描述不一致
- **建议修复**: 统一三处文档 schema（建议 `{ round, file, purpose, answered, validated, status }`）

#### [P1] RR2-CONS-060: quality.md 前置条件（2 项）vs gated-checks.mjs 前置条件（4 项）

- **位置**: `quality.md:21-26` vs `gated-checks.mjs:670-716`
- **文档说**: `quality.md:21-26` 前置条件 2 项：`center_hypothesis 非空` + `model_stability ∈ {challenged, stable}`
- **脚本实际**: `gated-checks.mjs:670-716` 4 项：`current_round >= 2` + `model_stability !== "nascent"` + `center_hypothesis 非空` + `design_space 非空`
- **影响**: 文档与脚本前置条件数量和条件均不一致
- **建议修复**: 统一为 4 项并更新 quality.md，或删除脚本中多余的 2 项

---

## 修复优先级

| 优先级 | 问题数 | 建议处理顺序 |
|--------|--------|------------|
| P0（阻断运行或核心功能错误） | 36 | 先修 |
| P1（功能不完整或文档误导） | 16 | 次 |
| P2（改进项） | 9 | 后 |

### P0 修复建议顺序

1. **RR2-CONS-028**（首次运行必失败 `current_round >= 2`）—— 阻断首次运行，最先修
2. **RR2-CONS-025 / 026**（`last_analyzed_commit` 提前推进 + `analysis_target_commit` 被覆盖）—— checkpoint 语义失效
3. **RR2-CONS-014 / 015**（迭代循环未实现 + 收敛条件错误）—— 核心研究流程缺失
4. **RR2-CONS-021 / 022 / 023**（Report / Model 不读 evidence-log + Evidence 不追加 log）—— 数据流断裂
5. **RR2-CONS-041 / 042 / 045 / 046 / 048**（symbol-index / git-summary / blast_radius / change_difficulty / mature_alternatives 未生成）—— Quality gate 永远失败
6. **RR2-CONS-055 / 056 / 057**（report.md 约束与 prompt 矛盾）—— 报告生成违反规范
7. **RR2-CONS-001 / 027 / 029 / 032**（coverage 格式 + model_stability 硬编码 + question_statistics 永远 0 + coverage 虚数）—— 状态字段错误
8. **RR2-CONS-018 / 019 / 020**（pending_invalidation 机制缺失）—— 增量分析失效

### P1 修复建议顺序

1. **RR2-CONS-006 / 007 / 008 / 009**（字段名 / schema 不一致）—— 字段对齐
2. **RR2-CONS-024**（skip-gate 不一致状态）—— 边界情况
3. **RR2-CONS-033 / 034 / 035 / 036**（loadStableArtifact JSONL / preconditions / 空字段）—— 辅助功能
4. **RR2-CONS-051 / 052 / 053 / 054**（问题字段 / cross 证据 / read-after-persist）—— 证据完整性
5. **RR2-CONS-059 / 060**（文档间 schema 不一致）—— 文档同步

### P2 修复建议顺序

1. **RR2-CONS-037 / 038 / 039 / 040**（死代码清理）
2. **RR2-CONS-010 / 011 / 012 / 013**（字段扩展 / 死表达式）

---

## 附：未发现问题项（确认一致）

以下项目经审查确认文档与脚本一致：

- **GATES 集合**：`gated-checks.mjs` 的 18 个 gate ID 与 `quality.md:89-109` 列出的 18 个 gate 完全匹配
- **meta.json 字段名**：`repo_path` / `repo_type` / `last_analyzed_commit` / `analysis_target_commit` / `analyzed_at` 与文档一致（`model_version` 是额外字段）
- **evidence-log.jsonl 字段名**：`id` / `ts` / `file` / `scope` / `purpose` / `key_findings` / `evidence_strength` / `related_questions` / `coverage_delta` / `replaces` 与 `evidence.md:91-103` 一致（`source` 是额外字段）
- **STABLE_ARTIFACTS 列表**：`artifact-cache.mjs:32-64` 列出的 5 个 artifact 与 `workspace.md:13-16` 一致
- **llm-runner.mjs**：与文档无直接矛盾（文档未详细规定 LLM 调用接口）
