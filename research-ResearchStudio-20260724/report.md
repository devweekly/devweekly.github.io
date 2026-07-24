# ResearchStudio 工程研究报告

> **仓库**: [microsoft/ResearchStudio](https://github.com/microsoft/ResearchStudio) (v1.0.0)
> **分析日期**: 2026-07-24
> **方法论**: Research Trace（Question → Evidence → Analysis → Counter Evidence → Conclusion → Confidence）+ Ontology-driven Research
> **证据基线**: evidence-brief.md（§0–§9）+ evidence-store/full.json + 仓库源码 + git log（49 commits）

---

## 1. 执行摘要

ResearchStudio 是 Microsoft 发布的"AI 研究合作者"——以 Claude Code / Codex **skill 套件**形式存在，覆盖研究生命周期的两段：`ResearchStudio-Idea`（pre-paper 选题构思）与 `ResearchStudio-Reel`（post-paper 海报/视频/博客/reel 生成）。仓库 49 commits、10 contributors、106 模块、1988 函数，处于 growing 阶段（简报 §1）。

**最有趣的发现**：这不是一个传统 library/CLI，而是 **skill-as-code**——SKILL.md 是契约，Python 脚本是工具，LLM 是执行器。两个最具研究价值的设计是 (1) **run-state navigator 模式**：通过文件系统状态机 + 单步 emit，机械性消除 LLM 在多步流程中的"工具漂移"；(2) **per-run skill copy 隔离**：视觉自动修复 loop 在 `<outdir>/_skill_run_copy/` 内复制整个 skill + 起一个 per-copy git repo 用于回滚，让"poster-specific 修复"绝不污染 shipped skill。

**次要关键**：IdeaSpark 的 5-phase 流水线把"研究构思"做成了带 kill-switch 字段、information-gain retry rule、dual-channel collision 检索的 gauntlet——并配 100-seed ICLR-2026-Oral 基准 + LLM-as-judge 评分（简报 §4 + evaluation/README.md）。

---

## 2. Research Traces

### 2.1 Skill-as-Code：Agent-native 的代码分发形态

**问题**: ResearchStudio 的"模块"究竟是什么？传统 library/CLI 模型在这里是否还成立？

**证据**:
- 顶层目录：`ResearchStudio-Idea/`、`ResearchStudio-Reel/`、`bin/`、`docs/`（简报 §1）
- 每个 skill 都是 `SKILL.md`（YAML front-matter `name` + `description` + `allowed-tools`）+ `scripts/*.py` + `references/*.md`（如 `idea_spark/SKILL.md`）
- `bin/install.mjs` 把 skill 拷贝到 `~/.claude/skills/` 或 `~/.codex/skills/`，并合并 `.env`（bin/install.mjs:36-44）
- README 明确："The skills run on Claude Code and Codex"（README.md:14）
- 简报 §5.5：68 个 tool 对象，但只有 1 个用 `decorator-tool` 框架，67 个是 `script-tool`（裸 Python 脚本）

**分析**: 这里的 Tool 对象不是 SDK 注册的 tool，而是**裸 Python 脚本作为 Bash 调用单元**。Skill 对象通过 `SKILL.md` 暴露给 host agent，host agent 通过 `Bash` 调用脚本——这是 Anthropic Claude Code / OpenAI Codex 的"skill"原语。整个仓库是**给 agent 看的代码**而非给人 import 的代码：Python 文件几乎都带 `if __name__ == "__main__"` guard 或 `main()` 入口（简报 §2 entry points），设计上就预期被 subprocess 调用。

**反证**: 仓库根目录仍有 `package.json`（简报 §1 标注 Manifest: package.json），但 `bin/install.mjs` 是唯一 JS 入口——package.json 主要是为 `npx github:microsoft/ResearchStudio` 提供入口，不是 npm 包语义。

**结论**: ResearchStudio 是 **skill-as-code 形态**——Skill 对象 configuredBy `SKILL.md`，Tool 对象 registeredBy 脚本入口，host Agent orchestrates 全流程。这是 agent-native 时代的新分发范式，传统 library 指标（test/source ratio、export 图）只是部分维度。

**置信度**: 高 — SKILL.md 契约 + install.mjs 行为 + script-tool 占比均直接可验证。

---

### 2.2 Run-State Navigator：用文件状态机对抗 LLM 工具漂移

**问题**: IdeaSpark 的 5-phase 流水线如何防止 LLM 在多步流程中"自作主张"绕过关键步骤？

**证据**:
- `ResearchStudio-Idea/skills/idea_spark/scripts/run.py` 提供 `next --dir "$RUN_DIR"` 子命令（run.py:1-44）
- SKILL.md: "next inspects the artifacts already on disk and prints EXACTLY one next step … It is read-only and idempotent"（SKILL.md:54-60）
- run.py 顶部 docstring 直白写道："Skills are advisory — when SKILL.md says 'run Phase 0 literature search', the model still has multiple paths it can take … Soft rules don't reliably prevent tool drift. The orchestrator collapses the choice space"（run.py:11-19）
- Phase 1 的 `lens_probe` 硬断言 `lit_grounding_mode` sentinel 存在——绕过即机械可检测（run.py:42-44）

**分析**: 这是一个**对象驱动**的设计：Run-Dir 对象 produces Phase-Artifact 对象，Navigator 对象 consumes 当前 artifact 集合 → produces 单步命令。LLM 不再决定"接下来做什么"，只决定"执行 navigator 给的命令"。这是把 Petri-net 思路用在 agent 编排上——状态由文件存在性定义，转移由 `next` 决定。Phase 0 sentinel `.lit_grounding_mode ∈ {real, webfallback, connector_failure}` 是状态机的硬 guard。

**反证**: sentinel 命名约定靠文档维护，若新增 phase 不写 sentinel，`next` 可能漏检。但目前 5 phase 全部有 sentinel，未发现反例。

**结论**: **Run-State Navigator 模式**通过文件状态机 + 单步 emit + 硬 sentinel，把 LLM 的自由度从"做任何符合 spirit 的事"压缩到"执行这一条 bash 命令"——是 agent 编排的有意义探索。

**置信度**: 高 — run.py 源码 + SKILL.md 契约 + docstring 设计意图一致。

---

### 2.3 Per-Run Skill Copy 隔离：视觉自动修复的 fearless iteration

**问题**: `html2pptx` 的 vision-driven auto-fix 如何避免 poster-specific 修复污染全局 skill？

**证据**:
- `ResearchStudio-Reel/skills/paper2poster/html2pptx/scripts/auto_fix_loop.py:1-36` docstring："Every run gets its own isolated COPY of the skill scripts under `<outdir>/_skill_run_copy/`. The code-fixer subagent only edits files inside that copy. The shipped skill is NEVER touched"
- 该脚本 `setup_run_copy()`：`shutil.copytree(SKILL_SCRIPTS, copy_scripts)` + 在 copy 内 `git init` + 初始 commit（auto_fix_loop.py:60-83）
- 每轮：build+audit → pick top issue → spawn `claude -p` 子 agent（`--add-dir <copy>`，仅 Read/Edit/Grep/Glob，禁 Bash/git）→ rebuild+re-audit → 改进则 commit，否则 `git checkout` 回滚（auto_fix_loop.py:17-29）
- 最终输出 `<outdir>/_skill_run_copy_diff.patch`——人工 review 后才决定是否 cherry-pick 进 shipped skill

**分析**: 这里的对象图是：Skill 对象 extends 出 Per-Run-Skill-Copy 对象，Per-Run-Skill-Copy 对象 configuredBy 自身内部 git repo，Fixer-Subagent 对象 configuredBy `--add-dir` 沙箱约束。设计者把"poster A 的修复可能 regress poster B"作为头等风险，选择"复制 + git 回滚 + patch 导出"而非"全局版本化"或"分支策略"。子 agent 被显式禁用 Bash 和 git——既不能逃出 copy 目录，也不能污染 copy 自己的 git 历史。

**反证**: 每次 run 都 `shutil.copytree` + `git init` 有 I/O 成本，批量跑 100 papers 时会有 100 个临时 git repo。但论文场景下这是可接受开销。

**结论**: **Per-Run Skill Copy Isolation 模式**——把"不可预测的 LLM 修复"与"shipped skill"用物理复制 + 内部 git 隔离，是 agent 自我修改代码场景下少见的深思熟虑设计。

**置信度**: 高 — auto_fix_loop.py 源码完整可读，docstring 明确说明设计动机。

---

### 2.4 Defense-in-Depth Time Guard：检索窗口的时钟防御

**问题**: 文献检索的"近 6 个月""近 24 个月"窗口如何防止系统时钟错误导致检索错时段？

**证据**:
- `ResearchStudio-Idea/skills/idea_spark/scripts/_time_guard.py:1-11` docstring："If the system clock is wrong (sandbox time-freeze, NTP failure, drifted VM), the window silently shifts … This module hard-fails on implausible clock readings"
- `assert_sane_now()`：clock < 2024-01-01 → `RuntimeError`；clock > 2027-01-01 → stderr warning（_time_guard.py:17-31）
- `resolve_now(as_of)`：支持 `--as-of YYYY-MM-DD` 把参考日期回拨到过去——用于 forward-prediction evals 重建"论文投稿时的文献状态"（_time_guard.py:34-67）
- 简报 §2：`_time_guard` in-degree 4，PageRank 0.0336——是 idea_spark 域内最被依赖的模块之一
- docstring 显式："The idea-spark orchestrator also runs an identical guard upstream, so this is defense-in-depth"

**分析**: Time-Guard 对象 validates System-Clock 对象，produces Reference-Date 对象，Reference-Date 对象 consumedBy Connector 对象的窗口算术。这是少见的**对时间输入做 sanitize**——大多数系统假设 `datetime.now()` 是可信的。`--as-of` 还把"回溯评估"做成一等能力：要评测"模型在 ICLR-2026 投稿时是否能想出这篇 Oral"，可以回拨到投稿日前，让检索只看到那之前的工作。

**反证**: 硬编码的 2024-01-01 / 2027-01-01 边界需要随时间维护——2027 年后该 floor 会失效。但这是显式的可接受 trade-off。

**结论**: **Defense-in-Depth Time Guard** 是 agent 系统中对"环境输入"而非"模型输出"做防御的罕见示例，`--as-of` 回拨让历史回溯评估变一等公民。

**置信度**: 高 — 源码 + 简报中心性数据一致。

---

### 2.5 IdeaSpark 的 Kill-Switch 字段锁定

**问题**: IdeaSpark 如何防止后续 phase 偷偷改写 Phase 2.2 的核心承诺（falsification 预测、compute 预算）？

**证据**:
- SKILL.md:160 "Both kill-switch fields (`falsification_prediction`, `compute_budget`) are locked from here on"
- SKILL.md:191 "Kill-switch fields are merger-refused with ONE audited exception: a `scope=falsification` target from `falsification_structure_check` is applied via the dedicated `rewrite_falsification` op"
- 验证器 `kill_switch_integrity`：`falsification_prediction` + `compute_budget` 必须 byte-identical 沿 Phase 2.2 → 3.3 final_candidate → 4（SKILL.md:233）
- `compute_budget` 在任何 scope 下都没有 revision 路径（SKILL.md:191）

**分析**: Kill-Switch 对象 configuredBy Phase-2.2，validatedBy `kill_switch_integrity` Validator 对象。这是一个**契约式不变量**：核心承诺一旦写下，后续 phase 只能在"明确审计授权 + 专用 op"路径下修改一个字段，另一个完全锁定。这避免了"audit 发现问题 → 顺手把 compute 预算也调大一点"这类隐性退化。

**反证**: 一个 audited exception 暗示 `falsification_prediction` 的结构有时确实需要修复——锁定不是绝对的，但 exception 通道本身有 `--critique` 授权验证，且 max 1 次/run。

**结论**: Kill-Switch 字段锁定 + 单一例外通道，是 agent 多步流程中**保护核心不变量**的精细设计，比简单的"只读字段"更适配真实需求。

**置信度**: 高 — SKILL.md 契约 + 验证器表均直接可读。

---

### 2.6 Vision-as-Judge 的结构化保真度审计

**问题**: html2pptx 如何评估"PPT 是否是 HTML 的 1:1 副本"？

**证据**:
- `ResearchStudio-Reel/skills/paper2poster/html2pptx/scripts/vision_audit.py:1-37` docstring："Vision-based fidelity auditor: HTML truth vs PPT render → structured diff report. NOT a corrector."
- 12 类 closed enum：`missing_element` / `extra_element` / `text_clipped` / `wrap_mismatch` / `color_drift` / `position_shift` / `size_mismatch` / `font_substitution` / `alignment_off` / `spacing_off` / `z_order` / `other`（vision_audit.py:7-19, 48-52）
- 三级 severity：high/medium/low，明文要求"PREFER NOT TO REPORT low-severity issues unless they cluster"（vision_audit.py:101-104）
- SYSTEM_PROMPT（vision_audit.py:79-114）给 vision 模型 8 条规则，包括"不报告 <10% color drift"、"ONE issue per place"
- 简报 §3：该 prompt 是仓库 10 个 prompt 之一，类型为 `system`

**分析**: Vision-Audit 对象 consumes HTML-Render 对象 + PPT-Render 对象，produces Diff-Report 对象。closed-enum categories 让跨 poster 聚合可行（auto_fix_loop.py:51-57 的 `ACTIONABLE_CATEGORIES` 白名单就是基于这个 enum）。auto_fix_loop 进一步把 12 类过滤为 6 类 actionable——把"模型易误报"的 alignment_off/color_drift 排除。这是一个 LLM-as-judge 的工程化范例：closed enum + severity 分层 + 可操作子集 + 显式规则约束。

**反证**: `low` severity 仍可能漏报真实问题；`other` 是 catch-all 可能被滥用。但 prompt 强约束 + auto_fix_loop 白名单构成两层过滤。

**结论**: **Vision-as-Judge with Closed-Enum Structured Diff** 是 LLM 评估非结构化输出的可复用范式——比"打一个分"或"自由文本评论"工程价值高得多。

**置信度**: 高 — vision_audit.py 源码 + auto_fix_loop.py 消费侧均完整可读。

---

### 2.7 Bounded HTTP Runtime：依赖图根部的 God Module

**问题**: `_http_runtime.py` 作为最高 PageRank 模块（0.0521）是否构成架构风险？

**证据**:
- 简报 §2：`_http_runtime` in-degree 9，PageRank 0.0521——全库最高
- 该模块定义 `HTTPConfig`、`get_http_config`、`request`、`configure_external_session`、`validate_environment`（_http_runtime.py:25-195）
- 重试策略：`RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}`，max_attempts=4，指数退避 + Retry-After header 解析（_http_runtime.py:28, 99-118）
- `configure_external_session()`：对 OpenReview 这种"不暴露 timeout 参数"的依赖，通过 `Session.mount` + `functools.wraps` 包装 `Session.request` 强制注入 timeout（_http_runtime.py:162-195）

**分析**: HTTP-Runtime 对象 consumedBy 4 个 Connector 对象（arxiv/openalex/semantic_scholar/openreview），是 paper-search 域的公共底座。in-degree 9 在 106 模块的仓库里偏高但不算极端——它**确实是 god module**，但承担的是"统一 HTTP 行为"这个本就该集中的职责。`configure_external_session` 显示出对依赖库 API 缺口的工程化 workaround。

**反证**: 没有循环依赖（简报 §2: import cycles 0），依赖方向单向——god module 但不是循环源。

**结论**: `_http_runtime.py` 是**有意识的 god module**——把 HTTP 行为集中是设计意图而非演进意外，0 循环说明集中化没带来拓扑副作用。

**置信度**: 高 — 中心性数据 + 源码职责单一一致。

---

### 2.8 评估基础设施：100-seed ICLR-2026-Oral 基准

**问题**: ResearchStudio 是否有真实的质量评估，还是只有 case study？

**证据**:
- `ResearchStudio-Idea/evaluation/README.md`：100 seeds，每 seed 来自 ICLR-2026 Oral 的"标题改写"（去除 method 后缀以限制泄漏）（evaluation/README.md:7）
- 4 系统：IdeaSpark (Opus 4.8) vs Opus 4.8 bare vs Opus 4.8 self-gen vs GPT-5.5 bare（README.md:9）
- 两个评分 skill：`idea-quality`（3 轴 0-100）+ `scoop-check`（5 级 overlap）（README.md:13-16）
- 简报 §4：16 个 eval 文件，metrics 包含 `metric / recall / score / precision / accuracy / bleu`，patterns 包含 `eval / benchmark / rubric / golden`
- `idea_quality/evals/evals.json` + `sample_ideas/` 下有 `mismatch_gate.md`、`strong_grpo.md`、`weak_temperature.md` 等 sample

**分析**: Eval 对象 evaluatedBy Quality-Skill 对象 + Novelty-Skill 对象，produces Score 对象。"标题改写去 method 后缀"显示对 train-test leakage 的工程意识——避免 seed 直接暴露 Oral 论文的方法。两个评分 skill 分别独立（quality 从 first principles，novelty 从 prior art）——正交维度避免单一 judge 偏差。

**反证**: 100 seed 规模相对小；评分 skill 自身是 LLM-as-judge，存在自身偏差未量化。`idea-quality` "consults no corpus" 是优点（reproducible）也是局限（无 ground truth）。

**结论**: 评估基础设施**超出 typical growing 阶段项目**——有正式 benchmark + 正交双 judge + leakage 控制。但 LLM-as-judge 的元评估仍是缺口。

**置信度**: 高 — evaluation/README.md + sample_ideas/ 文件可直接验证。

---

## 3. Negative Findings

> 引用简报 §6 + 源码阅读发现。每条说明"为何这个缺失重要"。

| 发现 | 为什么重要 |
|------|-----------|
| **未检测到 CI/CD**（简报 §6） | Microsoft 仓库无 GitHub Actions workflow，49 commits 全靠人工 review。git log 显示近期有 CodeQL 驱动的安全修复（#12, #15, #16, #17），说明安全洞已发现但无 CI 自动捕获——回归风险高 |
| **测试覆盖率极低：2 测试文件，41 函数，test/source ratio 0.02**（简报 §4） | 远低于 0.15 典型阈值。`test_gates.py` 仅测 paper2poster 的 check_poster gate；`test_canvas_clamp.py` 测 html2pptx canvas。IdeaSpark 5-phase 流水线 0 单测——复杂的状态机全靠 sentinel 文件 + docstring 维护 |
| **简报称"未找到 LICENSE"，但源码根目录存在 `LICENSE` 文件**（LS 验证） | 简报 negative finding 不准确。这是**简报-evidence 源不一致**的实例——LLM 撰报应优先信任源码验证。LICENSE 实际为 MIT（README.md:10） |
| **未检测到 prompt 版本控制 / A/B 机制** | 10 个 prompt 对象（简报 §3）+ 15 ideation pattern cards 是核心知识资产，但无版本化。pattern 改动的影响（如改 `companion-combos.md`）无法 A/B 评估 |
| **未检测到 extension 沙箱** | skill 的 `allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob, WebFetch, WebSearch`（paper2poster/SKILL.md:4）——Bash 完全开放。auto_fix_loop 的子 agent 沙箱（禁 Bash/git）是局部的，shipped skill 本身无隔离 |
| **未检测到跨 run 的 memory / state 持久化** | 每个 RUN_DIR 独立，跨 run 仅有 `~/.cache/ideaspark/fulltext/` 30 天 TTL 内容缓存（SKILL.md:146）和 `IDEASPARK_CROSS_RUN_DEDUP` 软负 anchor——无显式长期 memory |
| **未检测到 import 循环**（简报 §6） | 这是**正向 negative finding**——106 模块 0 循环，分层清晰。简报 §2 的 49 边 / 0 cycle 验证了这点 |

---

## 4. Architecture Smells

> 以下均为 **Potential**，非断言。

### 4.1 Potential God Module — `_http_runtime.py`

- **证据**: in-degree 9 / PageRank 0.0521 全库最高（简报 §2）
- **为什么是风险**: 9 个 consumer 意味着任何 API 改动触发 9 个文件级联测试。但 0 循环 + 单一职责（HTTP 行为）说明风险可控
- **置信度**: 中 — 中心性是事实，但是否是"问题"取决于团队对集中化的偏好

### 4.2 Potential Hidden Complexity — IdeaSpark Phase Graph

- **证据**: 5 phase + 9+ LLM 调用 + 5 验证器 + citation gate + coherence gate + dual-channel collision + 信息增益 retry rule（SKILL.md 全文）
- **为什么是风险**: 状态空间大——`do_not_generate` / `phase_3_failed` / `advance` / `revise` / `abandon` × 3 候选 cycle × bottleneck re-diagnosis 分支组合爆炸。2 个测试文件覆盖不到
- **置信度**: 高 — 复杂性可从 SKILL.md 直接读出

### 4.3 Potential Skill Drift Surface — `script-tool` 裸脚本

- **证据**: 67/68 tool 是 `script-tool`（简报 §5.5），无 schema
- **为什么是风险**: host LLM 调用脚本时无参数 schema 约束，参数错误只能靠运行时 fail。`run.py` docstring 也承认"Skills are advisory"
- **置信度**: 中 — run.py 的 navigator 模式部分缓解，但 standalone 调用仍暴露

### 4.4 Potential Scalability — Per-Run Git Repo

- **证据**: auto_fix_loop.py:75-83 每次 run `git init` + commit
- **为什么是风险**: 批量 100 papers × 3 rounds = 100 个临时 git repo，磁盘 + I/O 开销。但论文场景下可接受
- **置信度**: 低 — 单论文场景无问题，批量场景未观察到压力测试

### 4.5 Potential Coupling — `idea_spark` 与 `paper_search` 共享 `_time_guard`

- **证据**: `_time_guard.py` 在 `idea_spark/scripts/`，但被 paper_search 域模块依赖（简报 §2: in-degree 4）
- **为什么是风险**: 跨 skill 共享内部模块意味着 idea_spark 重构会波及 paper_search。应有共享 `common/` 层
- **置信度**: 中 — 简报 §2 中心性数据可验证

---

## 5. Interesting Decisions

### 5.1 Bash 编排器覆盖 Skill-tool 间接层

- **决策**: run.py 不用 Skill tool 调用 connector，而是直接 `subprocess` invoke Python 脚本
- **为什么有趣**: 显式承认"LLM 会用 WebSearch 假装满足 SKILL.md 精神"——把 LLM 自由度压缩到 1
- **替代方案**: 在 SKILL.md 写"必须用 connector" + 期望 LLM 遵守
- **权衡**: 失去 Skill tool 的可发现性，换取机械可检测的合规

### 5.2 Kill-Switch 字段锁定 + 单一 audited 例外

- **决策**: `falsification_prediction` + `compute_budget` 写下后锁定，仅 `falsification_structure_check` 触发的 `rewrite_falsification` op 可改前者，后者永不可改
- **为什么有趣**: 大多数 agent 系统假设"agent 可以重写任何东西"——这里显式划出不可变核心
- **替代方案**: 全字段可改 + audit 检测
- **权衡**: 减少灵活性，但保护"研究承诺"的可信度

### 5.3 `--as-of` 回拨用于 forward-prediction evals

- **决策**: `resolve_now(as_of)` 支持把检索参考日期回拨到过去（_time_guard.py:34-67）
- **为什么有趣**: 把"评估时重建历史文献状态"做成一等能力——通常评估假设"现在能看到的 = 当时能看到的"
- **替代方案**: 单独维护 historical snapshot
- **权衡**: 依赖外部 API 的历史数据可用性（arxiv/openreview 的存档）

### 5.4 Sentinel Handshake（rc=10 / rc=11）

- **决策**: 当编排器自己无法调 LLM 时，写 sentinel JSON + 退出码 10/11，让 host LLM 接管（SKILL.md:80）
- **为什么有趣**: 把"agent 内部 LLM 调用"与"host 外部 LLM 调用"用 exit code 协议桥接——harness-agnostic
- **替代方案**: 强制要求设置 `NOVELTY_LLM_*_CMD` 环境变量
- **权衡**: 增加协议复杂度，换取 harness 无关性（Claude Code / Codex / 裸 shell 都能跑）

### 5.5 Per-Copy Git Repo 用于回滚

- **决策**: 每个 auto_fix_loop run 在 `_skill_run_copy/` 内 `git init`，per-round commit/checkout
- **为什么有趣**: 用 git 做版本控制粒度的"实验回滚"，而非简单的"覆盖前备份"
- **替代方案**: 维护 N 份 backup + 手动恢复
- **权衡**: 引入 git 依赖，但获得 commit-level diff 可审计性

### 5.6 `idea-quality` skill 不 consult 任何 corpus

- **决策**: `idea-quality` "judges from first principles on the three axes … so its score is reproducible from the idea text alone"（evaluation/README.md:26）
- **为什么有趣**: 主动放弃外部知识以换取 reproducibility——与 `scoop-check`（查 prior art）形成正交双 judge
- **替代方案**: 让 quality judge 也查文献
- **权衡**: 失去"是否已被做过"的信号，但 quality 与 novelty 解耦

---

## 6. Repository Positioning

| 维度 | 当前成熟度 | 说明 |
|------|-----------|------|
| Planning | Advanced | 5-phase 状态机 + run-state navigator + 文件 sentinel 驱动 |
| Execution | Advanced | Bash orchestrator + 子 agent 沙箱 + per-run skill copy 隔离 |
| Memory | Emerging | 仅 RUN_DIR 内持久化 + 30 天 fulltext 缓存 + 跨 run 软负 anchor |
| Evaluation | Advanced | 100-seed ICLR-2026-Oral 基准 + 正交双 judge + leakage 控制 |
| Guardrails | Advanced | Kill-switch 字段锁定 + sentinel handshake + time guard + 信息增益 retry cap |
| Prompt | Common | 10 个静态 prompt + system prompts 文件目录 + TEMPLATE_VERSION 字段（无 A/B） |
| Tooling | Unique | 67 script-tool + 1 decorator-tool；skill-as-code 分发；auto_fix_loop 视觉修复 |
| Observability | Emerging | 无 CI、无分布式追踪、无 metrics；靠 stderr print + JSON 中间产物 |

---

## 7. Reusable Pattern Catalog

| 模式 | 描述 | 位置 | 可复用性 |
|------|------|------|---------|
| Run-State Navigator | 文件状态机 + `next` 单步 emit + 硬 sentinel | `idea_spark/scripts/run.py` | ✅ 通用 |
| Per-Run Skill Copy Isolation | 复制 skill + 内部 git + 子 agent 沙箱 + patch 导出 | `html2pptx/scripts/auto_fix_loop.py` | ✅ 通用 |
| Defense-in-Depth Time Guard | 对 `datetime.now()` 做 sanity check + `--as-of` 回拨 | `idea_spark/scripts/_time_guard.py` | ✅ 通用 |
| Bounded HTTP Runtime | closed-enum retry status + Retry-After 解析 + 外部 session 包装 | `paper_search/scripts/_http_runtime.py` | ✅ 通用 |
| Vision-as-Judge Closed-Enum Diff | 12 类 + 3 级 severity + actionable 白名单过滤 | `html2pptx/scripts/vision_audit.py` | ✅ 通用 |
| Kill-Switch Field Locking | 核心字段 byte-identical 沿流程 + 单一 audited 例外 | `idea_spark/SKILL.md` + 验证器 | ✅ 通用 |
| Information-Gain Retry Rule | abandon → lesson set 比较 → 仅当有新 lesson 才 retry | `idea_spark/SKILL.md` Phase 3 | ✅ 通用 |
| Sentinel Handshake (rc=10/11) | exit code 协议桥接编排器与 host LLM | `idea_spark/scripts/run.py` | ⚠ 需适配（依赖 host 支持） |
| Dual-Channel Collision Retrieval | signature@10mo + alias@48mo 双窗口 | `idea_spark/SKILL.md` Phase 3.1 | ⚠ 需适配（学术场景特定） |
| Pattern Card Taxonomy | 1947-paper corpus → 15 patterns + 31 sub-patterns 卡片 | `idea_spark/references/ideation-patterns/` | ❌ 特定场景（ML ideation） |
| Skill-as-Code Distribution | SKILL.md 契约 + script-tool + installer | `bin/install.mjs` + 全部 SKILL.md | ✅ 通用（agent-native 时代） |

---

## 8. Architecture Evolution

> 基于 git log 49 commits（按时间倒序，关键节点）。

### 主要演进线索

- **2026-07-03** `13aced7 Initial public release` → IdeaSpark + Reel 双 plugin 首发
- **2026-07 后** `c485871 fix(idea-spark): make the skill host-agnostic (#11)` —— 关键转折：从 Claude Code 专属走向 host-agnostic，引入 sentinel handshake + 自定位 skill root
- **2026-07 后** `20a7d23 feat(idea-spark): quality gauntlet upgrades, run-state navigator, dual-channel collision, compute-envelope overhaul` —— navigator 模式与 dual-channel collision 同 commit 落地
- `c286aac feat(idea-spark): Phase 2.3 coherence gate (dry-run trace)` —— 引入"对抗性"独立 context 验证 2.2 候选
- `827c1b2 feat(idea-spark): information-gain retry rule replaces death-type routing` —— **重大重构**：从"失败类型分类"转向"信息增益规则"，简化 retry 决策
- `4756e66 feat(idea-spark): evidence-grade gauntlet + bounded retries` —— gauntlet 升级
- `a2b10b0 fix(idea-spark): coherence-gate state guards` —— 修复"无效 verdict 绕过 / stale refined shadow"——说明 coherence gate 上线后出过状态机 bug

### Reel 侧演进

- `895a5b4 feat(paper2poster): 4-column method-driven layout + mono theme` —— layout 扩张
- `525d200 fix(paper2poster): close five holes where the poster gates pass without checking` —— **gate 漏洞批量修复**，说明早期 gate 设计有 false-positive 风险
- `6f05e46 Merge PR #13: close five poster-gate holes` —— 同主题合并
- `25a9acf tune(paper2poster): shorten fill-budget staleness 12h -> 15min` —— 性能调参

### 安全演进（值得单独标记）

- `b9a31ad fix(paper-search): bound requests and isolate source workers (#15)` —— 资源耗尽修复
- `f0294d5 Fix incomplete URL substring sanitization in extract_pdf.py (CodeQL #12) (#17)` —— CodeQL 驱动
- `298ca64 Fix XSS: stop reinterpreting DOM-derived text as HTML in debug badge (#16)` —— XSS 修复（HEAD commit）

### 历史决策痕迹

- `1c5ac5c Revert "chore: add skills-lock.json (pin taste-skill: ...)"` + `274f2b0` —— 团队尝试过引入外部 taste-skill（design-taste-frontend / full-output-enforcement / high-end-visual-design），随后 revert。说明曾探索"skill 依赖管理"机制但回退
- `8f9de15 fix(paper2poster): drop viewport reflow media query` —— 早期用 responsive reflow，后发现 poster 应 scale 不 reflow
- `c286aac` 引入 coherence gate 后 `a2b10b0` 立刻修 state guard——新功能的稳定性靠快速 patch

---

## 9. Reading Guide

### 30 分钟速览（5 个文件）

1. **`README.md`** — 项目定位：AI co-author，两个 plugin，覆盖 research lifecycle 首尾
2. **`ResearchStudio-Idea/skills/idea_spark/SKILL.md`** — IdeaSpark 5-phase 流水线契约，是整个仓库信息密度最高的文件（含 navigator 协议、context discipline、phase reference、验证器表）
3. **`ResearchStudio-Idea/skills/idea_spark/scripts/run.py`**（前 120 行）— navigator 设计意图的 docstring，理解"为什么 collapse choice space"
4. **`ResearchStudio-Reel/skills/paper2poster/html2pptx/scripts/auto_fix_loop.py`**（前 100 行）— per-run skill copy 隔离模式 + 子 agent 沙箱约束
5. **`ResearchStudio-Idea/evaluation/README.md`** — 100-seed benchmark 设计，理解 quality + novelty 双 judge

### 2 小时深入（+ 10 文件）

6. **`ResearchStudio-Idea/skills/idea_spark/scripts/_time_guard.py`** — 时钟防御 + `--as-of` 回拨设计（68 行短小精悍）
7. **`ResearchStudio-Idea/skills/paper_search/scripts/_http_runtime.py`** — god module 的职责边界 + 外部 session 包装 workaround
8. **`ResearchStudio-Reel/skills/paper2poster/html2pptx/scripts/vision_audit.py`** — Vision-as-judge 12 类 closed enum + SYSTEM_PROMPT 8 条规则
9. **`ResearchStudio-Reel/skills/paper2poster/SKILL.md`**（前 120 行）— 8 步流水线 + mandatory finishing gates + parallel-safety 规则
10. **`ResearchStudio-Reel/skills/paper2poster/tests/test_gates.py`**（前 80 行）— 唯一像样的测试文件，docstring 揭示 5 个曾被"silently broken"的 gate
11. **`bin/install.mjs`**（前 100 行）— skill-as-code 分发机制 + plugin registry
12. **`ResearchStudio-Idea/skills/idea_spark/references/ideation-patterns/overview.md`** — 15 ideation pattern 知识本体
13. **`ResearchStudio-Reel/skills/paper2poster/references/staged_fill.md`** — 测量→选择→应用→review 的迭代 fill loop
14. **`ResearchStudio-Idea/evaluation/idea_quality/evals/evals.json`** — 评估样本结构
15. **`ResearchStudio-Reel/skills/paper2reel/scripts/serve_reel.py`** — reel 本地 serve（HTTP Range 支持）

---

## 10. Open Questions

| # | 问题 | 为什么重要 | 建议调查方法 |
|---|------|-----------|-------------|
| 1 | host LLM 如何"消费" navigator 的 emit？tool result 截断规则是什么？ | SKILL.md:60 警告"never grep/filter/truncate the block"，暗示曾因截断出过 false advance | 阅读 Claude Code 的 tool result 处理逻辑；搜索 issue tracker 中"false advance"相关 bug |
| 2 | skill 如何被 host agent 发现？SKILL.md front-matter 的 `name`/`description` 是否参与路由？ | 理解 skill-as-code 的发现机制 | 用 Claude Code 跑一次 `/idea-spark` 观察日志；阅读 Claude Code skill loader 文档 |
| 3 | per-run git repo 在批量（100 papers）场景下性能如何？ | auto_fix_loop 假设单 run；批量时 I/O 可能成为瓶颈 | 写一个 batch driver 跑 10 papers 并发，测 wall-clock + 磁盘 |
| 4 | IdeaSpark 的 5-phase 状态机是否有 property-based testing？ | 2 个测试文件覆盖不到 phase graph 的状态空间 | 调研 `hypothesis` 库 + 设计状态机不变量（如"kill-switch 字段永不改变除非 audited exception"） |
| 5 | 跨 run dedup（`IDEASPARK_CROSS_RUN_DEDUP`）如何在多用户/多机器场景工作？ | soft-negative-anchor 扫描 sibling run dirs 假设单机共享 filesystem | 阅读 `next` 中扫描 sibling dir 的实现；考虑多 tenant 隔离 |
| 6 | vision_audit 在非英文（中文）poster 上的 prompt 偏差如何？ | 12 类 enum + SYSTEM_PROMPT 是英文设计，中文场景未验证 | 跑 5 篇中文 paper 的 paper2poster，统计 vision_audit 误报率 |
| 7 | `1c5ac5c` revert 的 skills-lock.json 机制为何回退？ | 理解 skill 依赖管理的尝试与失败 | 查 PR discussion；查 `taste-skill` 是否仍以其他形式存在 |
| 8 | IdeaSpark 的 information-gain retry rule 在实践中触发率多少？ | 这是 SKILL.md 最复杂的逻辑之一，实际触发频率未知 | 跑 100 seed benchmark，统计 attempt_1/attempt_2/phase_3_failed 比例 |

---

## 附录：证据引用

- **简报 §0**: 研究原则（证据优于假设、negative finding 同等重要等）
- **简报 §1**: Executive Brief — 仓库元数据、49 commits / 10 contributors / growing stage
- **简报 §2**: Architecture Insights — 106 模块、49 边、0 循环、_http_runtime PageRank 0.0521
- **简报 §3**: AI/Agent Design — 10 prompt / 68 tool / 6.8 tool-heavy ratio
- **简报 §4**: Testing & Evaluation — 2 测试文件、41 函数、16 eval 文件
- **简报 §5**: Engineering Metrics — coupling 0.46 / call density 18.3 / CI none
- **简报 §5.5**: Ontology View — 1268 function / 68 tool / 9 prompt / 8 runner / 8 planner / 1 workflow
- **简报 §6**: Negative Findings — 无 CI、无循环、简报称无 LICENSE（与源码不一致）
- **简报 §7-§8**: Reading Priority & Guide
- **源码验证**: `README.md`、`bin/install.mjs`、`idea_spark/SKILL.md`、`idea_spark/scripts/run.py`、`idea_spark/scripts/_time_guard.py`、`paper_search/scripts/_http_runtime.py`、`paper2poster/SKILL.md`、`paper2poster/html2pptx/scripts/auto_fix_loop.py`、`paper2poster/html2pptx/scripts/vision_audit.py`、`paper2poster/tests/test_gates.py`、`evaluation/README.md`、`ResearchStudio-Idea/README.md`、`ResearchStudio-Reel/README.md`
- **git log**: 49 commits（13aced7 初始 → 298ca64 HEAD），含 CodeQL 驱动安全修复 (#12/#15/#16/#17) 与 skills-lock.json revert (1c5ac5c/274f2b0)

> **简报-evidence 不一致声明**：简报 §6 称"未找到 LICENSE 文件"，但源码根目录 `LICENSE` 文件存在（README.md 标注 License: MIT）。本报告以源码为准，将该不一致列入 Negative Findings。
