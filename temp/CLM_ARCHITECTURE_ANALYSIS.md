# LLM Context Management 最新综述：CLM、压缩、记忆与运行时架构

> 分析对象：Context Language Models（CLM，arXiv:2609.37725）及其开源实现
> `facebookresearch/context-language-models`。
> 本文把论文设计、本仓库代码和常见上下文工程实践放在一起对照，给出可操作的移植方案。
> 研究与产品文档核对截至 2026-10-24。论文中的实验结果均按作者报告转述，不等于独立复现；平台能力以当前官方文档为准。

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


---

## 8. 研究与产品现状：从“压缩 prompt”走向上下文生命周期管理

截至 2026-10-24，CLM 不是 context management 唯一的发展路线。研究和产品实现正在分化为几类：模型直接编辑活动上下文、根据失败反馈优化压缩规则、持续演化可复用的策略记忆、把超长输入当作外部环境递归检查，以及由 Agent 平台管理会话压缩和长期记忆。它们共享一个目标——让每次模型调用看到适当的信息——但操作对象、控制权和持久化语义并不相同。

2026 年 10 月发布的综述《From Long Context to Selective Memory》提出一个有用的统一视角：不要只关注 token 压缩率，而要把信息在活动计算路径与非活动存储之间的写入、卸载、召回、检索注入、物化、驱逐、整合和遗忘当作完整生命周期；中间还存在缓存的 KV 状态等部分保留计算状态。这个视角比“短期上下文对比长期记忆”的二分法更适合作为生产架构的基础。

### 8.1 主要路线及其边界

| 路线 / 代表工作 | 主要控制对象 | 信息更新方式 | 最突出的价值 | 与 CLM 的关键区别 |
|---|---|---|---|---|
| Context Language Models（CLM，2026） | 当前 episode 中实际送入模型的活动上下文 | 模型通过普通代码工具直接编辑上下文文件，运行时将编辑同步回权威消息列表 | 允许任意局部增删、替换、压缩与指针化；压缩粒度由模型按任务状态决定 | 本文重点研究的可写活动上下文范式；需要运行时真正拥有并能替换完整消息列表 |
| Agent Context Optimization（ACON，2025 预印本，ICML 2026） | 环境观察和交互历史的压缩结果 | 从“完整上下文成功、压缩后失败”的轨迹中分析丢失原因，迭代优化自然语言压缩指导；也研究将压缩器蒸馏到更小模型 | 适合把失败反馈沉淀为稳定、可复用的压缩策略 | 主要优化压缩器和规则，不等于每轮都由主 Agent 任意编辑当前消息 |
| Agentic Context Engineering（ACE，2025 预印本，ICLR 2026） | 可演化的策略手册、领域上下文和长期 Agent 记忆 | Generation、Reflection、Curation 将新经验增量写入、反思并整理为 playbook | 适合从真实执行反馈中学习哪些规则和策略在某类任务有效 | 目标偏向跨任务复用、策略积累与上下文演化；不直接替代当前 transcript 的即时裁剪 |
| Recursive Language Models（RLM，2025） | 超长输入本身及其可编程检查环境 | 模型用代码检查、拆分输入，并递归调用模型处理相关片段 | 处理远超单次窗口的长文档、代码库或数据集合；避免一次性吞下全部内容 | 侧重外部化输入和递归计算，不要求把活动对话改写为一份新上下文 |
| Prompt 压缩（LLMLingua / LongLLMLingua） | 单次请求中的文本片段、token 或 prompt 结构 | 通过重要性估计和压缩算法删除、缩短输入 | 适合静态输入过长、延迟或调用成本敏感的场景 | 一般是请求级有损压缩，不具备完整的任务状态管理、跨轮编辑和恢复语义 |
| 传统摘要 / Context Folding | 历史消息或环境观察 | 由固定提示词、触发阈值或规则生成摘要，再替换旧消息 | 实现成本低、容易在现有 SDK 接入 | 取舍由外部策略控制，容易出现简洁偏置、关键细节丢失和摘要反复改写导致的信息塌缩 |
| RAG / Agentic Retrieval | 模型上下文之外的文档、索引、数据库和知识图谱 | 检索时选出候选，注入相关结果；外部资料仍可独立回查 | 适合大规模资料、来源引用、权限隔离和跨会话知识 | 解决“从哪里找到信息”，不直接解决“进入活动上下文后如何保留、修改和淘汰” |
| 平台托管 compaction（OpenAI Responses / Agents SDK 等） | 平台保存的对话历史或其可见后缀 | 达到阈值时调用平台压缩接口，或由 SDK 在回合之间改写会话历史 | 产品化路径清楚，开发者不必自行实现所有压缩环节 | 通常是平台或预定义策略决定何时压缩；压缩结果未必是可直接检查、任意局部编辑的上下文文件 |
| Agent 管理的持久记忆（Letta MemFS、LangMem 等） | 跨回合、跨会话可复用的记忆与策略 | Agent 或记忆管理器创建、更新、归档、整合和检索记忆 | 支持长期学习、可编辑记忆、文件化管理和策略复用 | 管理的是长期记忆或 prompt memory，不一定能修改当前模型调用中的完整消息列表 |

ACON 的论文与实现可见 [PMLR 论文](https://proceedings.mlr.press/v306/kang26b.html) 和 [Microsoft 官方代码库](https://github.com/microsoft/acon)。论文报告在 AppWorld、OfficeBench 和 Multi-objective QA 上将峰值 token 用量降低 26%–54%，并在部分设置中提升任务成功率；这是特定实验设置下的结果，不能直接视为所有业务系统的预期收益。

ACE 的研究已进入 ICLR 2026 论文集，强调通过 generation、reflection、curation 形成持续演化的 playbook，报告了 Agent 和金融任务上的改进。它提醒工程团队：长期记忆不应只是越来越长的摘要；应该能保留经过验证的有效策略，同时避免重复、冲突和上下文坍塌。参考 [arXiv 论文](https://arxiv.org/abs/2510.04618) 与 [Microsoft Research 论文页面](https://www.microsoft.com/en-us/research/publication/agentic-context-engineering-evolving-contexts-for-self-improving-language-models/)。

RLM 则把超长输入当作外部环境，由模型编程式检视片段，并在必要时递归调用模型，而不是要求单个上下文窗口承载一切。它适合文档级分析、仓库探索和大规模输入处理；对工程系统的启示是应区分“输入是否可访问”与“输入是否全部驻留在当前窗口”。参考 [Recursive Language Models](https://arxiv.org/abs/2512.24601)。

### 8.2 不能忽略的平台级工程化：Compaction 已经成为一类标准能力

研究中的自主编辑，与商业 API 提供的压缩能力不是二选一。对于多数生产系统，最稳妥的起点仍然是平台提供的 compaction、显式上下文裁剪、检索和持久会话，然后在验证过收益的长任务上引入更动态的上下文管理。

**OpenAI Responses API** 当前支持两种相关做法。一种是在请求中配置服务端 compaction 阈值，让平台在上下文达到阈值时进行压缩；另一种是调用独立的 compact 接口，基于现有消息构造更短的延续状态。压缩项目可能是不透明的内部表示，而不是面向用户阅读的完整摘要。官方说明还覆盖了 store=false 等状态管理差异。参考 [OpenAI Compaction Guide](https://developers.openai.com/api/docs/guides/compaction)。

**OpenAI Agents SDK** 进一步把会话存储和压缩封装成可组合组件。例如，Session 可持久化历史；session_input_callback 能自定义下一次运行时实际送入模型的历史子集，但不因此把过去历史重新保存成新输入；OpenAIResponsesCompactionSession 则可在回合之间触发 Responses API 压缩，并处理会话替换时的并发、过期快照和恢复问题。它体现了一个重要区分：**用于下一次调用的输入视图可以被裁剪，而长期会话历史仍可以保留完整记录。** 参考 [Agents SDK Sessions](https://openai.github.io/openai-agents-python/sessions/) 与 [Compaction Session API](https://openai.github.io/openai-agents-python/ref/memory/openai_responses_compaction_session/)。

这些能力比早期“收到超限错误就把最近 N 轮删掉”更系统化，但仍不等于 CLM。平台 compaction 通常采用平台拥有的压缩逻辑或压缩模型；CLM 的研究点在于让正在执行任务的模型通过通用操作，自主决定活动上下文的任意局部变换。平台 compaction 是可以直接采用的可靠基线；CLM 则是值得在特定任务上验证的另一种控制方式。

### 8.3 Letta / MemFS 与 CLM 的关系：相似的文件化思路，不同的生命周期

Letta 的 MemFS 把 Agent 管理的记忆投影为可通过文件操作检查和修改的文件系统，并以 Git 管理记忆演化；它还区分不可直接修改的历史经验、系统提示中的 memory blocks、外部 Markdown/skills，以及可在后台对近期交互进行整理的 dreaming 流程。其文档还建议通过记忆治理工具检查文件层级、重复和系统提示 token 占用。参考 [Letta memory & dreaming](https://github.com/letta-ai/letta-docs-md/blob/main/configuration/memory/index.md) 和 [Letta Code context architecture](https://github.com/letta-ai/letta-code/blob/main/src/agent/prompts/letta_local_memfs.md)。

这与 CLM 有明显的工程相似性：两者都让模型把文件操作作为维护上下文的自然方式，并强调可审查的文件变更。但不能混同：

- CLM 的研究对象是当前一次模型调用所使用的活动消息上下文；文件是活动消息列表的可编辑镜像。
- MemFS 重点管理 Agent 身份跨会话可复用的长期记忆、记忆块和外部文件；下一次 prompt 是根据这些材料重新编译出来的。
- Letta 可借助工具和 hook 影响上下文，但“可以修改外部记忆文件”本身并不能证明“能够在每次模型调用前任意替换完整消息列表”。

在自建系统中，可以同时采用两种模式：CLM 管理当前 episode 的工作集，长期记忆系统管理跨 episode 的经验和稳定规则。前者可以引用后者中的资源，但不能直接把长期记忆视为不可变的真相。

### 8.4 LangGraph / LangMem：把执行状态、对话历史与长期记忆分开

LangGraph 的 checkpoint/persistence 模型适合保存可恢复的图执行状态、线程状态和中间产物。LangMem 则提供从交互中抽取、扩展、整合和更新长期记忆的工具，并可与 LangGraph 的存储层组合。LangMem 文档把长期记忆区分为语义记忆（事实与知识）、情景记忆（过往经验和示例）以及程序性记忆（行为和流程规则）。参考 [LangMem 概念指南](https://github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md) 与 [LangMem 项目](https://github.com/langchain-ai/langmem)。

这种分层很适合生产设计，但 checkpoint、长期记忆和 CLM 仍是不同的机制：

- Checkpoint 是恢复执行的权威状态；不能为了缩短 prompt 而丢掉任务进度、审批状态或外部副作用记录。
- 长期记忆为未来任务复用事实、策略或经历；它需要自己的写入筛选、冲突处理、来源和隐私策略。
- 活动上下文是当前模型调用实际接收的输入；需要按 token 预算选择、重排、压缩和补取资料。
- CLM 是一种活动上下文管理策略，不应该取代 checkpoint 或长期存储。

### 8.5 Prompt 压缩、长上下文与“上下文腐化”研究仍然重要

LongLLMLingua 研究了长上下文输入中信息密度、位置和压缩的影响。Chroma 在 2025 年发布的 Context Rot 技术报告则评估了 18 个模型，报告指出即使任务本身相对简单，输入变长也可能使性能下降，且不同语义相似度的查询—证据对受影响的程度不同。更早的《Lost in the Middle》研究也发现，相关信息位于长上下文中间时，模型表现可能显著下降。

这些结果支持一个工程原则：**上下文窗口的标称长度，不是所有信息都能被同样可靠使用的保证。** 不能单凭“模型支持百万 token”就把完整仓库、全部 tool outputs、所有摘要和所有历史都放进一个 prompt。上下文工程还要考虑证据位置、干扰项、结构、重复、缓存与 token 成本。

参考 [LongLLMLingua / LLMLingua](https://www.microsoft.com/en-us/research/project/llmlingua/longllmlingua/)、[Context Rot](https://www.trychroma.com/research/context-rot) 和 [Lost in the Middle](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long-Contexts)。

### 8.6 当前阶段的判断：生产实践已成熟一部分，模型自主编辑仍属前沿能力

截至本文日期，可以做出三个相对稳妥的判断。

第一，长时程 Agent 的上下文治理不再只是提示词技巧。持久 Session、阈值压缩、服务端 compaction、长期记忆、按需工具发现、快照和成本统计，已经是平台级工程能力的一部分。

第二，CLM 所代表的模型自主编辑活动上下文，提供了比固定压缩模板更宽的动作空间，但仍是较新的研究路线。论文报告的性能、算力和多 Agent 收益很有参考价值，但当前证据不能证明它对所有模型、任务或托管 SDK 都优于稳定的 compaction/RAG 组合；具体收益必须结合模型能力、任务的精确信息保留要求、prefix cache 成本和端到端结果来评估。

第三，下一阶段不应把各种方法混成一个“万能 Memory”模块。更合理的方向是建立统一的上下文生命周期与观测接口，然后通过策略适配不同场景：静态文档用检索；长输入用递归检视；简单长会话用确定性或平台 compaction；策略学习用 ACE/ACON 思路；需要自主决定保留、删除和重写的长时程任务，再评估 CLM。

论文和代码的实验结论还应按各自评测口径解读。ContextBench 特别强调从最终活动上下文中评估保留、更新和卸载行为；它并不把“只存在于外部磁盘而未返回到活动上下文”的答案一律视为成功。因此，ContextBench 能测出一种重要能力，但不应单独用它代替实际业务端到端测试。

---

## 9. 面向生产系统的 Context Management 参考架构

建议把 context management 看作一条信息生命周期，而不是一段 prompt 或单个 Memory API。每条信息至少需要可回答：它来自哪里、属于哪个工作范围、能否用于当前任务、是否仍然有效、是否要进入当前计算、如果暂时移出窗口如何恢复。

| 层次 | 典型内容 | 权威性与生命周期 | 主要责任 |
|---|---|---|---|
| 业务事实源（source of truth） | 源码、原始文档、Draw.io XML、翻译原文、已采纳译文、人工确认规则 | 由业务应用持久化和版本管理 | 保存不可因上下文压缩而丢失的事实与正式产物 |
| 执行状态与审计账本 | Run、checkpoint、审批、工具调用、外部副作用、重试信息 | 具备明确状态机、版本和恢复语义 | 负责继续执行、恢复和核实任务是否真正完成 |
| 跨任务长期记忆 | 经验、用户偏好、可复用规则、已验证策略、情景示例 | 允许追加、更新、整合、归档，但需要来源、作用域和冲突策略 | 支持未来任务学习，不替代业务事实源 |
| 检索与召回层 | RAG、关键词索引、图遍历、历史会话查询、文件搜索 | 候选信息应携带来源、权限和时序属性 | 找到可能有用的信息，不能独自决定它已成为可信事实 |
| 活动上下文 / 工作集 | 本轮任务、关键证据、重要工具结果、当前假设、被排除方案、计划和待办 | 每次模型调用都可重新物化；在预算下选择并可更新 | 让模型在当前计算中看到最有用的信息 |
| 模型调用与策略层 | 排序、裁剪、确定性摘要、ACON/ACE 策略、CLM 编辑 | 策略可替换，但不能绕过权限、时间边界和证据规则 | 决定怎样把信息放入下一次模型输入以及何时编辑 |
| 运行时与模型服务层 | tokenizer、输入上限、prefix cache、KV cache、服务端 compaction、调用计量 | 与模型和 provider 有关 | 控制窗口、延迟、成本、缓存和超限处理 |

推荐的数据流如下：

1. 宿主应用从权威来源读取候选资料，并先做权限、版本、可信度和时间边界检查。
2. 检索层选择相关资料，保留 source ID、来源版本、原始引用和可回查位置。
3. Context assembler 根据当前任务、优先级、token 预算和必需约束生成活动上下文。
4. 若启用了 CLM，模型可以通过受控编辑机制调整活动上下文；候选变更必须经版本校验、受保护区域校验、结构校验和预算校验。
5. 模型获得下一轮上下文后继续执行；被卸载的原始资料仍保存在权威存储，必要时可重新检索。
6. 每次模型调用、上下文编辑和召回都记录输入快照、版本、来源、token 量、成本、结果和错误原因；长任务完成后用同一套评估用例做回归。

这里最重要的是保持分层边界。上下文文件是工作集，不是业务数据库；检索出的证据是候选，不自动升级为事实；压缩后的状态可以用于延续任务，但不能作为“原始历史从未发生”的替代品；模型说自己保存了信息，也不能替代实际的持久化或工具执行确认。

### 9.1 上下文管理操作也应当有明确的生命周期语义

跨框架接口可统一记录以下操作类型：

| 操作 | 语义 | 关键检查 |
|---|---|---|
| Write | 把新发现写入工作集或长期记忆 | 来源、任务作用域和写入目标是否明确 |
| Update | 改正过期假设或更新已有状态 | 是否保留旧值、变更原因和版本 |
| Compress | 以更短表示替换部分活动上下文 | 是否保留影响后续决策的事实和精确证据 |
| Offload | 将完整材料移出活动上下文，只保留引用或索引 | 引用是否稳定、权限是否仍有效、是否可重新载入 |
| Recall / Retrieve | 从外部存储恢复所需信息 | 召回质量、权限、时序和来源是否经过验证 |
| Evict | 从活动工作集中移除暂时无用内容 | 是否仍被未完成任务依赖、是否可从权威来源恢复 |
| Consolidate | 合并重复经验、归纳策略或形成更稳定的知识 | 是否处理冲突、是否保留出处、是否错误泛化 |
| Forget / Archive | 降低信息活跃度或从可用记忆中移出 | 保留要求、保留期、隐私策略和审计政策 |

ContextBench 值得作为“活动上下文管理能力”的专门评测；长期记忆还需要跨会话任务、冲突更新、遗忘、权限、恢复与隐私评估。一个完整的测试套件必须同时测量局部上下文效率与端到端任务是否正确完成。

---

## 10. common-agent-lib 是否需要引入 CLM 思想，以及如何落地

结论是：**应该引入 CLM 的架构思想，但不应把完整的 CLM 实现强塞进现有 agent-context 或 agent-memory，更不应将所有应用统一改成模型自由编辑记忆文件。** common-agent-lib 最适合沉淀跨 provider 的上下文契约、生命周期事件、安全准入与评估机制；具体运行时只有在能控制实际发送给模型的完整消息列表时，才可以实现真正的 CLM。

### 10.1 现有公共模块覆盖了什么，还缺什么

| 当前模块 | 已有能力 | 应当保持的边界 | 与 CLM 相关的缺口 |
|---|---|---|---|
| agent-context | 确定性选择与拼装、优先级、必需项、预算计量钩子、来源和省略原因 | 只处理宿主已经授权和选出的候选，不自行检索或改变事实状态 | 不管理运行中的完整消息列表，不提供活动上下文文件的编辑、同步、快照和回滚 |
| agent-memory | 记忆记录、归档记录、工作记忆窗口和归档候选选择 | 长期记忆的持久化及归档实现由宿主负责，不能把摘要当作原始记录 | 没有完整的 write/manage/read 运行时，也没有长期记忆合并、冲突、复核和策略学习的通用执行器 |
| agent-knowledge | 小规模确定性词法检索、来源和受限内容渲染 | 知识检索、权限和应用特定的索引应由宿主决定 | 不处理召回结果进入活动上下文以后如何被更新、压缩、卸载和重新载入 |
| agent-eval | 通用用例、grader、观测和评估结果聚合 | 不定义实际 Agent loop 或统一业务总分 | 没有 CLM 的 edit quality、key-fact retention、context replay、压缩成本和恢复评估约定 |
| 各 provider runtime | 管理各自的 SDK Session、流、调用和错误处理 | SDK 特有消息格式、工具调用和会话生命周期留在对应适配器 | 尚未形成统一的“读取当前实际 messages、提交新 messages、同步活动上下文”的能力契约 |

这说明 common-agent-lib 目前具备了 CLM 的部分下层积木，但不是 CLM Runtime。当前组件设计已经明确把上下文拼装和记忆存储分开，这是正确的起点，不应该因为引入 CLM 而重新合并。

### 10.2 推荐的公共边界：Context Assembly、Context Management Runtime 和长期 Memory 分离

建议维持现有两个主要模块的职责，再增加一层可选的运行时契约；是否拆成单独 npm package，应由真实调用路径和第二个接入应用决定，不需要预先建立复杂包体系。

| 建议模块 / 抽象 | 责任 | 不负责 |
|---|---|---|
| agent-context（现有） | 接收已授权候选，按确定性规则排序、去重、裁剪和渲染；报告纳入、排除及预算 | 不对外部数据做检索、授权或事实审核，不编辑对话历史 |
| agent-memory（现有） | 规范化长期记忆记录与归档契约；支持分页、归档候选和有界工作记忆 | 不把每一条 Agent 交互都自动变成长期记忆，不处理活动 message list |
| Context Management Runtime（建议新增的能力层） | 管理某次任务的活动上下文快照、版本、可编辑投影、变更准入、差异、预算及回放记录 | 不直接决定领域事实是否真实，不绕过应用授权，不把运行时快照视为正式业务产物 |
| Provider / Agent Loop Adapter（宿主适配器） | 在真实模型调用前读取当前 messages；在允许的情况下替换消息历史；保留 tool call、tool result、多模态 payload 和 provider 元数据 | 不应假设所有 SDK 都允许修改自己的内部会话历史 |
| 应用层的 Memory / Knowledge / Source Adapters | 提供可回查的长期记忆、知识、源码、业务数据和检索接口 | 不依赖 CLM 来保存权威数据或替代权限检查 |
| agent-eval（现有，可扩展） | 测试上下文管理策略对任务成功率、信息保留、成本、恢复和违规的影响 | 不以压缩率作为唯一目标 |

对外应提供的是策略无关的契约，再由宿主选择策略，例如：不压缩的 append-only；确定性裁剪或摘要；ACON 风格的反馈优化压缩；ACE 风格的长期策略累积；以及 CLM 风格的模型自主编辑。并非每个项目都需要所有策略。

### 10.3 真正的 CLM 要求一个“消息组装缝”

CLM 的接入前提不是“可以调用工具”或“可以写 memory 文件”，而是 provider adapter 在每次模型生成前能取得真正会发送的消息列表，并能把通过检查的新消息列表替换进去。

公共契约至少要表达以下能力：

- **Read actual context**：读到实际请求使用的 messages，而不是只读到用户 prompt 或 SDK 的 conversation ID。
- **Render / parse editable projection**：将可编辑区域投影到文件或其他编辑表面，并把编辑结果还原成受支持的 message 结构。
- **Replace with revision check**：提交新的上下文时携带 base revision；如果原始会话已经变化，必须拒绝过期编辑，而不是覆盖新消息。
- **Count and gate**：使用目标模型对应的 tokenizer 或可信估算器进行预算检查，并保留下一次输出、工具返回和安全检查所需的空间。
- **Preserve message semantics**：不能把带有工具调用 ID 的 assistant 消息和工具结果随意降级成普通文本；也不能在编辑投影中伪造 system、developer、tool 或多模态消息。
- **Trace and restore**：保存编辑前后版本、diff、纳入/排除内容、token 变化、拒绝原因和恢复点。

如果某个 SDK 只允许向内部会话追加新输入，却不让应用获取并替换下一次请求的完整历史，那么应用最多只能实现结构化笔记或外部记忆；不应对外声称实现了 CLM。对这种 SDK，正确方案可能是继续使用其原生 Session/Compaction，或在模型调用层自建受控 loop，而不是用工具回调伪造 transcript 修改。

### 10.4 安全边界：不要让 CLM 成为一条绕过规则的写入通道

common-agent-lib 可以统一技术层的编辑准入，但不能替代宿主的领域治理。

- System / developer 指令和宿主强制的安全策略不能由可编辑投影覆写。受保护的前缀应来自权威副本，每次应用编辑时重新钉住。
- 模型生成的摘要、事实或策略仍是模型输出；通过编辑语法校验，不代表内容正确。
- Context 文件与源码目录、工作区配置、业务记忆文件以及正式文档应具有不同的路径和权限。不能因为 CLM 使用 shell，就允许 Agent 任意修改 workspace 文件。
- 从网页、源码、日志或检索结果载入的内容必须作为不可信数据处理。模型把恶意指令复制进上下文，会将一次性的 prompt injection 转化为后续轮次继续生效的持久化注入。
- 业务端的证据、权限、版本和时间边界必须在 Context Assembly 之前做；不允许通过重写上下文把候选记忆升级为确认事实，或把未来信息引入当前任务。
- 不应默认把“编辑轮”视为免费且没有上限。编辑本身会调用模型、执行代码并可能导致后续 prefix cache 失效，需要有模型调用上限、时间上限和成本预算。

### 10.5 推荐的落地路线：先统一观测契约，再实现可选 CLM 策略

| 阶段 | 交付 | 验收标准 |
|---|---|---|
| P0：定义模型输入观测契约 | 每次模型调用记录 context revision/hash、provider/model、消息数量、token 估算、来源和构建策略 | 可复现某次模型实际接收的内容；可以区分完整 transcript、活动上下文和长期记忆 |
| P1：补上下文生命周期事件 | 纳入、排除、压缩、卸载、召回、过期、冲突、编辑拒绝和恢复事件 | 每次更新可追踪到来源、任务、旧版本、新版本和原因；无记录的静默丢弃不被接受 |
| P2：定义可编辑上下文适配契约 | Versioned context snapshot、受保护区域、render/parse、compare-and-swap、edit gate、token budget、diff/replay | 对工具消息、异常格式、并发更新、过期版本、预算溢出和 prompt injection 都有测试 |
| P3：实现一个受控 CLM 原型 | 在一个能够掌控完整消息列表的 runtime 中用独立文件镜像活动上下文，模型通过沙箱工具编辑，宿主校验后替换消息 | 证明编辑结果确实进入下一次模型请求，而不仅仅是保存在外部文件；消息语义和安全边界不丢失 |
| P4：进行策略 A/B 评估 | 对比不压缩、确定性压缩、ACON 式压缩与 CLM | 相同模型、相同任务、相同预算比较任务成功、关键事实保留、违规、成本和恢复；记录失败轨迹 |
| P5：再决定是否沉淀为稳定包 | 根据两个以上实际宿主应用的使用经验抽取稳定抽象 | 不因为单一试验而引入复杂的通用 Agent Runtime 或强制依赖 shell sandbox |

在公共实现中应优先使用可复现的、显式的上下文 patch / revision / diff，而不是只保存无法核对的“新摘要”。即使 CLM 原始研究使用任意代码编辑镜像，公共库也可以把安全校验、版本一致性、预算计算和审计先做成可靠的底层能力；文件编辑执行器可以作为可插拔实现。

### 10.6 三个应用仓库应如何使用

**architecture-diagram-studio：** 可以优先为长时间的架构调查、跨模块代码分析和复杂 Draw.io 变更增加可观测的活动上下文。先保留工作区检索与原生 XML 作为事实来源，记录重要判断、排除项和出处，并验证 Copilot SDK 对当前会话历史的可控程度。如果 SDK 的内部会话历史无法由应用替换，就先使用可重建的工作状态、文件检索和 SDK 原生压缩；在自建 loop 或有完整消息替换能力的适配器接入之前，不把它标成真 CLM。

**vocal-saga/local-agent-service：** 领域记忆、Context Graph、TranslationBrief 和 context_delta 仍然负责证据、来源版本、人工确认以及章节时间边界。CLM 若接入，应先管理每个长时程分析 Run 的临时工作上下文，例如已完成阶段、已验证结论、待确认问题和下一阶段计划；不得直接编辑正式 LiteraryMemory 或已采纳译文。进入翻译上下文的任何新事实仍需经过现有原文证据验证，不能以模型改写的上下文代替服务端验证。

**common-agent-lib：** 不应为所有调用默认开启 CLM。它的核心价值是向宿主提供可选、可测量、可审计的上下文管理能力；短对话和一般查询继续使用简单拼装，结构化业务系统继续保留权威存储与来源过滤，只有长期任务和上下文增长明显的 Agent 才启用模型自主编辑策略。

### 10.7 应加入的评估维度

在现有 agent-eval 上增加上下文管理相关用例时，不应把“最后上下文更短”当成成功。最少应覆盖：

- **任务结果**：任务成功率、输出正确性、工具操作完成率和回归错误。
- **关键状态保留**：重要约束、精确字符串、数字、路径、证据、用户确认决定及未解决问题是否仍被保留或可恢复。
- **证据与来源**：压缩后结论是否仍有可追踪的原始来源；引用的行号、文档版本或 source segment 是否真实有效。
- **更新正确性**：新证据推翻旧假设时，旧结论是否被更新并保留变更记录；是否有互相冲突的活动状态。
- **安全**：受保护指令是否不变；不可信指令是否被复制成高优先级上下文；是否出现跨 workspace、跨用户或跨 Run 的上下文泄漏。
- **预算和成本**：输入与输出 token、峰值活动上下文、编辑次数、编辑拒绝率、重新检索成本、延迟和缓存重算。长上下文模型和缓存能力变化时应重做测量。
- **恢复与可回放**：中断后能否从最新有效 revision 恢复；并发更新是否发生覆盖；同一任务的决策是否能使用保存的模型输入和工具轨迹复盘。

建议建立三组基线：不做压缩；固定阈值或规则驱动的 compaction；CLM 自主编辑。只有在任务成功率和关键事实保留不下降、成本没有被编辑造成的重读抵消，并且失败可以解释与恢复时，才应把 CLM 作为默认策略推广。

---


## 11. 厂商与框架的最新实现路线：从 API 原生压缩到可恢复的上下文工作集

本节以 2026-10-24 可查到的官方文档、开源实现和论文为准。需要区分三种成熟度：厂商 API 中可直接调用的能力；开源 Agent harness 中已有源代码和测试的机制；以及仍主要存在于论文或研究性代码中的新范式。三者都值得参考，但上线风险与证据强度不同。

### 11.1 Anthropic / Claude：服务端 compaction、选择性清理与保留原始尾部

Anthropic 的 Messages API 已把 context management 做成 API 层能力，而不再完全依赖应用自行实现“拼接全部历史—超限—调用摘要模型—替换 messages”的循环。官方文档推荐长时间运行的 Agent 优先采用服务端 compaction；需要更细的控制时，再组合 context editing。参考 [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)、[Compaction threshold](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold) 和 [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)。

| 能力 | 实际行为 | 适合的问题 | 生产注意事项 |
|---|---|---|---|
| 服务端压缩（`compact_20260112`） | 达到 input-token 阈值时生成 compaction block；后续请求继续携带压缩后的状态，而不是不断发送整个旧历史 | 长对话、多轮工具调用、研究/编码任务 | 压缩块不是完整、可读的原始 transcript；需要审计时仍应保存应用侧原始记录 |
| 自定义 compaction 指令 | 可指定保留重点；自定义 `instructions` 会替换默认摘要指令，而非简单追加 | 保留文件路径、术语、待办、精确决策、未完成步骤 | 必须明确要求摘要保留目标、已验证结论、未完成步骤、约束和证据回查线索 |
| `clear_tool_uses_20250919` | 选择性清理较旧工具调用结果 | 搜索、读取文件、调用 API 导致工具输出快速膨胀 | 只有在旧输出可以重新读取或不再影响后续决策时才清除；工具调用与对应结果必须保持合法消息序列 |
| `clear_thinking_20251015` | 选择性清理旧 thinking block | 连续推理/工具调用造成额外输入占用 | 不应把 thinking 当作权威业务状态；任务状态、结论、证据和下一步必须另有显式记录 |
| Keep-tail compaction（`compact-2026-09-04`） | 应用选取 cut point：压缩较早历史，最近若干轮原样保留 | 最近一次用户指令、代码 patch、工具调用参数或人工决定不适合再摘要的任务 | cut point 不能切断一组尚未闭合的 tool call/result；保留尾部越长，释放空间越少 |

对 Python / TypeScript SDK 集成，首选沿用 Messages API 返回的 compaction block 与官方规定的消息续接流程，不要自行把 block 转成普通字符串，也不要在没有理解 API 契约前删除返回内容。若需要精确保留近期轮次，先通过合法的消息边界确定 cut point；测试应覆盖 tool-use block、tool result、多模态内容以及压缩后的下一次工具调用。官方说明特别指出，服务端 compaction 比旧的 SDK 自行摘要更容易正确处理 token 计量；TypeScript/Ruby 的旧 `compaction_control` 方式已弃用，Python SDK 也已移除旧参数。

Claude Code 的趋势不止是 compaction，而是把不同类型的上下文分层：根目录或祖先目录的 `CLAUDE.md` 适合放长期有效的项目约束；Skills 按需加载详细流程；rules、hooks、subagents 和引用文档负责不同的使用时机与权限边界；自动记忆负责跨会话积累可复用信息。Anthropic 在 2026 年的工程文章中强调渐进披露、用工具接口和结构化 schema 承担约束、避免将过多规定预先塞进系统提示词，以及使用更丰富的参考文档。参考 [The new rules of context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models) 和 [Steering Claude Code](https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more)。

可落地的目录组织建议：

- `CLAUDE.md`：只放必须每次都生效、较短且稳定的项目规则和入口索引，不复制完整架构文档。
- rules 目录：按路径或任务范围注入规则，避免无关内容长期驻留。
- `skills/<name>/SKILL.md`：描述何时使用某能力；详细规范、参考资料和脚本放在同一 Skill 目录，按需读取。
- 独立进度文件或应用数据库：记录当前目标、已完成/未完成工作、验证结果、阻塞项、关键文件与下一步；不要只依赖 compaction 后的自然语言摘要。
- Hooks / 服务端 gate：校验高风险命令、文件范围、权限和重要副作用，不把这些限制只写在 prompt 中。

**工程判断：** 使用 Claude API 的应用应先评估原生 compaction + 选择性工具结果清理；只有在原生机制无法表达的任意局部编辑、业务特有保留策略或跨 provider 可观测性要求下，才考虑自建活动上下文管理。Claude Code 的 `CLAUDE.md` / Skills / hooks 是提示材料和工作流治理，不等同于可替换底层完整消息列表的 CLM runtime。

### 11.2 OpenAI：Responses API 服务端 compaction + Agents SDK 的 Session 输入视图

OpenAI 有两个应分清的层次：Responses API 管理模型调用中的 compaction item；Agents SDK 管理 Session 历史、下一次运行时输入的合并方式，以及何时触发压缩。官方文档：[Compaction](https://developers.openai.com/api/docs/guides/compaction)、[Agents SDK Sessions](https://openai.github.io/openai-agents-python/sessions/)。

**Responses API 的两条路线：**

1. **服务端自动压缩。** 在 `responses.create` 中通过 `context_management` 设置 `compact_threshold`。当渲染后的 token 数超过阈值，服务端执行压缩，并在响应流中发出 compaction item。该 item 是用于延续状态的 opaque/encrypted 表示，不是供用户阅读的普通摘要。若使用 input-array chaining，应将响应项目按官方流程续接；若使用 `previous_response_id`，则按该模式传入新用户输入，不要同时手工裁剪旧历史。
2. **独立 `/responses/compact`。** 应用将当前完整、尚未超出模型窗口的上下文提交给压缩端点，并将返回的压缩窗口作为下一次请求的规范输入。官方文档明确要求，不要再自行裁剪独立端点的返回结果，因为其中可能同时包含 compaction item 与仍需原样保留的项目。

服务端压缩请求的大致结构如下；实际 model、阈值和保留策略应根据模型窗口及输出预留量配置：

```python
response = client.responses.create(
    model=MODEL_ID,
    input=input_items,
    context_management={"compact_threshold": TOKEN_THRESHOLD},
)
```

这里的 `TOKEN_THRESHOLD` 是应用配置，不是跨模型通用常量。阈值应为最大输出、工具返回和下一轮续接留出空间。采用服务端 compaction 可以减少应用侧自建压缩控制器，但应用仍需要持久化业务事实、审批状态、工具副作用和可审计的原始轨迹。

**Agents SDK 的 Session 机制更接近应用层 context management：**

- `SQLiteSession` / `AsyncSQLiteSession` 等 Session 保存会话项；Session 持久化与“这次调用向模型发送什么”并不是同一件事。
- `RunConfig.session_input_callback(history, new_input)` 可以在模型调用前过滤、排序或选择旧历史，再与当前输入合并。这个回调控制本次模型输入，但 SDK 仍只把当前新输入持久化为新项目，不会因为裁剪了旧历史就把它重复记成新的用户输入。
- `SessionSettings(limit=N)` 可以限制每次读取的最近历史项；`call_model_input_filter` 可用作更靠近实际模型调用的最后一层过滤。
- `OpenAIResponsesCompactionSession` 把底层 Session 与 Responses compaction 组合起来，支持按阈值在回合后自动压缩，也允许手动触发。如果自动压缩在 run 结束前同步执行，流式调用即使已经产生最终输出，也可能继续等待压缩；对严格的时延要求，可以在回合之间或空闲时段安排压缩。

简化的组合模式：

```python
underlying_session = SQLiteSession(session_id)
session = OpenAIResponsesCompactionSession(
    session_id=session_id,
    underlying_session=underlying_session,
)
result = await Runner.run(agent, user_input, session=session)
```

生产中应把三类状态分别管理：应用侧的原始交互/操作审计记录、SDK 的 session items、Responses API 返回的 compaction continuation。它们可能具有不同的可读性、保留策略和恢复语义。还要明确 `store=False`、响应链可用性与 input-based compaction 的差异；不能假定所有运行都能通过上一个 response ID 恢复压缩。

**工程判断：** OpenAI API 原生 compaction 是最容易快速上线的基线；Agents SDK 的输入回调适合做可控裁剪、重排和历史限量。当需求升级到 CLM 时，要进一步验证所选 Agent loop 是否能读写下一次真实请求中的全部内容，而不是误把 Session 输入过滤能力当成任意消息编辑能力。

### 11.3 LangChain / LangGraph / Deep Agents：先卸载重复内容，之后才摘要

LangChain 的 Deep Agents 把上下文管理作为 Agent harness 的一部分，而不是仅提供一个 `summarize_messages()` 函数。官方在 2026 年的实现说明中描述了三种不同频率的策略：大型工具结果产生时立即卸载；上下文越过阈值后卸载旧的文件写入/编辑参数；只有卸载不足以释放空间时才压缩旧会话。参见 [Context Management for Deep Agents](https://www.langchain.com/blog/context-management-for-deepagents)、[Deep Agents overview](https://docs.langchain.com/oss/python/deepagents)、[summarization middleware source](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/summarization.py)。

| 机制 | 官方文章描述的默认行为 | 为什么有用 | 需要自行验证的边界 |
|---|---|---|---|
| 大工具结果卸载 | 单次工具响应超过约 20,000 tokens 时，将完整结果写到文件系统；对话中保留文件路径和开头预览 | 大文件、搜索结果、API payload 不会永久占据所有后续轮次的窗口 | 这个值依赖版本和配置，不应把 20k 当作所有任务的最佳阈值；路径必须稳定、权限受控且可重读 |
| 旧文件写入/编辑参数卸载 | 上下文越过模型窗口约 85% 时，对旧的 write/edit 调用参数做截断/指针替换，因为完整文件已经在文件系统 | 防止“文件已保存，完整文件内容却仍在每轮历史里重复出现” | 只有已成功持久化、可按路径读取的内容才能替换；失败或未确认的写操作不可被当成已保存 |
| 对话摘要 | 已无足够可卸载内容且达到压缩条件后触发 | 摘要保留目标、产物、进度和下一步 | 要测试目标漂移与被摘要掉的关键事实是否可恢复 |
| 原始历史文件 | 摘要时将完整原始消息写入文件系统，工作上下文只保留结构化摘要 | 压缩并不等于销毁历史，可通过文件检索恢复特定细节 | 需要明确文件生命周期、线程隔离、数据保留/删除和文件权限 |

Deep Agents 的 context management 还有两个值得借鉴的设计。第一，Skills 渐进披露：先给模型一个小的 Skill 入口，再按任务需要加载说明、参考资料和脚本；长期记忆通常来自 `AGENTS.md` 等文件，而不是把所有领域说明直接塞到系统提示词。第二，文件系统是基础抽象，skills、memory、代码执行、上下文卸载和自定义工具可以共享一套受权限控制的虚拟文件系统；子 Agent 可以拿更窄的工具和文件权限，且只把其结果摘要/产物回传给父 Agent，以隔离子任务产生的大量细节。

部署时一定要检查所选 Deep Agents 版本的实际默认 middleware。项目在 0.7.0 的变更中简化了默认 system prompt，并将 TODO planning middleware 改为按需添加；若业务确实依赖显式任务清单，必须在主 Agent 和需要它的子 Agent 上明确配置，而不是假设框架永远默认提供。自动与按需压缩也可以结合，但应避免多个 middleware 对同一历史重复摘要。

实用配置顺序：

1. 为每次运行明确选择 backend：图线程内的 `StateBackend` 适合随 checkpoint 恢复的临时文件；需要跨线程/重启持久化时，应显式配置持久化文件系统或 store，不能假定 state backend 自动等同于跨会话磁盘。
2. 启用文件工具，但用路径权限限制读写范围，保护 `.env`、凭据、原始输入与正式产物；子 Agent 仅授予子任务需要的目录。
3. 先测量实际 tool-output 分布，再配置 offload 与 summarization 触发点。保留原始 payload 的 source key、hash 和文件地址。
4. 给摘要增加可测试的字段：任务目标、不可变约束、已完成工作、当前工作、阻塞、重要决定、产物路径、未解决问题、下一步以及原始证据引用。
5. 做两类评测：频繁强制触发压缩以放大信号的机制测试；以及真实任务/真实配置下的端到端测试。

**工程判断：** Deep Agents 是“文件卸载 + 工作集摘要 + 按需召回”的成熟实现参考，特别适合长时间 coding/research Agent。它比第一版 CLM 更容易被已有框架渐进采用。其文件系统和摘要能力并不等于模型可自由编辑整个消息列表；如果接入 CLM，仍需另行实现严格的 context projection、revision gate 和 provider adapter。

### 11.4 Pi：结构化 compaction、分支摘要、文件操作追踪与持久化执行

本节讨论 [earendil-works/pi](https://github.com/earendil-works/pi) 当前公开实现中的 coding-agent compaction 和 `@earendil-works/pi-durable`，不要把不同 Pi 分支/发行版的 API 视为完全相同。相关实现可从 [compaction reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)、[agent changelog](https://github.com/earendil-works/pi/blob/main/packages/agent/CHANGELOG.md) 与 [pi-durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) 核对。

**Coding agent 的 compaction 细节：**

- 默认基于 `contextTokens > contextWindow - reserveTokens` 触发；文档中的默认 `reserveTokens` 为 16,384 tokens，`keepRecentTokens` 默认 20,000 tokens。前者为下一次生成留空间，后者控制近期历史有多少原样保留。它们是初始配置，不是所有模型的普适最佳值。
- 触发检查不只发生在下一次请求返回超限之后。Pi 会在工具结果写入后、准备下一次 assistant 响应前检查，也会在新用户输入前和某些 overflow recovery 路径中检查。检测到 provider context-overflow 时可执行一次 compact-and-retry 恢复尝试。
- 找 cut point 时会遵守消息边界，不能在 tool result 处切断并使其脱离对应工具调用。结构化摘要包含 Goal、Constraints & Preferences、Progress、Key Decisions、Next Steps、Critical Context，并要求保留准确的文件路径、函数名和错误信息。
- 摘要会累计追踪原始历史中已读取/修改的文件，也会继承先前 compaction 或 branch summary 的文件信息。`/tree` 分支切换采用 branch summarization，不是把所有分支历史与当前分支混成一个长摘要。
- 自动压缩有生命周期事件、持久化的 compaction entry 和扩展 hook；一次压缩的 token 用量也属于 usage 统计。摘要提示可能关闭 prompt-cache writes，因为一次性摘要请求很少被原样复用。

对应的关键配置如下（具体字段需与安装版本核对）：

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

**`pi-durable` 的更重要贡献是把上下文缩短和执行可靠性结合起来。** 当前 README 将对话表示为持久化的、不可变的 entries。compaction 生成一个新的 `pi.compaction` entry，存储摘要并指向第一条仍保留在活动视图中的 entry；原始旧 entries 仍留在存储里。因此其 compaction 更接近改变可见 transcript projection，而不是删除历史事实。该项目在 2026-10 的版本说明中进一步强化了任务 phase、checkpoint、sleep/wakeup、storage commit 一致性、恢复和可观测性。

值得直接借鉴的细节包括：

- **后台压缩。** `backgroundTokens` 可配置提前启动 compaction 的距离；达到阻塞阈值时等待结果。这样可以降低临界点上的停顿，但要处理并发 compaction、过期摘要和最新活动消息变化。
- **按模型覆盖阈值。** `modelOverrides` 允许 32k 窗口与超长窗口使用不同的 `reserveTokens` / `keepRecentTokens` / `backgroundTokens`，避免硬编码一个对小窗口太大、对大窗口又太小的数字。
- **失败时显式暴露状态。** 正在运行的压缩任务和最近一次失败进入 live state 与事件流；当阻塞阈值下的 compaction 失败时，生成任务失败并记录原因，而不是静默发出注定超限的请求。
- **只在稳定边界创建压缩快照。** cut point、first-kept entry、摘要和原始 entry ID 要一起持久化；如果任务在摘要产生后又新增了输入，旧摘要必须按 revision / cut-point 检查是否已经过时，不能覆盖较新的活动上下文。
- **让执行状态可恢复。** `pi-durable` 的任务可将阶段与 checkpoint 持久化，进程崩溃后从已提交状态继续；工具执行要明确 replay-safety 和幂等键；数据库写入与可见状态变化必须按同一提交协议完成。
- **提供有界观测。** 内容由 transcript ID 关联，遥测属性可只记录 ID、阶段、token 和成本等元信息，避免将 prompt、敏感工具参数和结果默认复制进日志。

当前 README 将 `@earendil-works/pi-durable` 标记为 experimental，且 API 可能跨版本变化；上线时应固定版本并运行 storage conformance、crash-recovery 和 compaction regression tests。它也不自动等于 CLM：durable compaction 是结构化摘要驱动的活动视图更新；CLM 的特征是模型通过通用操作自主决定活动上下文中的任意局部改写。两者可以组合，但语义不同。

另一个需要单独核对的方向是 CLM 对 Pi 的适配。Meta 的 [CLM 官方仓库](https://github.com/facebookresearch/context-language-models) 已列出通过 `pi install npm:@lolipopshock/pi-clm` 安装的 Pi 支持。该适配应视为将 CLM 策略带入 Pi 的单独集成，不意味着 `pi-durable` 自身就是 CLM，也不能据此推断插件与所有 Pi 分支兼容。使用前应验证维护状态、版本兼容、数据目录、shell sandbox、消息同步、故障恢复，以及原始 CLM 仓库的许可证边界。

**工程判断：** 对 common-agent-lib 来说，Pi 最值得学习的未必是摘要文案，而是 entry log、稳定 cut point、保留尾部、文件操作累积追踪、版本化压缩 entry、失败恢复和成本事件。将这些工程属性加到上下文管理层，比只移植一个 summarizer 更有实际价值。

### 11.5 四家方案的差异与适用场景

| 对比维度 | Anthropic / Claude | OpenAI | LangChain Deep Agents | Pi / pi-durable |
|---|---|---|---|---|
| 首选能力 | 服务端 compaction + 清理旧工具/思考块 + 可保留近期轮次 | Responses API compaction + SDK Session 输入视图 | 工具结果卸载 + 旧工具参数卸载 + 文件系统可召回的摘要 | 基于 session projection 的 compaction、branch summary 和持久化执行 |
| 原始历史能否独立保留 | 需要应用侧持久化并制定保留策略 | 通常由应用 Session/业务存储负责；compact output 不是可读 transcript 的替代品 | 原始消息可写入文件系统，活动上下文改为摘要与指针 | `pi-durable` 保留原始 entries；新增 compaction entry 指向活动保留边界 |
| 细粒度清理 | 有 tool/thinking block 清理策略 | 有输入回调和 compaction，细粒度行为依接口而定 | 文件化 offload，文件参数指针化；摘要是后备机制 | cut point、保留尾部、分支摘要和扩展 hook |
| CLM 式自由编辑 | 不是原生承诺 | 单靠 compaction 或 Session callback 不能实现 | 文件可写，但默认压缩并非任意改写整个消息列表 | 可通过独立 CLM 插件探索；durable core 本身不是 CLM |
| 运行恢复与任务阶段 | 应用/SDK 工作流负责 | Session / SDK / 应用工作流负责 | LangGraph checkpoint 与 backend 负责 | `pi-durable` 明确强化任务、存储提交与 restart recovery |
| 主要工程强项 | 少量定制代码即可获得 provider-native context lifecycle | API 与 SDK 有明确的会话和压缩接缝 | 通过文件与 progressive disclosure 限制工作集膨胀 | 历史不可变、压缩可回查、运行可恢复且可观察 |
| 主要限制 | 平台状态/压缩表示具有 provider 特定语义 | opaque compaction item 与 response chain 形成 API 耦合；自动压缩可能增加回合尾延迟 | 文件系统权限、线程隔离和实际版本的 middleware 默认值必须管理 | 部分包仍处实验阶段；须锁版本并严格测试恢复和并发 |

推荐的采用顺序不是选一个赢家，而是按需求逐层叠加：API 原生压缩作为基线；大工具结果先卸载；任务状态和正式产物写入外部权威存储；旧历史以结构化摘要作为工作集 checkpoint；关键细节通过指针和检索恢复；最后才把 CLM 式任意编辑作为可选策略。越靠后的层越需要更强的运行时控制、安全验证和回归评估。

---

## 12. 2026 年研究前沿：哪些可以用，哪些应当继续验证

以下论文的数字均是作者在各自实验设置中报告的结果，不等价于独立复现或业务承诺。适合把论文中的机制转化为假设、测试和小规模原型，而不是直接将论文性能数字写入生产 SLA。

| 工作 | 时间与代码状态 | 核心机制 | 能转化为工程工作的内容 | 尚需验证的风险 |
|---|---|---|---|---|
| [Context Language Models (CLM)](https://arxiv.org/abs/2609.37725) | 2026-09；[官方仓库](https://github.com/facebookresearch/context-language-models)，包含 harness、ContextBench 与 serving 实验；仓库列有 Pi 适配入口 | 把活动 transcript 镜像为文件，模型用通用代码任意修改，runtime 再同步回真实消息列表 | 把活动上下文定义为可编辑 projection；对 edit 实现 revision、预算、保护区域、diff、回放与恢复 | 误删关键证据、编辑成本、cache 失效、prompt injection 持久化；原仓库采用 CC BY-NC 4.0，商业复用前必须核验许可证，不能直接假设可将代码复制进商业公共库 |
| [ACM: Agentic Context Management for Long Horizon Tasks](https://arxiv.org/abs/2607.23809) | 2026-07；[公开代码与数据](https://github.com/lixiaochuan2020/agentic-context-management) | 给 Agent 提供上下文编辑工具，允许模型主动压缩、外置和按需检索，再通过训练提高这类动作质量 | 把 offload 与 recall 设计为显式操作，保存原始 evidence ID，而不是强迫所有信息压入摘要 | 自主触发可能浪费调用或错过压缩时机；应先用规则触发和 replay 评估，未必需要训练专用模型 |
| [Context as an Environment / Scroll](https://arxiv.org/abs/2608.21690) | 2026-08；论文提出可执行 session environment | append-only event log + 持久化、沙箱化的 Python kernel；会话数据存在类型化命名空间，模型通过代码选择并 materialize 信息，只有显式输出进入当前工作视图 | 把完整结果存于事件/工件层，以可编程检索产生每轮 context projection；让 eviction index 指向精确事件 ID | 需要严格隔离的代码执行环境、类型/权限治理、资源上限、确定性恢复和操作审计；不能让普通 Agent shell 无约束访问内部工作状态 |
| [When History Is Multimodal / VERA](https://arxiv.org/abs/2608.29897) | 2026-08；训练免费方案，论文报告不同任务上的非缓存 token 降幅 | 在文本场景将历史渲染为紧凑表示，在多模态场景尽量保留原始视觉证据而不是强制文字化 | 对截图、视频、图表、架构图和 UI 自动化任务，保存原始 image/video artifact、时间戳、裁剪区域与文字描述的关联；摘要不能替代原始像素 | 视觉压缩/渲染可能损失坐标、细节与时间关系；应以实际定位、视觉问答和跨帧追踪任务测量 |
| [ContextEvo: Self-Evolving Context Management Policies](https://arxiv.org/abs/2609.34649) | 2026-09；论文从开源 Pi-agent harness 开展实验 | 从长任务轨迹重建决策时刻的实际 context，定位上下文相关失败，再定向修正 context policy | 将失败归因到遗漏约束、证据被埋、过度保留、旧假设未更新等类别；对 context policy 做离线回归和版本化改进 | 自我演化的策略可能过拟合少量轨迹或引入不稳定行为；应先离线评估，通过固定基准后再灰度 |
| [AdaCoM: Learning Agent-Compatible Context Management](https://arxiv.org/abs/2605.30785) | 2026-05；研究由外部管理器为冻结 Agent 修改输入 | 学习一个独立 context manager，为不同能力的 Agent 选择保真度与压缩强度 | 把任务模型与上下文策略模型解耦；同一个 Agent runtime 可通过可插拔策略比较固定压缩与模型管理器 | context manager 自身增加成本和延迟；不同底模/任务域间迁移能力有限，需先证实总成本与质量收益 |
| [From Long Context to Selective Memory](https://arxiv.org/abs/2610.21165) | 2026-10-15；综述 | 用活动计算与非活动存储的生命周期统一压缩、KV/前缀缓存、offload、recall、eviction、consolidation 和 forgetting | 在数据模型中显式表达“存在于存储”与“进入本次模型计算”的区别，成本核算纳入重新 materialize / prefill | 综述给出概念框架和评估空白，不是单一可直接安装的 runtime |
| [Persistent Memory in Multi-Agent LLM Inference](https://arxiv.org/abs/2610.07782) | 2026-10-06；受控实证研究 | 比较多 Agent 分解与持久化推理记忆的收益，发现某些独立问题基准上持久记忆没有可检测的准确率增益 | 记忆功能必须做消融实验；确保测试任务真的需要跨回合/跨样本记忆，并正确隔离每个评测条件 | 不应把持久存储或更多记忆本身当成性能优化；不合适的评测设计会夸大收益或把无关记忆变成噪声 |
| [Memory for Autonomous LLM Agents](https://arxiv.org/abs/2603.07670) | 2026-03；综述 | 按 temporal scope、representation、control policy 对 Agent memory 分类，并覆盖 write/manage/read 与评测 | 用写入筛选、冲突处理、延迟预算、隐私治理和多会话评测约束长期记忆功能 | taxonomy 不能代替特定业务的正确性/成本验证 |

这些工作对工程实践的共同启示是：未来核心竞争力未必是更复杂的摘要 prompt，而是根据任务需要动态调整活动工作集的能力。不同研究切入点不同：CLM/ACM 控制模型是否可以操作工作集；Scroll 控制工作集能否从外部状态按需物化；ContextEvo/AdaCoM 控制采用什么编辑策略；VERA 关注压缩后是否仍保留原始模态证据；记忆综述则将这些操作放进生命周期与成本框架。

应避免三个误读。第一，论文报告更高准确率或更低 token/FLOPs，并不意味着把同名组件加入生产系统就能取得同等收益。第二，外部保存了某条信息不等于 Agent 当前能正确找到并使用它；需要同时测可恢复性和任务成功率。第三，自主上下文管理会引入新的执行权限：读取日志、运行代码、编辑工作集和选择证据都可能改变安全边界，因此必须把策略能力与权限治理分离。

### 12.1 从研究原型迁移到生产功能的准入规则

| 研究机制 | 可先落地的低风险版本 | 通过评估后才考虑的版本 |
|---|---|---|
| 任意上下文编辑（CLM / ACM） | 只允许变更活动上下文中的用户/assistant 文本投影；工具与多模态对象以不可伪造的引用表示；保护系统规则 | 在严格 schema 和 CAS revision gate 下更新完整 messages，并处理复杂 provider 原生 blocks |
| 可编程检索/物化（Scroll） | 使用现有 grep/SQL/RAG/文件读取工具，对外部事件日志按 ID 检索并限制返回条数 | 为每个 session 持久化 kernel/变量命名空间，要求独立沙箱、资源配额和 crash recovery |
| 策略演化（ContextEvo / ACE / AdaCoM） | 根据离线失败类别调节阈值、保留字段和检索排序；版本化保存策略 | 由模型自动修改线上策略，要求 canary、回滚、独立评测和人类审查 |
| 多模态历史压缩（VERA） | 把原始图像/音频/视频作为权威工件保存，当前上下文保留 artifact ID、摘要、时间戳和必要 crop 信息 | 将专门的视觉/多模态压缩编码器纳入推理管线，并为每种任务建立精确度基准 |
| 跨任务长期记忆 | 只写入明确可复用、有出处、非敏感且经筛选的记忆，定期做冲突和过期检查 | 自动 consolidation/dreaming 或多 Agent 共享记忆，需要跨用户隔离、遗忘、删除和权限审计 |

---

## 13. common-agent-lib 的落地蓝图：公共接口、事件结构、策略执行与上线门槛

common-agent-lib 不需要成为一个新的全功能 Agent runtime。较合理的设计是在现有 `agent-context`、`agent-memory`、`agent-knowledge` 和 `agent-eval` 之上增加可选的 context management contract，并让 provider/agent-loop adapter 只声明它真实支持的能力。下面将研究方向收敛到可以按阶段实现和评估的工程方案。

### 13.1 建议的数据模型：原始账本不可变，活动工作集是版本化投影

最重要的设计决定是不要让压缩后的上下文成为唯一记录。建议至少分成以下四种对象：

| 对象 | 保存内容 | 可否覆盖 | 说明 |
|---|---|---|---|
| `ContextEvent` | 用户输入、模型输出、工具调用、工具结果、召回、编辑、压缩、拒绝与恢复事件 | 只追加；更正以新事件表达 | 可审计的原始账本；敏感 payload 可引用加密 artifact，而非复制到日志 |
| `ContextArtifact` | 完整工具结果、文件片段、长文档、图像/音频/视频、模型输出原文、重要 patch | 按 artifact 的业务保留策略版本化 | 超出活动预算的信息仍可找回；提供 stable ID/hash、source、ACL、retention |
| `ContextRevision` | 某次模型调用实际会看到的上下文投影：引用哪些 event/artifact、使用哪个策略、token 估算及保护区 | 只创建新 revision，不原地覆盖旧 revision | 可用于重放、比较和回滚；不必每个 revision 都存一份重复大文本，可存引用与 snapshot hash |
| `ContextPolicyVersion` | soft/hard threshold、必留类型、offload/summarize/retrieve 顺序、模型与参数版本、CLM gate | 每次策略修改新版本 | 支持灰度与回归定位，避免无法解释的在线策略漂移 |

一次模型调用应有明确的 `requestId/runId/contextRevision/provider/model` 关联。Context revision 应能指出原始资料的 event ID、artifact ID 或 source location；如果上下文编辑把证据替换成摘要，应保存编辑前后的差异与原始来源，而不是只存新摘要。

建议的概念类型如下，类型名是实现草案而非要求照抄的公共 API：

```typescript
type ContextAction =
  | "include"
  | "offload"
  | "compress"
  | "evict"
  | "recall"
  | "edit"
  | "reject"
  | "restore";

type ContextSourceRef = {
  eventId?: string;
  artifactId?: string;
  sourceUri?: string;
  sourceVersion?: string;
  contentHash?: string;
};

type ContextSegment = {
  id: string;
  kind: "instruction" | "user_input" | "assistant" | "tool_call"
      | "tool_result" | "decision" | "evidence" | "progress"
      | "artifact_ref" | "memory" | "multimodal_ref";
  trust: "trusted" | "untrusted" | "derived";
  priority: number;
  protected: boolean;
  sourceRefs: ContextSourceRef[];
  tokenEstimate: number;
  payloadRef?: string;
};

type ContextRevision = {
  sessionId: string;
  runId: string;
  revision: number;
  parentRevision?: number;
  policyVersion: string;
  provider: string;
  model: string;
  contentHash: string;
  tokenEstimate: number;
  createdAt: string;
};

type ContextDecisionEvent = {
  runId: string;
  requestId: string;
  revision: number;
  action: ContextAction;
  segmentId?: string;
  reason: string;
  tokenDelta?: number;
  sourceRefs?: ContextSourceRef[];
};
```

不要把模型编写的全部文本都默认为可信 ContextSegment。来自网页、源代码、日志和检索结果的内容应保留 untrusted 来源属性；摘要和模型推断应是 derived；宿主签发的 system/developer policy 则在独立受保护的区域保存，每次构建下一次输入时由宿主恢复。

### 13.2 公共接口应拆成“能力声明、上下文准备、提交变更”三个层次

Provider/runtime 的能力各不相同，所以接口不应假设每个 SDK 都能完全控制 transcript。建议 adapter 暴露能力声明：

```typescript
type ContextCapabilities = {
  canReadActualModelInput: boolean;
  canReplaceNextModelInput: boolean;
  canPreserveToolCallStructure: boolean;
  canPreserveMultimodalPayloads: boolean;
  supportsProviderCompaction: boolean;
  supportsSessionInputFilter: boolean;
};

type PreparedModelInput = {
  revision: ContextRevision;
  messages: unknown[];
  estimatedInputTokens: number;
  decisions: ContextDecisionEvent[];
};

interface ContextInputAdapter {
  capabilities(): ContextCapabilities;
  readNextInput(): Promise<PreparedModelInput>;
  replaceNextInput(
    expectedRevision: number,
    candidate: PreparedModelInput
  ): Promise<{ applied: boolean; currentRevision: number; reason?: string }>;
}

interface ContextPolicy {
  readonly id: string;
  prepare(input: PreparedModelInput): Promise<PreparedModelInput>;
}

interface ContextArtifactStore {
  put(input: {
    sessionId: string;
    runId: string;
    mediaType: string;
    content: Uint8Array | string;
    metadata: Record<string, unknown>;
  }): Promise<{ artifactId: string; contentHash: string }>;
  get(artifactId: string): Promise<{
    content: Uint8Array | string;
    metadata: Record<string, unknown>;
  } | undefined>;
}
```

这组接口刻意没有要求通用库提供 shell、数据库、向量库或自己的会话存储。ContextArtifactStore 可以适配应用已有的存储，ContextInputAdapter 由具体 SDK/runtime 实现，ContextPolicy 则可换成 none / trim / offload / summarize / provider-native-compaction / CLM。replaceNextInput 应在能力不足时显式失败，而不是默默只更新外部文件。

`messages: unknown[]` 也只是接口边界示意。落地时应按宿主和 provider 将消息结构建模为可保留类型、原生 blocks、tool call/result pairing、refusal、安全元数据和多模态引用的 schema；不要在一个跨 provider 的简单 `{ role, content: string }[]` 中丢弃 SDK 原生字段。

### 13.3 每次模型调用前的实际处理顺序

推荐先采用确定性、可回退的次序，减少不必要的模型摘要调用。流程不是“超过 80% 就直接摘要”，而是先判断哪些数据已在权威存储中、哪些只是重复占用活动窗口。

1. **构建和计量。** 读取当前真正会发送的消息，使用 provider tokenizer 或经过校准的 estimator 计算输入 tokens，并记录模型、上下文窗口、最大输出和 cache 相关指标。
2. **验证硬约束。** 重新注入受保护的 system/developer instructions；检查权限、当前用户/项目/Run 的作用域，过滤已过期或不允许进入模型的引用。
3. **优先卸载可恢复的大内容。** 对完整文件内容、冗长工具输出、重复的文件写入参数，先存成 artifact 并保留路径/ID、hash、预览和重新读取方式。只有持久化成功后才能把活动消息替换成指针。
4. **保留最近和未闭合状态。** 不跨越未完成的 tool call/result；原样保留当前用户输入、近期人工决定、待执行工具操作和少数关键新证据。保留最近轮数只是近似，真实实现应按语义边界与 token 预算共同决定。
5. **选择性裁剪。** 去除重复、被新证据明确替代、已完成且可重建的中间信息。每次排除要记录理由，不能静默删掉关键决定或精确值。
6. **需要时生成结构化 checkpoint。** 若卸载后仍超预算，再对更早的历史生成摘要；摘要必须包含任务目标、不能变的约束、已完成/验证的结果、当前假设、未解决问题、重要文件/产物路径、下一步和原始证据 ID。
7. **提交新 revision。** 检查 tool schema 与 message pairing、受保护区域、token hard limit、revision 是否过期；以 compare-and-swap 原子提交。
8. **最后再次计量并生成。** 若新 revision 仍超限，不要无限重试摘要；进入有上限的 recovery 路径，记录失败并按当前 runtime 的安全策略 fail-closed 或请求重新规划。

可以把基本目标表达为一个约束优化问题，但实现里应先用可解释规则求解，不要一开始就训练复杂策略：

```text
maximize  retained_task_relevance + evidence_recoverability
        + constraint_fidelity + trajectory_continuity
subject to input_tokens + reserved_output_tokens <= model_context_limit
           protected_instructions_unchanged
           tool_call_result_pairs_valid
           source_acl_and_time_boundary_valid
           every_offloaded_segment_has_stable_recovery_reference
```

**阈值应是模型/任务相关配置。** Pi 的 16k reserve、20k recent tail 和 Deep Agents 的约 85% 触发点可以作为比较基线，但不应直接变成 common-agent-lib 的硬编码。实作时至少考虑最大输出 token、工具输出 p95/p99、context window、固定提示前缀、prompt cache 与模型请求失败模式。建议先用 soft threshold 启动卸载/预整理，在硬阈值之前确保可生成；阈值的默认值必须由任务回放校准。

### 13.4 CLM 编辑必须是事务，而不是直接覆盖活动 prompt 文件

如果实现 CLM 原型，推荐 transaction-like 编辑过程：

1. runtime 生成只属于该 sessionId/runId/revision 的可编辑上下文投影，并将 system/developer、权限、tool schemas 与多模态对象放在不可写区，或在 parse-back 时由宿主权威副本重新注入。
2. 模型只能在 sandbox 中读写投影文件和经授权的 artifact 引用，不应默认给它宿主仓库的任意 shell 权限。运行环境设定 CPU、内存、输出大小、时间、网络、路径及文件数量限制。
3. 编辑产物先进入临时目录。宿主解析为候选消息结构，校验 schema、来源 ID、禁止字段、tool call/result 的完整性、多模态引用有效性和受保护区域。
4. edit_gate 至少支持两种可解释模式：fit（编辑后在 token 预算内才接受）和 shrink（编辑必须明显减少活动 tokens 才接受）。建议另外限制单轮可增长量、一次编辑可删除的 protected/unverified segment 数量和连续编辑次数。
5. 以 expectedRevision 做 compare-and-swap。原消息列表已变更则拒绝过期 edit，重新读取最新 context 后再决定是否重试，不能覆盖并发输入。
6. 保存 old/new hash、diff、token 前后值、被卸载 ID、gate 判断、工具退出码、编辑成本和失败原因。若校验或下一次请求前检查失败，回滚到旧 revision。
7. 对低置信度编辑做人工检查或 shadow mode；只有在关键事实保留、任务成功率和总成本达标后才放开自动 apply。

**不要仅凭 CLM 编辑文件后 token 数减少就计为成功。** 它必须证明修改后的投影确实进入下一次模型请求，而且工具流程、业务约束和任务目标仍然连续。编辑轮本身也要计入模型调用数、FLOPs/token、工具费用、延迟和 cache 重新 prefill 的代价。

### 13.5 观测、回放和评测：从一次 run 能重建模型真正看到的内容开始

每个 model call 至少应有以下元数据：

- `runId`、`requestId`、`parentRunId`、provider/model、策略 ID/版本、context revision/hash、开始与结束时间。
- 输入 token 估算/实际计量、输出 tokens、缓存读取/写入 tokens、compaction tokens/cost、工具输出大小、卸载字节数、恢复/召回次数。
- 各 context segment 被纳入、保留、卸载、压缩、驱逐、召回或拒绝的原因；每项都可指回来源和 revision。
- 原始事件/工具结果是否已持久化、artifact hash、message/schema 校验状态，以及 compaction 前后的保留边界。
- 安全 gate 的判断、越权拒绝、过期 revision、并发冲突和恢复动作。默认 telemetry 只写元数据；敏感消息体按应用保留策略存入受控存储。

对用户可见的 Agent trajectory/trace 页面，应允许检查每次真实 request 的 prompt/context snapshot 和 response，但默认收起长内容；显示活动 revision、压缩/卸载 diff 和源信息链接。需要排查为何模型忘记用户要求、术语、精确路径或工具结果时，必须能回到真实输入，而不是只能看到摘要或者“Context compressed”事件。

测试集建议分三层：

**单元级 context-manager tests：** 预算计算、来源过滤、摘要 schema、stable artifact reference、保护区恢复、revision CAS、并发 edit 拒绝、工具调用与结果配对、多模态 block round-trip、token estimator 误差。

**机制级 context stress tests：** 把压缩阈值人为调低，例如测试配置中设在窗口 10%–25% 以增加压缩频率，注入早期 needle facts、精确文件路径、用户约束、反例、未完成 tool call 和后续更正；压缩后要求 Agent 持续任务并在需要时找回被卸载的信息。此时的阈值只为扩大测试信号，不是生产推荐值。

**端到端 regression tests：** 对同一批任务分别运行 append-only、传统 trim/summary、offload+summary、provider-native compaction 和 CLM。固定模型/版本、工具、任务输入、权限、重试与预算，比较任务成功率、事实/约束保留率、引用有效性、安全违规、p50/p95 延迟、总 tokens、缓存效率、工具成本、压缩后目标漂移率及失败恢复成功率。报告置信区间和分任务结果，不只报告一个平均分。

### 13.6 推荐的公共库实施顺序

| 阶段 | 交付 | 现实验收标准 | 暂时不做什么 |
|---|---|---|---|
| P0：输入可观察 | 在每个 runtime 记录实际 model input 的 revision/hash、tokens、provider/model 与 source refs | 可以还原一次请求真实发送的内容；可区分历史账本、活动工作集和长期记忆 | 不做模型自主编辑，不修改现有 Agent loop |
| P1：工具输出与工件卸载 | 通用 ContextArtifactStore、稳定 artifact ID/hash、指针化输出、恢复工具 | 一个超长 tool result 被卸载后，后续工具/模型能再次取回精确原文；路径、权限、删除策略可测 | 不把摘要写入业务记忆，不复制全部大 payload 到 trace |
| P2：结构化 checkpoint 与压缩 | 统一 summary schema、切点边界、保留尾部、原始 event/artifact 保留和错误事件 | 随机压缩时能恢复关键 needle facts，tool call/result 完整，过程可解释、可回滚 | 不要求每个 provider 使用相同原生 compaction 表示 |
| P3：SDK adapter | 首先接入真正支持 Session/filter/compaction 的 OpenAI 或 Anthropic 路径；为 Deep Agents 与 Pi 映射已有能力 | 每个 adapter 逐项声明 capability，不支持的操作显式拒绝；无静默退化 | 不把有输入过滤能力的 SDK 错标成 CLM |
| P4：CLM sandbox 原型 | 仅选择一个能替换真实下一次 messages 的 runtime，做版本化镜像、受控编辑、edit gate 和完整轨迹 | 证明变更应用到真实请求；revision 冲突、权限、预算、崩溃恢复和多轮工具使用均有测试 | 不先做跨 provider 的通用 shell sandbox，不默认对所有 agent 开启 |
| P5：策略比较与推广 | 以 agent-eval 建立固定任务集、成本/正确率/保留/恢复指标和 shadow/canary | 比 baseline 有稳定净收益，关键事实与安全指标不下降，总成本而非仅 token 数有改善 | 不以压缩率、论文最高分或一次成功 run 作为推广依据 |

### 13.7 两个关键的实现选择

**先复用 provider 原生 compaction 还是自建 messages loop？** 先优先使用 provider 原生机制以及现有 Agent SDK 的 Session filter，因为它们的接口更稳定，也较少破坏工具调用、多模态数据和缓存语义。只有业务确实需要跨 provider 的任意局部编辑，且无法用 offload + retrieval + structured checkpoint 解决时，才自建可以完全控制消息列表的 loop。自建 loop 带来的不仅是控制权，也包括对 tool scheduling、abort、retry、streaming、provider-native state、cache keys、错误处理和消息兼容性的持续维护责任。

**先加入通用 package 还是先在应用里落地？** 先在一个真实长任务应用里做 ContextArtifactStore、ContextRevision、context events 和 adapter capability 的最小实现，验证接口不会围绕单一 SDK 过拟合；再由第二个应用复用。只有两个以上应用实际共享同一职责时才把实现稳定沉淀进 common-agent-lib。初始可将 CLM 策略放在独立实验包或 app adapter 中，避免因实验方案引入全局 runtime 依赖。

---

## 14. 结论：把 CLM 放在上下文生命周期体系中，而不是把它变成新的 Memory 单体

更成熟的 context management 不是让一个机制统一替代其他机制，而是清楚划分哪些信息是权威事实，哪些是可复用记忆，哪些只是检索候选，哪些信息当前必须进入模型的计算，以及活动上下文如何在预算压力下更新和恢复。

CLM 为活动上下文加入模型可控的读写与删除能力；ACON 帮助从失败轨迹中学习更有效的压缩规则；ACE 将有效策略累积成可演化的 playbook；RLM 把超长输入变成可以递归检视的外部环境；RAG、长期记忆与产品化 compaction 分别承担召回、跨任务复用和运行时压缩。它们处于不同层次，可以组合，但不能视为同一个功能。

对于 common-agent-lib，正确决策是**引入 CLM 的关键思想，构建统一的上下文生命周期契约、受控编辑适配器、预算与审计能力，并把真正的 CLM 作为可选策略**。不应该把文件编辑镜像、Shell 执行器和某个特定 SDK 的会话历史处理强加给所有应用，也不应该让活动上下文成为替代事实源或正式记忆的唯一副本。

工程上最值得优先做的不是“把 CLM 移植过来”，而是让各 runtime 可以回答四个问题：这次模型真实看到了什么？哪些信息为何被保留或移出？一条已移出的证据怎样安全恢复？最终任务收益是否足以抵消上下文编辑、重检索和重新 prefill 的成本？一旦这四件事有稳定的契约和评测，CLM 才能作为一种可替换、可比较、可回滚的上下文管理策略进入公共基础库。

---

## 15. 参考资料与进一步阅读

### CLM 与专门评测

- Shao et al., [Context Language Models](https://arxiv.org/abs/2609.37725), 2026-09；论文的作者实验结果尚需独立复现。
- [Meta / Facebook Research 的 CLM 开源实现](https://github.com/facebookresearch/context-language-models)；包含 harness、ContextBench 适配、策略学习与 Suffix Cache Reuse 实现。
- [ContextBench：what an agent keeps, updates, and offloads](https://github.com/RulinShao/ContextBench)；用于测量上下文不能完整容纳时，哪些内容留在活动上下文中。
- [CLM 上下文编辑运行时](https://github.com/facebookresearch/context-language-models/tree/main/clm/clm_harness)；重点阅读 ContextEnv、消息镜像、预算治理、编辑门槛、checkpoint 和回放实现。

### 压缩、上下文演化与递归处理

- Kang et al., [ACON: Optimizing Context Compression for Long-horizon LLM Agents](https://proceedings.mlr.press/v306/kang26b.html), ICML 2026。
- Zhang et al., [Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models](https://arxiv.org/abs/2510.04618), ICLR 2026。
- Zhang et al., [Recursive Language Models](https://arxiv.org/abs/2512.24601), 2025。
- [Microsoft ACON implementation](https://github.com/microsoft/acon)。
- [Microsoft LLMLingua / LongLLMLingua research](https://www.microsoft.com/en-us/research/project/llmlingua/longllmlingua/)。
- [From Long Context to Selective Memory: A Survey of Memory-Centric Compression for Large Language Models](https://arxiv.org/abs/2610.21165), 2026-10-15；从信息生命周期和活动计算成本统一梳理压缩、缓存、卸载、召回与遗忘。

### 生产上下文与长期记忆系统

- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), 2025-09-29。
- OpenAI, [Compaction guide](https://developers.openai.com/api/docs/guides/compaction)。
- OpenAI Agents SDK, [Sessions](https://openai.github.io/openai-agents-python/sessions/) 与 [OpenAI Responses Compaction Session](https://openai.github.io/openai-agents-python/ref/memory/openai_responses_compaction_session/)。
- [Letta Memory & Dreaming](https://github.com/letta-ai/letta-docs-md/blob/main/configuration/memory/index.md)。
- [Letta Code Context Architecture / MemFS](https://github.com/letta-ai/letta-code/blob/main/src/agent/prompts/letta_local_memfs.md)。
- [LangMem conceptual guide](https://github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md)。
- [LangMem source repository](https://github.com/langchain-ai/langmem)。


### 厂商与 Agent 框架的官方实现

- Anthropic, [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) 与 [Compaction threshold](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)：服务端 compaction、阈值、自定义摘要指令与状态续接。
- Anthropic, [Compaction that keeps recent turns](https://platform.claude.com/docs/en/build-with-claude/compaction-keep-recent-turns)：压缩旧历史、最近若干轮保持原样的方案；注意合法 cut point 及 tool-call/result 完整性。
- Anthropic, [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)：工具结果与 thinking block 的选择性清理。
- Anthropic, [The new rules of context engineering for Claude 5 generation models](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models), 2026-07-24。
- Anthropic, [Steering Claude Code: skills, hooks, rules, subagents, and more](https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more), 2026-06-18。
- OpenAI, [Compaction guide](https://developers.openai.com/api/docs/guides/compaction)：Responses API 服务端 compact threshold 与独立 compact endpoint。
- OpenAI, [API deployment checklist](https://developers.openai.com/api/docs/guides/deployment-checklist)：长任务中 compaction 的工程建议。
- OpenAI Agents SDK, [Sessions](https://openai.github.io/openai-agents-python/sessions/)；重点看 session_input_callback、SessionSettings、OpenAIResponsesCompactionSession 和流式请求压缩时延。
- LangChain, [Context Management for Deep Agents](https://www.langchain.com/blog/context-management-for-deepagents), 2026-01-28。
- LangChain, [Deep Agents context management](https://docs.langchain.com/oss/python/deepagents) 与 [summarization middleware source](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/summarization.py)。
- Pi, [coding-agent compaction reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md) 与 [agent changelog](https://github.com/earendil-works/pi/blob/main/packages/agent/CHANGELOG.md)。
- Pi, [pi-durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) 和 [durable changelog](https://github.com/earendil-works/pi/blob/main/packages/durable/CHANGELOG.md)；涉及 immutable entries、compaction、task checkpoint、resume 与 storage。
- Meta, [Context Language Models repository](https://github.com/facebookresearch/context-language-models)：官方 CLM harness、ContextBench、serving 代码与 Pi 插件入口。仓库采用 CC BY-NC 4.0，商业代码复用前需单独审查许可证。

### 2026 年上下文管理与 Agent Memory 研究

- Shao et al., [Context Language Models](https://arxiv.org/abs/2609.37725), 2026-09。
- Li et al., [ACM: Agentic Context Management for Long Horizon Tasks](https://arxiv.org/abs/2607.23809), 2026-07；[代码、数据与模型](https://github.com/lixiaochuan2020/agentic-context-management)。
- Lin et al., [Context as an Environment: Programmatic Context Management for Long-Horizon Agents](https://arxiv.org/abs/2608.21690), 2026-08；提出 Scroll 的 event log、持久化 kernel 和按需 projection。
- Su et al., [When History Is Multimodal: Rethinking Context Management for Long-Horizon Agents](https://arxiv.org/abs/2608.29897), 2026-08；提出 VERA，强调多模态历史保留原始视觉证据。
- Li et al., [Beyond Skill Evolution: Self-Evolving Context Management Policies for Long-Horizon Agent Harnesses](https://arxiv.org/abs/2609.34649), 2026-09；ContextEvo 从执行轨迹中演化 context policy。
- Yi et al., [Learning Agent-Compatible Context Management for Long-Horizon Tasks](https://arxiv.org/abs/2605.30785), 2026-05；AdaCoM 使用外部 context manager 管理冻结的 Agent。
- Gou, [From Long Context to Selective Memory: A Survey of Memory-Centric Compression for Large Language Models](https://arxiv.org/abs/2610.21165), 2026-10-15。
- Son et al., [Persistent Memory in Multi-Agent LLM Inference: What It Costs, What It Buys, and When You Can Tell](https://arxiv.org/abs/2610.07782), 2026-10-06；提醒对持久记忆做正确的消融测试。
- Du et al., [Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers](https://arxiv.org/abs/2603.07670), 2026-03。

### 长上下文的性能边界

- Liu et al., [Lost in the Middle: How Language Models Use Long Contexts](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long), TACL 2024。
- Hong et al., [Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://www.trychroma.com/research/context-rot), Chroma technical report, 2025-07-14。
