# 项目长期记忆 — devweekly.github.io

Astro (AstroPaper) 技术博客，域名语义「Dev Weekly」，作者笔名 `W`。
逐轮细节与脚本工艺见同目录 `YYYY-MM-DD.md`；本文件只留跨会话仍需遵守的约定与当前状态。

## 1. 博客 post 约定

- 位置 `src/content/blog/`；schema `src/content.config.ts`（`pubDatetime` / `title` / `description` 必填，`tags` 默认 `["others"]`）
- 命名：周报 `YYYYMMMD.md`（如 `2026Aug31.md`）；主题长文用 slug（如 `ai-courses.md`）
- frontmatter：`author: W` / `featured: false` / `draft: false`
- 周报结构：`### AI and Programming` + `### Others`，条目 `[标题](url)` + 简短中文说明，每区块留约 20 行 `[]()` 占位
- **周报只建空白骨架，不填充内容**（用户原话「去掉填充的假内容！我自己会填！」）；主题长文才允许搜网络填真实内容
- 主题长文 tag 用主题词（`ai` / `agent` / `interview`），不用 `weekly`
- 发布：Astro 静态站，`pubDatetime` 只是元数据；CI 按 push 触发即推即发 —— 要「周几才出现」必须在部署侧加发布窗口

## 2. 主题长文写作规范（用户明确要求）

**语气**：无人称陈述，不用第一/第二人称对话腔（删「我查了 / 我认为 / 我推荐 / 给你的最终判断 / 你们平台」）；
章节标题不写口语祈使句或自述句。引用他人原话的引号内第一人称保留。

**结构**：章节编号连续 `## 1.`–`## N.`，不混用中文序号；引用编号全文唯一（各段都从 `[1]` 起会互相覆盖）；
`([X][n])` 紧跟句末，定义集中文末；不用 `---` 分隔线；不带 `utm_source` 等跟踪参数。
真拓扑（分支/汇合/循环/树/分层）用 **mermaid**，线性 `A ↓ B ↓ C` 留 `text` 块；写完逐个 `mermaid.parse` 校验
（build 不报错，页面才会炸）。

**「实操」章节**（用户：「实操不等同一定要有代码，而是工程实践的可行性」）：讲流程卡点、角色与 owner、指标与 SLA、
取舍与成本、反模式、可行性自检；不讲具体工具/代码/配置。判据用人话（「两个人看了会不会得出同一结论」），
落地难点优先归因到人、纪律、预算、预期对齐。

**超长文（>2000 行）**：三层 `#` 第 X 部分 → `## N.` 连续编号 → `###`。**一篇文章只能有一套主线模型** ——
先写的「趋势观察」与后写的「自己的结论」冲突时用**显式降级**（引子声明前者不是本文结论 + 趋势段末对照表 pivot），
不是删掉。前向引用重排后逐条 grep 核对。工艺见 skill `longform-md-restructure`。

**交付稿不带版本自指**：正文与元数据都不出现「本版 / 上一版 / 终轮」这类 changelog；撤回的判断可以留，
但主语必须是判断本身。

## 3. `skills/` — 自建 Agent 评审 Skill 套件

约定：`skills/<name>/SKILL.md`，frontmatter 只要 `name` / `version` / `description`。
**skill 只写流程与判据，不复制 checklist 条文** —— 规范内容用「数据来源与锚点」表指向
`temp/agent研究checklist.md`（Q 编号 / 附录 C 节号 / Invariant）与 `temp/agent研究.md`（§N），维持单一真相源。

```text
enterprise-agent-architecture-review      架构是否成立、边界划在哪（12 步 + Discovery/Design/Production 三层 Gate）
  子件：agent-security-threat-review / agent-governance-and-control-design / agent-runtime-boundary-review /
        agent-tool-and-mcp-governance / agent-reliability-review / agent-well-architected-assessment
evidence-and-claim-review                 横切件：审「说法成不成立」
```

前者审架构，`agent-well-architected-assessment` 审控制是否落地，`evidence-and-claim-review` 审说法可信度，三者互补。

**`evidence-and-claim-review` = v2.1.1**（2026-09-15 三轮：17 条 review → v2.0.0；模型正交化 → v2.1.0；
认识论底座补齐 → v2.1.1；~1680 行 / 75KB）。定义以 SKILL.md 为准，memory 只记「勿回退」的六条：

- 四层 `1 Claim Model` / `2 Evidence Model` / `3 Reality Model` / `4 Review Workflow` + 附录 A / B
- **旧 `S0–S5` 已废**：拆为 Source Type `T0–T5`（只是分类）＋ 独立评分的 **Authority** 与 `IND0–IND5`
- **Authority 是「对这个问题」而言**：`Expertise × Proximity × Claim-Fit`（按利益冲突扣减）；
  厂商文档对 capability 评 5，对 comparison/maturity 降为 1
- **Confidence ≠ Independence**：`FACT/CAPABILITY/LIMITATION` 可 `HIGH + LOW`；
  `PERFORMANCE/MATURITY/COMPARISON/PREDICTION` 不得只凭厂商来源给 High
- **六条不可违反原则**（顺序即推理主线，勿重排）：① 结论强度不得超过证据强度 ② 引用不是证据只是入口
  ③ 证据到结论的推理链须单独审查 ④ capability ≠ maturity ⑤ feasibility ≠ generality
  ⑥ 缺席不自动构成反证 —— **条件化**（须 detection probability 高且 Search Coverage 已覆盖）
- **正交化**：`Claim Type` × `Epistemic Status`（FACT / INFERENCE / PREDICTION / OPINION）是两个字段；
  **三个正交结论** Status × Confidence × **Sufficiency**；「无反证」改为独立轴 `counter_evidence.strength`
- 主要维度：Scope ＋ **Applicability Conditions**、Search Coverage ＋ `absence_assessment`、
  **Outcome Verification**（`Successful` 须说明谁在背书）、**Counter Evidence Severity**（严重度不可平均）、
  LIMITATION 专门规则（只凭「文档没写」最高 INSUFFICIENT_EVIDENCE）、§4.1 按 Type 分三级、输出含 Principle Check
- 冻结约定见附录 B.8

## 4. `temp/` 长期产物（**细节以文件本身为准**，这里只记定位用的一句话）

- **`agent研究.md`** — 单位内部架构评审（顾问式「你们」，5452 行）。核心：**Agent 是不可信的决策参与者，
  不是安全边界**；**Governance & Enforcement Layer 横切** + 三个 Plane + 三类 PEP + 独立 Evidence Plane；
  **Runtime-aware, Runtime-independent**；12 条 Invariants + P0 十项（= architectural prerequisite）。
  **未完成**：review 建议的「整体 30% 压缩」只做了局部去重。
- **`agent研究checklist.md`** — 正文 = A–L 十二节 120 题 + Invariants / Gates，原 431 项控制条目降为附录 D。
  **正文零说明**（只允许标题 / 表格 / 条目 / 空行，说明进附录 C）；条目必带
  `｜必须/禁止/条件/可选：… ｜达标线：…`（**不要**用「应为 / 应有」）；**主表编号是稳定标识**，
  合并后留空不重排不重用；统计数字只更新附录 B.4；批量补注走「子代理产字典 + 主代理脚本插入」。
- **`Snowflake Agent体系-成稿.md`** — 博客主题长文（14 节 + 47 引用），核心判断：Cortex Agent 是
  **Data-Native Managed General Agent Runtime**，推荐自建 Control Plane + Cortex 为辅助 Runtime。
  已用 `evidence-and-claim-review` 审过三轮，产出 `.review.md`（v2.1.1 口径）：硬错 3 处
  （Search 上限 400M → **<100M**；Search 授权归因写反 → REFUTED + REVERSE；§6 Google 模型不存在）；
  Maturity **Low–Medium** / Comparison **Low**；Gartner MQ Snowflake = **Visionary**；Reality 可达
  Successful 但 **Outcome 全部 SELF_REPORTED**、Production 最高 L5；战略排他论点 **CONTESTED**。
