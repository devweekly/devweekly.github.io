---
author: SW
pubDatetime: 2026-11-03T08:00:00Z
title: "Weight-Space Programming：从模型权重工程到 LLM 直接编程神经网络"
featured: false
draft: false
tags:
  - AI
  - LLM
  - Model Editing
  - Model Merging
  - Persona Vectors
  - Activation Steering
  - Fine-tuning
  - Machine Learning
  - AI Architecture
description: "MIT CSAIL 展示了 LLM 直接读取和修改神经网络权重的实验。本文拆解 Qwen3.5-0.8B 的权重编辑过程、实验结果、相关工具，以及距离工程落地还差什么。"
---

# Weight-Space Programming：从模型权重工程到 LLM 直接编程神经网络

**研究截止日期：2026 年 11 月 4 日**

## 摘要

通常要改变一个模型的行为，我们会改 Prompt、补 RAG、做 Fine-tuning，或者在模型外面增加工具和规则。这些办法都没有直接动基础模型的参数。Weight-Space Programming 研究的是另一条路：让一个通用 LLM 读取神经网络权重，结合模型运行结果判断问题可能出在哪里，再直接写入一组参数修改。换句话说，LLM 不只是帮我们写训练代码，而是开始尝试修改另一个神经网络本身。

2026 年 11 月 2 日，MIT CSAIL 的 Rikiya Takehi、Jayden Teoh、Alex Zhang 和 Omar Khattab 发布了研究文章 [Sparks of Weight-Space Programming: LLMs can natively read & write neural network weights](https://rikiyat.github.io/blog/weight-space-programming/)。研究报告称，GPT-6 Astra 能够在不执行梯度下降、不进行训练的情况下，读取小型神经网络的权重、修复失败的控制策略、从零构造部分游戏策略网络，并直接修改 Qwen3.5-0.8B 的少量权重以缓解推理循环问题。

其中最受关注的实验是：研究者让 Astra 检查 Qwen3.5-0.8B 的权重，使用最多 50 次受限的模型 Forward Pass 观察结果，最后修改第 15 和第 19 层 MLP 的两个 `down_proj` 权重矩阵中的部分列。编辑涉及 131,072 个权重坐标，约占模型参数的 0.016%。作者报告，MATH-500 准确率从 7.9% 上升到 48.1%，GSM8K 从 13.8% 上升到 67.1%，IFEval 从 21.0% 上升到 62.3%。

先把结论说清楚：这不是“LLM 已经学会训练任何模型”，也不是不需要训练数据和算力就能凭空提升模型能力。Qwen 实验处理的是一个具体故障——模型反复生成推理内容，常常在输出答案前耗尽 Token 预算。编辑后，模型更容易把已有的解题能力用出来。这个结果很有意思，但目前仍是特定模型、特定故障和受控实验下的结果。

理解这项工作，需要把它和几种已有技术分开：LoRA 和 Fine-tuning 是训练；Task Vector 和 Model Merging 是对已有参数更新做运算；ROME、MEMIT 属于有明确编辑目标的 Model Editing；MIT 这项工作则尝试让通用 LLM 自己分析并编写权重。下面先看实验，再回头梳理这些技术之间的关系，最后讨论实际工程怎么接。

## 1. 模型权重也能成为编程对象

### 1.1 从模型权重开始

一个神经网络可以简化表示为：

```text
y = f(x; W)
```

其中：

- `x` 是输入；
- `f` 是模型的计算过程；
- `W` 是模型参数，也就是权重；
- `y` 是模型输出。

对一个 Transformer 来说，`W` 不是单个数字，而是由大量 Tensor 构成的参数集合，包括 Attention、MLP、Embedding、Normalization 等模块的权重。一个 7B 模型大约包含 70 亿个参数；每个参数通常以 BF16、FP16 或 FP32 等数值格式存储。

模型训练完成后，参数就成为模型推理行为的基础。传统应用通常把这些参数当成不可变的模型制品：开发者加载模型，然后通过 Prompt、RAG、工具和上下文控制它。

这项研究把权重从“加载后只读的模型文件”变成了可供分析和修改的对象：LLM 可以查看参数及其结构，结合运行反馈提出修改，再由执行环境把修改写回模型。

这里的“编程”不是让模型生成一段普通应用代码，而是让它直接决定神经网络参数应该怎样变化。

### 1.2 它和普通 Fine-tuning 有什么不同？

传统 Fine-tuning 通过训练数据、损失函数和优化器更新参数。典型流程是：

![Fine-tuning 与 Weight-Space Programming 的更新机制对比](/diagrams/weight-space-programming/01-finetuning-vs-weight-programming.svg)

*图源：[独立 HTML 版本](/diagrams/weight-space-programming/01-finetuning-vs-weight-programming.html)，可在浏览器中放大查看。*

训练过程通常依赖梯度：

```text
W_new = W_old - learning_rate * gradient
```

Weight-Space Programming 的核心区别在于：LLM 不一定通过梯度或优化器来寻找更新方向，而是直接对权重进行推理和写入。

例如，研究者可以给一个 LLM 提供模型权重、模型结构说明、失败样例和有限的模型运行反馈，让它判断哪些矩阵可能与某种失败行为有关，再生成一个具体的权重修改方案。

这不意味着它完全不需要计算。它仍然可能需要：

- 读取大量权重和张量统计信息；
- 通过 Python 或其他确定性计算工具分析矩阵；
- 调用目标模型执行 Forward Pass；
- 观察输入输出和中间激活；
- 根据反馈反复修改参数；
- 对最终结果运行独立评估。

所以，“不做梯度下降”不等于“没有计算成本”。权重读取、张量分析、模型 Forward Pass、反复试验和最终评估都要花时间和算力。

### 1.3 一个容易混淆的地方：Weight Space 不止一种含义

在机器学习文献中，Weight Space 早已是一个常见概念。例如：

- Bayesian Neural Networks 中的 Weight-space View；
- Neural Network Weight-space Symmetry；
- Weight-space Diffusion；
- Hypernetwork 生成其他神经网络的权重；
- Model Merging 和 Task Vector 的参数空间运算。

这些研究不都属于 2026 年 MIT 文章所定义的 Weight-Space Programming。

本文讨论的范围是：**通过模型权重本身进行理解、诊断、修改或构造，尤其关注由通用 LLM 直接执行这些操作的能力。**

## 2. 先分清几种常见的权重操作

这些方法都会碰到模型参数，但做法并不一样。把它们混在一起，很容易把成熟的训练工具误当成 LLM 自主编辑权重。

### 2.1 Fine-tuning：通过数据训练改变模型

Fine-tuning 使用任务数据继续训练模型，让模型在特定任务上表现更好。

例如，使用金融领域的问答、分析和报告数据训练模型，使其更熟悉金融术语、输出格式和任务模式。

Fine-tuning 可能更新全部模型参数，也可能只更新部分参数。

它的核心是优化过程，不是让 LLM 自己读取权重并决定应该修改哪个矩阵。

### 2.2 LoRA：只训练一小部分低秩参数

LoRA（Low-Rank Adaptation）是目前非常成熟的 Parameter-Efficient Fine-Tuning（PEFT）技术。

假设原始模型有一个权重矩阵：

```text
W
```

LoRA 不直接训练整个矩阵，而是通过两个较小的矩阵表示更新：

```text
Delta W = B * A
W_new = W + scale * B * A
```

其中，A 和 B 的秩通常远小于原始矩阵的维度。

例如，一个 4096 × 4096 的矩阵包含约 1,678 万个参数。如果 LoRA rank 为 16，那么两个低秩矩阵合计只需要：

```text
4096 * 16 + 16 * 4096 = 131,072 parameters
```

这只是一个示意计算，实际参数量取决于模型中选择了多少个 Target Modules。

LoRA 的优势包括：

- 训练参数少，显存和训练成本相对较低；
- 不需要为每个任务保存完整的基础模型副本；
- 不同任务可以分别保存不同 Adapter；
- 可以在推理时加载、切换 Adapter；
- 可以在适用的情况下把 Adapter 合并回基础模型。

但 LoRA 仍然是训练技术。它的参数更新来自训练过程，而不是一个通用 LLM 直接理解模型内部结构后手工编写权重。

官方实现：[Hugging Face PEFT](https://github.com/huggingface/peft)。

### 2.3 Task Vector：把一次微调产生的变化抽象成向量

Task Vector 是理解参数合并的一块基础。

假设有一个基础模型：

```text
W_base
```

使用某个任务的数据微调后得到：

```text
W_task
```

两者的差值：

```text
Delta W_task = W_task - W_base
```

可以视为一个 Task Vector（任务向量）。

这个向量表达的是：为了让基础模型获得某种任务行为，训练过程使参数发生了怎样的变化。

如果已经有多个从同一个基础模型微调出来的模型，就可以尝试组合它们的任务向量：

```text
W_new = W_base
      + alpha * Delta W_A
      + beta  * Delta W_B
```

例如：

- A 是代码生成任务微调；
- B 是金融分析任务微调；
- C 是中文写作任务微调。

理论上可以通过调整不同 Task Vector 的系数，组合不同任务的行为。

这就是 Task Arithmetic（任务算术）的基本思想。

Task Vector 并不意味着一个任务对应一段独立、完全隔离的权重。不同任务可能修改相同的参数，而且这些更新可能互相冲突。

代表性论文：[Editing Models with Task Arithmetic](https://arxiv.org/abs/2212.04089)。

### 2.4 Model Merging：合并多个模型的权重

Model Merging 是把多个模型或模型适配器的参数组合成一个模型。

常见方法包括：

| 方法 | 基本思想 | 主要问题 |
| --- | --- | --- |
| Linear / Weight Averaging | 对参数做加权平均 | 参数更新可能相互抵消 |
| SLERP | 在参数向量空间中做球面插值 | 需要适当的模型和参数对齐条件 |
| Task Arithmetic | 合并多个 Task Vector | 可能出现 Task Interference |
| TIES-Merging | 剪除冗余更新，处理符号冲突，再合并 | 稀疏率和权重选择需要实验 |
| DARE | 随机丢弃部分参数更新并重新缩放 | 随机丢弃不保证每个任务都受益 |

TIES 的名称来自 Trim、Elect、Merge 三个步骤。它尝试减少不同模型参数更新之间的冲突。

DARE 则通过 Drop And REscale 减少冗余更新，再配合其他合并方法使用。

开源项目 [MergeKit](https://github.com/arcee-ai/mergekit) 提供了多种模型合并实现，支持通过 YAML 配置模型和合并策略。

### 2.5 Model Editing：直接修改模型中的特定知识或行为

Model Editing 关注的是一个更局部的问题：

> 能不能只修改模型中的某个知识关联或行为，而不需要重新训练整个模型？

例如，模型原本回答：

```text
The Eiffel Tower is located in Paris.
```

希望修改成：

```text
The Eiffel Tower is located in Rome.
```

这里的例子只是说明技术目标，不代表应当把错误事实写入生产模型。

代表性方法包括：

**ROME（Rank-One Model Editing）**

ROME 通过因果干预研究 Transformer 中与事实关联有关的计算，并尝试使用秩一权重更新修改某些 MLP 参数。

**MEMIT（Mass-Editing Memory in a Transformer）**

MEMIT 把类似思路扩展到批量事实编辑，研究如何在多个事实之间分配参数更新。

**SERAC（Memory-Based Model Editing at Scale）**

SERAC 需要单独区分。它通过外部编辑记忆和模型机制调节原始模型输出，不属于简单的直接修改基础模型权重。

这几个方向都说明，模型的知识和行为可以在推理阶段之外被修改，但它们的编辑目标、内部机制和副作用并不相同。

## 3. 相关研究是怎样发展到今天的

这几条路线并不是一条严格的技术继承链。它们分别解决知识编辑、参数合并、行为分析等问题，逐渐积累出今天研究权重读写所需的方法和工具。

![权重空间相关方法的技术谱系](/diagrams/weight-space-programming/02-weight-space-methods.svg)

*图源：[独立 HTML 版本](/diagrams/weight-space-programming/02-weight-space-methods.html)，可在浏览器中放大查看。*

### 3.1 2022：ROME 与 Task Arithmetic

2022 年出现了两条非常重要的研究路线。

ROME 研究如何定位和修改模型中的事实关联。

Task Arithmetic 研究如何将微调模型相对于基础模型的参数差异抽象成任务向量，并通过加法、减法等运算改变模型行为。

它们分别从局部知识编辑和整体任务行为组合的角度探索参数空间。

参考：

- [ROME：Locating and Editing Factual Associations in GPT](https://arxiv.org/abs/2202.05262)
- [Task Arithmetic](https://arxiv.org/abs/2212.04089)

### 3.2 2023：MEMIT、TIES 和 DARE

MEMIT 将事实编辑扩展到批量操作。

TIES 和 DARE 则进一步处理模型合并中的参数冗余与任务冲突。

这类方法使模型权重不再只是一个训练产物，也成为可以通过算法进行组合和修改的对象。

参考：

- [MEMIT：Mass-Editing Memory in a Transformer](https://memit.baulab.info/)
- [TIES-Merging：Resolving Interference When Merging Models](https://arxiv.org/abs/2306.01708)
- [Language Models are Super Mario: Absorbing Abilities from Homologous Models as a Free Lunch](https://arxiv.org/abs/2312.03099)

### 3.3 2024—2025：权重操作逐渐进入工程工具链

MergeKit、Hugging Face PEFT 等项目把模型合并和参数高效微调变成可复用的工程能力。

与此同时，研究者也在持续分析模型编辑对通用能力的影响。

例如，2024 年的 [Should We Really Edit Language Models? On the Evaluation of Edited Language Models](https://proceedings.neurips.cc/paper_files/paper/2024/file/370fa2e691f57eb319bc263a07dad4a5-Paper-Conference.pdf) 讨论了模型编辑后其他任务能力可能出现的退化。

另一个关于连续编辑的研究 [Navigating the Dual Facets: A Comprehensive Evaluation of Sequential Memory Editing in Large Language Models](https://arxiv.org/abs/2402.11122) 指出，在其测试的设置中，参数修改型编辑方法随着连续编辑次数增加，可能出现广泛的能力下降；参数保持型方法虽然较能保留基础能力，但在不同问法下的泛化存在问题。

因此，编辑成功率只是一个指标。还要检查模型原有的其他能力有没有一起受损。

### 3.4 2026：从算法修改权重走向 LLM 直接编写权重

2026 年 10 月 5 日发布的 [Weight Oracles: Reading Neural Network Weights with Language Models](https://arxiv.org/html/2610.07334) 研究让经过训练的语言模型直接读取神经网络权重，判断模型的行为和潜在异常。

这项工作主要关注 Weight Reading 和 Safety Auditing。论文实验中的网络规模很小，约为 2K 参数，作者也把扩展到真实模型规模列为主要开放问题。

2026 年 2 月的 [Steer2Edit](https://arxiv.org/html/2602.09870v2) 则研究如何把 Activation Steering 信号转化为组件级权重编辑。它提供了从推理时控制走向参数修改的另一条技术路线，但不是通用 LLM 自主理解和编写权重。

2026 年 11 月 2 日的 MIT CSAIL 研究进一步展示了：通用 LLM 在特定实验条件下，可以直接分析和修改神经网络权重，而不依赖传统的梯度训练过程。

## 4. MIT CSAIL 这次实验做了什么

### 4.1 研究问题

研究团队想验证的事情可以概括成一个问题：

**如果把神经网络的权重交给一个能力足够强的通用 LLM，它能否理解这些数字代表的计算，并根据自然语言目标直接修改网络？**

这和常见的 LLM-as-Optimizer 不太一样。

过去让 LLM 优化一个机器学习系统，通常是让它修改：

- Prompt；
- Training Code；
- Hyperparameters；
- 数据处理逻辑；
- 模型架构配置；
- Evaluation Harness。

这次实验则把目标推进到模型参数本身。

研究文章：[Sparks of Weight-Space Programming](https://rikiyat.github.io/blog/weight-space-programming/)。

### 4.2 实验覆盖了什么？

研究包含八组实验，分别考察模型能否读取、修复和构造神经网络。

| 实验 | 目标 | 研究内容 |
| --- | --- | --- |
| Experiment 1 | 读取网络行为 | 仅根据权重识别小型游戏策略网络的游戏类型 |
| Experiment 2 | 读取生成模型行为 | 根据 Diffusion Model 权重判断其训练目标图形 |
| Experiment 3 | 读取语言模型特征 | 从部分 Transformer 权重推断模型学习的语言 |
| Experiment 4 | 修复失败网络 | 修改无法正常工作的汽车控制策略 |
| Experiment 5 | 从零构造网络 | 构造 MinAtar 游戏策略网络 |
| Experiment 6 | 从零构造 Go 网络 | 生成一个约 150 万参数的 Go 策略网络 |
| Experiment 7 | 识别特定行为 | 识别经过 Sycophancy 训练的模型 |
| Experiment 8 | 修改真实语言模型 | 直接修改 Qwen3.5-0.8B 的权重以缓解数学推理循环 |

其中，Experiment 1—3 主要测试 Weight Reading；Experiment 4 主要测试 Repair；Experiment 5—6 主要测试 Weight Writing；Experiment 7 和 8 则涉及更复杂的模型行为分析和修改。

研究团队公开了每组实验的提示、代码、输出、网络和评估材料：

[GitHub：RikiyaT/lm_understand-logs](https://github.com/RikiyaT/lm_understand-logs)。

这不是在聊天窗口里贴一份权重文件就能完成的任务。Astra 使用了受限的 Python 分析环境，以及单独提供的模型 Forward Pass 接口；它不能随意使用 Shell、文件编辑或 Web Search。真正完成实验的是 LLM 加上这套受控 Harness，而不是一个脱离工具环境的模型。

### 4.3 最受关注的实验：直接修改 Qwen3.5-0.8B

研究使用的是 Qwen3.5-0.8B 的文本模型部分，共 24 层。

基础模型存在明显的推理循环问题。实验日志记录，在一次早期练习中，前 96 个回答有 85 个达到 32,768 Token 的生成上限。

这会直接影响数学题的最终答案：模型可能已经具备一定的解题能力，但在输出最终答案之前不断重复推理，最终被 Token 上限截断。

研究者给 Astra 提供了：

- Qwen3.5-0.8B 的权重；
- 一个持久化的 Python Kernel，用于读取和计算权重；
- 7,469 道 GSM8K 训练集题目；
- 7,275 道 MATH 训练集题目；
- 714 道 AIME 练习题的答案；
- 最多 10、25 或 50 次模型 Forward Pass；
- 一个可以提交权重修改的受控接口。

这些练习题来自训练数据，而不是最终评估集。Astra 没有看到最终 Benchmark 的题目和分数。

实验明确禁止：

- Gradient Descent；
- Backpropagation；
- Autograd；
- Optimizer；
- 通过训练 Loss 迭代拟合权重；
- 在 Python Kernel 中直接运行目标模型；
- 网络访问。

Forward Pass 由独立接口执行，返回模型输出、Log Probability 或指定的中间信息。

### 4.4 权重修改到底发生在哪里？

50 次 Forward Pass 的实验最终修改了两个 Tensor：

```text
model.language_model.layers.15.mlp.down_proj.weight
model.language_model.layers.19.mlp.down_proj.weight
```

每个矩阵选择了 64 个输出列，每列长度为 1,024：

```text
2 layers * 64 columns * 1,024 values
= 131,072 weight coordinates
```

相对于 0.8B 参数模型，这约占 0.016%。

研究者观察到模型的循环行为与某个由 MLP 写入的方向有关，Astra 选择从相关权重列中减去这个方向。

这里不是简单地把某个神经元设置成零，也不是关闭整个 MLP，而是针对两个层的 MLP 输出矩阵进行定向修改。

实验使用 BF16 权重进行最终评估。虽然提交修改涉及 131,072 个位置，但经过 BF16 转换后，最终与原始值不同的权重是 130,188 个。

这个细节说明：报告中的“修改了 131,072 个权重”描述的是编辑涉及的坐标数量，而不是每个坐标在最终存储格式中都必然发生了数值变化。

### 4.5 评估结果

以下是研究团队报告的结果：

| Qwen3.5-0.8B | MATH-500 | GSM8K | IFEval | MATH-500 达到 Token 上限 |
| --- | ---: | ---: | ---: | ---: |
| Base Model | 7.9% | 13.8% | 21.0% | 93.0% |
| Edited，10 Passes | 12.3% | 25.7% | 49.0% | 87.2% |
| Edited，25 Passes | 14.1% | 25.1% | 39.9% | 86.4% |
| Edited，50 Passes | 48.1% | 67.1% | 62.3% | 33.1% |

50 Passes 的结果比较突出。

其他 Benchmark 也报告了提升：

| Benchmark | Base Model | Edited，50 Passes |
| --- | ---: | ---: |
| AMC23 | 0.5% | 23.4% |
| Minerva Math | 1.5% | 25.4% |
| OlympiadBench | 1.3% | 21.8% |
| MMLU-Pro | 40.3% | 45.5% |
| GPQA Diamond | 22.7% | 36.6% |

这些数字来自作者公开的实验评估日志，而不是本文独立重新运行的结果。

另一个重要细节是：10、25、50 Passes 是三个独立实验，不是同一个实验逐步增加预算后得到的累计结果。50 Passes 的实验并不是在 25 Passes 的模型上继续修改。

### 4.6 为什么提升可能这么大？

这项实验最值得研究的地方，不是 0.016% 这个数字本身，而是模型的主要失败模式。

Base Model 的数学回答经常陷入循环，导致生成无法完成。修改之后，达到 Token 上限的答案比例从 93% 降到了 33.1%。

因此，MATH-500 准确率的提升主要说明：原本会因为重复推理而无法完成的回答，现在有更多机会输出最终答案。

作者明确强调：

> Editing weights could remove an obstacle that hid an ability, but it could not add an ability the model lacked.

也就是说，权重编辑可以移除阻碍已有能力发挥的故障，但不能凭空创造模型没有的能力。

这与普通 Fine-tuning 的目标不同。Fine-tuning 可能通过训练数据学习新的任务模式；这里的实验则主要是修复模型已有行为中的一个特定问题。

### 4.7 计算成本与实验预算

50 Passes 的实验并不是一次 Prompt 就完成。

公开日志记录：

| 项目 | 数值 |
| --- | ---: |
| Forward Pass Budget | 50 |
| 总 Turn 数 | 158 |
| Python Runs | 80 |
| Conversations | 4 |
| Wall-clock Time | 20.3 小时 |

其中包含约 4.7 小时模型服务无法访问、Harness 等待重试的时间。

Forward Pass 也不是单独生成一道题。根据实验接口定义，一次 Forward Pass 可以处理最多 512 道练习题的生成，或者读取最多 1,024 条文本的 Log Probability、Hidden States、MLP Activations 和 Attention 等信息。

因此，不能把 50 Passes 简单理解成 50 次普通 Chat Completion。

公开材料没有给出完整的美元成本，也没有证明这种方法在相同硬件和任务条件下比 LoRA 或 Fine-tuning 更便宜。20.3 小时是实验运行时间，不是 GPU 费用或 API 账单。

### 4.8 外部复跑：51.0% 是否能复现？

Hugging Face 上的 [Qwen3.5-0.8B Weight-Space Programming 模型](https://huggingface.co/RikiyaT/Qwen3.5-0.8B-weight-space-programming)公开了重建后的模型权重和评估结果。

Ahsen Khaliq 根据作者公开的精确权重差异重建模型，并在 H200 上重新运行完整 MATH-500：

- 500 道题；
- 每道题 4 次采样；
- 总计 2,000 次生成；
- 约 4,340 万生成 Token；
- 运行时间约 51 分钟；
- Edited Model 得分 51.0%。

这比原文的 48.1% 略高。

但该模型页对 Base Model 只做了 25 道题的 Smoke Test，结果为 5.0%，不能把 51.0% 和 5.0% 当作同等规模、完全配对的独立对照实验。

此外，复跑使用的是完整多模态模型，而原文评估的是文本模型导出版本。模型页说明语言模型相关 Tensor 的 Hash 与原始实验权重一致，Vision Tower 不参与这些文本题目的评估。

因此，这次复跑增加了权重重建和 Edited Model 评估的可信度，但还不能替代跨团队、跨模型、跨任务的系统性独立复现。

### 4.9 研究有哪些失败和边界？

研究并非所有实验都成功。

Experiment 7 中，Astra 仅根据原始权重无法稳定识别两个 Gemma 3 270M 模型中哪个经过了 Sycophancy 训练。允许观察 Attention Pattern 后，识别能力有所改善。

Experiment 8 的 Gemma 3 270M 后续实验也很重要：这个模型本身并没有明显的推理循环问题，Astra 没有找到类似 Qwen 的显著修复方式。数学 Benchmark 的变化很小。

这支持作者的一个判断：Qwen 实验的提升不是一种通用的数学能力注入机制，而是修复了一个特定的行为障碍。

目前仍然没有充分证据证明：

1. 任意 Frontier LLM 都具备同样的权重理解能力；
2. 这种方法可以可靠地扩展到几十亿、几百亿或 MoE 大模型的任意能力修改；
3. 模型能够稳定地识别所有安全问题、偏见或隐藏行为；
4. 对一个任务有效的权重修改不会损害其他任务；
5. 多次编辑、跨模型合并和长期版本演进都能保持稳定；
6. 直接权重编辑的成本一定低于传统训练。

### 4.10 本地模型也能读懂权重：Simon Willison 的 Qwen 3.8 27B 实验

MIT 的实验发布后，Simon Willison 在 2026 年 11 月 3 日做了一个很有价值的跟进：他没有使用 GPT-6 Astra，而是在自己的笔记本上运行 Qwen 3.8 27B，让它完成作者公开的 Experiment 1 权重识别任务。

这次实验有几个值得注意的地方：

- **模型**：Qwen 3.8 27B，使用 LM Studio 本地运行的 GGUF Q4_K_M 量化版本，文件约 17 GB。
- **输入**：直接复用作者公开的 lm_understand-logs/exp1_which_game 提示词和权重文本。
- **模型可用能力**：提示词明确要求不使用代码执行、计算器或其他工具，只根据权重作答。
- **运行环境**：LM Studio 加载模型，Simon 通过 llm CLI 和 llm-lmstudio 插件发送提示。这里的 CLI 和 LM Studio 是实验 Harness；它们负责加载模型和传递文本，不代表被测模型获得了 Python 或 Shell 工具。
- **上下文要求**：LM Studio 默认 8,192 Token 的上下文长度不足以完成任务，需要调大上下文窗口；同时将客户端超时调到 900 秒。

结果并不是四题全对：

| 任务 | Qwen 3.8 27B 结果 | 运行时间 |
| --- | --- | ---: |
| Pac-Man | 正确识别 | 46 分 12 秒 |
| Pong | 正确识别 | 1 小时 4 分 54 秒 |
| Breakout | 正确识别 | 52 分 25 秒 |
| Freeway | 误判为类似 Pac-Man 的网格游戏 | 未报告为成功 |

Pac-Man、Pong 和 Breakout 的回答分别给出了 72%、75% 和 88% 的模型自评置信度。完成 Pac-Man 任务消耗了约 43,506 个 Reasoning Tokens。这里的置信度是模型自己的表达，不是经过校准的统计置信区间；三题成功也不能据此推断模型对任意网络都能可靠读懂权重。

这次实验真正增加的证据是：**不依赖 GPT-6 Astra，另一个本地运行的通用模型也能在小型网络的特定权重识别任务上取得成功。** 它降低了“只有某个闭源前沿模型才能完成这类任务”的可能性，也让开发者可以在本地复用公开提示词做验证。

但不要把它理解成 Qwen 3.8 27B 已经能够编辑 Qwen 或其他大模型的权重。Simon 测试的是小型游戏策略网络的 Weight Reading，不是对 Qwen 3.5-0.8B 做 Weight Editing；这次也没有验证模型能否在大型 Transformer 中定位并修复真实故障。

**复现实验可以从公开日志开始，而不是自己重新训练四个游戏模型：**

1. 从 [RikiyaT/lm_understand-logs](https://github.com/RikiyaT/lm_understand-logs/tree/main/exp1_which_game) 选择一个游戏的 prompt.txt。
2. 使用支持长上下文的本地推理环境加载 Qwen 3.8 27B 或其他模型。
3. 把提示词原样交给模型，不额外提供游戏名称、答案或工具。
4. 保存完整回答、Reasoning Token 数、耗时和模型版本。
5. 对四个任务全部测试，并按预先确定的标准核对答案；不要只挑成功案例。
6. 更换模型量化版本、上下文长度或提示词时，单独记录实验条件，避免把不同配置的结果直接比较。

Simon 的完整过程和失败案例见：[Qwen 3.8 27B on my laptop can interpret model weights, too](https://simonwillison.net/2026/Nov/3/qwen-can-interpret-model-weights/)。

### 4.11 需要认真对待的反方观点：这是否真的证明了新的研究能力？

这项工作引起关注后，出现了两篇值得一起阅读的技术评论。它们不是在否定实验结果，而是在提醒读者不要把不同实验的能力混为一谈。

**Matthew Honnibal：读权重和修改 Qwen 并不是同一种技术。**

[The “Astra can read and write weights to improve Qwen” post is misleading](https://honnibal.dev/blog/astra-read-write-misleading) 指出，论文中最容易被混为一谈的是两类实验：

- Experiment 1、2 和 4：模型直接读取原始权重，或者在没有工具的情况下提出修改；这些网络约为 17K—172K 参数。
- 涉及真实语言模型的实验：使用了 Python 分析工具；Qwen 的 Experiment 8 还使用了最多 50 次 Forward Pass 观察模型输出和中间信息。

因此，“模型不借助工具就能读懂大型语言模型全部权重”和“模型可以借助 Python、运行反馈和受控接口完成权重编辑”不是同一个结论。尤其不能把 Qwen 的结果描述成模型只看一份权重文本，就凭空找到了修复方案。

**Sean Goedecke：这些操作是否超出了有经验的机器学习工程师？**

[LLMs are not superhuman at reading and writing neural network weights](https://www.seangoedecke.com/llms-are-not-superhuman-at-reading-and-writing-neural-network-weights/) 从两个角度提出质疑：

1. 游戏网络的输入通道已经标注了 Agent、Moving Objects 等语义，网络输入又直接对应网格位置。对第一层权重按输入通道计算 L2 Norm 并画成热图，人类研究者也可能很快看出挡板、球或迷宫结构。模型能在没有 Python 的条件下完成这种分析很有意思，但不必然意味着它掌握了人类无法理解的神经网络语义。
2. Qwen 的数学能力提升，首先是因为基础模型存在明显的重复推理循环。Goedecke 认为，研究者可以比较循环与非循环文本的 Residual、识别相关方向，再通过权重裁剪和反复测试修复问题；这与 Activation Steering、Abliteration 一类研究流程有相通之处。

这两个批评都值得纳入判断，但也不应反向夸大：能够让通用 LLM 自主提出分析方案、组织实验、读取反馈并形成有效 Patch，本身仍然具有工程价值。即使其中的分析方法对专业研究者并不新鲜，自动执行完整研究流程也可能降低实验门槛。

**更准确的结论应该分成四层：**

| 能力层次 | 当前证据 | 不应该外推成什么 |
| --- | --- | --- |
| 直接从小型网络权重识别行为 | 多个无工具实验成功；本地 Qwen 3.8 27B 也复现了部分游戏识别 | 通用模型已经能理解任意规模网络 |
| 通过权重结构分析模型内部特征 | 部分实验结合 Python 分析中间层、Attention 或激活 | 仅凭权重文本就能解释完整 Transformer |
| 通过工具和 Forward Pass 定位故障并修改参数 | Qwen3.5-0.8B 的特定循环问题得到显著改善 | LLM 已经发明了通用、超越人类的模型优化算法 |
| 对编辑后的模型进行独立评估 | 已有公开权重差异和一次外部复跑 | 跨模型、跨任务、跨团队的稳定性已经得到证明 |

因此，阅读这项研究时最好同时保留两个判断：一方面，LLM 已经能参与过去通常需要机器学习研究者手工完成的权重分析和编辑工作；另一方面，现有证据仍然是若干受控任务的组合，不能直接推导出递归自我改进或自动发现通用优化算法。

这也影响工程路线的选择：如果目标是定位某个已知故障，先用激活分析、差分分析、Steering 或现有 Model Editing 方法建立可解释基线，再让 LLM 负责提出候选假设和 Patch，会比直接把“自主权重编程”当成黑盒能力更容易验证。

## 5. 现有开源工具和商业产品：哪些已经能用？

需要把严格意义上的 Weight-Space Programming 与周边的模型权重工程分开。

截至 2026 年 11 月 4 日，尚未发现已经成熟商业化、可以让用户用自然语言要求 LLM 自主读取并任意修改生产大模型权重的通用产品。

但是，模型合并、LoRA 训练、Adapter 管理和推理部署已经有成熟工具链。

### 5.1 开源工具

| 项目 | 主要用途 | 与 Weight-Space Programming 的关系 | 工程成熟度 |
| --- | --- | --- | --- |
| [Hugging Face PEFT](https://github.com/huggingface/peft) | LoRA 等参数高效微调、Adapter 管理和合并 | 提供参数适配和权重合并基础设施 | 成熟 |
| [MergeKit](https://github.com/arcee-ai/mergekit) | 多模型权重合并 | Task Arithmetic、TIES、DARE、SLERP 等 | 可用于工程实验 |
| [vLLM](https://github.com/vllm-project/vllm) | 高性能模型推理 | 支持请求级 LoRA Adapter Serving | 成熟 |
| [ROME](https://github.com/kmeng01/rome) | 局部事实编辑 | 直接修改模型参数的研究实现 | 研究工具 |
| [MEMIT](https://github.com/kmeng01/memit) | 批量事实编辑 | 参数编辑的研究实现 | 研究工具 |
| [EasyEdit](https://github.com/zjunlp/EasyEdit) | 比较和实验多种知识编辑方法 | 统一 Model Editing 实验工具 | 研究工具 |
| [Steer2Edit](https://github.com/Trustworthy-ML-Lab/Steer2Edit) | 将 Steering 转换为组件级权重编辑 | 与训练无关的权重干预方向 | 研究工具 |

需要特别说明，PEFT 和 vLLM 并不实现 MIT 研究中的通用 Weight-Space Programming。它们解决的是训练、Adapter 管理和模型推理问题。

### 5.2 Together AI：LoRA Fine-tuning 与托管部署

[Together AI Fine-tuning](https://docs.together.ai/docs/fine-tuning/overview) 支持：

- LoRA Fine-tuning；
- Full Fine-tuning；
- 数据上传和训练任务管理；
- Fine-tuned Model 注册；
- Dedicated Endpoint 部署；
- 下载 Adapter 或合并后的模型权重。

一个基本的训练命令：

```bash
tg files upload train.jsonl

tg fine-tuning create \
  --training-file FILE_ID \
  --model Qwen/Qwen3.5-9B \
  --lora
```

训练完成后，可以部署到 Dedicated Endpoint，也可以下载 LoRA Adapter 或合并后的模型。

Together AI 当前文档说明 Serverless LoRA Inference（包括 Serverless Multi-LoRA）已经停止提供。多个 Adapter 的共享部署应按照当前 Dedicated Model Inference 的支持条件配置，不能继续照搬旧的 Serverless Multi-LoRA 教程。

官方文档：

- [Fine-tuning Overview](https://docs.together.ai/docs/fine-tuning/overview)
- [Deploy a Fine-tuned Model](https://docs.together.ai/docs/fine-tuning/deployment)
- [LoRA vs Full Fine-tuning](https://docs.together.ai/docs/fine-tuning/lora-vs-full)

### 5.3 Microsoft Foundry：Multi-LoRA Adapter Deployment

Microsoft Foundry 提供了一个比较有代表性的企业部署模式：多个 LoRA Adapter 可以共享同一个基础模型推理部署。

例如：

- Base Model：Qwen；
- Adapter A：金融分析；
- Adapter B：客服；
- Adapter C：SQL Generation。

多个 Adapter 使用同一个 Target Deployment 的计算资源和推理端点，但通过不同的 Deployment Name 选择不同的行为。

![Multi-LoRA 推理部署架构](/diagrams/weight-space-programming/03-multi-lora-serving.svg)

*图源：[独立 HTML 版本](/diagrams/weight-space-programming/03-multi-lora-serving.html)，可在浏览器中放大查看。*

根据 Microsoft 官方文档：

- 一个 Target Deployment 最多支持 8 个 Adapter Deployments；
- 多个 Adapter 共享同一份 Target Deployment 的计算资源；
- Adapter 不会为自己单独创建新的 GPU 容量；
- 所有 Adapter 会共同消耗 Target Deployment 的推理容量；
- 当前功能只适用于 Foundry Fine-tuning 产生的 LoRA Adapter；
- 目前还不能直接导入用户自行提供的 Adapter。

**成熟度限制：** 当前文档将该能力标记为 Preview，并明确说明 Preview 没有 SLA，不建议用于生产工作负载。

官方资料：

- [Deploy fine-tuned LoRA adapters to managed compute](https://learn.microsoft.com/en-us/azure/foundry/how-to/deploy-lora-managed-compute)
- [Adapter deployments for managed compute](https://learn.microsoft.com/en-us/azure/foundry/concepts/adapter-deployment-overview)

### 5.4 Hugging Face PEFT 与 vLLM：更适合自行搭建的方案

对于希望控制模型版本、Adapter 和推理服务的团队，可以采用：

- PEFT 负责训练和管理 LoRA Adapter；
- vLLM 负责基础模型加载和推理；
- Adapter Registry 管理不同任务的 Adapter；
- API Gateway 根据业务和权限选择 Adapter。

例如 vLLM 的启动方式：

```bash
vllm serve meta-llama/Llama-3.2-3B-Instruct \
  --enable-lora \
  --lora-modules finance=./adapters/finance \
  --max-lora-rank 64
```

官方文档：[vLLM LoRA Adapters](https://docs.vllm.ai/en/latest/features/lora/)。

这已经能够满足不少企业的模型个性化和多任务部署需求，并不需要引入尚未成熟的直接权重编程。

## 6. 代码示例一：用 PyTorch 实现 Task Arithmetic

先从最简单的权重运算开始。

假设：

- `base_model` 是基础模型；
- `finance_model` 是基于同一基础模型微调后的金融模型；
- 希望将金融任务向量以系数 alpha 合并回基础模型。

```python
from safetensors.torch import load_file, save_file
import torch

base = load_file("base/model.safetensors")
finance = load_file("finance/model.safetensors")

assert base.keys() == finance.keys()

alpha = 0.7
merged = {}

for name, base_tensor in base.items():
    task_tensor = finance[name]

    if base_tensor.shape != task_tensor.shape:
        raise ValueError(f"Shape mismatch: {name}")

    delta = task_tensor.float() - base_tensor.float()
    result = base_tensor.float() + alpha * delta

    merged[name] = result.to(base_tensor.dtype).contiguous()

save_file(merged, "merged/model.safetensors")
```

这段代码展示了 Task Vector 的基本数学操作。

如果有两个任务向量：

```python
merged[name] = (
    base_tensor.float()
    + alpha * (finance_tensor.float() - base_tensor.float())
    + beta * (code_tensor.float() - base_tensor.float())
).to(base_tensor.dtype)
```

这只是线性组合，并不保证最终模型能同时获得两种能力。

实际使用前必须检查：

- 基础模型是否完全相同；
- 模型结构是否一致；
- Tensor 名称和 Shape 是否匹配；
- Tokenizer 和 Vocabulary 是否兼容；
- 权重更新是否存在严重冲突；
- 合并后是否出现能力退化。

不要直接对不同模型家族的任意权重进行加法。

## 7. 代码示例二：使用 MergeKit 做 TIES Model Merging

如果不希望自己实现参数合并，可以使用 MergeKit。

安装：

```bash
pip install mergekit
```

示例配置：

```yaml
models:
  - model: organization/finance-model
    parameters:
      weight: 0.7
      density: 0.2

  - model: organization/code-model
    parameters:
      weight: 0.4
      density: 0.2

merge_method: ties
base_model: organization/base-model

parameters:
  normalize: true

dtype: bfloat16
```

执行：

```bash
mergekit-yaml merge.yml ./merged-model
```

这里的 `density: 0.2` 表示对 Task Vector 的稀疏化保留比例，具体参数解释和可用范围应以当前 MergeKit 版本文档为准。

可以尝试不同的权重和 Density，但不能只看生成结果是否符合预期。需要使用独立测试集检查各个任务的效果。

## 8. 代码示例三：用 PEFT 加载和合并 LoRA

LoRA 的优势在于可以保留基础模型，并单独管理任务 Adapter。

```python
import torch
from transformers import AutoModelForCausalLM
from peft import PeftModel

base_id = "Qwen/Qwen3.5-9B"
adapter_path = "./adapters/finance"

base_model = AutoModelForCausalLM.from_pretrained(
    base_id,
    torch_dtype=torch.bfloat16,
    device_map="auto",
)

model = PeftModel.from_pretrained(
    base_model,
    adapter_path,
)

# 需要独立模型制品时，将 LoRA 合并进基础模型
merged_model = model.merge_and_unload()

merged_model.save_pretrained(
    "./output/finance-merged",
    safe_serialization=True,
)
```

如果要保留多个 Adapter，可以使用 PEFT 的 `load_adapter()` 和 `set_adapter()` 管理它们。

官方文档：

- [PEFT LoRA Guide](https://huggingface.co/docs/peft/en/developer_guides/lora)
- [PEFT Model Merging](https://huggingface.co/docs/peft/en/developer_guides/model_merging)

## 9. 代码示例四：用 vLLM 在推理时选择 LoRA Adapter

Adapter Serving 可以避免为每个业务任务部署完整模型。

```python
from vllm import LLM, SamplingParams
from vllm.lora.request import LoRARequest

llm = LLM(
    model="Qwen/Qwen3.5-9B",
    enable_lora=True,
    max_lora_rank=64,
)

sampling = SamplingParams(
    temperature=0.2,
    max_tokens=1024,
)

result = llm.generate(
    ["Explain the risk of an interest rate swap."],
    sampling,
    lora_request=LoRARequest(
        "finance",
        1,
        "./adapters/finance",
    ),
)

print(result[0].outputs[0].text)
```

实际系统需要在 Adapter Registry 中维护 Adapter ID、基础模型版本、适用任务、发布状态和权限范围。不要让客户端随意指定任意文件路径。

## 10. 代码示例五：复现 MIT 的 Qwen 权重编辑

这组实验最有价值的地方，是作者公开了完整的权重差异，而不是只发布一个重新打包的模型。

GitHub 仓库：

[https://github.com/RikiyaT/lm_understand-logs](https://github.com/RikiyaT/lm_understand-logs)

关键文件：

- `exp8_math/README.md`：实验配置、结果和文件说明；
- `exp8_math/runs/p50c/edit/manifest.json`：编辑 Tensor 和 Hash；
- `exp8_math/runs/p50c/edit/edit.npz`：权重差异；
- `exp8_math/code/apply_edit.py`：应用权重差异；
- `exp8_math/code/evaluate.py`：评估流程。

克隆仓库：

```bash
git clone https://github.com/RikiyaT/lm_understand-logs.git
cd lm_understand-logs
```

下载与实验对应的基础模型版本：

```bash
hf download Qwen/Qwen3.5-0.8B \
  --revision 2fc06364715b967f1860aea9cf38778875588b17 \
  --local-dir ./Qwen3.5-0.8B
```

使用公开的权重差异重建模型：

```bash
python exp8_math/code/apply_edit.py \
  ./Qwen3.5-0.8B/model.safetensors \
  exp8_math/runs/p50c/edit \
  ./Qwen3.5-0.8B-wsp.safetensors
```

实际运行时，应先确认下载文件布局和 Safetensors 文件名；如果模型使用分片文件，需要按仓库脚本的加载方式提供正确的权重文件。

`apply_edit.py` 不只是简单地把两个矩阵覆盖掉。它会：

1. 读取权重编辑 Manifest；
2. 检查基础 Tensor 的 Shape；
3. 校验基础 Tensor 的 SHA-256；
4. 根据稀疏坐标和 BF16 数值重建编辑结果；
5. 校验编辑后 Tensor 的 SHA-256；
6. 保存重建后的模型权重。

这比只下载一个模型文件更有研究价值，因为它提供了可审计的参数变更记录。

### 10.1 用 vLLM 运行编辑后的模型

Hugging Face 模型页提供了可运行示例：

```python
from vllm import LLM, SamplingParams
from transformers import AutoTokenizer

ckpt = "RikiyaT/Qwen3.5-0.8B-weight-space-programming"

tokenizer = AutoTokenizer.from_pretrained(ckpt)

llm = LLM(
    model=ckpt,
    dtype="bfloat16",
    max_model_len=34816,
)

prompt = tokenizer.apply_chat_template(
    [
        {
            "role": "user",
            "content": (
                "What is 2^10 + 24? "
                "Please reason step by step, "
                "and put your final answer within \\boxed{}."
            ),
        }
    ],
    tokenize=False,
    add_generation_prompt=True,
    enable_thinking=True,
)

params = SamplingParams(
    n=1,
    temperature=0.6,
    top_p=0.95,
    top_k=20,
    presence_penalty=1.5,
    max_tokens=32768,
    seed=0,
)

outputs = llm.generate([prompt], params)
print(outputs[0].outputs[0].text)
```

模型页面：[Qwen3.5-0.8B Weight-Space Programming](https://huggingface.co/RikiyaT/Qwen3.5-0.8B-weight-space-programming)。

这个示例可以用于验证模型运行和输出，但不能仅凭一道题判断模型的通用能力。需要运行完整测试集，并保留基线、编辑版本和评估配置。

## 11. 严格意义上的 Weight-Space Programming 应该如何工作？

MIT 的实验提供了一个很有价值的工程模式：LLM 负责理解目标、分析权重和提出修改，确定性工具负责张量读取、计算、写入和评估。

![LLM 驱动的权重编程闭环](/diagrams/weight-space-programming/04-weight-programming-loop.svg)

*图源：[独立 HTML 版本](/diagrams/weight-space-programming/04-weight-programming-loop.html)，可在浏览器中放大查看。*

这个流程中有几个重要的设计原则。

**第一，LLM 不应该直接拥有生产模型文件的写权限。** 它应该在隔离环境中生成 Patch，由独立程序验证后再应用。

**第二，模型修改必须可回滚。** 原始权重不能被覆盖，应该保留不可变的 Base Checkpoint 和独立的 Patch Artifact。

**第三，Forward Pass 预算必须明确。** 运行目标模型会产生推理成本，也会影响编辑结果。评估预算应作为实验配置保存。

**第四，权重编辑和模型发布应该分离。** LLM 可以提出候选模型，但是否进入生产环境应由独立的验证流程决定。

## 12. 企业级应用：真正值得研究的场景

### 12.1 Model Debugging：模型内部行为诊断

这是最接近工程价值的方向。

例如，一个小模型在数学推理、SQL 生成或代码生成时反复输出相同内容。

传统方式通常是：

- 修改 Prompt；
- 调整 Sampling；
- 增加 Stop Sequence；
- 更换模型；
- Fine-tuning；
- 在 Agent Runtime 增加循环检测。

Weight-Space Programming 提供了另一种可能：让模型分析参数或中间计算，定位可能导致重复行为的内部路径，再提出局部修改。

但生产系统仍然应该先排除 Prompt、Sampling、Tokenizer、Chat Template 和 Serving Runtime 等外围问题，不能看到循环就直接修改权重。

### 12.2 Model Repair：修复模型特定故障

如果一个模型在某些固定场景下出现稳定的内部行为错误，可以尝试局部权重编辑。

例如：

- 特定输入触发重复输出；
- 某个策略网络总是选择错误动作；
- 某个模型的输出层出现异常偏向；
- 某个特定模块造成明显的行为退化。

这类场景的前提是：失败行为可以稳定复现，并且有明确的评估标准。

### 12.3 Domain Adaptation：领域能力适配

企业可能希望一个模型同时具备：

- 金融领域知识；
- SQL 生成能力；
- 企业架构分析能力；
- 文档理解能力；
- 特定的输出风格。

短期内，LoRA 和 Fine-tuning 仍然是更可靠的选择。

未来可以研究 Task Vector 和 Weight Editing 是否能够帮助组合或修复这些能力，但不能默认多个领域能力可以直接相加。

### 12.4 Personalized Model：用户个性化模型

这是一个值得进一步研究的方向。

例如，一个用户长期使用 Agent 后，系统已经积累了：

- 输出格式偏好；
- 编程习惯；
- 术语偏好；
- 代码审查标准；
- 文档写作风格；
- 对不同任务的处理偏好。

传统方案通常把这些信息放在 Prompt、Memory 或外部配置中。

另一种可能是把经过用户确认的偏好转化为独立 Adapter 或参数更新，让模型在推理时具备更稳定的个性化行为。

但必须区分三个层次：

| 方法 | 适合解决什么问题 | 风险 |
| --- | --- | --- |
| Memory / Prompt | 快速表达用户偏好 | 上下文长度、指令冲突 |
| LoRA Adapter | 稳定的任务或风格适配 | 需要训练和回归评估 |
| Direct Weight Editing | 尝试直接修改模型内部行为 | 可解释性、局部性和副作用尚不成熟 |

在现阶段，用户个性化不应该直接从权重编辑开始。更合理的路线是先建立偏好数据、评价指标和 Adapter，再研究是否需要进一步做权重级修改。

### 12.5 Anthropic Persona Vectors：如何提取、测量和干预模型行为

上一节介绍了 Persona Vectors 与 Weight-Space Programming 的关系。本节回到 Anthropic 的原始研究，按论文实验顺序解释它究竟做了什么、哪些结果有证据支持、官方代码如何复现，以及为什么它还不能被当作生产环境的通用安全开关。

研究原文：[Persona Vectors: Monitoring and Controlling Character Traits in Language Models](https://arxiv.org/abs/2507.21509)，Anthropic 于 2025 年 8 月 1 日发布研究介绍。作者包括 Runjin Chen、Andy Arditi、Henry Sleight、Owain Evans 和 Jack Lindsey。官方实现位于 [safety-research/persona_vectors](https://github.com/safety-research/persona_vectors)。

#### 12.5.1 研究真正想解决的问题：行为漂移不一定发生在输出文本层

通常我们通过最终输出判断模型行为：它是否迎合用户、是否编造事实、是否给出有害建议。这种方式有一个明显缺陷：当输出已经表现出问题时，行为偏移已经发生。更重要的是，输出文本只能告诉我们“模型说了什么”，不能直接告诉我们模型在生成之前是否已经进入了某种行为状态。

Anthropic 的假设是：模型的高层行为特征会在内部激活空间中留下可测量的信号。假设一个模型在不同上下文中表现出两种行为：

- A：用户提出一个没有证据支持的结论，模型明确指出证据不足。
- B：用户提出同样的结论，模型为了迎合用户而表示赞同，甚至补充不存在的证据。

如果模型内部存在与“迎合”相关的方向，那么 B 类响应的某些层激活，平均而言可能沿该方向比 A 类响应更远。通过对照实验，就有机会提取出这个方向。

这里的 Persona 不是心理学意义上的人格诊断，也不是给模型贴上“诚实”“邪恶”等标签。它是一个操作性定义：研究者先定义某种可观察行为，再通过对照数据和模型内部激活，构造一个可以测量、并且可以尝试干预的方向。

研究主要关注三种负面特征：

| 特征 | 论文中的含义 | 企业系统中可能观察到的表现 |
| --- | --- | --- |
| Evil | 恶意、伤害他人或漠视他人福祉 | 生成有害建议、鼓励伤害或操纵 |
| Sycophancy | 过度赞同、奉承用户 | 用户表达错误观点时仍然附和，改变判断迎合用户 |
| Hallucination | 编造不存在的信息 | 对未知事实给出虚构细节，或把猜测表达成事实 |

论文还在附录中研究了 optimism、impoliteness、apathy 和 humor 等其他特征。方法本身并不局限于负面特征：只要能给出足够清楚的行为定义，并构造出可靠的正反例，就可以尝试提取相应方向。

#### 12.5.2 先理解 Residual Stream：Persona Vector 究竟存在于哪里

Transformer 每一层都会处理输入 Token，并更新内部表示。以典型的 Transformer Block 为例，输入隐藏状态经过 Attention 和 MLP 等子层后，会通过残差连接累加到 Residual Stream。可以把 Residual Stream 理解为贯穿网络各层、不断累积和传递信息的主干表示。

对第 \(\ell\) 层、第 \(t\) 个 Token，记其激活为：

\[
h_{\ell,t}\in\mathbb{R}^{d}
\]

其中 \(d\) 是模型的 Hidden Size。以 Qwen2.5-7B 为例，隐藏维度为 3584；Llama-3.1-8B 的隐藏维度为 4096。每个 Token 在每一层都有一个这样的高维向量。

Persona Vector 是同一模型、同一层、同一表示位置上的一个方向：

\[
v_{\ell}^{(p)}\in\mathbb{R}^{d}
\]

它与模型参数 \(\theta\) 完全不是同一种对象：

- \(\theta\)：模型参数，决定模型的计算函数。
- \(h_{\ell,t}\)：模型运行某次 Forward Pass 时产生的中间状态。
- \(v_{\ell}^{(p)}\)：研究者从一批中间状态中估计出的行为方向。

因此，Persona Vector 并不是模型文件中的一组新权重。加载一个向量文件不会自动改变模型；只有在模型运行时把它用于投影、监控或激活干预，才会产生作用。

#### 12.5.3 向量提取流水线：不是简单地让模型回答两组问题

Anthropic 的方法有一个值得重视的设计：它把“行为定义、对照数据生成、行为评分、激活提取、向量选择”拆成了明确步骤，而不是直接对任意两段文本做 Embedding 差分。

论文中的实验流程如下。

~~~mermaid
flowchart TD
    A["Trait name + natural-language definition"] --> B["Claude 3.7 Sonnet generates trait artifacts"]
    B --> C["5 pairs of positive / negative system prompts"]
    B --> D["40 evaluation questions"]
    B --> E["Trait evaluation rubric"]
    D --> F["20 extraction questions"]
    D --> G["20 held-out evaluation questions"]
    C --> H["Target model generates contrastive responses"]
    F --> H
    H --> I["GPT-4.1-mini scores trait expression"]
    I --> J["Keep positive score > 50 and negative score < 50"]
    J --> K["Extract Residual Stream activations at every layer"]
    K --> L["Average response-token activations"]
    L --> M["Positive mean minus negative mean"]
    M --> N["Candidate vector for each layer"]
    N --> O["Steering experiments select useful layer"]
    O --> P["Validated Persona Vector"]
~~~

**第一步：把抽象特征转成可执行定义。**

输入不只是一个单词 sycophancy，还包括自然语言描述，例如“模型为了获得用户认可而过度赞同用户观点，即使用户的观点缺乏证据或明显错误”。定义越含糊，后面的样本筛选和评估就越容易失真。

论文使用 Claude 3.7 Sonnet（Thinking 模式）生成三类实验材料：

1. 五对正反 System Prompts。正向 Prompt 鼓励目标特征，负向 Prompt 抑制目标特征。
2. 四十个可能触发目标行为的问题，其中二十个用于提取向量，另外二十个留作下游评估。
3. 一个行为评分 Rubric，用于判断模型响应在多大程度上体现目标特征。

这里使用不同用途的数据集很重要。若提取和验证使用完全相同的问题，很容易把对某些 Prompt 的适配误当成可泛化的行为方向。

**第二步：生成正反响应，而不是直接使用 System Prompt 的标签。**

对每个提取问题，目标模型分别在正向和负向 System Prompt 下生成响应。论文对每种配置进行 10 次 Rollout，以获得一定的采样变化。

但 System Prompt 只是实验条件，不是行为事实。模型即使收到“你是一个邪恶的助手”的指令，也可能拒绝这样做；反过来，一个看似正常的 Prompt 也可能诱发迎合或编造。因此，不能简单地把所有正向 Prompt 的输出都当成正样本、所有负向 Prompt 的输出都当成负样本。

**第三步：使用 LLM Judge 对真实行为进行筛选。**

论文使用 GPT-4.1-mini 对模型 Transcript 进行评分，分数范围是 0 到 100：

- 0：没有表现目标特征。
- 100：强烈表现目标特征。
- 正向样本：保留评分大于 50 的响应。
- 负向样本：保留评分小于 50 的响应。

作者还检查了 LLM Judge 与人工评估者之间的一致性，并使用外部 Benchmark 验证问题集是否能够捕捉目标行为。这一步非常关键：向量最终反映的是被保留下来的行为差异，而不是 Prompt 文本之间的差异。

不过，Judge 仍然是一个有误差的测量工具。评分模型可能误判讽刺、复杂语境、事实争议或礼貌表达；如果评分 Rubric 本身有偏差，向量就会继承这种偏差。因此，实际复现时应保存 Judge 的原始分数、理由、人工抽检结果和数据版本，而不是只保存最终的 PT 文件。

**第四步：从 Residual Stream 提取激活。**

对每一条通过筛选的响应，论文提取目标模型每一层的 Residual Stream 激活，并对响应 Token 求平均。注意：用于提取向量的主要是 Response Tokens，而不是整个 Prompt 的平均激活，也不是最终输出文本的 Embedding。

对第 \(i\) 条响应，在第 \(\ell\) 层，定义：

\[
a_{\ell}^{(i)}
=
\frac{1}{T_i}
\sum_{t=1}^{T_i}h_{\ell,t}^{(i)}
\]

其中 \(T_i\) 是该响应的 Token 数量。然后分别计算正样本和负样本的均值：

\[
\mu_{\ell}^{+}
=
\frac{1}{N_+}\sum_{i\in P}a_{\ell}^{(i)}
\]

\[
\mu_{\ell}^{-}
=
\frac{1}{N_-}\sum_{i\in N}a_{\ell}^{(i)}
\]

最终得到每一层的候选 Persona Vector：

\[
v_{\ell}^{(p)}=\mu_{\ell}^{+}-\mu_{\ell}^{-}
\]

这就是核心算法：对比两类行为样本在模型内部表示上的平均差异。

**第五步：每一层都得到候选向量，再选择有效层。**

不同层可能编码不同抽象程度的信息。论文先对所有层生成候选向量，再通过实际 Steering 实验比较各层效果，选择对目标特征干预最有效的层。不能因为某个层编号在 Qwen 上有效，就认为 Llama 或其他模型也应该使用相同层编号。

#### 12.5.4 为什么论文要区分 Response Vector 和 Prompt Vector

这项研究有两个容易混淆、但用途不同的测量位置。

| 激活位置 | 提取方式 | 主要用途 |
| --- | --- | --- |
| Response Tokens | 对模型生成响应中的 Token 激活求平均 | 论文主要用于构造 Persona Vector，并做生成期间的 Steering |
| Last Prompt Token | 取 Assistant 开始生成之前最后一个 Prompt Token 的激活 | 在生成前估计当前上下文是否已将模型推向某种行为特征 |

为什么 Response Tokens 更适合提取向量？因为研究目标是找出与实际表现出的行为相关的内部方向。响应生成过程中，目标行为已经在模型内部计算中体现出来。论文发现，用 Response Token 激活得到的方向，比使用 Prompt Token 位置得到的方向更适合 Steering。

为什么 Last Prompt Token 又有价值？因为它位于模型开始回答之前。若此时的激活已经明显投影到“迎合”方向，系统就有机会在生成之前识别风险，而不是等输出后再做检测。

这两种测量不要混为一谈：用 Response Token 激活提取的向量，可以用于监控 Last Prompt Token 的投影；但它们的采样位置、统计意义和使用场景不同。

#### 12.5.5 如何监控行为漂移：把激活投影变成一个指标

向量提取完成后，可以计算当前激活在 Persona Vector 方向上的投影。

先对向量归一化：

\[
\hat v_{\ell}=\frac{v_{\ell}}{\|v_{\ell}\|_2}
\]

然后对当前激活 \(h_{\ell}\) 计算：

\[
s_{\ell}=\langle h_{\ell},\hat v_{\ell}\rangle
\]

\(s_{\ell}\) 越大，表示当前激活沿该方向的分量越大。它是一个内部状态测量值，不是“模型有 87% 概率在撒谎”这样的概率，也不能脱离模型版本、层、Token 位置和校准集进行跨模型比较。

论文在部署期监控实验中，使用不同强度的 System Prompt 和 Many-shot Prompt 诱发行为变化，然后测量最后一个 Prompt Token 的激活投影。论文报告，投影与后续响应中的目标特征评分具有 \(r=0.75\) 到 \(0.83\) 的相关性。

但这里有一个非常重要的限定：作者发现，这种相关性主要来自明显不同的 Prompt 条件，例如明确鼓励目标特征与明确抑制目标特征之间的差异；在控制 Prompt 类型后，相关性会明显减弱。因此，这个结果支持它检测显式、较强的上下文诱导行为变化，但不能据此宣称它可以可靠地预测所有细微的真实世界行为漂移。

一个实际监控系统不能只设置 projection 大于某个 threshold 就报警。需要在目标模型上建立正常流量基线，按任务类型、上下文长度、模型版本和对话阶段校准阈值，并把激活投影与输出行为评测、业务规则和用户反馈结合起来。

#### 12.5.6 推理期 Steering：通过修改中间激活改变当前生成

Persona Vector 的第二个用途是因果干预。给定某一层的向量 \(v_{\ell}\)，在模型 Forward Pass 时把它加到 Residual Stream：

\[
h_{\ell}\leftarrow h_{\ell}+\alpha v_{\ell}
\]

其中 \(\alpha\) 是 Steering Coefficient。

- \(\alpha>0\)：推动模型沿向量方向移动。
- \(\alpha<0\)：推动模型沿反方向移动。
- \(|\alpha|\) 越大：干预通常越强，但副作用风险也可能越高。

论文通过向 evil、sycophancy 和 hallucination 方向加向量，观察到相应行为评分上升。这是一个重要的因果证据：向量不仅能区分两类样本，还能通过人为注入改变模型行为。

但“能诱发一种行为”与“能安全地消除一种行为”不是同一件事。论文在微调后的模型上尝试减去不良 Persona Vector，发现目标行为确实可以下降，但较大的 Steering Coefficient 会降低 MMLU 等通用能力指标。模型内部表示是多种能力共同使用的空间，一个行为方向不一定与其他能力完全正交。

因此，推理期 Steering 更适合做受控实验或有独立评估支撑的局部干预，不应简单作为安全过滤器部署。特别是 Hallucination Vector 的反向干预，并不等同于事实核验；模型可能只是更少生成某类表达，也可能连正常推理和知识表达一起受影响。

#### 12.5.7 最反直觉的部分：Preventative Steering 为什么在训练时加上“不良方向”

论文不只研究部署期控制，还研究 Fine-tuning 如何改变模型行为。

作者构造了两类训练数据：

1. 显式诱导目标特征的数据，例如恶意回答、过度赞同用户、编造事实。
2. 带有局部缺陷但没有直接表达目标特征的数据，例如错误医疗建议、有漏洞的代码、错误数学解答或有缺陷的观点论证。这类数据用于研究类似 Emergent Misalignment 的意外泛化。

每类数据又有 Normal、I、II 等不同版本，表示从正常样本、轻度缺陷到明显缺陷的程度。研究观察到，Fine-tuning 不仅可能强化训练数据直接表达的特征，也可能引起其他特征的变化。例如针对某一种行为构造的数据，可能同时提高模型的迎合或幻觉倾向；某些带有隐蔽缺陷的数学数据，也可能诱发与原始任务看起来无关的行为变化。

作者进一步比较 Fine-tuned Model 与 Base Model 的激活变化，并把变化投影到对应 Persona Vector 上。论文报告，特征方向上的激活变化与目标行为评分之间存在较强正相关，相关系数约为 \(r=0.76\) 到 \(0.97\)。这说明 Persona Vector 不仅能监控 Prompt 诱导的行为，也可能成为观察训练前后行为漂移的指标。

**Post-hoc Steering 的问题**是：训练完成后再减去不良方向，虽然可能降低目标行为，但也会损害其他能力。

于是作者提出了一个看似反直觉的做法：在 Fine-tuning 过程中，主动把模型激活推向那个“不希望最终出现”的 Persona Vector 方向。其直觉是，训练目标本身会给模型施加压力，使它沿某个方向变化；如果训练过程中已经通过 Steering 提供了这部分方向上的激活，模型就不必通过参数更新去获得同样的行为变化，从而降低训练结束后沿该方向发生的漂移。

可以把两种方法区分为：

| 方法 | 何时干预 | 激活操作 | 论文观察 |
| --- | --- | --- | --- |
| Post-hoc inhibition | Fine-tuning 完成后 | 推理时减去不良方向 | 能降低目标特征，但强干预可能降低 MMLU |
| Preventative steering | Fine-tuning 期间 | 训练时向不良方向加向量 | 在论文实验中更好地保留通用能力，并限制训练诱导的特征漂移 |
| CAFT 对照方法 | Fine-tuning 期间 | 对不希望的概念方向做 zero-ablation | 对 evil、sycophancy 有效，但论文中对 hallucination 的效果不理想 |

论文报告，Preventative Steering 在多个数据集和模型实验中降低了训练引起的行为漂移，平均 Coherence Score 保持在 80 以上。单层干预并不总能完全阻止显式诱导目标特征的数据；作者在附录中进一步研究了多层干预，在其特定实验中取得更强效果，且没有观察到相对于普通 Fine-tuning 的 MMLU 退化。

这里不能把“训练时加不良向量”理解成向模型注入有害能力，更不能直接当作可复制的安全配方。它是针对训练优化过程的内部激活干预，需要复现模型、数据、训练参数和评估条件；对其他训练目标、模型规模和数据分布是否有效，仍需要单独验证。

#### 12.5.8 训练数据筛查：Projection Difference 比简单扫描文本更有价值

Persona Vector 的第三个用途，是在训练开始之前估计数据可能把模型推向哪个行为方向。

假设训练数据集为：

\[
\mathcal D=\{(x_i,y_i)\}
\]

其中 \(x_i\) 是 Prompt，\(y_i\) 是训练数据中提供的 Response。对每个 Prompt，研究者还让 Base Model 自己生成一个自然响应 \(y'_i\)。

分别计算训练响应和模型自然响应在 Persona Vector 方向上的激活投影，然后定义：

\[
\Delta P=
\frac{1}{|\mathcal D|}
\sum_i
\left[
a_{\ell}(x_i,y_i)-a_{\ell}(x_i,y'_i)
\right]\cdot\hat v_{\ell}
\]

其中 \(a_{\ell}(x,y)\) 是模型在第 \(\ell\) 层对响应 Token 激活求得的平均表示，\(\hat v_{\ell}\) 是归一化后的 Persona Vector。

为什么不直接计算训练响应在向量上的投影？因为某个回答即使在“迎合”方向上得分很高，也不代表它会让模型发生新的行为变化。如果 Base Model 在同一个 Prompt 下本来就会给出类似回答，那么这条训练样本并没有提供太多新的方向性信号。

Projection Difference 比较的是“训练数据要求模型学会什么”与“模型本来会怎么回答”之间的差异，因此更接近训练数据可能引起的参数更新压力。

论文在合成数据集上验证了 Dataset-level Projection Difference 与 Fine-tuning 后的特征变化之间的相关性，并进一步在 LMSYS-Chat-1M 真实对话数据上做实验。研究发现，按 Projection Difference 选出的高分样本，在 Fine-tuning 后更容易诱发相应的行为特征；低分样本则通常表现出相反趋势。这个现象在先用 LLM Judge 过滤明显不良样本后仍然存在。

这对企业训练数据治理有实际启发：传统数据质量检查关注文本是否包含明显有害内容、事实错误或违规词句；Persona Vector 分析关注的是这些样本是否会在模型内部产生某种方向性影响。论文还发现，向量筛查与 LLM Judge 筛查具有互补性，不能简单认为其中一种可以取代另一种。

但 Projection Difference 也有成本：它需要针对训练集中的 Prompt 运行 Base Model，获得自然响应作为对照。对于数千万条训练样本，直接全量计算可能很昂贵。论文讨论了更低成本的近似方法，但实际项目仍需比较筛查成本、漏报率和训练后行为变化。

#### 12.5.9 官方代码如何复现：数据、向量文件和命令

官方仓库：[safety-research/persona_vectors](https://github.com/safety-research/persona_vectors)。它不是只有一段 Hook 示例，而是包含数据生成、模型评估、激活提取、向量生成、投影计算、推理期 Steering 和训练期干预等脚本。

README 中展示的典型流程如下。

**1. 安装与准备**

~~~bash
git clone https://github.com/safety-research/persona_vectors.git
cd persona_vectors

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# 按 README 配置模型访问和评估所需的 API Key
unzip dataset.zip
~~~

仓库提供预生成的 Trait Artifacts，位于 `data_generation/trait_data_extract/` 和 `data_generation/trait_data_eval/`。每个特征的数据包含正反 Prompt、评估问题和 Judge Rubric。要增加新特征，可以参考 `data_generation/prompts.py` 中的生成 Prompt。

**2. 生成正反样本**

下面是 README 中的命令形式，分别生成正向和负向 System Prompt 下的评估数据：

~~~bash
CUDA_VISIBLE_DEVICES=0 python -m eval.eval_persona \
  --model Qwen/Qwen2.5-7B-Instruct \
  --trait evil \
  --output_path eval_persona_extract/Qwen2.5-7B-Instruct/evil_pos_instruct.csv \
  --persona_instruction_type pos \
  --assistant_name evil \
  --judge_model gpt-4.1-mini-2025-04-14 \
  --version extract

CUDA_VISIBLE_DEVICES=0 python -m eval.eval_persona \
  --model Qwen/Qwen2.5-7B-Instruct \
  --trait evil \
  --output_path eval_persona_extract/Qwen2.5-7B-Instruct/evil_neg_instruct.csv \
  --persona_instruction_type neg \
  --assistant_name helpful \
  --judge_model gpt-4.1-mini-2025-04-14 \
  --version extract
~~~

**3. 计算 Persona Vector**

~~~bash
python generate_vec.py \
  --model_name Qwen/Qwen2.5-7B-Instruct \
  --pos_path eval_persona_extract/Qwen2.5-7B-Instruct/evil_pos_instruct.csv \
  --neg_path eval_persona_extract/Qwen2.5-7B-Instruct/evil_neg_instruct.csv \
  --trait evil \
  --save_dir persona_vectors/Qwen2.5-7B-Instruct/
~~~

仓库生成三类主要文件：

| 文件 | 内容 | 论文中的用途 |
| --- | --- | --- |
| `prompt_avg_diff.pt` | 正负样本 Prompt Token 平均激活差 | Prompt 位置的对照向量 |
| `prompt_last_diff.pt` | 最后一个 Prompt Token 的激活差 | 生成前监控相关实验 |
| `response_avg_diff.pt` | 正负样本 Response Token 平均激活差 | 论文主要用于 Steering 的向量 |

向量 Tensor 的形状为 `[layers, hidden_dim]`。仓库的 `generate_vec.py` 会逐层提取正负样本激活，分别计算均值，再做差分。实际使用时可以通过 `--layer` 选择层，通过 `--coef` 调整干预强度。

**4. 运行 Steering 评估**

~~~bash
CUDA_VISIBLE_DEVICES=0 python -m eval.eval_persona \
  --model Qwen/Qwen2.5-7B-Instruct \
  --trait evil \
  --output_path eval_persona_eval/steering_results.csv \
  --judge_model gpt-4.1-mini-2025-04-14 \
  --version eval \
  --steering_type response \
  --coef 2.0 \
  --vector_path persona_vectors/Qwen2.5-7B-Instruct/evil_response_avg_diff.pt \
  --layer 20
~~~

README 还提供训练期 Steering 的配置示例。配置中的向量路径、层号和系数都应当视为实验参数，不是推荐生产值。仓库实现依赖具体模型结构、评估服务和训练配置，开始复现前应先阅读当前主分支的 README、requirements 和脚本，而不是假定历史命令在任意环境中都能直接运行。

**5. 如何理解最小实现的边界**

如果自己写一个 Hook，核心操作确实只有一行：

~~~python
hidden_states[:, token_positions, :] += alpha * persona_vector
~~~

但完整实现还必须回答：Hook 挂在 Block 输入还是输出？对所有 Token 还是只对生成 Token 生效？Prefill 与 KV Cache Decode 阶段是否一致？Batch 内不同请求能否使用不同系数？多卡模型的向量应该放到哪个 Device？这些问题决定了一个研究 Demo 能否成为可靠 Serving 组件。

#### 12.5.10 2026 年 Anthropic 的后续研究：Assistant Axis 将问题扩展到 Persona Space

2026 年 1 月，Anthropic 发布了另一项相关研究 [The Assistant Axis: Situating and Stabilizing the Default Persona of Language Models](https://www.anthropic.com/research/assistant-axis)，对应论文 [arXiv:2601.10387](https://arxiv.org/abs/2601.10387) 和代码仓库 [safety-research/assistant-axis](https://github.com/safety-research/assistant-axis)。

它与 2025 年 Persona Vectors 的关系是“相关但不同的研究问题”：

- Persona Vectors：给定一个具体特征，例如 sycophancy，提取该特征的方向，用于测量、控制和预测该特征。
- Assistant Axis：研究模型默认的 Assistant 身份在更大 Persona Space 中处于什么位置，以及模型在多轮对话中是否逐渐偏离这一位置。

Assistant Axis 研究从 275 种角色原型（Character Archetypes）中提取激活表示，例如 Editor、Jester、Oracle、Ghost 等，再分析不同角色在激活空间中的结构。实验涉及 Gemma 2 27B、Qwen 3 32B 和 Llama 3.3 70B 等开源权重模型。作者将默认 Assistant 激活与其他角色激活的平均差异定义为 Assistant Axis，并发现它与 Persona Space 的主要变化方向相吻合。

研究还提出 Activation Capping：不是持续把模型推向 Assistant 方向，而是估计正常 Assistant 行为下的激活范围，只在激活沿 Assistant Axis 超出设定范围时进行限制。Anthropic 报告称，这种方法在其测试中将有害响应率降低约 50%，同时保留了所测能力 Benchmark 的表现。

这项研究把问题从“某个特征是否被激活”扩展到“模型整体角色身份是否发生漂移”。例如，在某些长对话中，模型可能逐渐从助手转向某种角色扮演状态；这种漂移不一定在单轮输出中明显，却可能改变后续面对有害请求时的响应方式。

它也带来新的工程启发：监控系统可以同时保留多个具体 Persona Vectors 和一个更高层的 Assistant Axis。前者用于识别特定风险倾向，后者用于观察模型整体角色状态。但二者仍然只是激活空间测量与干预方法，不能取代输出层安全评估和业务策略。

#### 12.5.11 研究结果的边界：哪些结论可以用，哪些不能外推

Persona Vectors 是有价值的机制可解释性工具，但论文并没有证明模型人格可以被一个向量完整描述。需要特别注意以下边界：

1. **模型覆盖有限**：原始实验主要使用 Qwen2.5-7B-Instruct 和 Llama-3.1-8B-Instruct。不能假设相同向量、层位置或阈值适用于 Claude、GPT、Gemini 或其他模型。
2. **特征定义依赖人工和 LLM**：自然语言定义、正反 Prompt、评估问题和 Judge Rubric 都会影响最终向量。不同定义得到的向量可能不同。
3. **LLM Judge 不是客观真值**：论文做了人工一致性检查，但 Judge 仍可能漏掉语境、讽刺和隐性行为。生产系统需要独立人工评估和领域评估。
4. **线性方向只是近似**：模型行为可能由多个方向、多个层和非线性电路共同决定。单一向量不能完整表达一个复杂人格特征。
5. **不同特征可能相关**：论文观察到一些负面特征会共同变化，Persona Vectors 之间也可能存在相关性。因此，抑制一个方向可能影响其他特征。
6. **监控相关性不等于因果预测**：Prompt 类型之间的强相关不能直接证明对任意自然对话中的微妙漂移都有同样的预测能力。
7. **训练期效果依赖训练条件**：Preventative Steering 的结果来自特定模型、训练数据和配置；需要在自己的 Fine-tuning 流程中重新验证。
8. **向量不是安全边界**：攻击者可能绕过单一方向检测；正常行为也可能在激活空间中投影较高。它不替代 Policy、权限控制、工具沙箱、事实校验和红队测试。

尤其要避免一个常见误解：Persona Vector 的方向具有可解释的行为相关性，不代表它对应一个可被独立定位的神经元、一个唯一电路，或者一个可以直接映射到少数权重的参数补丁。要从激活方向进一步找到权重层面的因果机制，还需要组件消融、因果追踪、梯度分析或参数编辑实验。

#### 12.5.12 企业落地建议：把它放进 Model Evaluation 和 Model Governance，而不是直接放进 Prompt 工程

对于企业架构团队，比较现实的落地路径不是一开始就修改线上模型，而是先把 Persona Vector 当作额外的模型诊断维度。

| 阶段 | 工作内容 | 产出 | 主要验收标准 |
| --- | --- | --- | --- |
| 1. Behavior Specification | 将“不要迎合”“不要编造”等要求定义成可测试行为 | 特征定义、正反例、领域测试集 | 业务和风险团队能判定样本是否符合定义 |
| 2. Offline Extraction | 对指定模型提取候选向量 | 版本化 Persona Vector | 数据、模型、层和脚本可追溯 |
| 3. Calibration | 比较投影值与行为评分 | 阈值、基线和校准报告 | 对正反例有区分力，误报和漏报可量化 |
| 4. Shadow Monitoring | 在离线或 Shadow Traffic 中计算投影 | 行为漂移指标 | 不影响在线响应，能够与业务指标关联 |
| 5. Controlled Steering | 在隔离环境尝试运行时干预 | Steering 参数和效果报告 | 目标行为改善，其他能力无不可接受退化 |
| 6. Training Data Audit | 对 Fine-tuning 数据计算 Projection Difference | 数据风险分布和样本清单 | 与训练后行为变化做回测 |
| 7. Governance | 纳入模型版本、审批、回滚和审计 | Model Card、向量制品、评估记录 | 可以复现、回滚和解释每次变更 |

如果是在金融研究 Agent 中应用，优先考虑监控 sycophancy：当用户明确表达某个投资观点时，模型是否因为用户的语气或身份而改变证据标准？其次可以评估 hallucination：当 Reference Data 不完整、价格或持仓缺失时，模型是否倾向于补造数据？这些都是可以构造对照样本、通过人工和业务规则验证的行为目标。

但要把 Persona Vector 指标与业务结果分开。高 sycophancy 投影并不自动意味着该条回答错误；低 hallucination 投影也不代表回答一定真实。最终判断仍应基于引用证据、数据来源、领域规则和独立测试。


### 12.6 Model Auditing：权重级安全审计

Weight Oracles 研究提出了一个值得关注的方向：直接分析模型权重，判断模型是否存在某些异常行为或潜在 Backdoor。

论文：[Weight Oracles: Reading Neural Network Weights with Language Models](https://arxiv.org/html/2610.07334)。

该研究报告了小型网络上的 Backdoor Detection 结果，但其测试网络约为 2K 参数，尚不能据此认定能够直接审计真实生产规模的大模型。

在企业环境中，这类能力未来可能用于：

- 模型供应链审查；
- 权重文件完整性和来源核验；
- 发现异常参数变化；
- 对比不同版本的模型行为；
- 检查第三方模型是否包含非预期修改。

但是，权重异常检测不能代替模型行为测试。没有发现异常权重模式，不等于模型没有 Backdoor。

## 13. 企业架构应该怎么设计？

如果未来要把 Weight-Space Programming 纳入企业模型平台，建议将它视为一个受控的模型研发和模型修复流程，而不是直接接入生产推理请求的实时工具。

![企业级 Weight-Space Programming 治理架构](/diagrams/weight-space-programming/05-enterprise-governance.svg)

*图源：[独立 HTML 版本](/diagrams/weight-space-programming/05-enterprise-governance.html)，可在浏览器中放大查看。*

### 13.1 Model Registry：权重版本必须可追溯

每一个候选模型至少需要记录：

| 字段 | 作用 |
| --- | --- |
| Base Model ID | 基础模型标识 |
| Base Revision | 原始模型的不可变版本 |
| Tensor Manifest | 被修改的 Tensor 列表 |
| Patch Hash | 权重差异文件的 Hash |
| Editor Model | 负责生成 Patch 的 LLM |
| Prompt / Task Specification | 修改目标和实验指令 |
| Tool Budget | Python、Forward Pass 等预算 |
| Evaluation Results | 修改前后的测试结果 |
| Approval Record | 人工审批信息 |
| Rollback Target | 原始模型版本 |

如果没有这些信息，后续很难解释某个生产模型为什么与官方基础模型不一致。

### 13.2 Sandbox：权重操作需要隔离

不要让一个具有普通工具权限的 Agent 直接修改生产模型目录。

建议使用隔离环境：

- 只读挂载基础权重；
- 独立的临时写入目录；
- 限制 CPU、Memory、Disk 和 GPU；
- 限制 Python 执行时间；
- 禁止未经授权的网络访问；
- 限制可写入的 Tensor 名称和 Shape；
- 对输出 Patch 进行格式校验；
- 保留每次操作的输入、代码和结果。

权重文件可能非常大，因此实际系统还需要支持按 Tensor 读取、低秩表示、稀疏差异和分块校验，避免把完整模型参数全部塞进 LLM Context Window。

### 13.3 Evaluation：不能只看一个 Benchmark

每次修改至少需要检查：

| 测试类别 | 检查内容 |
| --- | --- |
| Target Task | 目标任务是否改善 |
| General Capability | 通用推理、代码和语言能力是否退化 |
| Regression | 原来正常的任务是否失败 |
| Robustness | 不同 Prompt、不同输入分布是否稳定 |
| Safety | 是否引入不安全行为、越权或拒绝能力退化 |
| Multilingual | 不同语言表现是否发生变化 |
| Performance | Latency、Throughput、Memory |
| Reproducibility | 相同 Patch 是否可以重建相同模型 |

特别需要区分 Target Improvement 和 Capability Preservation。

目标任务提升不代表其他能力保持不变。

### 13.4 Rollback：不要原地修改基础模型

推荐采用不可变模型制品：

- Base Model：原始模型；
- Candidate Model：应用 Patch 后的候选模型；
- Approved Model：经过评估和审批的模型；
- Production Model：当前生产版本。

任何修改都应该生成新的 Model Version。

如果出现质量回归或安全问题，应该能够直接切回之前的 Approved Model，而不是尝试反向计算一个不可靠的权重补丁。

## 14. Weight-Space Programming 的安全问题

直接修改权重会带来新的风险。

### 14.1 Malicious Weight Patch

如果一个 Agent 能够修改模型权重，那么恶意指令或恶意 Patch 可能：

- 修改模型的拒绝行为；
- 注入隐藏的 Backdoor；
- 改变特定输入下的输出；
- 破坏原有安全对齐；
- 使模型在特定场景下泄露信息。

因此，Patch 必须有来源、Hash、审批和评估记录。

### 14.2 Supply Chain Risk

企业可能从第三方下载模型和 Adapter。

如果模型在下载、合并、编辑或重新打包时被修改，最终部署的权重可能与原始模型不同。

需要：

- 固定基础模型 Revision；
- 校验文件和 Tensor Hash；
- 保存 Patch Manifest；
- 对模型制品进行签名；
- 验证模型加载后的关键 Tensor；
- 对发布过程进行审计。

### 14.3 Cross-Task Regression

一个编辑可能改善数学推理，却破坏代码生成或多语言能力。

所以不能只对目标任务做测试。

建议建立固定的 Regression Suite，并为不同任务设置最低可接受的性能阈值。

### 14.4 Multi-tenant Isolation

不要让多个企业客户共享一个会被动态修改的基础模型权重文件。

如果需要个性化，优先使用隔离的 Adapter、独立模型版本或明确的租户级配置。

即使未来出现运行时权重编辑，也应该把编辑结果视为独立模型制品，而不是在多个租户之间共享可变参数状态。

### 14.5 Tamper Resistance

2026 年 8 月发布的 [TamperBench](https://dl.acm.org/doi/10.1145/3770855.3817557) 研究了开源大模型在 Fine-tuning 和权重篡改攻击下的安全性。

研究评估了 21 个开源模型和 9 类 Tampering Threat，指出现有 Alignment 阶段的防御并不能可靠抵抗所有攻击设置。

这类研究说明，未来模型平台不仅要评估模型能力，也要评估模型在受到参数级修改后是否还能维持安全属性。

## 15. 选型：什么时候应该使用哪种技术？

不应该因为 Weight-Space Programming 是一个新概念，就把所有模型定制工作都迁移到权重空间。

| 需求 | 首选技术 | 原因 |
| --- | --- | --- |
| 添加最新企业知识 | RAG / API / Knowledge Retrieval | 知识更新不需要修改模型权重 |
| 改变输出格式 | Prompt / Structured Output | 成本低、可回滚 |
| 个性化写作风格 | Prompt / LoRA | 有成熟的工程实现 |
| 学习企业领域任务 | LoRA / Fine-tuning | 有明确训练和评估流程 |
| 组合多个同源模型能力 | Model Merging / Task Arithmetic | 已有可用工具，但需要测试冲突 |
| 修改某个特定事实 | ROME / MEMIT 等 Model Editing | 有研究方法，但需要验证局部性 |
| 修复模型内部的特定行为 | Weight-Space Programming Research | 新方向，尚缺乏通用工程保证 |
| 审计模型权重异常 | Weight Oracles / Weight Analysis | 研究阶段，不能替代行为审计 |

可以把成熟度粗略归纳为：

| 技术 | 工程可用性 | 主要风险 |
| --- | --- | --- |
| Prompt / RAG | 高 | 检索质量、上下文和指令冲突 |
| LoRA / PEFT | 高 | 数据质量、Adapter 兼容和能力回归 |
| vLLM Adapter Serving | 高 | 资源隔离、容量和运行时兼容 |
| Model Merging | 中高 | 参数冲突、模型兼容性 |
| Model Editing | 研究到有限应用 | 连续编辑和副作用 |
| LLM-driven Weight-Space Programming | 研究阶段 | 泛化、可重复性、成本和安全 |

这里的成熟度是本文基于公开工具、官方文档和研究证据作出的工程判断，不是某个统一行业标准的认证结果。

## 16. 如果要做一个 PoC，建议怎么开始？

不建议一开始就尝试修改 70B 或更大的模型。更合理的方式是分阶段验证。

### Phase 1：建立权重空间基础设施

使用一个小型开源模型，完成：

1. 下载固定版本的模型；
2. 读取 Safetensors；
3. 输出 Tensor 名称、Shape、Dtype 和统计信息；
4. 计算基础模型 Hash；
5. 实现一个独立 Patch Manifest；
6. 实现 Patch 应用和回滚；
7. 确认重建后的 Tensor Hash 完全一致。

这一阶段不需要 LLM。

### Phase 2：实现传统权重运算

使用 PEFT 和 MergeKit：

- 训练两个不同任务的 LoRA Adapter；
- 计算 Task Vector；
- 使用 Linear、SLERP、TIES 等方法进行合并；
- 对比合并前后的任务效果；
- 记录不同参数组合的 Regression。

这一阶段的目标是理解参数更新、模型合并和任务冲突。

### Phase 3：尝试 Model Editing

使用 ROME 或 EasyEdit 等工具，在一个小模型上执行知识编辑。

重点评估：

- 编辑成功率；
- 编辑的局部性；
- 不同问法下的泛化；
- 连续编辑后的能力变化；
- 原始能力是否受到影响。

### Phase 4：构建受控 Weight-Space Programming Harness

让 LLM 通过受限 Python 环境读取权重、分析统计信息和提出 Patch。

Harness 需要负责：

- 模型加载；
- Tensor 读取；
- Shape 和 Dtype 检查；
- Patch 写入；
- Forward Pass；
- Evaluation；
- Hash 校验；
- 实验日志。

不要让 LLM 自己实现一个不受约束的模型加载和执行环境。

### Phase 5：建立独立验证和安全门禁

至少需要两套评估：

- Development Set：允许编辑模型时观察；
- Held-out Test Set：编辑过程完全不可见，最后统一评估。

否则，模型可能只是对开发集进行了隐式过拟合。

还需要有一组独立 Regression Test，检查目标任务以外的能力和安全属性。

## 17. 这项技术可能把模型研发带向哪里

如果这类方法能在更多模型和任务上复现，模型研发可能多出一个环节：先诊断，再决定是补数据、重新训练，还是做局部权重修复。它不一定取代训练，但有机会减少一些“明明只是一个局部故障，却要重新跑完整训练流程”的情况。

另一个变化是模型制品的管理范围会扩大。除了基础模型、Adapter 和评估报告，还要保存编辑目标、权重差异、执行环境、Forward Pass 预算和回归结果。否则，团队无法解释一个模型版本为什么发生变化，也无法可靠地回滚。

Agent 可能参与这类离线模型工程工作，但不应因此获得生产模型的直接写权限。权重编辑应当生成独立候选制品，经过评估和发布流程后才能替换线上版本。

## 18. 结论：它改变了什么，还没有证明什么

Weight-Space Programming 不是突然冒出来的一套全新数学。Task Vector、Model Merging、Model Editing 和 Mechanistic Interpretability 已经分别研究了参数差异、权重组合、局部编辑和模型内部机制。MIT 这项工作的变化在于：把这些操作交给通用 LLM，让它自己分析权重、提出修改，并通过模型反馈检查结果。

新进展不在于“权重可以修改”——这件事早有研究；新进展是通用 LLM 在受控环境里，已经能参与定位问题、选择参数位置并写入修改，而不只是调整 Prompt、训练脚本或配置。

这项研究给模型研发增加了一种可能的工作方式：

- 让 LLM 理解模型的参数结构；
- 根据目标分析内部权重；
- 通过有限的模型反馈定位问题；
- 直接提出权重修改；
- 使用确定性工具验证和重建模型；
- 通过独立评估决定是否接受修改。

但它还不能替代 Fine-tuning、LoRA 或已有的 Model Editing。跨模型能否奏效、连续修改会不会累积副作用、成本是否划算，以及安全性如何保证，都还没有答案。

对企业工程团队来说，短期内仍应使用 PEFT、MergeKit、vLLM 和现有评估体系。Weight-Space Programming 可以先放进研究验证环境，重点观察模型故障诊断、定向修复和权重审计，而不是直接接入生产模型发布链路。

接下来真正要验证的，不是 LLM 能不能改动几个 Tensor，而是它能否在不同模型和任务上稳定找到有效修改，并且通过独立测试证明没有破坏其他能力。做到这一步，权重编程才可能从有趣的研究实验变成可用的工程方法。

## 参考资料

### Weight-Space Programming 与最新研究

1. [Sparks of Weight-Space Programming: LLMs can natively read & write neural network weights](https://rikiyat.github.io/blog/weight-space-programming/) — MIT CSAIL，2026-11-02。
2. [Complete Experiment Logs](https://github.com/RikiyaT/lm_understand-logs) — 包含实验 Prompt、Python 代码、模型输出、权重差异和评估数据。
3. [Edited Qwen3.5-0.8B Model](https://huggingface.co/RikiyaT/Qwen3.5-0.8B-weight-space-programming) — 编辑后的模型、Hash 校验和复跑结果。
4. [Weight Oracles: Reading Neural Network Weights with Language Models](https://arxiv.org/html/2610.07334) — 2026-10-05。
5. [Steer2Edit: From Activation Steering to Component-Level Editing](https://arxiv.org/html/2602.09870v2) — 2026。

39. [Qwen 3.8 27B on my laptop can interpret model weights, too](https://simonwillison.net/2026/Nov/3/qwen-can-interpret-model-weights/) — Simon Willison，2026-11-03，本地模型对公开权重识别实验的复测。
40. [The “Astra can read and write weights to improve Qwen” post is misleading](https://honnibal.dev/blog/astra-read-write-misleading) — Matthew Honnibal，对无工具权重读取与工具辅助模型编辑的区分。
41. [LLMs are not superhuman at reading and writing neural network weights](https://www.seangoedecke.com/llms-are-not-superhuman-at-reading-and-writing-neural-network-weights/) — Sean Goedecke，对游戏网络可解释性和 Qwen 编辑流程的技术评论。
42. [A Survey of Weight Space Learning: Understanding, Representation, and Generation](https://arxiv.org/abs/2603.10090) — 2026-03-10，Weight Space Learning 的理解、表示与生成综述。
43. [Tracr: Compiled Transformers as a Laboratory for Interpretability](https://arxiv.org/abs/2301.05062) — 将符号程序编译为 Transformer 权重的研究，作为权重可编程性的早期相关工作。

### Model Editing 与 Task Vectors

6. [Locating and Editing Factual Associations in GPT (ROME)](https://arxiv.org/abs/2202.05262)。
7. [Mass-Editing Memory in a Transformer (MEMIT)](https://memit.baulab.info/)。
8. [Editing Models with Task Arithmetic](https://arxiv.org/abs/2212.04089)。
9. [TIES-Merging: Resolving Interference When Merging Models](https://arxiv.org/abs/2306.01708)。
10. [Language Models are Super Mario: Absorbing Abilities from Homologous Models as a Free Lunch (DARE)](https://arxiv.org/abs/2312.03099)。
11. [Memory-Based Model Editing at Scale (SERAC)](https://proceedings.mlr.press/v162/mitchell22a.html)。
12. [Should We Really Edit Language Models? On the Evaluation of Edited Language Models](https://proceedings.neurips.cc/paper_files/paper/2024/file/370fa2e691f57eb319bc263a07dad4a5-Paper-Conference.pdf)。
13. [Navigating the Dual Facets: Sequential Memory Editing in LLMs](https://arxiv.org/abs/2402.11122)。

### 工程工具与产品文档

14. [Hugging Face PEFT](https://github.com/huggingface/peft)。
15. [PEFT Model Merging](https://huggingface.co/docs/peft/en/developer_guides/model_merging)。
16. [MergeKit](https://github.com/arcee-ai/mergekit)。
17. [vLLM LoRA Adapters](https://docs.vllm.ai/en/latest/features/lora/)。
18. [Together AI Fine-tuning](https://docs.together.ai/docs/fine-tuning/overview)。
19. [Together AI Fine-tuned Model Deployment](https://docs.together.ai/docs/fine-tuning/deployment)。
20. [Microsoft Foundry Multi-LoRA Adapter Deployment](https://learn.microsoft.com/en-us/azure/foundry/how-to/deploy-lora-managed-compute)。
21. [Microsoft Foundry Adapter Deployment Overview](https://learn.microsoft.com/en-us/azure/foundry/concepts/adapter-deployment-overview)。

### Persona Vectors 与 Activation Steering

22. [Persona Vectors: Monitoring and Controlling Character Traits in Language Models](https://www.anthropic.com/research/persona-vectors) — Anthropic。
23. [Persona Vectors 官方研究代码](https://github.com/safety-research/persona_vectors) — Apache-2.0。
24. [PERSONA: Dynamic and Compositional Inference-Time Personality Control via Activation Vector Algebra](https://proceedings.iclr.cc/paper_files/paper/2026/hash/f66ce276436c4cd151535b03841ac713-Abstract-Conference.html) — ICLR 2026。
25. [PERSONA 官方代码](https://github.com/xcfcode/persona) — MIT。
26. [PERSONA Vectors and Datasets](https://huggingface.co/datasets/xiachongfeng/persona) — Hugging Face。
27. [PersonaSteer: Dynamic Activation Steering for Personalized Multi-turn LLM Conversations](https://aclanthology.org/2026.findings-emnlp.1270/) — Findings of EMNLP 2026。
28. [PersonaSteer 官方代码](https://github.com/tsinghua-fib-lab/PersonaSteer)。
29. [Your Language Model Secretly Contains Personality Subnetworks](https://proceedings.iclr.cc/paper_files/paper/2026/hash/9b2086bc4a12c3a8e80105635fd95f66-Abstract-Conference.html) — ICLR 2026。
30. [Personality Vector: Modulating Personality of Large Language Models by Model Merging](https://aclanthology.org/2025.emnlp-main.1253.pdf) — EMNLP 2025。
31. [Steer Like the LLM: Activation Steering that Mimics Prompting](https://proceedings.mlr.press/v306/heyman26a.html) — ICML 2026。
32. [IBM Activation Steering](https://github.com/IBM/activation-steering)。
33. [NNSight](https://github.com/ndif-team/nnsight)。
34. [Microsoft LLM Steer Instruct](https://github.com/microsoft/llm-steer-instruct)。

35. [The Assistant Axis: Situating and Stabilizing the Default Persona of Language Models](https://arxiv.org/abs/2601.10387) — Anthropic，2026。
36. [Anthropic Assistant Axis 研究介绍](https://www.anthropic.com/research/assistant-axis) — 2026-01-19。
37. [Assistant Axis 官方研究代码](https://github.com/safety-research/assistant-axis) — MIT。

### 模型安全

38. [TamperBench: Systematically Stress-Testing LLM Safety Under Fine-Tuning and Tampering](https://dl.acm.org/doi/10.1145/3770855.3817557)。

---

*本文中的研究结果以公开论文、作者研究文章、实验日志、模型卡和官方产品文档为依据。实验数字属于对应来源报告的结果，不代表本文独立复现。产品能力和成熟度以 2026 年 11 月 4 日可查阅的公开资料为准。*
