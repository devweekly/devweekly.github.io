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

## 11. 结论：把 CLM 放在上下文生命周期体系中，而不是把它变成新的 Memory 单体

更成熟的 context management 不是让一个机制统一替代其他机制，而是清楚划分哪些信息是权威事实，哪些是可复用记忆，哪些只是检索候选，哪些信息当前必须进入模型的计算，以及活动上下文如何在预算压力下更新和恢复。

CLM 为活动上下文加入模型可控的读写与删除能力；ACON 帮助从失败轨迹中学习更有效的压缩规则；ACE 将有效策略累积成可演化的 playbook；RLM 把超长输入变成可以递归检视的外部环境；RAG、长期记忆与产品化 compaction 分别承担召回、跨任务复用和运行时压缩。它们处于不同层次，可以组合，但不能视为同一个功能。

对于 common-agent-lib，正确决策是**引入 CLM 的关键思想，构建统一的上下文生命周期契约、受控编辑适配器、预算与审计能力，并把真正的 CLM 作为可选策略**。不应该把文件编辑镜像、Shell 执行器和某个特定 SDK 的会话历史处理强加给所有应用，也不应该让活动上下文成为替代事实源或正式记忆的唯一副本。

工程上最值得优先做的不是“把 CLM 移植过来”，而是让各 runtime 可以回答四个问题：这次模型真实看到了什么？哪些信息为何被保留或移出？一条已移出的证据怎样安全恢复？最终任务收益是否足以抵消上下文编辑、重检索和重新 prefill 的成本？一旦这四件事有稳定的契约和评测，CLM 才能作为一种可替换、可比较、可回滚的上下文管理策略进入公共基础库。

---

## 12. 参考资料与进一步阅读

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

### 长上下文的性能边界

- Liu et al., [Lost in the Middle: How Language Models Use Long Contexts](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long), TACL 2024。
- Hong et al., [Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://www.trychroma.com/research/context-rot), Chroma technical report, 2025-07-14。
