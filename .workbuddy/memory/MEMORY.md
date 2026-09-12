# 项目长期记忆 — devweekly.github.io

Astro (AstroPaper) 技术博客，域名语义为「Dev Weekly」。

## 博客 post 约定

- 位置：`src/content/blog/`
- 内容 schema：`src/content.config.ts`（`pubDatetime` / `title` / `description` 必填；`tags` 默认 `["others"]`）
- 命名：周报按 `YYYYMMMD.md`（如 `2026Aug31.md`）；主题长文用 slug（如 `ai-courses.md`）
- frontmatter 固定：`author: W` / `featured: false` / `draft: false` / `description: Dev weekly`（周报）

### 两类 post 的结构

| 类型 | 结构 |
|---|---|
| 周报（weekly） | `### AI and Programming` + `### Others` 两个区块，正文条目为 `[标题](url)`，可后接简短中文说明；区块内保留 `[]()` 占位行（约 20 行/区块） |
| 主题长文 | 自由长文，分 `## N. 主题` 章节，夹叙夹议 + 真实链接；tag 用主题词（如 `ai` / `agent` / `interview`）而非 `weekly` |

### 周报填充规则（用户明确要求）

**周报只建空白骨架，不要填充内容。** 用户明确表示「去掉填充的假内容！我自己会填！」。
创建周报时只写 frontmatter + 两区块的 `[]()` 占位行，不搜网络、不编造条目。

主题长文（有明确题目时）才允许用网络搜索填充真实内容。

### 主题长文的「实操」写法（用户明确要求）

用户原话：「实操不等同一定要有代码，而是工程实践的可行性」。

写"怎么做/怎么落地"类章节时，**不要写成技术方案或代码清单**，要写成团队可执行的工程实践判断：

- 讲：流程卡点、角色与 owner、指标与 SLA 定义、取舍与成本、反模式、可行性自检
- 不讲：具体工具/代码/配置怎么做
- 判据要用人话表达（例："两个不同的人看了会不会得出同一结论"），而非技术手段
- 落地难点优先归因到"人、纪律、预算、预期对齐"，而非技术

### 主题长文的语气与结构规范（用户明确要求）

用户原话：「注意改成写正式文章的语气，而不是 ai 回答的语气」。

**语气**——不要第一/第二人称对话腔：

- 删「我查了」「我会把」「我认为」「我推荐」「给你的最终判断」「你们平台」
  「在你补充这个前提之后」这类；改成无人称陈述（「值得注意」「更推荐」「可以定义为」）。
- 章节标题不写成口语祈使句/自述句（「所以我认为未来会出现两层 Workflow」→
  「企业 AI Platform 的『两层 Workflow』」）。
- 例外：引用模型/他人原话的引号内第一人称保留。

**结构**——一份长文只应有一套编号，且引用定义只在文末：

- 全文章节编号连续 `## 1.`–`## N.`，不要一段阿拉伯数字一段中文序号。
- 引用编号全文唯一，不要各段都从 `[1]` 起（同名 reference 会互相覆盖）。
- `([X][n])` 引用紧跟句末/段末，不要单独占一段；定义全部集中到**文末**。
- 不用 `---` 分隔线，靠标题分层；不带 `utm_source` 等跟踪参数。
- **真拓扑图（分支/汇合/循环/树/分层）用 mermaid**；线性 `A ↓ B ↓ C` 小片段保留
  `text` 代码块即可。写完必须逐个 `mermaid.parse` 校验（build 不报错，页面才会炸）。

**超长文的分层与收敛**（`workflow and agent and bpmn.md` 一文的经验）：

- 超过 ~2000 行时用三层：`#` 第 X 部分 → `## N. 章节`（全文连续编号）→ `###` 子节。
  站内已有 post 用 `#` 做正文分节，主题渲染没问题。
- **一篇文章只能有一套主线模型。** 长文常常是先写了一段「趋势观察」（厂商怎么做），
  后来才写出自己的结论，两者容易被当成两个互相冲突的主张。
  处理方式不是删掉前者，而是**显式降级**：在引子声明「这部分是某条路线的真实主张，
  是趋势的一部分，但不是本文对金融业务的结论」，并在趋势部分末尾设一个转折小节
  （用「对 X 正确 / 对 Y 不正确」这类对照表做 pivot），再进入主线。
- 前向引用（「第 34 节会说明」）在重排后必须逐条 grep 核对。
- 具体的重排/收敛操作流程见 skill `longform-md-restructure`。

**该文当前定稿形态**（`workflow and agent and bpmn.md`，2026-09-12 第二次 review 后）：

- 9 部分 / 52 节（`## 1.`–`## 52.` 连续），mermaid 35 块，引用 [1]–[42] 定义数 = 使用数
- 主线：`Business Process → Agent Task Contract → Agent Runtime → Controlled Result → Business State`
- 术语已收紧：四条路线 → **四个架构领域**；BPMN = **可执行约束合同**（不含全部业务语义，
  DMN 管规则、IAM 管资格、Agent Policy 管能力边界、Human Approval 管责任归属，**不可合并**）
- 三个状态必须分开：Business Workflow State / Agent Task State / Agent Working Plan
- 已删除：「80/20 deterministic+agentic」「二阶段提交 / 2PC」；补充：Business Data Contract、
  Task Context、Governed Action Pipeline、OpenAI Agents API（2026-09-10，引 [42]）

## 发布机制注意

Astro 是静态站，`pubDatetime` 仅是元数据，不做定时发布。真正上线由构建/部署流水线控制；
若 CI 按 push 触发，推上去即发布。需要「周几才出现」必须在部署侧加发布窗口控制。
