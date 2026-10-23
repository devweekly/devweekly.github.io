# CLM 架构设计分析：可写上下文、与 RAG 的边界，以及跨框架落地指南

> 分析对象：Context Language Models（CLM，arXiv:2609.37725）及其开源实现
> `facebookresearch/context-language-models`。
> 本文把论文设计、本仓库代码和常见上下文工程实践放在一起对照，给出可操作的移植方案。
> 论文为 2026-09 预印本，文中效果数字均为作者报告，未经过独立复现。

---

## 0. 摘要

- **CLM 的核心不是"更长的上下文"，而是把上下文从只追加的日志变成模型可读写的对象。**
  形式上是把 `c_{t+1} = c_t ⊕ LM(c_t)` 换成 `c_{t+1} = f_CLM(c_t)`，`f` 由模型自己用通用代码实现。
- **设计优势来自四个转移**：控制权从 harness 转移到模型；编辑粒度从"整段摘要"转移到"任意 span"；
  动作空间从"预定义工具"转移到"通用 bash/python"；上下文管理从"外部策略"变成"可学习行为"。
- **CLM 与 RAG 不是替代关系，而是分层关系**：RAG 决定"能把什么拿进来"，CLM 决定"留下什么、以什么形式留下、
  什么时候删掉"。RAG 的检索结果进入上下文后通常是只读的；CLM 让这段活上下文本身可写。
- **移植的关键是找到"每次调用 LLM 前组装完整 messages 的那一层"**。找不到这一层，就只能做
  "结构化笔记/记忆文件"，做不了真正的 CLM。
- **代价与风险同样明确**：编辑会破坏 prefix cache（需要 cache-aware 成本模型或 SCR）；
  误删/幻觉式改写会造成信息损失；模型自写上下文会成为 prompt injection 的持久化通道。

---

## 1. CLM 的设计内核

### 1.1 论文给出的形式化

普通语言模型只做追加：

```
c_{t+1} = c_t ⊕ f_LM(c_t)
```

CLM 允许对上下文做任意替换：

```
c_{t+1} = f_CLM(c_t)
```

关键点在于 `f_CLM` 不是 harness 预定义的 `compact()` / `retrieve()` / `offload()`，
而是模型通过通用代码（bash、python、sed、正则、循环、自定义函数）即时构造的任意变换。
论文把已有的上下文管理方法视为这个动作空间的真子集：摘要、折叠、卸载到磁盘、检索、维护记分牌，
都只是模型可能选择的某一种策略。

### 1.2 本仓库的落地方式

`clm/clm_harness` 的实现把上面的抽象压成了非常小的机制：

| 论文概念 | 代码实现 |
|---|---|
| 可写上下文文件 | `/tmp/.live_ctx/LIVE_CTX_MAIN.txt`，每轮由 `ContextEnv.write_mirror` 上传 |
| 任意编辑 | 模型只拿到一个 `bash` 工具；编辑就是普通 shell 命令 |
| 编辑同步回上下文 | 下载文件 → `context_string.parse_back` → 替换 message list |
| 保护系统提示/任务 | 前两条 message 为 protected prefix，解析时从原文重新钉住 |
| 编辑准入 | `edit_gate`：`fit`（不超预算即可）或 `shrink`（必须变小） |
| 预算治理 | `BudgetController`：确定性 token 计数、分级 nudge、回滚重试、最后一轮 |
| 编辑轮不消耗任务步 | 只有"文件变了 + 无 stdout/stderr + exit 0"才算免费轮 |
| 可回放 | 每次 LLM 调用前保存精确 messages；`trajectory.ctx.json` 用 segment 记录 `input_context` |
| 多智能体 | 每个 agent 一个上下文文件；子 agent = 新建/删除文件（论文层面） |

有两个实现细节值得注意，它们不是偶然的：

1. **镜像只是投影，message list 才是权威。** 文件被模型任意破坏后，解析器仍能恢复出一个合法的
   message list；系统提示和任务永远从原文重新钉住，模型无法通过编辑文件改写自己的系统指令。
2. **默认行为保持追加语义。** 模型不编辑文件时，生成结果照常追加。CLM 是普通 LM 的超集，
   而不是另一套必须显式触发的协议。

---

## 2. 这个设计优秀在哪里

### 2.1 把"管理上下文"变成"编辑文件"，复用了模型最强的先验

模型在预训练中见过海量代码、diff、shell 和文件编辑，但没见过"专用的 compact 工具调用格式"。
把上下文暴露成文件，等于把上下文管理映射到模型已经擅长的分布上：`grep` 定位、`sed` 替换、
`python` 切片、循环批处理。**不需要发明新 DSL，也不需要模型学习新工具 schema。**
这是零样本就能工作的关键原因之一。

对比之下，固定 compaction 工具通常要求模型输出结构化参数（保留哪些 turn、摘要成什么格式），
这既要工具设计者预判所有策略，也把模型的表达能力限制在参数空间里。

### 2.2 控制权从 harness 转移到模型，消除了"策略-任务"错配

固定 harness 的典型问题是触发时机和压缩粒度都是外生常量：

- 到 75% 才压缩 → 可能一次工具输出就爆窗口；
- 每 N 轮摘要一次 → 在关键证据刚出现时把它摘要掉；
- 统一按 turn 压缩 → 无法处理"某一轮里只有两行有用"的情况。

CLM 把"何时、压哪一段、压到什么程度、是否保留逐字原文"交给当前持有任务状态的模型。
论文的 ContextBench 结果说明这种差异不是边际优化：摘要式方法在 Needle Retention（逐字保留）
和 Sudoku Sketchpad（精确状态更新）上会丢信息或幻觉，而 CLM 在高压下仍接近满分。

### 2.3 不强加有损瓶颈：可以逐字保留，也可以结构化改写

摘要 harness 在触发点必然经过一个有损瓶颈。CLM 的策略空间同时包含：

- 逐字保留（needle、精确数值、报错原文、API schema）；
- 结构化改写（把 20 次工具调用压成一张表）；
- 删除（过期搜索结果、死胡同）；
- 指针化（把大块原文放磁盘，上下文只留路径和摘要）；
- 就地更新（记分牌、todo、候选解集合）。

**"是否损失信息"从架构约束变成了模型决策。** 这是 CLM 相对所有固定压缩方案最重要的能力差异。

### 2.4 一个机制覆盖多种已知方法，组合性好

offloading、retrieval、summarization、scratchpad、structured note-taking、sub-agent 结果折叠，
在 CLM 里都不是独立模块，而是同一动作空间里的不同写法。这带来两个工程好处：

- **不需要为每种策略接一套 API**。加一种上下文管理技巧，通常只是改提示/技能文档，不是改 harness。
- **策略可以组合**。模型可以先用 `grep` 找到旧结果，判断它已过期，用 `sed` 删除，再在文件尾部
  追加一条指针；这些操作在同一个 bash 调用里完成。

### 2.5 让上下文管理成为"可学习"的对象

这是论文最被低估的一点。传统 harness 的压缩发生在模型外部，模型无法为"压得好不好"获得梯度；
CLM 的编辑是模型自己生成的 token 序列，于是同一套接口同时支持：

- **in-context 学习**：把一份 `SKILL.md` 追加到系统提示，用技能进化循环迭代（论文报告最高 +35.9 点）；
- **参数化学习**：用 RL 直接优化编辑行为（Qwen3.5-9B 在 BrowseComp-Plus 上 28.8% → 42.5%）；
- **推理时自适应**：模型可以现场发明新策略（论文观察到模型自创 `role=notes`、定义
  `compact_turns` helper 并复用 37 次）。

固定工具方案只能通过"改工具 + 重训"来改进策略；CLM 把策略放进了模型的语言空间。

### 2.6 多智能体的扩展几乎是免费的

"上下文即文件"让 agent 的身份、生命周期和协作都落到文件系统原语上：

- 新建一个上下文文件 = 创建一个子 agent 的上下文；
- 删除文件 = 终止子 agent；
- 共享工作区 = 多个 agent 读写同一组文件；
- 父 agent 折叠子结果 = 读子文件、写摘要、删子文件。

不需要设计消息总线、序列化协议或专门的 handoff API。论文在 24 小时、六仓库的 agent-swarm 任务上
报告同算力下 65% 的额外提升，来源正是 agent 主动裁剪共享上下文，而不是各自维护完整历史。

但这也带来新的工程问题：并发写、版本冲突、谁能读谁的上下文、子 agent 崩溃后的孤儿文件。
这些在单 agent 场景不存在，落地时必须补锁/版本/所有权。

### 2.7 可观测、可 diff、可回放

上下文是文本文件，编辑就是文本 diff。这带来很实际的调试能力：

- 能看到模型到底删了什么、改了什么、什么时候改的；
- 能把"编辑前/编辑后"的 token 数、turn 数、编辑类型记录下来；
- 能把每次调用实际发送的 message list 存快照，做逐轮回放和成本重算；
- 能区分"真编辑"和"零 delta 的 parse 往返"（本仓库用 `n_ctx_syncs_real` 和
  `TRIVIAL_EDIT_TOKENS` 做这件事）。

大多数 agent 框架的上下文压缩是个黑盒：只知道"被摘要了"，不知道摘要掉了什么。
CLM 把这一步变成了可审计的工件。

### 2.8 与 serving 协同设计，承认"编辑有代价"

论文没有把 CLM 当成纯算法，而是同时指出：中途编辑会让 prefix cache 从第一个不匹配处失效，
后续所有 token 都要重新 prefill。于是他们提出 **Suffix Cache Reuse（SCR）**：
把编辑后仍然存活的后缀 span 的 KV 搬到新位置、重转 RoPE，只 prefill 新插入的部分。
论文报告相对标准 SGLang 降低 35% 服务端算力。

这个设计思想的价值在于：**上下文管理策略和推理系统必须一起设计**。如果只优化"模型少看多少
token"而不优化"编辑导致多少重算"，CLM 在真实服务里可能更贵。本仓库的 `flops_metrics` 也遵循
同样的口径：用 prefix-reuse FLOPs 而不是单次调用 token 数来衡量轨迹成本。

### 2.9 效果证据（均为作者报告）

- BrowseComp-Plus：比最强 baseline 准确率高 11.4%，prefix-reuse FLOPs 少 21.5%；
- 12 小时 EdgeBench：分数高 5%，FLOPs 少 59%；
- 24 小时六仓库 agent-swarm：同算力下提升幅度高 65%；
- ContextBench：在最高 24 倍窗口的压力下仍接近满分，而摘要、Context Folding、RLM、Self-Compact、ACM 在部分任务上失败；
- In-context 技能进化：held-out 准确率最高 +35.9 点，同时降低算力；
- RL（Qwen3.5-9B，BrowseComp-Plus）：28.8% → 42.5%，FLOPs 少 12%；
- SCR：相对标准 SGLang，匹配性能下服务端算力少 35%。

注意两点：这是预印本，数字未经独立复现；且 9B 模型在 RL 之前比 summary harness 低 6 个点，
说明 CLM 的能力门槛真实存在，不能假设"换个提示就能在任意模型上复现"。

---

## 3. 与通常 RAG 的区别

### 3.1 一句话

> **RAG 管理的是"外部知识的进入"，CLM 管理的是"进入之后活上下文的去留与形态"。**

RAG 的检索结果一旦拼进 prompt，通常就变成只读的历史；模型不能主动把它删掉、改写或替换。
CLM 让模型对这段活上下文拥有读写权，因此可以决定"这条检索结果已经用完了，删掉"、
"这三段合并成一条结论"、"原始文档留在磁盘，上下文只留路径和引用"。

### 3.2 机制对比

| 维度 | 常规 RAG | 长上下文（全塞） | 摘要/压缩 harness | CLM |
|---|---|---|---|---|
| 知识位置 | 外部索引/向量库 | 全部在窗口内 | 窗口内滚动历史 | 窗口内可写文件 |
| 谁决定取舍 | 检索器 + top-k + 相似度 | 不取舍 | harness 的阈值/摘要器 | 模型自己 |
| 读写权限 | 只读注入 | 只追加 | 只追加 + 有损压缩 | 读、写、删、改 |
| 编辑粒度 | chunk / 文档 | token | 轮次 / 块 | 任意 span / token / 整文件 |
| 信息保真 | 原文，但可能召回失败 | 原文，但注意力会衰减 | 有损，可能丢信息或幻觉 | 可逐字保留，也可主动结构化 |
| 触发时机 | 每次 query 前 | 无 | 固定阈值/固定轮次 | 模型按任务状态决定 |
| 失败模式 | 召回缺失、chunk 截断、索引陈旧 | lost-in-the-middle、成本爆炸 | 摘要丢关键细节、压缩后不可逆 | 误删、编辑错误、注入持久化 |
| 成本结构 | 检索 + 注入 token | 全量 prefill | 摘要调用 + 重写 | 编辑后 re-prefill（SCR 可缓解） |
| 跨任务持久性 | 持久 | 无 | 无 | 默认 per-episode，不跨任务 |
| 典型适用 | 大规模静态知识、多租户 | 一次性长文档阅读 | 通用聊天、短任务 | 长时程 agent、状态频繁变化、需逐字保真 |

### 3.3 五个关键差异

**（1）对象不同：外部语料 vs 活上下文。**
RAG 的对象是 corpus，CLM 的对象是"这一次调用将要发送的 message list"。
论文的措辞很准确：*context management determines what the model sees at each invocation,
whereas external memory stores information beyond the current context for later use.*
RAG 属于后者；CLM 属于前者。

**（2）方向不同：只增不减 vs 可增可减。**
RAG 的上下文体积单调增长，直到触发 harness 压缩。CLM 允许在任意时刻把上下文变小，
而且这个"变小"不需要经过摘要器——可以直接删除，也可以替换成更短的精确表述。

**（3）决策者不同：检索器/策略 vs 模型。**
RAG 的相关性由 embedding 相似度决定，无法判断"这条证据已经被证伪"或"这个中间结果只是死胡同"。
CLM 的决策者持有任务状态，能利用语义之外的信息（进度、已尝试方案、哪个结论还被依赖）。

**（4）损失发生的位置不同。**
RAG 的损失发生在召回阶段（没检索到）；摘要 harness 的损失发生在压缩阶段（摘要丢掉细节）；
CLM 的损失发生在编辑阶段（模型误删或改写错）。三者失败模式不同，不能互相替代。
ContextBench 的价值就在于把"压缩阶段"的损失单独暴露出来。

**（5）成本发生的位置不同。**
RAG 的成本主要是检索 + 注入；CLM 的成本主要是编辑后的 re-prefill。这也是为什么 CLM 必须和
SCR / cache-aware 成本模型一起看：**同样的"上下文变小了"，在 prefix cache 上可能反而更贵**，
如果编辑点很靠前、后面还有很长的存活后缀。

### 3.4 不是替代，而是分层

把两者放在一起，比较合理的架构是三层：

```
外部知识层（RAG / 搜索 / 数据库 / 文件系统）
        │  按需检索，保留来源与指针
        ▼
活上下文层（CLM 可写文件）
        │  保留当前决策所需的证据、计划、状态；其余删除或指针化
        ▼
模型调用层（每次组装 messages）
```

在这个架构里：

- RAG 是 CLM 可以调用的一个工具，而不是竞争对手；
- 检索结果进入上下文后，CLM 可以决定保留原文、压缩成结论，还是只留一个 doc id；
- 需要审计时，上下文里保留 source id / URL / 行号，原文放外部存储，随时可回查；
- 跨任务记忆仍然交给外部存储（向量库、知识图谱、文件），CLM 只负责当前 episode 的工作集。

一个常见的误解是"CLM 就是不用 RAG 了"。实际上论文的 BrowseComp-Plus 任务本身就需要搜索，
CLM 仍然通过工具检索外部语料；它改变的是检索结果进入上下文之后的命运。

---

## 4. 编程落地：把 CLM 思想移植到其它框架

### 4.1 第一步：找到"消息组装缝"

CLM 的必要条件是：**你能在每次 LLM 调用前拿到并替换完整的 message list。**
按这个条件给框架分层：

| 框架能力 | 能否实现真 CLM | 最多能做到 |
|---|---|---|
| 自研 agent loop / 直接调 SDK | 可以 | 完整 CLM |
| 框架暴露 session / memory / model_context，可自定义 | 通常可以 | 完整 CLM（需要适配层） |
| 只暴露 tool / callback，不能改写下一次请求 | 不可以 | 结构化笔记、记忆文件（note-taking） |
| 托管 agent，完全黑盒 | 不可以 | 只能通过工具维护外部状态 |

所以落地顺序应该是：**先找缝，再谈策略。** 如果框架没有缝，最现实的做法是在 LLM client 外包一层
wrapper，或者在框架的 model provider 接口上实现；不要试图用 tool 回调去模拟"替换上下文"，
那只是让模型多写了一个文件，下一次请求仍然带着完整历史。

### 4.2 五个必备组件

一个最小 CLM 实现只需要五个部件，和本仓库的结构一一对应：

| 组件 | 职责 | 关键实现点 |
|---|---|---|
| **Canonical store** | 权威 message list | provider 合法格式；protected prefix 单独保存 |
| **Mirror / renderer** | 把可编辑区投影成文本 | 稳定 turn 标记；包含 reasoning 和 tool call 参数；不含 system/task |
| **Executor** | 让模型执行编辑 | bash、python、code interpreter，或受限的编辑 DSL；沙箱内执行 |
| **Parser / gate** | 把任意文本解析回合法 messages | 容错解析；重钉 prefix；角色折叠；空 turn 丢弃；大小准入 |
| **Budget governor** | 控制 token 与轮次 | 本地 tokenizer；strict_target = budget - reserve；nudge；回滚/最后一轮 |

#### （a）Canonical store 与 protected prefix

系统提示和初始任务必须来自 harness 的原始副本，而不是从文件解析出来的文本。
否则模型只要在文件里写一段"新的系统指令"，就能改写自己的约束。
本仓库的做法是 `parse_back(edited, protected=messages[:_PROTECT])`：
解析结果永远以原始 prefix 开头，模型只能编辑其后的 turn。

#### （b）Renderer：稳定、可逆、无噪声

渲染要满足三个条件：

1. **稳定**：同样的 messages 每次渲染出完全相同的文本。不要插入时间戳、随机 id、易变的格式。
   否则模型没编辑，文件也会"变化"，产生无意义的 sync。
2. **可逆**：每一段文本都能映射回 role。用行首的显式标记，例如
   `[[CTX_TURN 7 role=assistant]]`，并且 turn 编号从可编辑区顶部从 1 开始。
3. **完整**：模型看到的内容都要可编辑。bash agent 的大部分 token 在 `tool_calls[].function.arguments`
   里，只渲染 `content` 会让模型看不到自己的命令，也无法压缩它。

#### （c）Parser：永远不要相信模型会保留格式

解析器要按"敌意输入"设计，而不是按"模型会乖乖保留 header"设计：

- header 丢失/拼错 → 剩余文本作为 user note 保留，绝不静默丢弃；
- 非法 role → 折叠成 user，不允许伪造 system；
- 连续同 role → 合并，保证 chat template 合法；
- 空 turn → 丢弃；
- tool_call 结构 → 编辑后不重建（本仓库明确放弃），统一降级为 role + text；
- 结果 → 必须重新过一遍 provider 的合法性检查（Anthropic/Bedrock 对未配对的 tool_use 很敏感）。

**"容错 + 可预测的降级"比"严格校验后拒绝"更重要**：模型经常只破坏一个 header，
如果整次编辑被拒绝，它会反复重试同一个错误；如果只降级那一段，其余编辑仍然生效。

#### （d）Edit gate：允许长大，但必须有理由

两个策略：

- `fit`：只要编辑后仍不超过预算就接受。适合探索型任务，模型可以补充结构化笔记。
- `shrink`：编辑必须让上下文变小。适合"压缩"语义明确的场景（如 BrowseComp-Plus 配置）。

拒绝时返回的提示必须是可操作的，并且要说明"你很可能重复/追加了内容，应该用更短的摘要替换"。
这段文案是 prompt 的一部分，不是日志；改动它会改变模型行为。

#### （e）Budget governor：确定性计数 + 软硬结合

- 用本地 tokenizer 做确定性计数，不要依赖服务端返回的 usage 做准入（gateway 的 usage 不可靠）；
- 用服务端 usage 做校准（本仓库的 `calibrate`），但准入门槛仍用本地计数；
- `strict_target = context_budget_tokens - reserve`，reserve 留给下一次输出；
- 分级 nudge（25%/50%/75%）负责"提前提醒"，adaptive persistent nudge 负责"按最近工具输出大小提前触发"；
- 超限时优先回滚最新 turn 并插入一条 pinned ledger，告诉模型"哪些命令的输出导致了溢出"，
  防止回滚后模型失忆、重复执行同一命令造成 livelock；
- 回滚次数用尽后给最后一轮，然后停止，让 verifier 按当前状态评分。

### 4.3 框架映射

下面的映射按"接入层"而非具体 API 版本给出；具体 hook 名称随版本变化，落地时以当前版本文档为准。

| 框架 | 接入层 | 具体做法 | 主要注意点 |
|---|---|---|---|
| **LangGraph** | `StateGraph` 的 state + node | state 里保留 `messages` 和 `context_file`；一个 node 执行编辑，另一个 node 在调用模型前 render/parse；checkpointer 负责恢复 | 自定义 reducer 要保留 tool_call_id；编辑后要把 state 里的 messages 整体替换，不能只 append |
| **AutoGen (v0.4)** | `ChatCompletionContext` / model_context 抽象 | 实现一个自定义 context 类：`get_messages()` 前把当前 messages 渲染到文件，工具执行后读回并 parse | GroupChat 里多个 agent 共享 context 时要隔离文件；不要把共享文件当成消息总线 |
| **CrewAI** | Agent/Task 的 LLM 调用层 | 用自定义 tool 暴露编辑能力；在 LLM wrapper 里做 render/parse；task 的 context 只作为初始输入 | Crew 默认隐藏 message list，必须在 LLM 层拦截，否则只能做 note-taking |
| **OpenAI Agents SDK** | Model provider / Runner 的模型调用层 | 包一层 Model 实现，在请求前 render、响应后 parse；tool 只负责执行编辑命令；session 负责持久化 | `RunHooks` 适合审计，不适合改写请求；要确认能拿到完整 messages 而不是只有 input |
| **Claude Agent SDK / Claude Code** | hooks + 工作区文件 | 用 `PreToolUse`/`PostToolUse`/`UserPromptSubmit` 维护一个 scratchpad/notes 文件，把摘要注入下一轮 | 这类产品通常不暴露"替换 transcript"的接口，只能做 agentic memory，不要宣称是真 CLM |
| **LlamaIndex** | Memory / ChatStore | 自定义 memory 类，在 `put`/`get` 时同步 mirror；检索器仍作为 tool 使用 | memory 的 token 裁剪逻辑要关掉，否则会和 CLM 的预算治理打架 |
| **自研 loop** | LLM client 封装 | 按本仓库五组件实现，最直接 | 推荐作为参考实现；先把 parser 和预算做对，再谈优化 |

一个通用判断：**如果框架的抽象是"消息列表 + 模型调用"，CLM 可以适配；如果抽象是"prompt 字符串
+ 工具回调"，CLM 会被降级成"让模型维护一个笔记文件"。** 后者仍然有用，但不是同一个东西。

### 4.4 最小实现骨架

下面是一个与 provider 无关的骨架，省略了重试、日志和 provider 适配，只保留 CLM 的四个关键动作：
render → 模型编辑 → parse → gate。其中 `count_tokens`、`llm`、`write_mirror` 等是示意接口，
落地时替换成你的 tokenizer、模型客户端和沙箱 I/O。

```python
import re

HEADER = re.compile(r"^\[\[CTX_TURN (\d+) role=([A-Za-z]+)\]\]$", re.M)

class EditableContext:
    def __init__(self, system: str, task: str, budget: int, reserve: int = 2048):
        self.protected = [
            {"role": "system", "content": system},
            {"role": "user", "content": task},
        ]
        self.turns = []            # 权威 message list 的可编辑部分
        self.limit = budget - reserve

    # 1) 投影：只渲染可编辑区，header 必须稳定、可逆
    def render(self) -> str:
        return "\n\n".join(
            f"[[CTX_TURN {i} role={m['role']}]]\n{m['content']}"
            for i, m in enumerate(self.turns, 1)
        )

    # 2) 解析：容错；非法 role 折叠；空 turn 丢弃；连续同 role 合并
    def parse(self, text: str) -> list[dict]:
        matches = list(HEADER.finditer(text))
        out = []
        for k, mt in enumerate(matches):
            role = mt.group(2).lower()
            role = "assistant" if role == "assistant" else "user"
            end = matches[k + 1].start() if k + 1 < len(matches) else len(text)
            body = text[mt.end():end].strip()
            if body:
                out.append({"role": role, "content": body})
        # 只规范化可编辑区；protected 原样拼回去，绝不被合并/覆盖
        return [dict(m) for m in self.protected] + self._normalize(out)

    def _normalize(self, msgs):
        kept = [m for m in msgs if m["content"].strip()]
        merged = []
        for m in kept:
            if merged and m["role"] == merged[-1]["role"] and m["role"] != "system":
                merged[-1] = {
                    "role": m["role"],
                    "content": merged[-1]["content"] + "\n\n" + m["content"],
                }
            else:
                merged.append(m)
        return merged

    # 3) 准入：fit 或 shrink；拒绝时返回可操作的提示，而不是抛异常
    def apply(self, edited: str, allow_growth: bool = True) -> tuple[bool, str]:
        candidate = self.parse(edited)
        after, before = count_tokens(candidate), count_tokens(self.messages())
        if after > before and not (allow_growth and after <= self.limit):
            return False, "[CTX: edit rejected — it grew context; replace stale text with a shorter summary]"
        self.turns = candidate[len(self.protected):]
        return True, f"[CTX: applied {before}->{after} tokens]"

    def messages(self):
        return self.protected + self.turns
```

外层循环只需要：

```python
ctx = EditableContext(system, task, budget=32000)
while step < max_steps:
    rendered = ctx.render()
    write_mirror(rendered)                      # 上传到沙箱/工作区
    resp = llm(messages=ctx.messages(), tools=[bash])
    cmd = parse_tool_call(resp)
    result = run_bash(cmd)
    edited = read_mirror()                      # 下载
    if edited != rendered:
        ok, note = ctx.apply(edited)
        result.output += note
    ctx.turns += [assistant_msg(resp), tool_msg(result)]
```

这段代码故意没有处理"编辑轮免费""回滚 ledger""snapshot"这些细节；它们是生产实现的必要部分，
但核心机制就是上面这四步。

### 4.5 迁移路线图

建议按以下顺序落地，每一步都能独立产生价值：

1. **只读镜像**：先把完整 context 渲染成文件供模型查看，不允许编辑。
   验证渲染稳定、token 计数准确、模型确实会读它。
2. **可编辑 + 严格校验**：开放编辑，但只接受"能解析且不超预算"的结果；
   先不做 rollback，超限就结束。观察模型是否会误删、是否会破坏 header。
3. **预算治理**：加 nudge、reserve、adaptive persistent nudge、最新输出 cap；
   加"编辑轮免费"的记账规则和 LM-call 上限，防止免费轮无限循环。
4. **回滚与 ledger**：加 `max_num_retry_on_limit` 和 pinned ledger，
   解决"爆窗口后模型失忆、重复执行同一命令"的 livelock。
5. **快照与回放**：每次调用前保存精确 messages；加 segment/input_context 轨迹格式；
   这时才能可靠地做成本分析和离线评估。
6. **成本模型**：从"token 数"升级到"prefix-reuse FLOPs"；如果自托管，评估 SCR；
   如果走 API，至少按"编辑点之后的重读量"做估算。
7. **策略学习**：先写 `SKILL.md` 并用 A/B 评估；只有当提示调优遇到瓶颈、且有稳定 reward 时，
   再考虑 RL。

### 4.6 反模式

- **让模型返回完整的新上下文**：重打一遍全量文本既贵又容易漏，等于把编辑变成生成任务。
  正确做法是让模型用代码就地修改文件。
- **没有 protected prefix**：模型可以通过编辑文件改写系统提示，这是 prompt injection 的直通车。
- **把镜像文件当唯一存储**：文件被破坏后没有权威副本可恢复；message list 才是 source of truth。
- **只按 content 计 token**：bash agent 的大部分 token 在 tool call 参数里，会低估近一倍。
- **编辑轮无限免费**：必须同时有"免费轮"和"LM-call 上限"，否则模型可以靠反复微调文件刷轮次。
- **每次小编辑**：编辑点之后的所有 token 都要重读；批处理、尽量靠后编辑，成本会低很多。
- **用向量库替代活上下文**：向量库解决"找得到"，不解决"看得见、改得动、删得掉"。
- **把摘要当成无损**：摘要适合叙事性历史，不适合逐字证据、精确数值、结构化状态。

---

## 5. 适用边界与风险

### 5.1 什么时候 CLM 明显占优

- 上下文压力远大于窗口（ContextBench 最高到 24 倍窗口）；
- 任务需要逐字保真（needle、日志原文、API schema、精确数值）；
- 状态需要频繁就地更新（记分牌、todo、候选解集合、棋盘）；
- 长时程 agent，压缩时机无法预先确定；
- 多 agent 共享工作区，需要互相裁剪对方的上下文。

### 5.2 什么时候 RAG / 其它方案更合适

- 大规模静态知识、多租户、权限隔离、强审计：RAG 的召回和引用更成熟；
- 单轮问答、低延迟、成本敏感：CLM 的编辑开销不划算；
- 模型能力较弱且不做后训练：论文自己报告 Qwen3.5-9B 在 RL 前比 summary harness 低 6 个点；
- 托管 agent 不暴露 message list：只能做 note-taking，做不到真 CLM；
- 需要跨会话长期记忆：CLM 默认是 per-episode，长期记忆仍应放外部存储。

### 5.3 主要风险

1. **信息误删**：模型可能删掉后面还要用的证据。缓解：shrink gate 只用于压缩型任务；
   保留 source id/指针；关键事实要求逐字保留；编辑后做一次"任务关键信息还在吗"的自检。
2. **编辑幻觉**：模型可能"总结"出原文没有的内容。缓解：优先删除/指针化而不是改写；
   对数值、引用、代码要求逐字保留；用 diff 审计。
3. **注入持久化**：论文明确警告，模型可能把不可信指令写进自己的上下文，并在后续轮次继续生效。
   缓解：把外部内容标记为 untrusted；parser 重钉 system；对编辑做模式扫描；
   多 agent 场景限制文件读写权限。
4. **服务成本反直觉**：上下文变小不等于算力变小，编辑点靠前会导致大量 re-prefill。
   缓解：cache-aware 成本模型、批处理、靠后编辑、SCR。
5. **评测口径偏差**：ContextBench 只按"最终上下文里保留了什么"评分，不承认放在磁盘上的答案。
   这能隔离上下文管理能力，但不能直接等同于"端到端任务能力"；真实业务里 offload 到磁盘 + 查询
   往往是更优解，评估时要补端到端指标。

---

## 6. 如何评估一次 CLM 改造

不要只看任务准确率，至少同时看四组指标：

| 组别 | 指标 | 说明 |
|---|---|---|
| 任务效果 | accuracy / reward / pass@k | 最终目标；要和 baseline 同预算比较 |
| 上下文健康 | peak tokens、平均 tokens、超限次数、rollback 次数 | 是否真的把上下文控制住了 |
| 编辑质量 | 编辑次数、真编辑比例、拒绝率、误删率（人工/自动抽查） | 模型是否会用这个能力 |
| 成本 | prompt/completion tokens、prefix-reuse FLOPs、TTFT、tokens/turn | 编辑带来的重算是否被算进去 |

建议的 A/B 基线：同一模型、同一预算、同一任务，对比
(a) 无管理的长上下文、(b) 固定摘要 harness、(c) CLM。再对 CLM 做消融：
去掉 edit gate、去掉 rollback、去掉 nudge、把 fit 换成 shrink，看每个部件的边际贡献。

---

## 7. 结论

CLM 的设计优秀之处，不在于"让模型自己压缩"这个口号，而在于它同时做对了四件事：

1. **接口选对了**：用文件而不是新工具，复用模型对代码/文件的强先验；
2. **权限给对了**：把整个活上下文的读写权交给模型，而不是只给一个固定大小的 memory block；
3. **边界守住了**：protected prefix、容错解析、编辑准入、预算治理，保证"任意编辑"不会变成"任意破坏"；
4. **代价算清了**：承认编辑会破坏 prefix cache，并用 SCR 和 cache-aware 指标把账算回来。

与 RAG 的关系可以概括为一句话：**RAG 是取数，CLM 是理账。** 取数决定上限，理账决定这些数在
长时程任务里能不能被持续、准确、低成本地使用。两者组合，才是长时程 agent 的完整上下文架构。

对工程团队来说，最可行的起点不是复刻整个论文，而是：

> 找到消息组装缝 → 加一个只读镜像 → 开放编辑并做容错解析 → 加预算与回滚 →
> 加快照与成本核算 → 最后才谈技能进化或 RL。

这条路径的每一步都可以独立验证、独立回滚，也不会要求你更换模型或框架。

---

## 8. 参考

- Shao et al., *Context Language Models*, arXiv:2609.37725, 2026.
  <https://arxiv.org/abs/2609.37725> · <https://arxiv.org/html/2609.37725v1>
- 开源实现：<https://github.com/facebookresearch/context-language-models>
- ContextBench：<https://github.com/RulinShao/ContextBench>
- Anthropic, *Effective context engineering for AI agents*：
  <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- ContextBench 任务与评测口径说明：<https://notesbylex.com/contextbench.html>
- CLM 设计解读：<https://originshq.com/blog/context-language-models-clm/>
- RAG 与长上下文/agentic retrieval 的权衡：<https://ordoresearch.ai/blog/rag-vs-long-context-retrieval-future>
- MemGPT / Letta 的分层记忆（core / recall / archival）思路：Packer et al., 2023；
  以及 Letta 文档中的 memory blocks 设计。
- Chroma, *Context Rot: How Increasing Input Tokens Impacts LLM Performance*, 2025.
