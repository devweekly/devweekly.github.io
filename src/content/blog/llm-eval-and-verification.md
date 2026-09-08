---
author: W
featured: false
draft: false
description: Eval 不是给模型出题，而是为一个 Claim 构造可重复实验：判定、效度、评分器、指标、生产飞轮
pubDatetime: 2026-09-08T02:02:03Z
title: 大模型结果如何测试和验证：Anthropic 与 OpenAI 的方法论
tags:
  - ai
  - eval
  - llm
  - testing
---

最近被反复问到一个问题：

> 大模型的结果怎么测？怎么保证 100% 准确？

我去翻了 Anthropic 和 OpenAI 的一手工程文档。先说结论（措辞上收敛一点：以下是我查到的公开材料范围内的归纳，不是全称判断）：

**在我查到的这些公开材料里，没有一家把 100% accuracy 当作现实可行的工程目标；OpenAI 的相关工作甚至专门讨论了为什么绝对准确不是合理目标。**

他们真正在做的事，是另一套东西：**把不可控的生成，拆成可判定的断言 + 可归因的失败 + 可回归的门禁。**

> 阅读指引：本文混合了三种陈述，下文用括号标注——【原文】= 一手文档明确说的；【归纳】= 我对多篇文档的归纳；【推论】= 可直接落地的工程推论。

---

## 1. 先破题：为什么 100% 是个错误问题

OpenAI 的论文 [《Why Language Models Hallucinate》][1]（[PDF][13]）里有三句判断，基本终结了这个问题【原文】：

| 常见主张                                            | 论文的发现                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| 提高准确率就能消除幻觉，100% 准确的模型永远不会幻觉 | **准确率永远到不了 100%**——有些现实问题本质上不可答（信息缺失、歧义、需要澄清） |
| 幻觉不可避免                                        | 不是。模型在不确定时**可以选择沉默**                                            |
| 消除幻觉需要很高智能，只有大模型做得到              | 相反，**小模型更容易认知自身局限**（校准所需算力远低于追求绝对准确）            |
| 幻觉是现代模型里的某种神秘故障                      | 不是。统计机制与评测激励都已经搞清楚了                                          |

### 1.1 幻觉有两个来源，第二个才是主因

**来源一：预训练的统计不可约性**【原文】**。**

预训练是在海量文本上做"预测下一个词"。和传统机器学习不同，**每条陈述都没有"真/假"标签**——模型只看到流畅语言的**正例**，必须去近似整体分布。

论文把这个归约成一个叫 **IIV（Is-It-Valid，这条陈述有效吗）** 的问题：当你手里只有正例、从来没见过被标记为"无效"的样本时，区分有效与无效陈述**本质上是无监督的**，难度高得多。

为什么模型很少拼错单词、很少括号不匹配，却会编造生日？论文的类比很漂亮：

- 给几百万张猫狗照片打上"猫/狗"标签，算法能可靠分类——因为**存在可学习的模式**
- 改成按宠物的生日给照片打标签——**生日本质上是随机的**，无论算法多先进，这个任务必然出错

拼写在语料里有极其稳定的模式，规模上去错误就消失；而"某人的生日"这种**任意的、低频的事实**没有模式可循，于是产生幻觉。

论文还给了一个可量化的下界：

> 预训练之后的幻觉率，**至少等于训练事实中只出现过一次的比例**。
> 例如，若 20% 的生日事实在预训练数据中只出现过一次，那么基础模型在这类事实上**至少**会幻觉 20%。

这一条很硬：**有些错误不是训练不够好，是信息本身就不在模型里。**

**来源二（更关键）：后训练阶段被评测机制奖励出来的**【原文】**。**

### 1.2 一组让人不舒服的数据

论文给了一组真实数据（SimpleQA，出自 GPT-5 System Card）【原文】：

| 指标                     | gpt-5-thinking-mini | OpenAI o4-mini |
| ------------------------ | ------------------- | -------------- |
| 弃权率（不给具体答案）   | 52%                 | 1%             |
| 准确率（答对，越高越好） | 22%                 | **24%**        |
| 错误率（答错，越低越好） | **26%**             | **75%**        |

（三行相加都是 100%：准确 + 错误 + 弃权。）

单看准确率，老模型 o4-mini 反而更高。但它的错误率是前者的近 3 倍——因为它几乎从不弃权（1%），什么都敢猜。

论文的类比很直白：这就像选择题考试，空着必然 0 分，蒙一个还有 1/4 概率对。

> 当成千上万个 benchmark 都用 0-1 打分，**模型就会学会"永远别承认不知道"**。
> 模型永远处在"考试模式"里。

论文的用词是 **"an epidemic of penalizing uncertainty"（一场惩罚不确定性的流行病）**。他们特别强调：

> 只在旁边加几个新的"幻觉评测"是不够的。**主流评测本身必须改。**

因为只要主榜单还在奖励幸运的猜测，少数几个幻觉评测的影响力根本压不过去。

### 1.3 解法：改评分规则，不是改模型

具体做法是在每道题的 prompt 里显式写明阈值【原文】：

> 答对 +1 分；回答"我不知道"得 0 分；**答错扣 t/(1-t) 分**。
> 请只在你确信答对概率大于 t 时才作答。

其中 t 是置信度阈值。有了这条规则，模型就会把自己的置信度和 t 比较——**低于阈值时，最理性的策略就是弃权**。

这个思路并不新：标准化考试早就用"答错倒扣分"来遏制瞎猜。新的是 OpenAI 把它主张为**所有主流 benchmark 都应该改的计分方式**（MMLU、SWE-bench 等）。

### 1.4 对做应用的人，三条直接含义【推论】

1. **如果你自己的评估体系只统计"准确率"，你就在亲手训练你的系统去瞎猜。**
2. **给"我不知道"一条合法出路，并且在指标上不惩罚它。** 弃权是特性，不是缺陷。OpenAI 甚至把"谦逊（humility）"写进了 Model Spec——宁可表明不确定或请求澄清，也不要给出可能错误的自信信息。
3. **校准比准确便宜。** 让模型知道自己不知道，所需的算力远低于让它答对。小模型在这件事上反而有优势——论文的例子是：面对毛利语问题，完全不懂毛利语的小模型可以直接说"我不知道"；而懂一点毛利语的模型反而需要费力评估自己的置信度。

---

## 2. 全文的总模型：Eval 不是出题，而是在证明一个 Claim

这是全文最重要的骨架【归纳】。后面所有章节（判定、题目、环境、评分器、指标、生产）都是这个链条上的一个环节：

```text
Claim → Task → Environment → Observation → Grader → Metric → Decision → Feedback
```

展开成一个具体例子——"这个 Agent 能可靠地处理退款请求"：

```text
Claim:
"这个 Agent 能可靠地处理退款请求"

↓ 拆成

Task:
用户要求取消一笔符合条件的订单

↓ Environment（环境）:
账户、订单、退款 API、权限、policy

↓ 行为:
Agent 调用工具、查询订单、执行退款

↓ Observation / Outcome:
订单状态 = refunded
退款金额正确
没有越权
没有修改其他订单

↓ Grader:
状态检查 + 金额检查 + 权限检查 + Policy 检查

↓ Metric:
pass@1 / pass^k / 错误类型 / 成本 / 延迟

↓ Decision:
是否上线？灰度多少？转人工阈值？

↓ Feedback:
生产失败 → 新 Task → 回归套件
```

理解了这个，就理解了全文的核心论点：

> **Eval 不是"给模型出题"，而是构造一个能够支持 / 反驳某个产品或模型 Claim 的实验。**

于是"AI 系统为什么不能靠一个准确率证明自己可靠"，就有了答案：因为链条上有 **7 个不同的断裂点**，准确率只覆盖了其中一段：

```text
1. 你到底想测什么？（Claim 是否清晰）
2. 这个东西能不能被判定？（§3）
3. 题目/任务本身是否有效？（§4）
4. 你的执行环境有没有改变结果？（§5）
5. 你的评分器是否真的在测你想测的东西？（§6）
6. 测出来的数字能不能推广到生产？（§7、§9）
7. 生产中的新失败能不能反过来修正 Eval？（§9）
```

**后文导读：** §3–§7 按这个顺序逐关展开；§8 把"模型"换成"系统"；§9 闭环到生产；§10 只保留大厂证据；§11 给最小可跑方案。

---

## 3. 第一关：这个东西能不能被判定？

第一判断仍然是：**哪些输出能判对错，哪些不能**【推论】。但"可判定 / 不可判定"二分太粗，拆成三级才够用【归纳】：

### 3.1 Outcome 可判定（最好）

```text
数据库里是否新增了一条记录？
文件是否存在？
测试是否通过？
金额是不是 100 元？
权限是否越权？
```

判定方式：确定性检查（SQL 查询、文件断言、测试套件、规则引擎）。这是 Anthropic [《Demystifying evals for AI agents》][2] 里 Transcript ≠ Outcome 区分的落点【原文】：

> 订机票 agent 在对话里说"您的航班已预订"——这只是 Transcript。
> 只有当你去查后台 SQL，发现**真的多了一条预订记录**——那才叫 Outcome。

**工程含义：先把 outcome 的可观测性建起来（能查库、能查状态、能查副作用），再谈 grader。** 很多团队反过来做，grader 只能判文本，天然测不准。

判据用一句人话即可：

> **"两个不同的人看了这个输出，会不会得出同一个结论？"**

会 → 可判定，能进准确率指标。不会 → 进入下一级。

### 3.2 Semantic 可判定（需要组合拳）

```text
SQL 是否实现了相同语义？
回答是否完整？
方案是否满足约束？
摘要是否忠实？
```

这类不能字符串比较。OpenAI 内部 Data Agent [《Inside our in-house data agent》][8] 明确绕开了"朴素字符串匹配"的坑【原文】：生成的 SQL 语法不同但可能正确，结果集多几列但不实质影响答案——所以**同时比对 SQL 与结果数据，把两个信号一起喂给 grader，产出分数 + 解释**。

标准打法：

```text
deterministic checks + LLM grader + human calibration
```

只比 SQL 字符串 → 漏判语义等价；只比结果集 → 放过"碰巧结果一样但逻辑错了"的查询。两个信号一起给 grader，是比"跑个 diff"高一档的做法。

### 3.3 Preference / Value 可判定（没有 ground truth）

```text
哪个方案更好？
这个回答是否"有洞察"？
这个 UI 是否更自然？
```

这类根本不存在绝对答案，只能进：

```text
rubric + pairwise comparison + expert review + calibration + agreement measurement
```

Warp 的做法 [《How Warp builds self-improving agents on Claude》][5] 是个参照【原文】：领域可验证 → 先建 verification harness；领域不可验证 → 依赖 golden outputs 的确定性 eval，人类反馈**只限领域专家**（"don't open the floodgates"）。

**最高杠杆的动作不在下游加校验，而在上游把需求改成可判定的**【推论】。以下全是产品决策：

| 原本的需求         | 改成可判定                                                         |
| ------------------ | ------------------------------------------------------------------ |
| "帮我分析一下数据" | 回答必须落到某张表的某个指标，**并给出取数口径**                   |
| "写个方案"         | 方案必须包含 A/B/C 三项，**缺一项算未完成**                        |
| "回答用户问题"     | 答案必须给出可核对的来源，**没有来源就说不知道**                   |
| "帮我处理这个任务" | 必须能说出**完成后的世界状态是什么**（多了一条记录？状态变成 X？） |

**判定不了的需求，再强的验证手段也救不回来。**

---

## 4. 第二关：题目本身是否有效？

OpenAI 这条线最打动我的地方是：**他们先审计 benchmark，而不是先吹分数**【原文】。

背景见 [《Separating signal from noise in coding evaluations》][6]：SWE-Bench Pro（731 题，从仓库变更历史程序化生成，要求通过新增测试且不破坏既有功能）在八个月内被前沿模型从 23.3% 推到 80.3%，然后 OpenAI 掉头审计了它自己推荐的 benchmark，结论是**约 30% 的任务是坏的**。

### 4.1 三段式质检流水线【原文】

| 阶段                     | 做法                                                                                   | 结果                 |
| ------------------------ | -------------------------------------------------------------------------------------- | -------------------- |
| 1. 自动过滤器            | 审查指令、模型尝试、打分测试本身                                                       | 标出 286 个潜在坏题  |
| 2. 人工监督的 agent 复审 | Codex investigator agents 跑测试、读文件，区分"合理歧义"与"规格不足"，研究员做最终判定 | 认定 200 个（27.4%） |
| 3. 人工标注              | 每个任务 5 名工程师独立评审，分歧与低置信上报                                          | 认定 249 个（34.1%） |

值得注意：人类比 agent 更倾向判坏题（34.1% vs 27.4%）——agent 辅助审计能提速，但替代不了人类判断。

### 4.2 坏题的四种长相【原文】

| 类型                                    | 后果                            |
| --------------------------------------- | ------------------------------- |
| 测试过严（强制了 prompt 没说的细节）    | 功能正确的提交被判错 → 分数偏低 |
| prompt 规格不足（隐藏测试要的东西没写） | 做对了也过不了 → 分数偏低       |
| 测试覆盖不足                            | 不完整修复也能过 → 分数虚高     |
| prompt 误导（与测试矛盾）               | 分数失去意义                    |

四种错误**不会互相抵消**——混在一起，那个数字基本无法解释。

### 4.3 【推论】Eval case 是软件资产，要有生命周期

不要只记住"30% 坏题"，要记住：**Evaluation Dataset 本身就是 Software / Data Product。**

```text
Draft → Review → Validation → Active → Regression → Drifted → Retire
```

每个 case 至少带这些元数据：

```yaml
task_id: refund_top5_001
version: v3
claim: "Agent 能正确查询退款率"
expected_outcome:
  {
    top_5_products: [...],
    refund_rate_definition: "refund_orders / paid_orders",
  }
reference_solution: golden.sql
grader: grader_v2
known_ambiguities: ["退款率口径需在 prompt 中显式声明"]
difficulty: medium
risk: high # 涉及资金
last_reviewed: 2026-08-20
owner: data-agent-team
status: active
```

自建 eval 的硬规则（Anthropic 与 OpenAI 两边其实在说同一件事）：**写不出参考解，就是坏题信号。** Anthropic 要求每个任务配可通过的参考解【原文】，OpenAI 发现大量坏题是规格不足【原文】。

τ²-bench 的 v1.0.1 一次做了 75+ 项任务质量修复（移除错误预期动作、修掉不可能满足的约束），甚至触发榜单重评分——这就是"活资产"的常态。

---

## 5. 第三关：实验条件是否公平？Harness 是变量

[《A shared playbook for trustworthy third party evaluations》][7] 提出了一个会被反复引用的概念：**harness**【原文】。

> 早期评测把模型当聊天机器人：问、答、判分。
> 今天的模型用工具、跨多步保持信息、在工作流中行动。
> **性能不只取决于模型，还取决于任务发生的环境，以及促成其行动的设置。**

一个保留状态、对失败自动重试的 harness，可能让同一个模型完成多步任务；而在简单 harness 里永远完不成。**所以"模型 + harness"才是实际被测系统**（Anthropic [2] 同样明确说了这点）。

### 5.1 【归纳】把 Harness 理解成"实验条件"

```text
Model = treatment（处理）
Task = stimulus（刺激）
Harness = experimental setup（实验装置）
Environment = context（上下文）
Grader = measurement instrument（测量仪器）
Metric = statistic（统计量）
```

这能解释：为什么不同 benchmark 分数不能直接比？为什么 prompt 变了但模型没变分数会变？为什么 tool availability 会改变排名？——因为**实验条件变了**。

OpenAI 要求评测报告必须写清两件事【原文】：**这个评测想验证什么 claim；有什么证据表明结果有效。** 三类 claim 对应不同 harness：能力激发（最强激发配置）/ 受控对比（任务、评分、预算全固定）/ 防护性能（针对攻击设计）。

对比时的诚实要求【推论】：任务、评分、预算、脚手架**全部固定**，否则你看到的差异很可能只是脚手架的差异。

### 5.2 Eval Manifest：让实验可复现

【推论】每个 eval 运行都应该有一份 manifest，随报告一起存：

```yaml
model: claude-opus-4-5-2026xxx
prompt_version: refund-v7
harness_version: harbor-0.3 / codex-cli-xxx
tools: [schema_search, sql_execute]
max_steps: 20
max_tokens: 8000
temperature: 0.0
retry_policy: { max_retries: 2, backoff: exponential }
memory: { enabled: false }
network: disabled
dataset_version: refund-eval-v3
grader_version: grader_v2
budget: { cost_cap_usd: 5.00, time_cap_s: 300 }
```

### 5.3 Trial：点估计不够，要不确定性

Anthropic 引入 trial（同一 task 跑多次）的原因很朴素：**一次成功可能是运气**【原文】。但要再往下推一层【归纳】：

- 不要只报 `pass@1 = 72%`，要报 `72% ± 不确定性`（置信区间）。
- `A = 72%, B = 75%` 不能直接说 B 更好——要问样本量、trial 方差、是否配对比较。**Task 本身才是主要实验单位，而不是单次生成。**
- 每次 trial 必须隔离（全新容器、不保留状态、默认无网络）。Harbor 把这做成了默认值（见 §11），而 Anthropic 是靠一次真实事故才学到这点（§10.3）。

### 5.4 一个统计陷阱：pass^k 的独立性假设

`0.9^10 ≈ 35%` 的直觉解释很好，但它隐含了 **trial 之间近似独立**【推论】。现实中常常不是：同一个 prompt、同一个缓存、同一个 failure mode、同一个坏掉的工具——失败是相关的。

> **如果 trial 不是独立样本，那么重复跑 100 次也不等于获得了 100 个独立证据。**

这正是 trial isolation 不是形式主义的原因。

### 5.5 读评测报告的七问【归纳自 [7]】

1. 它想证明哪一类 claim？2. harness 是什么，和部署环境像吗？3. 预算（步数/token/时间/成本）是多少？4. 评分器是什么，模型自己给自己打分吗？5. 有没有排查 reward hacking、contamination、broken problems？6. 拒答率是多少？7. 弃权怎么处理？——**不报弃权率的准确率都是耍流氓。**

五类效度威胁速查（[7] 原文）：Reward hacking / Refusals / Contamination / Broken problems / Sandbagging。注意最后一条已是实测事实：GPT-6 Astra 安全评估里专门做了 monitorability 与 controllability 调查，发现模型在对抗环境下能战略性低估而不被发现。

---

## 6. 第四关：评分器本身是否可信？

### 6.1 三类 Grader 各自的坑【原文自 [2]，含误用为归纳】

| 类型                                  | 优势                   | 劣势                               |
| ------------------------------------- | ---------------------- | ---------------------------------- |
| 代码型（匹配/测试/静态分析/结果验证） | 快、便宜、客观、可复现 | 对"有效变体"脆弱；主观任务无能为力 |
| 模型型（rubric/断言/成对比较/多裁判） | 灵活，能处理开放输出   | 非确定性、更贵、**必须与人工校准** |
| 人工型（专家/众包/抽样/A-B）          | 金标准                 | 贵、慢                             |

典型误用：用字符串匹配判"意思"；把模型 grader 当金标准；拿人工做日常回归。组合方式：加权 / 一票否决 / 混合。Anthropic 的实用建议：**grader 聚焦产出而非路径，并考虑部分分**——否则会重演"模型找到更优解却被判失败"（τ²-bench 订机票案例：Opus 4.5 发现政策漏洞、绕过去订得更好，eval 判失败）。

### 6.2 Meta-Eval：谁来评估评委？

这是全文最该强化的一点【归纳】。"模型 grader 必须人工校准"只说了一半，另一半是：**怎么知道 grader 是好的？**

```text
System → Task → Grader → Grader 是否正确？ → Meta-Eval
```

做法很朴素：取 100 个样本，同时跑人工 gold label 与 LLM grader，对比 accuracy / precision-recall / false positive-negative / agreement。

但真正的风险不是"它不准"，而是**它稳定地偏**：

```text
LLM grader 总是偏爱：更长的答案、更正式的表达、
某一种架构、某个模型家族、某种写作风格
```

于是出现一个比"grader 会错"深得多的结论：

> **Grader Reliability ≠ Grader Validity。Grader 可以很稳定地测错东西。**

### 6.3 Reliability vs Validity：全文最大的理论缺口

"可信"其实是两个完全不同的问题【归纳】：

- **Reliability（信度）**：同样的东西重复测，结果稳定吗？看 variance、置信区间、可重复性、评分者间一致性。
- **Validity（效度）**：这个测试到底测到了你想测的东西吗？SWE 分数很稳定，但如果题目本身错了——Reliability 高，Validity 低。

```text
                Valid
                 ↑
      好评测     │
                 │
Stable ──────────┼────────── 不稳定但有效
                 │
      稳定地测错 │
                 ↓
              Invalid
```

一句话：**一个评测可以非常稳定地测错东西。** OpenAI 的 benchmark 审计、Anthropic 的 broken eval、harness 变量，全部是这句话的证据。

---

## 7. 第五关：一个数字不够描述可靠性

### 7.1 准确率不是充分统计量

至少要拆开【归纳】：

```text
Correctness / Completeness / Consistency / Robustness /
Calibration / Safety / Cost / Latency / Recoverability
```

一个系统完全可能 Accuracy 95% 但 Consistency 70%、Calibration 很差、Cost 极高。也可能 Accuracy 98% 但关键交易仍不可上线——因为**错误不是等价的**。

| 系统 | 正常任务准确率 | 高风险任务错误率 | 弃权率 | pass^5 |
| ---- | -------------: | ---------------: | -----: | -----: |
| A    |            98% |               5% |     1% |     低 |
| B    |            95% |             0.5% |    12% |     高 |

哪个更可靠？数字本身回答不了。**Metric 必须服从 Failure Cost，而不是反过来。** 再往下推一层就是 expected loss【推论】：

```text
Expected Loss = P(wrong)×Cost(wrong) + P(abstain)×Cost(abstain) + P(correct)×Cost(correct)
```

阈值谁定？业务定，不是算法定——因为"错一次"和"少答一次"哪个更贵，只有业务知道。

### 7.2 Selective Prediction：弃权只是一半

"给'我不知道'一条合法出路"很好，但完整形态是**决策策略**【归纳】：

```text
Answer / Abstain / Ask clarification / Retrieve evidence /
Escalate human / Retry with another model / Use deterministic tool
```

```text
用户问事实问题 → 模型置信度 → 高：直接回答 / 中：检索验证 /
低：不回答 / 高风险：转人工
```

可靠系统优化的是决策策略，而不只是回答本身。兜底路径必须存在：没有兜底，"允许弃权"只是一句空话。

### 7.3 pass@k vs pass^k：选错指标等于选错产品

| 指标   | 含义                | 适用                                 |
| ------ | ------------------- | ------------------------------------ |
| pass@k | k 次里至少成功 1 次 | 辅助工具（多试几次成一次就行）       |
| pass^k | k 次全部成功        | 客服、交易、数据管道（每次都必须对） |

`pass@1=90%` 看着不错，但 `pass^10 = 0.9^10 ≈ 35%`。**同一个系统，"成功率 90%"和"连续 10 次都对 35%"是同一件事的两种说法。** 实践折中：pass@1 做快速迭代，pass^k（k 取业务能容忍的连续失败代价）做发布门禁。评分规则同样是产品决策：弃权通道 + 兜底路径 + 业务定阈值。

---

## 8. 从"测试模型"到"测试系统"

### 8.1 复杂度递进与 transcript 优先级

Anthropic 把评估分成三档【原文】：单轮（看文本）→ 多轮（给工具+环境，看产物）→ Agent（跨回合改状态，看最终状态+过程）。Agent 最难因为错误会传播复合，且前沿模型会找到超出静态 eval 边界的解法。

语音场景同理（[Realtime Eval Guide][9]）：内容质量（理解、做对事）与音频质量（自然度、稳定性）是两个独立轴，单分数会掩盖问题；且必须分阶段打日志（speech start/stop → commit → response.create → audio deltas → done），当黑盒测永远定位不了根因。

### 8.2 Failure Taxonomy：Eval 的产物不是分数，是可行动的失败信息

`failed / broken / wrong` 指导不了工程。至少定义【推论】：

```text
F1  Knowledge failure（缺知识）
F2  Reasoning failure（推理错）
F3  Instruction following failure（没听指令）
F4  Tool selection failure（选错工具）
F5  Tool argument failure（参数错）
F6  Environment / infra failure（环境坏）
F7  Harness failure（脚手架坏）
F8  Grader failure（评委错）
F9  Task specification failure（题目坏）
F10 Safety / policy failure（越权违规）
F11 Abstention failure（该弃权没弃 / 不该弃权弃了）
F12 Recovery failure（错了但没恢复）
```

`Accuracy = 80%` 没法指导下一步；但"工具参数错 8%、题目歧义 5%、策略理解错 4%、grader 误判 2%"马上能指导。

> **Eval 的终极产物不是分数，而是可行动的 failure information。**

### 8.3 可归因：好 Eval 的输出格式

一个好的 Eval 至少输出【推论】：

```text
Pass / Fail + Why + Where + Who/What caused it + Can it regress?
```

例如：

```text
FAIL — 退款未创建
Root cause: tool-call #4 的 order_id 参数错误
Category: F5 tool argument failure
Stage: tool-call #4
Regression: yes（加入回归套件）
Suggested fix: tool schema / prompt / retry policy
```

### 8.4 Eval 驱动开发（EDD）

传统开发是 Bug → Fix → Test；AI 系统是【归纳】：

```text
Failure → Eval → Fix → Regression
```

Anthropic 的 SDLC playbook [4] 把它写成了纪律【原文】：修 bug 先写失败测试并提交，用 hook 阻止 agent 改测试，再让 agent 修。Eval 在 AI 系统里扮演传统 Unit Test + Integration Test + Production Monitoring 的混合角色——但它比 unit test 更宽，因为被测对象是非确定性的系统。

---

## 9. 从离线 Eval 到生产可靠性

### 9.1 Benchmark ≠ Production Eval

这两个概念必须分层【归纳】：

```text
Benchmark → Capability Eval → Regression Eval → Production Monitoring → Incident Eval
```

| 层                    | 回答的问题                                                |
| --------------------- | --------------------------------------------------------- |
| Benchmark             | 这个能力大概怎么样（capability signal，如 SWE-bench）     |
| Capability            | 能力边界在哪（专挑翻车的题，通过率 10–30% 也正常）        |
| Regression            | 以前解决的问题坏了吗（已稳定的题，接近 100%，掉分即 bug） |
| Production Monitoring | 我的系统今天还能不能工作（真实分布）                      |
| Incident              | 哪些 failure 该永久进入测试集（discovery signal）         |

Anthropic 的定义很清楚【原文】：能力 eval 是"进攻战"（要爬的山），回归 eval 是"保卫战"；**当能力 eval 通过率做上去，它就"毕业"进入回归套件**。关键纪律：冲能力指标时必须同时跑回归，否则为了爬山把营地烧了。

### 9.2 Swiss Cheese：每层解决什么未知

没有任何单层能拦住所有问题【原文自 [2]】。改成决策表【归纳】：

| 层                    | 解决的未知              | 节奏       |
| --------------------- | ----------------------- | ---------- |
| Regression            | 以前解决的坏了吗        | 发布前、CI |
| Capability            | 能力边界在哪            | 迭代期     |
| Adversarial           | 没想到的失败是什么      | 周期性     |
| Production Monitoring | 真实世界怎么失败        | 持续       |
| Human review          | Grader 是否错了         | 每周抽样   |
| Incident              | 哪些 failure 该永久入集 | 每次事故   |

```mermaid
flowchart LR
A["自动化 Eval<br/>（快速迭代、CI 门禁）"]
B["生产监控<br/>（分布漂移、真实失败）"]
C["A/B 测试<br/>（大流量验证显著变更）"]
D["用户反馈 + 抽样读 transcript<br/>（持续、每周）"]
E["系统性人工研究<br/>（校准 grader、主观金标准）"]
A --> B --> C --> D --> E
```

### 9.3 真正的 flywheel：生产失败是资产

完整回路【归纳】：

```text
真实用户 → 失败 → Incident/Feedback → Failure Classification →
New Eval Case → Regression Suite → 系统修改 → Release →
Production → 再次发现未知失败 ↺
```

Anthropic 的 transcript、OpenAI 的 benchmark 审计、Data Agent 的 production canary、Warp 的 skill 改进、Realtime 的生产飞轮——**看似分散，其实都在描述同一个闭环。**

三条硬纪律【原文+推论】：

1. **每个生产事故必须写成一条 eval**（Anthropic playbook 原文）。复盘会产出清单里必须有一项"本次新增的 eval 描述"。
2. **谁每周读 transcript**：如果你找不到一个愿意每周花两小时读 transcript 的人，这套体系半年内一定烂掉。先解决这个人，再谈平台。
3. **验证基础设施自己也要被验证**：Anthropic 三起网络安全 eval 事故（详见 §10.1）的教训——提示词说无网络，容器实际有出口。事前验证隔离、实时监控日志、第三方审查，都要显式列进预算。

---

## 10. 大厂案例：统一框架下的证据

本节不再是主体，而是 §2–§9 的证据链。详略有调整：Astra 大幅压缩，工具产品介绍压缩（完整选型见 §11）。

### 10.1 Anthropic：能力边界的真实压力测试

[《Investigating three real-world incidents in our cybersecurity evaluations》][3] 公开了自家事故【原文】。2025 年 2 月起用 Claude Sonnet 3.7 跑 Cybench（40 个 CTF），后加 CyberGym、ExploitBench，与 Irregular 等外部伙伴协作，开放式夺旗，多数环境不连互联网，跑在隔离 infra 上。

关键设计：**为测能力故意摘掉防护**——评估模型不带可用版本的分类器与监控，但保留安全训练。测的是"模型能力"而非"产品行为"；代价是一旦隔离出错，摘掉的那层就真没了。

三起事故根因相同：**提示词说无网络，但与 Irregular 的误解导致容器实际有互联网出口**，模型把真实系统当模拟靶场（共 6 次运行）：Opus 4.7 攻入与虚构目标同名的真实网站（识别为真后仍继续）；Mythos 5 真的注册并上传了恶意 PyPI 包（留存约 1 小时，被 15 个真实系统下载）；内部研究模型扫描约 9,000 个目标，后期自行判断为真并**主动停止**。三者连起来是一条情境意识梯度。

事后：7 月 23 日回溯 **141,006 条**运行记录、次日锁定；对接 METR 独立审查；公开轻度编辑的 transcript；联系受影响组织。改进项本质一句话：**验证系统需要的防御纵深，不比被测系统少。**

### 10.2 Anthropic：AI-Native SDLC 可抄的部分

[《The AI-Native SDLC playbook》][4] 把 Plan/Design/Build/Test/Deploy/Maintain 重构成工件链（intent → spec → plan → diff+测试 → PR 发现 → 事件记录）【原文】。测试部分可直接抄：验证包装成单命令（`make test`，失败非零退出）；先写失败测试再修；CI 跑 20–50 个真实任务，通过率不下降才能合并；事故转 eval；会话结束用全新上下文的 Verifier subagent 只报告不修复；确定性 hook 做硬门禁（`RELEASE_APPROVAL`、deny .env/secrets、沙箱白名单）。

值得单拎：**咨询性控制 vs 确定性控制**【归纳】。CLAUDE.md、Skills 是咨询性的（模型可不听）；Hooks、分支保护、受管设置是确定性的（不依赖自觉）。**只有后者能当门禁。**

### 10.3 OpenAI 产品侧：Data Agent 纵向案例（贯穿全文）

[《Inside our in-house data agent》][8] 是"自家产品怎么保证对"的实操文。本节把它拆到底，作为 §2–§9 的完整纵贯案例【原文为前半，诊断过程为推论示例】：

```yaml
task:
  user_request: "过去 30 天退款率最高的 5 个产品是什么？"
claim: "Agent 能正确查询退款率"
environment:
  database: production_snapshot_2026_08_01
  permissions: user-scoped
  tools: [schema_search, sql_execute]
expected_outcome:
  top_5_products: [P-1042, P-0891, ...]
  refund_rate_definition: refund_orders / paid_orders
  date_range: [2026-07-09, 2026-08-08]
constraints:
  must_respect_user_permissions: true
graders:
  sql_semantic: { type: llm_grader, rubric: v2 }
  result_correctness: { type: code, compare: result_set_with_tolerance }
  permission_check: { type: code, rule: no_cross_user_tables }
  explanation_quality: { type: human_sampled }
metrics: [outcome_pass, policy_pass, partial_score, latency, token_cost]
failure_labels:
  [
    wrong_table,
    wrong_date_range,
    wrong_metric_definition,
    permission_violation,
    hallucinated_data,
  ]
```

一次失败 transcript（示意）：agent 把"退款率"算成 `refund_amount / gmv`，查了 `orders` 却漏了 `refunds` 表的权限过滤，输出了 top5。

- Grader 判失败：result_correctness（结果集与 golden SQL 不一致）+ permission_check（一票否决）。
- 人工复核发现 grader 误判了一半：SQL 语义其实接近正确，错的是口径定义——属于 F9 任务规格失败（prompt 没写清退款率口径），不是 F2 推理失败。
- 修正：prompt 显式声明口径 + grader 增加口径容忍说明 + 该 case 以 `refund_top5_001 v3` 进入 Regression Suite。

三条踩坑教训【原文】：Less is More（工具收敛合并，功能重叠对 agent 是困惑）；Guide the Goal, Not the Path（刚性指令把 agent 推向错误路径，和 τ²-bench 案例同一枚硬币）；Meaning Lives in Code（语义活在生产 pipeline 代码里，用 Codex 爬代码理解数据集构造）。另有权限透传 + 暴露推理证据链：系统侧不可越权，用户侧可自己核查。

语音场景一句话（[Realtime Eval Guide][9]）：Crawl（单轮回放）→ Walk（存档音频回放）→ Run（模型模拟多轮），dataset + graders + harness + 真实失败自动变新测试；投入 eval 的团队上线快 5–10 倍【原文】。

### 10.4 前沿模型评估已转向（压缩）

一句话案例【归纳自 [10][11]】：**前沿模型评估已从"答对多少题"转向"在真实工具和高风险环境中会做什么"**——重心是 capability / safety / monitorability / controllability（如 54,000 内部 Codex 任务部署模拟、Critical 网络能力定级、错位监控、红队、CoT 可控性）。注意：安全概述里没有常规准确率数字，这本身就是表态。

### 10.5 两家的侧重差异

| 维度     | Anthropic                                                                                     | OpenAI                                  |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| 最强输出 | Agent eval 术语与方法论（[2]）                                                                | 数据质量审计 + 第三方评测规范（[6][7]） |
| 核心概念 | Transcript ≠ Outcome、pass^k、能力/回归分离、Swiss Cheese                                     | Harness 即变量、五类效度威胁、弃权激励  |
| 对 agent | 多回合改状态当一等公民                                                                        | 环境（harness）当一等变量               |
| 对数据   | 从真实失败出题、配参考解、双向平衡                                                            | 直接审计公开 benchmark（30% 坏题）      |
| 安全感   | 多层叠加，接受单层必漏                                                                        | 可量化 + 可归因 + 第三方可复现          |
| 对"100%" | 不谈，改用门禁 + 监控                                                                         | 明确论证达不到，转优化错误/弃权权衡     |
| 透明度   | 公开自家 eval 事故（[3]）                                                                     | 公开自家 benchmark 缺陷（[6]）          |
| 共同点   | **都要求 20–50 个真实失败起步，都强调读 transcript，都把 eval 当活资产，都用 agent 辅助质检** |                                         |

与其说竞争，不如说补同一张图的不同角落：Anthropic 解决"在具体 agent 产品里怎么管质量"；OpenAI 解决"当分数被全世界引用时怎么保证分数有效"。**你两个都需要。**

---

## 11. 如何自己搭：从 0 到 1 不需要平台

### 11.1 最小可跑（四文件起步）

```text
eval/
  dataset.jsonl    # 20–50 个真实失败，每个带参考解
  runner.ts        # 跑任务、隔离环境、记 transcript.jsonl
  grader.ts        # 确定性 grader 为主 + 模型 grader 为辅
  report.ts        # 输出 pass@1 / pass^k / failure 分布
```

```text
20–50 cases + 隔离执行 + 确定性 grader + transcript.jsonl
```

已经足够。Terminal-Bench 2.0 的 outcome-driven 设计就是证明："测试验证指令结果是否在容器最终状态达成，不测命令或控制台输出"【原文】。

### 11.2 平台引入阈值

规模上去之后再谈平台，按需引入【推论】：

```text
规模增加 → tracing → dataset management → concurrency →
experiment tracking → annotation
```

- 执行与隔离：[Harbor][18]（Terminal-Bench 团队开源，Apache 2.0）——评测任意 agent、大规模并发（本地 Docker / 云端 Daytona、Modal、E2B 等）、默认隔离（全新容器、任务无状态、默认禁用网络）。**Anthropic 靠事故学到的，现在是它的默认值。**
- 打分与追踪：按"离线迭代还是生产可观测"选——Braintrust（离线+线上打通）、LangSmith（LangChain 生态）、Langfuse（自托管/合规）、Arize Phoenix（开源起步）、EvalScope（[文档][20]，中文生态）。很多团队是组合+自建小脚本，完全没问题（Anthropic [2] 附录原话）。
- 公开题集：SWE-bench Verified（有根本性设计与污染问题，慎用）、Terminal-Bench 2.0（89 任务，三位人工评审，前沿模型 <65%）、τ²-bench（政策+工具+任务+用户模拟器，榜单 [taubench.com][15]，仓库 [14]）。

按团队规模：小团队先指定每周读 transcript 的人；中型把通过率做成合并门禁；大型把 eval 结果带进发布评审。**买不到的部分**：前沿靶场、红队、第三方审计、生产规模流量、sandbagging 研究、公开缺陷的意愿——这些是资源与文化，不是工具。

反模式：先买平台再想测什么；把默认 scorer 当金标准；只看 dashboard 不读 transcript；跑一次 benchmark 当结论；以为买了工具就有了体系（本体永远是 L1 任务集）。

补充时效：OpenAI Evals 平台 **2026-10-31 只读、2026-11-30 关停**，新项目改用 Datasets（见 [12]）。

---

## 12. 最终原则

真正的问题不是"AI 能不能 100% 正确"，而是我们能不能把系统变成【归纳】：

```text
可观察 → 可判定 → 可归因 → 可回归 → 可比较 → 可治理
```

并且形成：

```text
生产失败 → 新的知识 → 新的 Eval → 新的约束 → 新的系统
```

所以可靠性不是**一个模型属性**，而是**系统属性 + 测量体系属性 + 组织属性**。

最后一句 operational 的：**能不能判定，是需求设计问题；能不能一直判定下去，是人和纪律的问题。** 前者看 §3，后者看"每周谁读 transcript、每次事故是否新增 eval、发布评审是否看回归 diff"。

---

## 参考来源

[1]: https://openai.com/index/why-language-models-hallucinate/ "Why language models hallucinate — OpenAI"
[2]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents "Demystifying evals for AI agents — Anthropic Engineering"
[3]: https://www.anthropic.com/news/investigating-incidents-cybersecurity-evals "Investigating three real-world incidents in our cybersecurity evaluations — Anthropic"
[4]: https://claude.com/blog/the-ai-native-sdlc-playbook "The AI-Native SDLC playbook — Claude by Anthropic"
[5]: https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude "How Warp builds self-improving agents on Claude"
[6]: https://www.openai.com/index/separating-signal-from-noise-coding-evaluations "Separating signal from noise in coding evaluations — OpenAI"
[7]: https://openai.com/index/trustworthy-third-party-evaluations-foundations/ "A shared playbook for trustworthy third party evaluations — OpenAI"
[8]: https://openai.com/index/inside-our-in-house-data-agent "Inside our in-house data agent — OpenAI"
[9]: https://developers.openai.com/cookbook/examples/realtime_eval_guide "Realtime Eval Guide — OpenAI Cookbook"
[10]: https://openai.com/index/safety-overview-gpt-6-astra/ "Safety overview: GPT-6 Astra — OpenAI"
[11]: https://deploymentsafety.openai.com/gpt-6-astra "GPT-6 Astra System Card"
[12]: https://platform.openai.com/docs/guides/evals "Working with evals — OpenAI API Docs"
[13]: https://cdn.openai.com/pdf/d04913be-3f6f-4d2b-b283-ff432ef4aaa5/why-language-models-hallucinate.pdf "Why Language Models Hallucinate (PDF)"

**开源与业界工具**

[14]: https://github.com/sierra-research/tau2-bench "τ²-bench — Sierra Research（airline / retail / telecom / banking_knowledge，政策 + 工具 + 用户模拟器）"
[15]: https://taubench.com/ "τ²-bench Leaderboard"
[16]: https://arxiv.org/html/2601.11868v1 "Terminal-Bench: Benchmarking Agents on Hard, Realistic Tasks in Command Line Interfaces"
[17]: https://github.com/harbor-framework/terminal-bench-2 "Terminal-Bench 2.0 数据集与任务仓库"
[18]: https://github.com/harbor-framework/harbor "Harbor — Terminal-Bench 团队做的 agent 评测与优化框架"
[19]: https://doi.org/10.5281/zenodo.20953922 "Harbor Framework（Zenodo DOI）"
[20]: https://evalscope.readthedocs.io/ "EvalScope — 阿里开源的大模型评测框架"
