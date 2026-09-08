可以，而且我建议你把这一节从现在的“几个平台推荐”升级成一份**按 Eval 工作层次分类的工具地图**。你当前 §11 只有 Harbor、Braintrust、LangSmith、Langfuse、Phoenix、EvalScope，以及几个 benchmark；范围还明显不够。

现在的生态已经可以拆成至少 **8 类**。下面这些值得加入。

## 建议新增的工具全景

| 层                          | 工具                              | 类型     | 最适合解决什么                                                 |
| -------------------------- | ------------------------------- | ------ | ------------------------------------------------------- |
| 通用 LLM Eval                | **DeepEval**                    | OSS    | pytest 风格、CI、LLM/Agent/RAG evaluation                   |
| 通用 LLM Eval                | **Promptfoo**                   | OSS    | Prompt/model A/B、回归、red-team、安全测试                       |
| 通用 LLM Eval                | **Ragas**                       | OSS    | RAG、Agent、Text-to-SQL、LLM testing                       |
| 通用 LLM Eval                | **Inspect AI**                  | OSS    | Frontier / agent / safety / reasoning / multimodal eval |
| Foundation Model Benchmark | **lm-evaluation-harness**       | OSS    | 标准 benchmark、模型能力测评                                     |
| OpenAI 风格轻量 Eval           | **OpenAI Evals / simple-evals** | OSS    | benchmark / reference implementations                   |
| Grader Library             | **AutoEvals**                   | OSS    | 可直接复用 LLM-as-a-judge / heuristic graders                |
| Observability + Eval       | **Arize Phoenix**               | OSS    | tracing、datasets、experiments、eval                       |
| Observability + Eval       | **Opik**                        | OSS    | tracing、evaluation、prompt、production monitoring         |
| Observability + Eval       | **TruLens**                     | OSS    | feedback functions、online evaluation                    |
| Observability + Eval       | **W&B Weave**                   | OSS/平台 | tracing、experiment、evaluation                           |
| Agent / Sandbox Harness    | **Harbor**                      | OSS    | agent sandbox、benchmark 执行、并发                           |
| Workflow / App Eval        | **Microsoft Prompt Flow**       | OSS/平台 | flow、testing、evaluation、CI/CD                           |
| Enterprise Eval            | **Microsoft Foundry**           | 商业     | model/agent/dataset/trace evaluation                    |
| Enterprise Eval            | **AWS Bedrock Evaluations**     | 商业     | model/RAG/end-to-end evaluation                         |
| Enterprise Eval            | **Galileo**                     | 商业     | eval engineering、failure analysis、guardrail             |
| Enterprise Eval            | **Confident AI**                | 商业     | DeepEval 的生产 observability/eval                         |
| RAG 专用                     | **UpTrain**                     | OSS/平台 | RAG/LLM quality evaluation                              |
| AI Safety                  | **Inspect AI**                  | OSS    | safety/frontier evaluations                             |
| Red Team                   | **Promptfoo**                   | OSS    | adversarial testing / red teaming                       |
| Red Team                   | **Giskard**                     | OSS    | agent testing / red teaming / vulnerability scanning    |

这个分类比单纯列“10 个 Eval 平台”更适合你的文章，因为它直接对应你前面建立的：

```text
Task
→ Harness
→ Observation
→ Grader
→ Metric
→ Production
```

---

# 1. DeepEval：应该放在你文章的核心推荐里

这是目前最值得补上的一个。

DeepEval 的定位非常接近：

> **“Pytest for LLM apps”**

它提供大量 evaluation metrics，并且可以作为测试体系的一部分运行；同时已经覆盖 LLM、RAG、conversation、agent 等场景。当前项目本身是 Apache-2.0。([GitHub][1])

你的文章可以写：

> **DeepEval：偏“测试框架”路线**
>
> 如果你的目标是把 Eval 当成软件测试来写，DeepEval 是最接近 `pytest` 思维的选择：测试用例、metric、CI gate 都是一级对象。它更适合作为 L3 Grader + Regression 的开发框架，而不是完整的生产 observability 平台。

尤其适合对应你的：

```text
Failure
→ Eval
→ Fix
→ Regression
```

---

# 2. Promptfoo：必须单独列出来

Promptfoo 和 DeepEval 不应该放成同一种工具。

它非常适合：

```text
Prompt A
Prompt B
Model A
Model B
Attack A
Attack B
```

做矩阵比较。

更关键的是，它有专门的 red-team 工作流：

```text
redteam init
→ redteam run
→ redteam report
```

并支持插件、攻击策略、CI 中记录 run context。([GitHub][2])

所以你的文章可以把它定义为：

> **Promptfoo：Prompt / Model Regression + Red Team 工具**

尤其对应你前面的：

```text
Regression
Adversarial
Harness
```

而不是简单写成“另一个 LLM Eval Framework”。

---

# 3. Ragas：不要只写成“RAG 工具”

你现在已经提到了 RAG，但 Ragas 的覆盖实际上已经比过去广。

官方当前 quickstart 已经包含：

```text
RAG evaluation
Agent evaluation
Text-to-SQL
Workflow evaluation
Prompt evaluation
Judge alignment
Benchmarking
```

([Ragas][3])

这和你的文章尤其匹配，因为你一直在讲：

> **不同 failure mode 必须使用不同的 grader。**

Ragas 恰好可以作为一个非常好的案例：

> 不要问“哪个 Eval 框架最好”，而要问“哪个框架覆盖我的 failure surface”。

---

# 4. Inspect AI：这是我非常建议你加入的一个

这是目前你的工具清单中比较大的缺口。

Inspect 是 UK AI Security Institute 与 Meridian Labs 开发的开源 Eval framework，面向：

```text
coding
agentic tasks
reasoning
knowledge
behavior
multimodal
```

而且强调：

```text
datasets
agents
tools
scorers
```

这些 composable primitives；当前有 200+ 预构建 eval。([Inspect][4])

它特别适合你文章中的：

> **“从单轮模型评测进入 frontier / agent evaluation”**

所以可以专门设一行：

| 工具         | 特色                                                         |
| ---------- | ---------------------------------------------------------- |
| Inspect AI | Frontier / agent / safety eval，强调可组合的 agents、tools、scorers |

而且它和 Harbor 的关系也非常好讲：

```text
Inspect
= Evaluation logic

Harbor
= Execution / sandbox infrastructure
```

这样正好对应你的 L2/L3 分层。

---

# 5. lm-evaluation-harness：应该把它和 Agent Eval 明确分开

EleutherAI 的 `lm-evaluation-harness` 仍然是 foundation model benchmark 领域非常重要的开源项目。

它专注：

```text
few-shot
zero-shot
standard benchmarks
multiple backends
task configs
```

并且支持 HF、vLLM、MPS 等 backend。([GitHub][5])

你可以直接给它一个定位：

> **lm-evaluation-harness：测“模型能力”的经典路线，而不是测完整 Agent 系统。**

这正好强化你文章：

```text
Benchmark ≠ Production Eval
```

---

# 6. OpenAI Evals / simple-evals：建议保留，但要区分两者

你目前已经提到 OpenAI Evals，但最好写得更准确。

`openai/evals` 本身仍然是公开 repo，定位是：

> framework + benchmark registry

用于 LLM 和 LLM systems evaluation。([GitHub][6])

但是：

`simple-evals`

官方仓库已经明确标注：

> **2025 年 7 月之后不再为新模型/benchmark 持续更新。**

它主要保留 HealthBench、BrowseComp、SimpleQA 等 reference implementation。([GitHub][7])

所以文章里不要再笼统说：

> “OpenAI Evals 是推荐的新项目。”

最好写：

> **OpenAI Evals：值得阅读其 eval schema / benchmark 实现；但项目状态与 OpenAI 当前产品化 Evals 能力要分开看。**

这会比现在严谨很多。

---

# 7. AutoEvals：非常值得补，因为它正好对应你的 Grader 层

这个工具非常符合你的：

```text
Grader
```

章节。

AutoEvals 是 Braintrust 团队开源的 grader library，包含：

```text
LLM-as-a-Judge
heuristic
statistical
factuality
safety
```

并同时支持 Python / TypeScript。([GitHub][8])

你可以把它放成：

> **AutoEvals：不要管理整个 Eval 平台，只想快速获得一组可复用 grader 时，用它。**

这是很重要的一类，因为你的文章已经明确说：

> 工具不应该和体系画等号。

AutoEvals 正好是反例：

```text
它只是 grader library
≠ 完整 eval platform
```

---

# 8. Opik：现在应该和 Phoenix、Langfuse 放在一起

你当前已经有：

> Langfuse / Phoenix

但缺了 Opik。

Opik 当前覆盖：

```text
tracing
evaluation
datasets
experiments
LLM-as-a-judge
production monitoring
pytest integration
```

而且开源、自托管。([GitHub][9])

因此你现在的：

```text
Langfuse
Phoenix
```

最好改成：

```text
Langfuse
Phoenix
Opik
```

然后区分：

```text
Phoenix → OpenTelemetry / OpenInference
Opik → tracing + eval + optimization
Langfuse → open-source observability / eval
```

不要用“谁最好”的方式排名。

---

# 9. TruLens：很适合放到你的“Measurement”部分

TruLens 的核心思路很接近：

> **Feedback functions**

你可以指定 evaluation metric 应该观察应用中的哪一部分，例如：

```text
question
context
retrieval
response
```

而且支持 online evaluation、sampling、throttling 等生产场景。([TruLens][10])

这很适合解释：

> **Grader 不是只有“给最终回答打分”，还可以绑定到 trace 中的具体组件。**

例如：

```text
Retriever
   ↓
Context
   ↓
LLM
   ↓
Tool
   ↓
Final answer
```

分别评估。

---

# 10. W&B Weave：值得加入，但定位要准确

Weave 是 W&B 的 GenAI toolkit，目前重点集中在：

```text
Tracing
Evaluation
Experiment organization
Production workflow
```

官方 repo 当前甚至明确说其 Weave evaluation code 主要在 `weave/flow`。([GitHub][11])

所以可以归到：

> **Experiment / Observability / Evaluation**

而不是 benchmark。

---

# 11. Microsoft Prompt Flow：很值得加入

Prompt Flow 其实非常适合你的：

```text
Eval → CI/CD → Production
```

它覆盖：

```text
flow orchestration
debugging
tracing
evaluation
CI/CD
deployment
monitoring
```

并且支持大数据集 evaluation。([GitHub][12])

它可以作为：

> **Workflow-oriented Eval**

与 DeepEval 形成对比：

```text
DeepEval
→ test-oriented

Prompt Flow
→ workflow-oriented
```

这是一个很有价值的区分。

---

# 12. Microsoft Foundry：值得单独做“云厂商原生 Eval”

Microsoft Foundry 现在已经不只是 model benchmark。

官方当前支持：

```text
Model evaluation
Agent evaluation
Dataset evaluation
Trace evaluation
```

以及：

```text
offline
production
full conversation
individual turn
```

并同时提供：

```text
code rules
LLM-as-a-judge
human review
pairwise comparison
```

([Microsoft Learn][13])

这实际上已经非常贴合你整篇文章的框架：

```text
Task
Dataset
Agent
Trace
Grader
Production
```

因此建议专门新增一个小节：

### Cloud-native evaluation

然后：

```text
Microsoft Foundry
AWS Bedrock Evaluations
Google Vertex AI Evaluation
```

一起比较。

---

# 13. AWS Bedrock Evaluations：应该加入

AWS Bedrock 当前支持：

```text
Foundation model evaluation
Custom/imported models
RAG evaluation
LLM-as-a-Judge
Programmatic evaluation
```

其中 RAG 可以评估 retrieval 或 retrieve+generate 全链路。([Amazon Web Services, Inc.][14])

它很适合拿来证明：

> **云厂商的 Eval 已经从“模型 benchmark”进入“应用/Agent evaluation”。**

---

# 14. Galileo：非常适合你的“Production → Eval”部分

Galileo 当前的定位已经非常明显：

> **offline eval → production guardrail**

它强调：

```text
production data
→ groundtruth
→ annotation
→ custom eval
→ guardrail
```

并覆盖：

```text
RAG
Agent
Safety
Security
Custom Eval
```

([Galileo AI][15])

而且 Galileo 特别强调从 live feedback 构建 ground truth，再把 expensive judge evaluator 压缩成更低成本的 Luna models。([Galileo AI][15])

这特别适合你文章的：

> **Eval Flywheel**

因为它不是单纯：

```text
eval → report
```

而是：

```text
production
→ feedback
→ eval
→ guardrail
→ production
```

---

# 15. UpTrain：可以作为轻量 OSS 选择

UpTrain 仍然适合放在“开源 evaluation libraries”里。

官方提供开源 Evaluator，可以记录、评估数据并输出结果。([UpTrain][16])

不过我不建议给它和 DeepEval / Promptfoo / Ragas 同等篇幅。

它更适合作为：

> **其他可选 OSS**

而不是主推荐。

---

# 16. Giskard：应该列入 Red Team

Giskard 的当前 v3 定位已经明显转向：

```text
Agent eval
Multi-turn testing
Red teaming
Test generation
RAG evaluation
```

([GitHub][17])

它特别适合放在：

> **Adversarial Evaluation / Security**

而不是普通 LLM evaluator。

你目前文章的工具部分缺一个专门的：

```text
Security / Red Team
```

分类，Giskard + Promptfoo 正好填进去。

---

# 17. Humanloop：不要加入推荐表，但应该作为“历史/退出市场”案例

这个很值得你注意。

Humanloop 文档目前明确显示：

> **平台已经于 2025-09-08 sunset。** ([Humanloop][18])

所以不要把 Humanloop 当成当前可选工具。

但从你文章的方法论来看，它反而可以成为一个很有意思的旁证：

> **Eval 产品并不只是技术问题，平台生命周期本身也是选型风险。**

不过这已经属于“工具市场观察”，不必展开。

---

# 18. Harbor 现在可以继续保留，但建议把它从“Eval Framework”单独摘出来

你现在已经把 Harbor 放在 L2，这是对的。

但是建议明确：

```text
Harbor
≠ Grader
≠ Eval Metric
≠ Benchmark

Harbor
= Execution / Sandbox / Rollout Harness
```

现在 Harbor Hub 本身已经扩展到：

```text
datasets
tasks
leaderboards
trajectories
rollouts
```

并支持发布和运行 benchmark。([Harbor Hub][19])

所以它越来越适合作为：

> **Agent Evaluation Infrastructure**

---

# 19. 你这节最终建议改成这个结构

不要继续在一个表里混所有东西。

建议直接改成：

## 11.2 开源与业界工具地图

### A. Benchmark / Foundation Model

```text
lm-evaluation-harness
OpenAI Evals
simple-evals
Inspect AI
```

### B. Application / LLM Eval

```text
DeepEval
Promptfoo
Ragas
UpTrain
```

### C. Grader / Evaluation Library

```text
AutoEvals
TruLens
```

### D. Agent Evaluation / Harness

```text
Harbor
Inspect AI
Prompt Flow
```

### E. Observability + Evaluation

```text
Langfuse
Arize Phoenix
Opik
W&B Weave
```

### F. Red Team / Security

```text
Promptfoo
Giskard
Inspect AI
```

### G. Cloud / Enterprise

```text
Microsoft Foundry
AWS Bedrock Evaluations
Google Vertex AI Evaluation
Braintrust
Galileo
Confident AI
```

这个结构和你全文现在的理论模型能直接对应起来。

---

# 20. 更重要的是：最后加一张“工具 → 你的五层模型”的映射

这一张非常值得加。

| 工具          | Task | Harness | Grader | Observability | Production |
| ----------- | ---: | ------: | -----: | ------------: | ---------: |
| DeepEval    |  ★★★ |       ★ |    ★★★ |            ★★ |         ★★ |
| Promptfoo   |  ★★★ |      ★★ |    ★★★ |             ★ |         ★★ |
| Ragas       |  ★★★ |       ★ |    ★★★ |            ★★ |         ★★ |
| Inspect AI  |  ★★★ |     ★★★ |    ★★★ |            ★★ |          ★ |
| Harbor      |   ★★ |     ★★★ |      ★ |           ★★★ |          ★ |
| Phoenix     |   ★★ |       ★ |    ★★★ |           ★★★ |        ★★★ |
| Opik        |   ★★ |       ★ |    ★★★ |           ★★★ |        ★★★ |
| Langfuse    |   ★★ |       ★ |     ★★ |           ★★★ |        ★★★ |
| TruLens     |   ★★ |       ★ |    ★★★ |           ★★★ |        ★★★ |
| Prompt Flow |   ★★ |     ★★★ |     ★★ |           ★★★ |        ★★★ |
| Foundry     |  ★★★ |     ★★★ |    ★★★ |           ★★★ |        ★★★ |
| Bedrock     |  ★★★ |      ★★ |    ★★★ |           ★★★ |        ★★★ |

这里的星级**不是工具排名**，而是“覆盖面示意”。最好在文章中明确这一点。

---

## 我最建议你重点加入的 10 个

如果不想让文章突然变成工具目录，优先加入：

**DeepEval、Promptfoo、Ragas、Inspect AI、lm-evaluation-harness、AutoEvals、Opik、TruLens、Microsoft Foundry、AWS Bedrock Evaluations。**

然后把 **Phoenix / Langfuse / Harbor** 保留为现有核心。

这样你的工具地图就从原来的：

> “几个 LLM observability 平台 + Harbor”

变成：

> **Benchmark → Eval Framework → Grader → Agent Harness → Observability → Red Team → Cloud Enterprise**

这才真正覆盖当前 Eval 工具链。尤其值得强调的是，Inspect AI、Harbor、DeepEval、Promptfoo、Ragas、Phoenix、Opik 各自解决的其实不是同一个问题；把它们全部称作“Eval Framework”反而会让读者产生错误认知。([Inspect][4])

[1]: https://github.com/confident-ai/deepeval?ref=workhere.org&utm_source=chatgpt.com "GitHub - confident-ai/deepeval at workhere.org · GitHub"
[2]: https://github.com/promptfoo/promptfoo/blob/main/site/docs/red-team/configuration.md?utm_source=chatgpt.com "promptfoo/site/docs/red-team/configuration.md at main · promptfoo/promptfoo · GitHub"
[3]: https://docs.ragas.io/en/latest/howtos/cli/?utm_source=chatgpt.com "Ragas CLI - Ragas"
[4]: https://inspect.aisi.org.uk/?lang=en-US&utm_source=chatgpt.com "Inspect"
[5]: https://github.com/EleutherAI/lm-evaluation-harness/?utm_source=chatgpt.com "GitHub - EleutherAI/lm-evaluation-harness: A framework for few-shot evaluation of language models. · GitHub"
[6]: https://github.com/openai/evals?utm_source=chatgpt.com "GitHub - openai/evals: Evals is a framework for evaluating LLMs and LLM systems, and an open-source registry of benchmarks. · GitHub"
[7]: https://github.com/openai/simple-evals?utm_source=chatgpt.com "GitHub - openai/simple-evals · GitHub"
[8]: https://github.com/braintrustdata/autoevals?utm_source=chatgpt.com "GitHub - braintrustdata/autoevals: AutoEvals is a tool for quickly and easily evaluating AI model outputs using best practices. · GitHub"
[9]: https://github.com/comet-ml/opik/blob/main/README.md?utm_source=chatgpt.com "opik/README.md at main · comet-ml/opik · GitHub"
[10]: https://www.trulens.org/component_guides/evaluation/running_feedback_functions/with_app/?utm_source=chatgpt.com "Running with your app - 🦑 TruLens"
[11]: https://github.com/wandb/weave?utm_source=chatgpt.com "GitHub - wandb/weave: Weave is a toolkit for developing AI-powered applications, built by Weights & Biases. · GitHub"
[12]: https://github.com/microsoft/promptflow?utm_source=chatgpt.com "GitHub - microsoft/promptflow: Build high-quality LLM apps - from prototyping, testing to production deployment and monitoring. · GitHub"
[13]: https://learn.microsoft.com/en-us/azure/foundry/how-to/evaluate-generative-ai-app?utm_source=chatgpt.com "Run evaluations from the Microsoft Foundry portal - Microsoft Foundry | Microsoft Learn"
[14]: https://aws.amazon.com/bedrock/evaluations/?utm_source=chatgpt.com "Evaluate Foundation Models - Amazon Bedrock Evaluations - AWS"
[15]: https://galileo.ai/?utm_source=chatgpt.com "Galileo AI: The AI Observability and Evaluation Platform"
[16]: https://docs.uptrain.ai/tutorials/open-source-evaluator?utm_source=chatgpt.com "Open Source Evaluator - UpTrain"
[17]: https://github.com/Giskard-AI/giskard-oss?utm_source=chatgpt.com "GitHub - Giskard-AI/giskard-oss: 🐢 Open-Source Evaluation & Testing library for LLM Agents · GitHub"
[18]: https://humanloop.com/docs/getting-started/overview?utm_source=chatgpt.com "Humanloop is the LLM Evals Platform for Enterprises | Humanloop Docs"
[19]: https://hub.harborframework.com/?utm_source=chatgpt.com "Harbor Hub"
