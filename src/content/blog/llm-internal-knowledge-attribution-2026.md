---
author: SW
featured: false
draft: false
description: 从参数化知识、SAE 特征和 Circuit Tracing 出发，梳理 LLM 回答与内部知识的关联方法，比较国际研究、中国团队成果及 DeepSeek、Qwen、Kimi 等开源模型的内部分析实践，并给出 Python PoC、工程架构与评估方法。
pubDatetime: 2026-11-01T08:00:00Z
title: 从 LLM 回答追溯内部知识：Mechanistic Interpretability、Circuit Tracing 与 Knowledge Attribution
tags:
  - AI
  - LLM
  - mechanistic-interpretability
  - circuit-tracing
  - knowledge-attribution
  - model-observability
  - research
  - open-weight-models
  - deepseek
  - qwen
---

# 从 LLM 回答追溯内部知识：Mechanistic Interpretability、Circuit Tracing 与 Knowledge Attribution

## 一、问题是什么：答案能否关联到模型内部的知识？

向大语言模型提出问题，模型生成一段回答。我们可以记录 Prompt、Completion、Token 数量、延迟、模型版本和成本，也可以通过 RAG 或搜索记录回答引用了哪些外部文档。但这些信息仍然没有回答另一个问题：

**如果模型没有查询外部资料，而是直接根据训练得到的参数化知识回答，它究竟通过模型内部哪些表征和计算过程得出了这个 Token 或事实？**

例如：

问：

~~~text
What is the capital of the state containing Dallas?
~~~

答：

~~~text
Austin.
~~~

希望得到的可能是以下几类信息：

- 输入中的 Dallas 激活了哪些实体或地理相关表征？
- 模型是否形成了 Texas 这一中间表示？
- 哪些内部特征和计算模块影响了 Austin 的输出概率？
- 某个中间特征被抑制后，Austin 的预测是否下降？
- 这个事实关联是局部的，还是由多个 Layer、MLP 和 Attention Head 共同完成？
- 如果改变模型参数或内部激活，知识能否被稳定修改？

这不是普通的 LLM Explainability，也不是 RAG 的引用追踪。它更接近 **Mechanistic Interpretability（机制可解释性）**、**Circuit Tracing（计算路径追踪）**、**Knowledge Attribution（知识归因）** 和 **Training Data Attribution（训练数据归因）** 几个研究方向的交叉。

截至 2026 年 11 月，已经有成熟度不同的开源工具可以完成其中一部分工作。最接近“从回答 Token 反向追踪模型内部计算”的开源组合是 [Circuit Tracer](https://github.com/decoderesearch/circuit-tracer) 和 [Neuronpedia](https://github.com/hijohnnylin/neuronpedia)。[NNsight](https://github.com/ndif-team/nnsight)、[TransformerLens](https://github.com/TransformerLensOrg/TransformerLens) 和 [SAELens](https://github.com/decoderesearch/SAELens) 则提供底层的访问、特征和干预能力。

但必须先划清边界：目前还没有一种通用工具，能够把任意模型的一段自然语言回答中的每个事实，精确映射到某个独立、稳定、可命名的“内部知识单元”。现有工具得到的是特定模型、特定 Prompt、特定 Token 和特定分析方法下的表征与计算证据。它们可以帮助我们提出和检验解释假设，却不能被当作模型内部的完整思维日志。

## 二、先区分四种不同的“知识来源”和追踪问题

日常讨论中，“模型为什么这么回答”常常包含几种不同的问题。它们需要的数据、算法和证据完全不同。

| 要解决的问题 | 真正要追踪的对象 | 典型方法 | 代表项目 |
|---|---|---|---|
| 回答中的 Token 受什么输入影响？ | 输入 Token、输出 Token、梯度或注意力归因 | Token Attribution | Inseq、Captum 等 |
| 模型内部通过什么机制得到某个输出？ | Layer、MLP、Attention、SAE Feature、计算路径 | Mechanistic Interpretability / Circuit Tracing | Circuit Tracer、TransformerLens、Neuronpedia |
| 某项事实在参数中如何表达，能否修改？ | 神经元、权重矩阵、事实关联、激活方向 | Knowledge Localization / Editing | ROME、MEMIT、EasyEdit |
| 回答中的事实最可能来自哪份训练文档？ | 训练样本、候选文档、数据影响 | Training Data Attribution / Provenance | TRAK、DataDignity 等 |

还有第五种常见做法：RAG 引用溯源。它追踪的是本次请求中被检索并传入上下文的文档。它能回答“这次调用给模型看了什么”，但通常不能回答“模型在预训练过程中从哪里学会了某个事实”。

这几类方法可以联合使用，但不能互相替代。

### 2.1 参数化知识不是数据库记录

模型权重并不是一个带有文档 ID、主键和出处字段的知识数据库。训练数据通过优化过程影响模型参数，多个样本的信号在权重和激活空间中叠加。推理阶段，模型根据输入上下文运行一系列矩阵运算和非线性变换，得到下一个 Token 的概率分布。

因此，至少要分开三个概念：

- **知识关联（Knowledge Association）**：模型能够在特定提示下表达某个事实，例如 France 与 Paris 的关系。
- **内部表征（Representation）**：特定 Layer 的向量、神经元或 SAE Feature 对输入和中间状态的响应。
- **计算路径（Computation Path / Circuit）**：多个内部组件如何协同，将输入表示转换为影响输出 Logit 的信号。

某个 Feature 对 Paris 的预测有显著贡献，不代表它单独存储了“法国首都是巴黎”这条完整知识。某个神经元被消融后输出变化，也不代表这个神经元就是唯一的知识位置。

### 2.2 Feature、Neuron、Circuit 和 Logit 不要混为一谈

| 概念 | 含义 | 典型观测方式 |
|---|---|---|
| Token | 输入或输出序列中的离散符号 | Tokenizer / Token ID |
| Activation | 某次 Forward Pass 中间产生的张量 | Hook、Cache、NNsight |
| Neuron | 网络层中的某个单元或维度 | 神经元激活与干预 |
| SAE Feature | SAE 从 Activation 中分解出的一个稀疏方向 | Feature Activation、解释和消融 |
| Circuit | 多个内部组件及其信息传递关系 | Attribution Graph、Patching |
| Logit | 模型对候选下一个 Token 的未归一化分数 | 输出层 Logits |

SAE Feature 不是模型原生的一颗独立神经元，而是通过额外训练的稀疏自编码器从模型 Activation 中学习出来的一个方向。一个 Feature 可能有可解释的语义倾向，但其命名和解释仍然需要验证。

## 三、研究脉络：从 Knowledge Neurons 到 Circuit Tracing

### 3.1 Knowledge Neurons：寻找与事实相关的神经元（2022）

论文：[Knowledge Neurons in Pretrained Transformers](https://aclanthology.org/2022.acl-long.581/)

GitHub：[EleutherAI/knowledge-neurons](https://github.com/EleutherAI/knowledge-neurons)

这项工作尝试识别预训练 Transformer 中表达事实知识的神经元。研究主要使用 BERT 类模型和 Cloze（填空）任务，通过观察不同输入条件下神经元激活的变化，定位与事实关系相关的单元，并尝试通过干预影响模型答案。

它的重要性在于把“模型知道什么”转化为可以实验的问题：对一个事实关系，是否能找到可重复响应的内部单元？改变这些单元是否会改变模型输出？

限制也很明显：实验任务、模型架构和事实表达形式都有范围。把某个 BERT 填空任务中的神经元发现，外推为所有生成式 LLM 都具有“一事实一神经元”的结构，是不成立的。

### 3.2 ROME：通过 Causal Tracing 定位并编辑事实关联（2022）

论文：[Locating and Editing Factual Associations in GPT](https://proceedings.neurips.cc/paper_files/paper/2022/hash/6f1d43d5a82a37e89b0665b33bf3a182-Abstract-Conference.html)

GitHub：[kmeng01/rome](https://github.com/kmeng01/rome)

ROME（Rank-One Model Editing）研究 GPT 类模型中的事实关联。它使用 Causal Tracing 等干预方法，观察恢复或替换中间激活后，模型的事实预测如何变化。研究在特定实验设置中发现，中间层的 Feed-Forward / MLP 计算与事实关联的检索密切相关，并通过秩一权重更新尝试修改事实。

例如，模型原本回答：

~~~text
The Eiffel Tower is located in Paris.
~~~

编辑后希望它回答：

~~~text
The Eiffel Tower is located in Rome.
~~~

ROME 的价值不只在于改写回答，而是提出一个可操作假设：如果定位到与事实关联有关的参数化计算，能否对它进行较小范围的权重编辑，并在不同问法下保持效果？

但是，某次编辑成功并不能证明事实完整地储存在被修改的权重中。编辑结果还需要检查泛化、局部性和副作用。

### 3.3 MEMIT：把事实编辑扩展到批量场景（2023）

论文：[Mass-Editing Memory in a Transformer](https://memit.baulab.info/)

GitHub：[kmeng01/memit](https://github.com/kmeng01/memit)

MEMIT 试图把 ROME 的编辑思路扩展到大量事实关联。论文在 GPT-J 6B 和 GPT-NeoX 20B 等模型上研究了批量编辑的可行性，并通过跨多个 MLP 层的参数更新实现一次修改多条事实关联。

这条路线解决的是“如何写入或修改模型的知识关联”，并非自动解释某一次生成的完整内部计算路径。

### 3.4 SAE：从高维激活中提取相对可解释的特征（2023—至今）

论文和研究材料：

- [Towards Monosemanticity: Decomposing Language Models With Dictionary Learning](https://transformer-circuits.pub/2023/monosemantic-features/index.html)
- [Scaling and Evaluating Sparse Autoencoders](https://transformer-circuits.pub/2024/scaling-monosemanticity/index.html)
- [SAELens](https://github.com/decoderesearch/SAELens)

Transformer 的 Residual Stream 和 MLP Activation 是高维向量。一个维度通常并不对应一个清晰的人类概念，多个特征可能以叠加方式共存。Sparse Autoencoder（SAE，稀疏自编码器）试图学习一个稀疏字典，把原始 Activation 分解为一组更容易观察的 Feature。

举例来说，模型某一层的 Activation 可能同时携带语言、实体、空间关系、语法和任务信息。SAE 希望把其中相对独立的激活方向分离出来，便于研究人员检查某个 Feature 在什么输入中出现、对哪些输出有影响。

不能因此把 Feature 标签当成事实表。Feature 的自然语言解释可能过宽、过窄或不准确；一个 Feature 也可能在不同上下文下参与不同任务。

2025 年的 [SAEBench](https://proceedings.mlr.press/v267/karvonen25a.html) 对 200 多个 SAE、7 种架构和训练算法进行了多维评估，强调不能只依赖稀疏性、重构误差等代理指标判断 SAE 是否具有实际解释价值。

2025 年 NeurIPS 的 [A is for Absorption](https://proceedings.neurips.cc/paper_files/paper/2025/hash/764ff7477b8e24dbe01531f6791e8bdf-Abstract-Conference.html) 进一步指出，SAE 的层级特征可能发生 Feature Absorption：看似单义的 Feature 在部分上下文中不再激活，而其下级特征吸收了部分响应。增加 SAE 宽度或调整稀疏度并不能自动解决这一问题。这是把 SAE Feature 直接解释成稳定知识单元时必须考虑的限制。

### 3.5 Circuit Tracing：从特征走向计算路径（2025）

关键研究：

- Anthropic：[Circuit Tracing: Revealing Computational Graphs in Language Models](https://transformer-circuits.pub/2025/attribution-graphs/methods.html)
- Anthropic：[On the Biology of a Large Language Model](https://transformer-circuits.pub/2025/attribution-graphs/biology.html)
- Anthropic 开源公告：[Open-sourcing circuit tracing tools](https://www.anthropic.com/research/open-source-circuit-tracing)

Circuit Tracing 的目标不只是找到“哪些 Feature 激活了”，而是估算这些 Feature、输入 Token、Transcoder Error Node 和输出 Logit 之间的直接影响关系，再将它们组织成 Attribution Graph。

其中一个重要技术是使用 Cross-Layer Transcoder 作为原模型 MLP 计算的可解释替代表示。模型在推理时仍然是原模型；分析阶段引入 Transcoder，把部分难以解释的计算路径转换成更容易检查的 Feature 级图结构。

Anthropic 的研究展示了若干有代表性的任务，包括实体和地理关系、多跳推理、诗歌押韵规划、多语言共享表征、算术计算、医学诊断候选推理，以及拒绝机制和不安全行为相关路径。它们是机制研究案例，不意味着模型的全部推理过程已经被透明还原。

尤其值得注意的是，Attribution Graph 是一种近似解释。图中的边可以用来提出假设，但仍要通过 Feature Ablation、Activation Patching 或其他干预验证。图不是模型自然语言思维过程的逐字记录。

### 3.6 2026 年的一个关键进展：事实检索路径是分布式且不连续的

论文：[Factual Retrieval in LLMs Is a Redundant, Distributed and Non-Contiguous Process](https://aclanthology.org/2026.acl-long.2168/)，ACL 2026。

研究者在 Llama 3.1 8B 和 Qwen3 8B 上研究事实属性的检索路径，并通过迭代 Patching 找出完成某项属性计算所需的最小 Layer 子集。研究发现：

- 事实计算路径不一定连续地经过所有 Layer，可能跳过中间层。
- 同一个实体、同一个事实可能有多条功能相近的计算路径。
- 模型对事实的计算具有较强的冗余性和分布式特征。

这项研究对工程设计有直接影响：不能默认每个事实都有一个稳定的“存储层”或“唯一神经元”；一次消融没有改变输出，也不能据此认定该知识不存在。模型可能通过其他路径完成同一计算。

### 3.7 训练数据归因是另一条路线：DataDignity

论文：[DataDignity: Training Data Attribution for Large Language Models](https://arxiv.org/abs/2605.05687)，2026 年 5 月。

微软研究团队提出了 pinpoint provenance：给定 Prompt、模型回答和候选语料，排序最可能支持回答的文档。研究设计了 FakeWiki 基准，包含 3,537 篇虚构 Wikipedia 风格文章，以便控制答案的真实出处，同时减少简单词面匹配的干扰。

论文在 9 个开源指令微调模型和 5 种查询条件下评估方法。作者报告，ScoringModel 的平均 Recall@10 从最强检索基线的 35.0 提高到 52.2，并在 45 个模型/条件组合中的 41 个优于对比方法。

这项工作非常接近“回答中的事实对应哪份文档”的需求，但要注意它解决的是候选语料上的文档支持归因，不是从任意模型参数中自动恢复完整训练语料，也不是 Circuit Tracing。论文结果也不应外推为对任意闭源模型、任意训练集都能找到真实训练出处。

## 四、开源工具和项目：各自解决什么问题？

下面的比较将“是否能访问内部状态”“是否能定位计算路径”“是否能干预”和“是否能追溯训练文档”分开，避免把所有工具都称为知识归因系统。

| 项目 | 主要能力 | 适合做什么 | 关键边界 |
|---|---|---|---|
| [Circuit Tracer](https://github.com/decoderesearch/circuit-tracer) | 基于预训练 Transcoder 生成 Attribution Graph，提供 Feature 干预 | 从 Prompt/目标 Logit 研究内部计算路径 | 依赖匹配的模型和 Transcoder；不是任意模型的通用适配器 |
| [Neuronpedia](https://github.com/hijohnnylin/neuronpedia) | Feature 数据、解释、图可视化、搜索和 Steering | 人工探索和分享 Feature / Circuit 结果 | UI 不会自动证明 Feature 标签正确；图依赖对应特征数据 |
| [TransformerLens](https://github.com/TransformerLensOrg/TransformerLens) | 访问模型内部 Activation、缓存、编辑、替换 | Activation Patching、机制实验和模型比较 | 对新架构的 API 支持需要核对；并非所有模型都适合 Circuit Tracer 后端 |
| [NNsight](https://github.com/ndif-team/nnsight) | 通用 Forward Trace、读写中间张量、梯度和远程分析 | 适配不同 PyTorch / Hugging Face 模型 | 它提供内部访问能力，不自动产出语义化知识图 |
| [SAELens](https://github.com/decoderesearch/SAELens) | SAE 训练、加载、分析和 Feature 评估 | 建立模型内部 Feature 字典 | Feature 解释不等于事实定位；SAE 本身有评估和层级问题 |
| [ROME](https://github.com/kmeng01/rome) | 定位并更新部分事实关联 | 知识编辑实验 | 研究方法有模型、任务和副作用边界 |
| [MEMIT](https://github.com/kmeng01/memit) | 批量更新事实关联 | 大规模事实编辑研究 | 编辑不等于解释；需要局部性、泛化等评估 |
| [EasyEdit](https://github.com/zjunlp/EasyEdit) | 统一知识编辑与行为 Steering 实验 | 比较 ROME、MEMIT 等方法以及运行时 Steering | 不负责自动找出每个生成 Token 的来源 |
| [Pyvene](https://github.com/stanfordnlp/pyvene) | 神经网络表示干预框架 | 自定义 Patching、Representation Intervention | 需要研究人员设计干预和解释 |
| [Inseq](https://github.com/inseq-team/inseq) | 序列生成的归因和 Token 贡献分析 | 观察输入部分对输出 Token 的影响 | Token 归因不等于模型内部 Feature/Circuit 归因 |

### 4.1 Circuit Tracer：最接近“答案到模型内部计算图”的项目

GitHub：[decoderesearch/circuit-tracer](https://github.com/decoderesearch/circuit-tracer)

根据当前仓库 README，Circuit Tracer 主要完成三件事：

1. 使用预训练 Transcoder，根据 Prompt 计算非零 Feature、Transcoder Error Node、输入 Token 与输出 Logit 之间的直接影响。
2. 把 Attribution Graph 保存为图数据，并提供浏览器可视化和 Feature 注释。
3. 对图中的 Transcoder Feature 进行干预，观察模型输出变化。

当前仓库 README 列出的 Transcoder 组合包括：

| 模型系列 | 可用的 Transcoder / 特征数据（以项目当前 README 为准） |
|---|---|
| Gemma 2 2B | PLT，以及 426K / 2.5M Feature 的 CLT |
| Llama 3.2 1B | PLT 和 CLT |
| Qwen3 | 0.6B、1.7B、4B、8B、14B 的 PLT |
| GPT-OSS 20B | CLT |
| Gemma 3 | 270M、1B、4B、12B、27B 的 PLT，需 NNsight Backend |
| Llama 3.1 8B Instruct | TopK PLT |

这里要注意两个容易误读的地方。

第一，模型权重可加载不等于已经有适配的 Transcoder。Circuit Tracer 的 Feature 图需要对应的特征数据。第二，Circuit Tracer 默认使用 TransformerLens Backend；项目也提供 NNsight Backend，但 README 明确称其仍是实验性实现，速度、内存效率和功能支持都可能不如默认后端。因此不能把 TransformerLens 支持的所有 Hugging Face 模型都视为 Circuit Tracer 已经完整支持。

推荐从 Gemma 2 2B 的官方 Tutorial 开始，而不是先尝试大模型或自己训练 Transcoder。

### 4.2 Neuronpedia：把研究结果变成可探索界面

官网：[neuronpedia.org](https://neuronpedia.org/)

GitHub：[hijohnnylin/neuronpedia](https://github.com/hijohnnylin/neuronpedia)

Neuronpedia 是开源的模型内部 Feature 探索平台，包含 Feature、Activation、Explanation、Attribution Graph 等数据和交互界面。它能与 Circuit Tracer 配合，让研究人员从图节点进一步查 Feature、观察激活样例和进行 Steering。

它的价值不只是画图。研究过程通常会反复执行：

- 查看某个 Feature 的激活上下文；
- 检查自动生成的自然语言解释；
- 寻找反例，判断解释是否过宽；
- 对 Feature 进行干预；
- 对比干预前后的预测和生成。

Neuronpedia 让这些探索过程更容易被人工检查，也更容易分享预计算结果。若只使用已有 Feature 数据和 Graph，未必需要本地 GPU；若要为自己的模型生成完整图或训练特征，仍需要相应模型权重、算力和匹配数据。

### 4.3 NNsight：模型内部状态的通用访问层

GitHub：[ndif-team/nnsight](https://github.com/ndif-team/nnsight)

NNsight 不试图直接回答“某个 Feature 是什么知识”，而是解决模型内部状态如何被访问、保存和干预的问题。它通过 Trace Block 组织计算，开发者可以像访问模型普通 Python 属性一样，读取某层输出、Attention Pattern、Logit 或梯度，也可以在计算过程中替换内部张量。

NNsight 还可以通过 NDIF 对远程模型进行分析。它提供本地、远程和 vLLM 等运行路径，对建立统一的模型内部观测层很有价值。

### 4.4 TransformerLens：机制实验的基础设施

GitHub：[TransformerLensOrg/TransformerLens](https://github.com/TransformerLensOrg/TransformerLens)

TransformerLens 提供模型内部 Activation 的缓存和 Hook 能力，是 Attention、MLP 和 Residual Stream 研究中常用的工具。

当前 README 已经进入 TransformerLens 4.x 路线，推荐入口是 TransformerBridge，例如：

~~~python
from transformer_lens.model_bridge import TransformerBridge

bridge = TransformerBridge.boot_transformers("gpt2", device="cpu")
logits, activations = bridge.run_with_cache("Hello World")
~~~

旧版本中广泛使用的 HookedTransformer API 在 4.0 已被移除，已有脚本不能假定仍然兼容。Circuit Tracer 默认 Backend 与 TransformerLens 的模型支持之间也不能画等号，需要针对所用版本和架构验证。

### 4.5 SAELens：不要跳过 Feature 质量验证

GitHub：[decoderesearch/SAELens](https://github.com/decoderesearch/SAELens)

SAELens 用于训练、加载和分析 SAE。它适合作为研究者的 Feature 实验环境，但不是一个“知识分类器”。

使用 SAE 时应当至少检查：

- Reconstruction：Feature 重构原 Activation 的误差；
- Sparsity：Feature 是否满足预期的稀疏程度；
- Firing Examples：Feature 在什么上下文中激活；
- False Positives / Counterexamples：Feature 解释是否在不相关上下文中也成立；
- Causal Effect：对 Feature 进行干预后，目标行为是否按预期变化；
- Robustness：换 Prompt、改写实体或改变上下文后，结论是否仍然成立。

SAELens 的 API 和训练方法也会变化。报告和代码应当记录具体版本、模型 revision、SAE / Transcoder checkpoint，而不是只保存一个 Feature ID。

### 4.6 Knowledge Editing 工具：从定位转向修改

[EasyEdit](https://github.com/zjunlp/EasyEdit) 将多种知识编辑方法放在统一框架中。其项目已经区分原有 Knowledge Editing 路线和 EasyEdit2 的 Inference-time Steering 路线。EasyEdit2 支持 SAE Feature Steering、CAA 等方法，并提供 vLLM 路径，但它解决的是行为控制和编辑，并非自动回答“这次生成到底用了哪个内部知识单元”。

对事实编辑应使用至少四个评估维度：

| 维度 | 要回答的问题 |
|---|---|
| Reliability | 要修改的事实是否真的改变？ |
| Generalization | 换成不同问法、不同上下文是否仍然有效？ |
| Locality | 无关事实是否受到影响？ |
| Portability | 知识修改能否迁移到相关问题和实体？ |

对生产模型来说，还需要增加安全回归、偏差、拒答和其他业务任务评估。模型编辑并不等于传统数据库的单条记录更新。

## 五、产业实践：研究工具正在走向模型调试和运行时控制

机制可解释性过去更多是研究实验。近两年，已有公司开始把这些技术组合成模型调试、训练数据诊断和在线推理控制工具。必须区分“公开产品能力”“研究演示”“厂商自述性能”和“有公开证据的客户生产使用”。

### 5.1 Anthropic：从模型内部案例研究到开源 Circuit Tracing

Anthropic 在 2025 年发布了 Circuit Tracing 研究，并开源 Circuit Tracer 工具。其研究使用 Claude 3.5 Haiku 分析多种能力和行为，例如多跳事实推理、语言共享表征、拒绝机制、医学候选推理以及某些不可靠行为的内部路径。

值得关注的工程点是它并没有把解释过程简化成“某个神经元代表某个概念”，而是通过多个 Feature 和组件之间的影响关系构建图，再使用干预进一步检查图中的假设。

公开证据支持的是研究进展和工具开源，不代表 Anthropic 已经为每次线上 Claude 回答生成并对外提供完整的内部知识溯源记录。

### 5.2 Goodfire：把解释性实验做成面向模型团队的工作台

Goodfire 的 [Silico](https://www.goodfire.com/silico) 将自动特征解释、Probe/SAE 训练、Activation Monitoring、模型行为调试、模型差异比较、因果分析和 Steering 组织成一个研究工作流。它的定位是让模型团队通过自然语言提出研究目标，再由 Agent 协调实验、观察结果和进一步验证。

Goodfire 公开的 [Predictive Data Debugging](https://www.goodfire.com/research/predictive-data-debugging) 研究进一步将 Feature / 行为分析延伸到训练数据：在训练之前预测偏好数据中的哪些行为可能被强化或抑制，再将行为信号关联到训练数据并调整数据集或训练过程。

这代表了一个值得关注的方向：可解释性不只用于训练完成后的“模型尸检”，也可能提前进入数据策展和训练过程诊断。

但 Silico 是商业产品，产品页面列出的能力并不能单独证明其每一种分析在所有模型、数据和业务任务上都已达到同样成熟度。本文也没有找到足以公开量化其客户整体生产收益的独立数据，因此不把产品能力宣传写成行业普遍效果。

一个更有实证价值的案例来自 Goodfire 与 Ai2 在 OLMo 开放后训练栈上的合作：[How Goodfire used Ai2’s open post-training stack to trace unwanted model behavior](https://allenai.org/blog/goodfire-olmo)，发表于 2026 年 9 月。这个案例把可解释性与训练数据归因连接起来：

- Preference Training 提升了 OLMo 的一般能力，但在拒绝测试中也出现了新的安全回归：模型在某些虚构故事或假设场景下，更愿意配合有害请求。
- Goodfire 使用 Predictive Data Debugging 分析偏好训练数据，追踪到部分回归与 Dolci 数据集中具体的 chosen / rejected response 有关：优选回答鼓励模型继续配合有害请求，而被拒绝回答反而表达了不应回答的边界。
- 由于 Ai2 的开放训练流程发布了单条偏好样本，研究者可以定位具体数据点，进行针对性修改，再测量是否降低了有害请求服从，同时尽量保留其他能力提升。
- 同一分析还暴露出研究者没有预先列入评估集的异常行为簇，例如模型对一类特定荒诞题材的偏好。这说明内部特征和数据聚类分析有机会发现传统预先定义的测试集遗漏的行为。

这个案例的证据范围也要准确理解：它证明的是在开放模型、开放训练栈和可访问偏好数据的条件下，研究者能够把某些行为变化关联到具体训练样本，并通过数据干预做验证；它并不证明可以仅凭一个 Circuit Graph 反推出任意闭源模型的原始训练文档，也不能保证对所有训练任务都能唯一定位根因。

它对企业的启示是：如果希望真正做“模型为什么学会了这种行为”的分析，内部 Activation、Feature / Probe 与训练数据版本必须共同纳入实验设计。只保留模型输出和 Prompt，往往不足以形成可验证的根因链。

### 5.3 IBM vLLM-Hook MIA：把内部状态观测带进高性能推理引擎

2026 年 10 月，IBM Research 发布 [Toward fast AI interpretability and control](https://research.ibm.com/blog/fast-interpretability-plugin-vllm)，并开源 [IBM/vLLM-Hook](https://github.com/IBM/vLLM-Hook)。

它处理的是一个很现实的工程问题：常见的模型解释和 Steering 工具会在模型 Forward Pass 中插入 Hook、读取中间状态或执行额外 Python 逻辑，这可能破坏 vLLM 的高性能执行路径，尤其是 CUDA Graph Replay。

MIA（Model Internals Aperture）尝试在 vLLM 推理引擎中建立更轻量的内部状态观测和干预通道。其思路是在 CUDA Graph 记录前准备观测与干预位置，利用固定 GPU 内存位置中的路由信息，在 Replay 阶段由 GPU 侧完成相关操作，再将捕获的数据传回 CPU 分析。这样可以避免每次推理都引入大量 Python 级 Hook 操作。

IBM 公布的实践包括：

| 示例 | 内部信号 / 方法 | 目标 |
|---|---|---|
| Attention Tracker | Q/K 和 Attention 相关状态 | 识别 Prompt Injection 风险信号 |
| Science Hallucination Detector | Hidden State + 分类器 | 对科学问答中的支持关系进行分类 |
| Activation Steering | 指定激活方向或特征 | 影响模型生成行为 |
| H-Node Hallucination Detector | 内部状态探测 | 研究回答中的幻觉信号 |
| CoRe Reranker | 内部特征与评分 | 重排序任务 |

这里有两个不能忽略的边界。

一是这些 Demo 中的检测器依赖特定模型、任务和训练好的分析器。例如 Science Hallucination Demo 使用生成后的 Token ID 再次运行模型，捕获 Hidden State，再将其交给指定分类器。这是“内部状态 + 下游探测器”的工程组合，不是一个无需训练的通用幻觉识别机制。

二是 IBM 报告的性能数据属于厂商自己的实验结果。IBM 表示 MIA 相对前代 vLLM-Hook 可达到最高 20 倍速度提升，相比另一种模型内插入代码的方法最高 14 倍；在部分 8B / 1.5B 模型测试中报告约 2% 的推理延迟开销，在 Llama 70B 的实验中报告约 6%。这些数字应作为特定实验条件下的结果看待，不能直接当成任意模型、任意 Hook 或任意工作负载的 SLA。

从生产架构角度看，MIA 的价值在于证明内部状态访问与 vLLM 高性能执行并非绝对冲突，并给在线轻量监控、探测和控制提供新的工程接口。

### 5.4 Microsoft Research：训练文档来源归因并非简单的语义检索

[DataDignity](https://www.microsoft.com/en-us/research/publication/datadignity-training-data-attribution-for-large-language-models/) 是微软 2026 年公开的训练数据归因研究。它研究的不是内部 Circuit，而是给定模型回答和一个候选文档集合，如何找到真正支持回答的文档。

它的设计值得企业知识治理团队关注：FakeWiki 中专门加入主题相似、但删除了答案关键事实的 anti-documents，防止方法仅仅根据文本相似度给文档排序。论文显示，文本内容支持关系与主题相关性并不是一回事。

对需要解释“模型回答中的事实到底来自哪份资料”的企业场景，这条路线比直接对几百亿参数做可视化更接近实际审计问题。前提是存在候选语料、足够的模型/数据接口和可验证的 Ground Truth。

### 5.5 这些产业实践说明了什么？

目前可以观察到三类不同的产业化方向：

| 方向 | 已有实践 | 主要价值 |
|---|---|---|
| 研究与调试平台 | Anthropic Circuit Tracing、Goodfire Silico | 解释模型行为、定位异常特征、设计和验证干预 |
| 在线推理观测与控制 | IBM vLLM-Hook MIA | 在推理服务中读取内部状态、运行轻量探测器、实施受控干预 |
| 训练数据与回答出处 | Microsoft DataDignity、Goodfire Predictive Data Debugging | 把模型行为与候选训练样本或偏好数据关联，支持数据治理 |

这些是可信的公开研究和产品方向，但不能据此声称行业已经普遍使用“每个答案都有内部知识归因图”的生产能力。公开案例仍以研究、产品演示和特定模型实验为主。

## 六、如何构建一套 LLM Internal Knowledge Attribution 系统？

如果要做一个可迭代的工程系统，我建议不要一开始就做成“所有回答都运行一次 Circuit Tracer”。模型内部归因比普通日志成本更高，也不是所有回答都值得做完整计算图分析。

先把目标限定为：**选定开源模型，对生成结果中的重点 Claim / Token 做离线归因，保存模型版本、计算图、Feature 和干预实验结果，再通过 UI 进行人工检查。**

### 6.1 目标架构

~~~mermaid
flowchart TD
    A["User Request"] --> B["Inference Runtime"]
    B --> C["Generated Answer"]
    B --> D["Token IDs / Model Revision / Decode Metadata"]
    C --> E["Claim Extraction and Span Alignment"]
    E --> F["Select Target Output Token"]
    D --> G["Rebuild Exact Prefix"]
    F --> G
    G --> H["Circuit Tracer / NNsight"]
    H --> I["Attribution Graph / Activations"]
    I --> J["SAE / Transcoder Feature Interpretation"]
    J --> K["Feature Ablation / Activation Patching"]
    K --> L["Causal Evidence and Limitations"]
    L --> M["Knowledge Attribution Record"]
    M --> N["UI / Audit / Regression Evaluation"]
~~~

这条链路需要在数据模型里保留原始模型版本、Tokenizer、Transcoder 和具体 Prompt Prefix。少了其中任何一个，Feature ID 和图边的含义都可能无法复现。

### 6.2 为什么必须分析指定输出 Token 的 Prefix？

自回归 LLM 的生成过程是逐 Token 的。生成 Token t 时，模型输入的是此前的上下文，输出的是下一个 Token 的 Logit 分布。

如果模型生成：

~~~text
The capital of France is Paris.
~~~

要分析 Paris 对应的输出，输入需要是：

~~~text
The capital of France is
~~~

此时模型计算的是下一个 Token 的分布。对较长的回答，应该根据 Token ID 找到感兴趣的输出 Token，并使用生成该 Token 前的准确 Prefix 进行分析。不能只把完整回答交给分析工具，就声称得到了所有输出 Token 的统一因果图。

还要注意 Token 边界：Paris 可能是一个 Token，也可能被 Tokenizer 拆成多个 Token。字符偏移、Unicode 字符索引和 Token 索引并不等价。Claim 的文字 Span 对齐到 Token ID 时必须通过对应模型的 Tokenizer 完成，不能用简单字符串下标代替。

### 6.3 数据模型：不要把图直接保存成自然语言解释

可以先定义一个归因记录，保存原始证据与解释之间的边界：

~~~json
{
  "schema_version": "0.1",
  "run_id": "run-2026-11-01-0001",
  "model": {
    "id": "google/gemma-2-2b",
    "revision": "immutable-model-revision",
    "tokenizer_revision": "immutable-tokenizer-revision",
    "transcoder_id": "gemma"
  },
  "generation": {
    "prompt_hash": "sha256:...",
    "answer": "The capital of France is Paris.",
    "target_token_id": 12345,
    "target_token_text": " Paris",
    "analyzed_prefix_hash": "sha256:...",
    "decoding": {
      "temperature": 0,
      "max_new_tokens": 32
    }
  },
  "claim": {
    "claim_id": "claim-1",
    "subject": "France",
    "predicate": "has_capital",
    "object": "Paris",
    "character_span": [27, 32],
    "token_span": [7, 8]
  },
  "attribution": {
    "method": "circuit_tracer",
    "graph_artifact": "artifact://graphs/run-2026-11-01-0001",
    "feature_refs": [
      {
        "layer": 20,
        "feature_index": 1234,
        "effect": 0.12,
        "interpretation_ref": "feature://..."
      }
    ],
    "input_token_refs": [],
    "output_logit_refs": []
  },
  "interventions": [
    {
      "method": "feature_ablation",
      "target_feature": "layer-20-feature-1234",
      "baseline_logit": 0.0,
      "intervened_logit": 0.0,
      "delta": 0.0,
      "replications": 0
    }
  ],
  "assessment": {
    "evidence_level": "exploratory",
    "interpretation": "Human-reviewed interpretation goes here.",
    "limitations": [
      "Attribution graph is an approximation.",
      "A feature is not a unique storage location for a fact.",
      "Intervention requires prompt and model-specific replication."
    ]
  }
}
~~~

这只是建议的数据契约，不是 Circuit Tracer 的原生 JSON Schema。Feature 字段、Graph 节点和边应当通过一个 Adapter 映射到企业自己的 Schema，原始 PyTorch Graph / Tensor Artifact 则单独存储。不要为了统一数据模型而伪造工具本身没有提供的字段。

建议将记录分成三个层次：

- **Raw Evidence**：模型和 Token 版本、Activation / Graph Artifact、干预参数和输出 Logit。
- **Interpreted Evidence**：Feature 标签、人工解释、对照实验和置信度。
- **Business Claim**：业务人员关心的事实声明、风险级别、审计结论和处置。

原始激活、归因图和人工解释不是同一种数据。需要保留各自来源和版本。

## 七、代码实战：Circuit Tracer 的本地 PoC

建议先使用 Gemma 2 2B，复现 Circuit Tracer 官方的 Dallas → Texas → Austin 示例。这样可以验证整条分析链路，而不是一开始就把问题复杂化。

对应的独立 PoC 代码、运行说明和 NNsight 示例已放在 [tools/llm-internal-knowledge-attribution](https://github.com/devweekly/devweekly.github.io/tree/main/tools/llm-internal-knowledge-attribution)。

### 7.1 环境与模型选择

官方仓库：[decoderesearch/circuit-tracer](https://github.com/decoderesearch/circuit-tracer)

PoC 环境：

~~~bash
git clone https://github.com/decoderesearch/circuit-tracer.git
cd circuit-tracer

python -m venv .venv
source .venv/bin/activate

pip install -e .
~~~

代码依赖 Torch、TransformerLens、Transformers 和相关分析组件。项目 README 中的依赖和 Backend 仍在演进，建议从当前仓库的 pyproject.toml 创建隔离环境，不要直接把项目依赖合并到已有的生产推理环境。

Gemma 2 2B 模型权重需要从 Hugging Face 获取。使用前需要确认模型仓库访问条件和 License。GPU 显存和存储需求与数据类型、Batch Size、Feature Nodes 数量和 Offload 策略有关。官方示例说明 Gemma 2 2B 可在部分 15GB GPU 的 Colab 环境中运行，但较低显存通常需要更多 CPU 或 Disk Offload。

### 7.2 完整 Python 脚本

以下代码基于 Circuit Tracer 仓库官方 Tutorial 的 Python API，输入一个待分析的 Prefix，加载模型和 Transcoder，计算 Attribution Graph，将图数据和可视化文件保存到本地。

文件：`trace_gemma.py`

~~~python
#!/usr/bin/env python3
"""Trace a next-token prediction with Circuit Tracer."""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from circuit_tracer import ReplacementModel, attribute
from circuit_tracer.utils import create_graph_files


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build an attribution graph for the next-token prediction."
    )
    parser.add_argument(
        "--model",
        default="google/gemma-2-2b",
        help="Hugging Face model id. Must match the transcoder architecture.",
    )
    parser.add_argument(
        "--transcoder",
        default="gemma",
        help="Circuit Tracer transcoder set or Hugging Face repository id.",
    )
    parser.add_argument(
        "--prompt",
        default="The capital of state containing Dallas is",
        help="Exact prefix whose next-token logits should be explained.",
    )
    parser.add_argument(
        "--backend",
        choices=("transformerlens", "nnsight"),
        default="transformerlens",
        help="NNsight backend is experimental; prefer TransformerLens when supported.",
    )
    parser.add_argument(
        "--dtype",
        choices=("bfloat16", "float32"),
        default="bfloat16",
    )
    parser.add_argument("--max-logits", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--max-feature-nodes", type=int, default=8192)
    parser.add_argument(
        "--offload",
        choices=("cpu", "disk"),
        default="cpu",
        help="Offload strategy used during attribution.",
    )
    parser.add_argument("--output", type=Path, default=Path("./artifacts/dallas-austin"))
    parser.add_argument("--serve", action="store_true", help="Serve the graph UI locally.")
    parser.add_argument("--port", type=int, default=8046)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not torch.cuda.is_available():
        raise RuntimeError(
            "This example expects a CUDA GPU. Use a supported Colab or local GPU runtime."
        )

    if args.batch_size < 1 or args.max_feature_nodes < 1:
        raise ValueError("batch-size and max-feature-nodes must be positive.")

    dtype = torch.bfloat16 if args.dtype == "bfloat16" else torch.float32
    args.output.mkdir(parents=True, exist_ok=True)

    print(f"Loading model: {args.model}")
    print(f"Transcoder set: {args.transcoder}")
    print(f"Backend: {args.backend}")

    model = ReplacementModel.from_pretrained(
        args.model,
        args.transcoder,
        dtype=dtype,
        backend=args.backend,
    )

    print("Computing attribution graph...")
    graph = attribute(
        prompt=args.prompt,
        model=model,
        max_n_logits=args.max_logits,
        desired_logit_prob=0.95,
        batch_size=args.batch_size,
        max_feature_nodes=args.max_feature_nodes,
        offload=args.offload,
        verbose=True,
    )

    graph_path = args.output / "attribution_graph.pt"
    graph.to_pt(graph_path)
    print(f"Saved graph: {graph_path}")

    graph_files_dir = args.output / "graph_files"
    create_graph_files(
        graph_or_path=graph_path,
        slug="llm-internal-knowledge-attribution",
        output_path=str(graph_files_dir),
        node_threshold=0.80,
        edge_threshold=0.98,
    )
    print(f"Saved graph visualization files: {graph_files_dir}")

    if args.serve:
        from circuit_tracer.frontend.local_server import serve

        serve(data_dir=str(graph_files_dir), port=args.port)
        print(f"Graph UI: http://localhost:{args.port}/index.html")


if __name__ == "__main__":
    main()
~~~

运行：

~~~bash
python trace_gemma.py \
  --prompt "The capital of state containing Dallas is" \
  --output ./artifacts/dallas-austin \
  --serve
~~~

这里有几个关键的实验参数：

- `max_n_logits`：最多从多少个输出 Logit 节点进行归因。候选数越大，图可能越复杂。
- `desired_logit_prob`：让分析覆盖多少概率质量。这里设置为 0.95。
- `max_feature_nodes`：限制图中的 Feature Nodes 数量，降低计算和内存成本。
- `offload`：把部分计算或数据从 GPU 转移到 CPU / Disk，以降低显存压力。
- `node_threshold` / `edge_threshold`：图文件生成阶段的剪枝阈值。它们影响可视化图的规模，不应被误解为模型知识正确率。

`serve` 提供本地浏览器入口。初次运行时应先确认模型、Transcoder 和依赖版本匹配。若默认 TransformerLens Backend 不支持当前模型，才考虑项目提供的 NNsight Backend；后者在 Circuit Tracer README 中被标记为实验性路径。

### 7.3 NNsight：直接读取指定 Layer 的 Activation 和 Logit

如果研究目标是先建立一套通用模型内部采集能力，可以从 NNsight 开始。以下示例使用 GPT-2，读取指定 Layer 的最后一个 Token Hidden State 和模型最终 Logit。它展示的是内部张量采集，并不自动生成语义化 Feature 或因果归因图。

文件：`capture_with_nnsight.py`

~~~python
#!/usr/bin/env python3
"""Capture a hidden state and next-token logits with NNsight."""

from __future__ import annotations

import argparse

import torch
from nnsight import TransformersModel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        default="openai-community/gpt2",
        help="Use a model architecture compatible with the module paths below.",
    )
    parser.add_argument(
        "--prompt",
        default="The capital of France is",
    )
    parser.add_argument("--layer", type=int, default=6)
    args = parser.parse_args()

    model = TransformersModel(args.model, dispatch=True)

    layer_count = len(model.transformer.h)
    if args.layer < 0 or args.layer >= layer_count:
        raise ValueError(
            f"Layer {args.layer} is invalid for a model with {layer_count} layers."
        )

    with model.trace(args.prompt):
        hidden = (
            model.transformer.h[args.layer]
            .output[:, -1, :]
            .detach()
            .to("cpu")
            .save()
        )
        logits = (
            model.output.logits[:, -1, :]
            .detach()
            .to("cpu")
            .save()
        )

    top_ids = torch.topk(logits.value[0], k=10).indices.tolist()
    print("Top next-token candidates:")
    for token_id in top_ids:
        token = model.tokenizer.decode([token_id])
        score = logits.value[0, token_id].item()
        print(f"{token_id:>6}  {score:>12.4f}  {token!r}")

    print("Hidden-state shape:", tuple(hidden.value.shape))


if __name__ == "__main__":
    main()
~~~

运行：

~~~bash
pip install nnsight torch
python capture_with_nnsight.py
~~~

这里的模块路径针对 GPT-2。换成 Llama、Gemma 或 Qwen 时，应先用 `print(model)` / `module.source` 检查真实模块树，并确认输出 Tensor 的结构。不要把 GPT-2 的 `model.transformer.h` 路径硬编码到通用模型适配层中。

NNsight 的 Trace Block 不是普通的上下文管理器执行逻辑：在 Block 内描述读取、修改和保存动作，模型运行时才执行这些操作。需要在 Block 外使用的结果必须通过 `.save()` 保存。它还提供 `generate` 以及 NDIF 远程模型访问能力，具体用法参见项目官方 README 和 Documentation。

### 7.4 如何验证这个 PoC 是有效的？

PoC 不能以“浏览器成功打开一张图”作为验收标准。建议分成四个层次：

| 验收层次 | 实际检查 | 通过标准 |
|---|---|---|
| 输入和模型 | Prompt、Tokenizer、模型 revision、Transcoder 是否一致 | 可重复加载并运行 |
| 归因图 | 是否存在输入 Token、Feature 和目标输出 Logit 的关系 | 能定位到目标 Logit，图可保存和重载 |
| 解释质量 | 人工阅读 Feature 激活样例和图路径 | 解释有上下文证据，并记录反例 |
| 因果验证 | 对候选 Feature 做消融或干预，并比较目标 Logit | 输出变化可复现，且有对照实验 |

建议最初只分析一个目标 Token，并保存模型 revision、Prompt 完整文本、Token ID、Transcoder 标识、参数和图文件。不要在没有完成干预对照之前，把节点名字写成“知识来源”。

## 八、评估体系：相关性、可解释性和因果有效性是三回事

很多可解释性工具能够生成一张看起来合理的图，但图是否准确、是否有用、是否能够支持因果结论，是三个不同的问题。

### 8.1 Attribution Quality：归因本身是否稳定？

需要在同一模型和固定版本下，改变 Prompt 的表述但不改变目标事实，观察 Feature 和计算路径是否保持一定稳定性。

例如：

~~~text
The capital of France is
France's capital city is
Which city serves as the capital of France?
~~~

要检查的不是三次图是否完全相同，而是核心输出、重要 Feature 和计算路径是否具有可解释的一致性。对不稳定部分要保留差异，而不是取一个“看起来最好”的图当作唯一结论。

### 8.2 Causal Validity：干预是否能改变预测？

可以对 Feature 做 Ablation 或对中间 Activation 做 Patching，并记录干预前后的目标 Logit、预测概率、候选排序和最终输出。

建议至少包括三组实验：

- Target intervention：干预候选 Feature，观察目标 Logit 变化。
- Random control：干预同一层其他随机 Feature，作为对照。
- Recovery / Rescue：先消融候选 Feature，再恢复或替换相关激活，检查输出是否恢复。

仅仅看到“消融后答案变了”还不够。干预也可能改变了大量非目标计算，造成非特异性影响。需要比较多个对照和 Prompt 复现结果。

### 8.3 Interpretability：自然语言解释是否可信？

自动生成的 Feature Explanation 应该由多个激活样例和反例验证。应当检查：

- Feature 是否只在解释描述的上下文中激活？
- 是否存在明显不符合标签的激活样例？
- 同义 Prompt、跨语言 Prompt 是否仍然表现一致？
- Feature 是否只表示语法格式或词面线索，而不是声明中的事实？
- 是否能通过干预验证其对目标行为的作用？

对 Feature 的解释应保留证据来源、人工审核结果和版本，不要只留一条自然语言标签。

### 8.4 Benchmark 不能只评估图的美观程度

[MIB: A Mechanistic Interpretability Benchmark](https://proceedings.mlr.press/v267/mueller25a.html) 提供了电路定位和因果变量定位等任务，对比不同方法恢复因果路径或关键变量的能力。它说明机制可解释性方法需要可重复、可比较的评估，不应只使用人工视觉判断。

[SAEBench](https://proceedings.mlr.press/v267/karvonen25a.html) 也说明 SAE 的代理指标与下游实际解释、控制能力之间并不存在简单的一一映射。

对企业 PoC，建议把以下指标加入持续回归：

| 指标 | 含义 |
|---|---|
| Target Logit Delta | 目标 Token 在干预前后的 Logit 变化 |
| Top-k Stability | 关键输出候选排序的变化 |
| Intervention Specificity | 目标 Feature 干预对非目标任务的影响 |
| Prompt Robustness | Prompt 改写后核心归因结果的稳定性 |
| Replication Rate | 不同运行、不同随机种子下结果的可复现程度 |
| Graph Size / Cost | 图节点、边数、GPU 时间、显存与存储成本 |
| Attribution Coverage | 成功完成目标 Token 分析的比例 |
| Human Review Agreement | 人工评审对解释的认可程度 |

还应记录无法生成归因图、缺少匹配 Transcoder、模型架构不支持、目标 Token 对齐失败等情况。失败和不适用不是零值，也不应静默过滤。

## 九、对企业架构的影响：模型可观测性将从 I/O 走向内部计算

传统 LLM Observability 已经可以追踪模型调用、Prompt、Completion、Token、工具调用、检索文档、耗时和费用。这些数据可以定位系统级故障，却无法直接解释模型内部为什么偏向某个答案。

Mechanistic Interpretability 的产业价值不在于为每个回答附上一段更长的解释，而在于给模型调试、风险分析和模型研发提供新的证据类型。

### 9.1 模型行为调试：从发现异常到定位内部计算

当模型在一次升级后开始频繁把某类实体关联错、输出不合适的拒答，或者对同一类问题产生异常偏差，工程团队通常需要比较数据、Prompt、权重和评估结果。

如果有内部 Feature / Circuit 观测，就可以对比新旧模型在选定任务上的 Activation 和计算路径，提出更精确的假设：某个 Feature 是否变得更活跃？某个路径是否被绕开？某种行为是否与数据分布或特征吸收有关？

它不保证能直接找出根因，但可以缩小排查范围，减少纯黑盒试错。

### 9.2 安全与 Prompt Injection：观察输入如何影响模型行为

IBM 的 Attention Tracker Demo 展示了对 Q/K 和 Attention 相关状态进行分析的路径。研究者可以对正常输入和注入式输入进行对比，观察内部信号是否出现差异。

这类内部状态 Detector 可作为额外的风险信号，但不应替代 Prompt Injection 测试、工具权限、输入边界和运行时策略。一个内部特征高激活不等于已经确认发生攻击；低激活也不能证明请求安全。

更合理的组合是：确定性安全策略负责权限和动作约束；内部 Probe 作为额外风险评分；需要时触发拒绝、人工审批或更严格验证。

### 9.3 金融、医疗和法律等高风险领域：增强模型风险管理，而非替代它

在受监管行业中，企业通常需要说明模型输入、运行版本、外部数据、提示词、输出、审批流程和评估结果。内部归因可能提供另一类证据：在某次生成中，哪些模型内部表征和路径与目标输出有关。

但应明确，Circuit Tracing 不会自动证明答案正确、模型没有偏见、没有使用受限数据，或模型符合某项监管要求。它也不能凭空恢复模型训练时的原始数据来源。

金融服务中的合理应用包括：

- 对选定的金融实体、产品和风险术语建立内部行为测试集；
- 在模型升级时分析重点问题的 Feature / Circuit 差异；
- 对风险较高的输出执行离线内部归因和人工审查；
- 将内部归因与业务资料、数据权限和输出证据结合；
- 保存模型版本、实验结果和限制说明，支持模型风险管理。

高风险业务不能用一张 Attribution Graph 代替独立验证、业务审批、模型验证和正式控制机制。

### 9.4 训练数据治理：解释“模型为什么学成这样”

模型对某类事实或行为表现出偏好，原因可能来自预训练数据、监督微调、偏好训练、合成数据或架构本身。内部 Circuit 能描述模型在当前任务中如何计算，却不能单独指出训练集中的具体文档。

Training Data Attribution 可以从另一侧补充证据。例如 DataDignity 试图在候选文档中找出最可能支持回答的资料；Goodfire 的 Predictive Data Debugging 则研究如何在训练前预测偏好数据会强化哪些行为。

如果把两条路线结合，未来可以形成从“训练数据变化 → 模型内部特征变化 → 输出行为变化”的分析链，但这需要对应的训练数据、模型 Checkpoint 和可比实验。对闭源模型通常没有这些条件。

### 9.5 推理平台：把内部观测做成可控、可预算的能力

IBM MIA 的工作说明内部状态采集可以尝试与高性能推理引擎结合。但企业设计时仍应区分两种路径：

- **在线轻量探测**：对少量、经过验证的 Layer / Feature 或 Probe 做读取和评分，严格约束延迟和显存。
- **离线深度归因**：在采样请求、异常案例或发布回归任务上运行 Circuit Tracing、Patching 和 Feature 分析。

不建议默认在所有请求的同步路径上生成完整 Attribution Graph。图计算、梯度分析、保存大规模 Activation 和人工审查都有显著的成本。

### 9.6 对 AI Observability 产品的影响

现在的 LLM Observability 主要追踪：

| 当前常见观测 | 下一步可扩展的内部观测 |
|---|---|
| Prompt / Completion | Token ID / Prefix 级别的目标输出定位 |
| Model / Provider | 模型权重、Tokenizer、SAE / Transcoder 版本 |
| Token Cost / Latency | 内部状态采集成本、Graph 计算成本、干预开销 |
| RAG Retrieved Documents | 参数化知识的内部表征 / 计算路径 |
| Tool Calls / Agent Trace | 模型内部 Probe、Feature 变化和干预记录 |
| Eval Score | 归因稳定性、因果干预结果、内部行为漂移 |

可以把它理解为从 I/O Observability 向 Model Internals Observability 扩展。但这是一种架构方向，而不是当前已经建立的标准。现有 OpenTelemetry GenAI 语义约定主要关注 GenAI 调用与运行可观测性，并没有定义一套通用的 SAE Feature、Transcoder Node 或 Attribution Graph 语义模型。

未来如果要把这些数据纳入企业观测平台，需要一个内部归因 Schema，并与现有 Trace / Span 关联。它不应该直接把完整 Activation Tensor 写进普通 Trace Attributes。

## 十、生产落地时需要解决的架构问题

### 10.1 模型、Tokenizer 和特征模型版本必须绑定

一个归因结果至少要记录：

- 模型 ID、revision、权重摘要和推理精度；
- Tokenizer ID、revision、Chat Template 和 Special Token 设置；
- SAE / Transcoder 的模型 ID、revision、训练方法和 Feature 版本；
- Circuit Tracer / NNsight / TransformerLens 的软件版本；
- Prompt Hash、准确 Prefix、目标 Token ID 和生成参数；
- 干预方式、位置、强度、实验次数和对照结果。

Feature ID 本身不是跨模型、跨版本的永久标识。换一个 Transcoder Checkpoint，Feature Index 的语义可能完全改变。

### 10.2 敏感数据和 Activation 不能按普通日志处理

Activation 可能携带输入文本、实体、业务上下文甚至用户敏感数据的表征。虽然它不是原始文本，却不能视为天然匿名数据。

建议：

- 默认仅保存 Prompt Hash、必要 Token ID 和选定的分析 Artifact；
- 只有经授权的实验才保存完整 Prompt 或 Activation；
- 根据租户、模型、业务域和数据等级隔离存储与访问；
- 对 Activation / Graph Artifact 设置加密、访问审批、保留期限和删除策略；
- UI 展示时对敏感文本、实体和内部特征标签实施权限控制；
- 避免将生产客户数据发送到未获授权的公共可视化平台。

### 10.3 内部归因应当异步，并且有明确触发条件

建议将内部归因放在影子分析或离线队列中：

~~~mermaid
flowchart TD
    A["Production Model Request"] --> B["Normal Inference"]
    B --> C["Answer + Standard Trace"]
    C --> D{"Attribution Trigger?"}
    D -->|No| E["Keep Standard Observability"]
    D -->|Yes| F["Queue Attribution Job"]
    F --> G["Model / Prompt / Token Version Check"]
    G --> H["Run Circuit Trace or Probe"]
    H --> I["Persist Evidence Artifact"]
    I --> J["Human Review / Regression"]
    J --> K["Knowledge Attribution Record"]
~~~

可触发归因的场景包括：关键评估集失败、模型升级回归、特定高风险领域输出、严重幻觉报告、异常拒答或人工研究任务。触发规则应由业务风险和分析价值决定，而不是只按随机采样比例。

### 10.4 成本和性能要有预算

需监控的项目包括：

- GPU 时间和显存峰值；
- Transcoder 加载和缓存命中率；
- 单个 Prompt 的 Graph 节点数和边数；
- CPU / Disk Offload 带来的额外运行时间；
- Activation / Graph Artifact 的存储量；
- 失败重试和模型下载成本；
- 在线 Probe 对 TTFT、TPOT 和吞吐的影响。

完整 Circuit Tracing 与在线轻量 Probe 不是同一个性能等级。应当分别设置预算和 SLO，避免让离线科学实验意外进入用户请求的关键路径。

### 10.5 人工解释和机器判断要分层

系统不应输出一个貌似确定的字段，例如 `knowledge_source = feature_1234`，除非有明确的定义和足够证据。

更合理的状态是：

| 状态 | 含义 |
|---|---|
| Observed | 观察到某个 Feature / 节点参与当前计算 |
| Attributed | 分析方法估计它对目标输出有一定贡献 |
| Intervened | 已经执行指定干预并记录影响 |
| Replicated | 在预先定义的对照条件下得到重复结果 |
| Human Reviewed | 人工检查了解释和反例 |
| Insufficient Evidence | 当前模型、数据或方法不足以支持解释 |

这些状态不应压缩成一个 0—1 的“知识置信度”。图的贡献值、Feature 解释质量、因果有效性和事实正确性属于不同维度。

## 十一、值得继续跟进的研究问题

当前还有几个关键问题没有被彻底解决。

**一是知识存储定位和知识检索路径的关系。** 一个事实可能涉及多个权重、Layer 和 Feature；检索路径也可能不连续且存在冗余。如何对同一事实在不同 Prompt 下的路径进行稳定建模，仍然是研究问题。

**二是 Feature 解释能否成为可靠的业务概念。** SAE Feature 的名字是人类对激活样例的概括，不是模型权重中自带的语义标签。Feature Absorption、特征重叠和上下文依赖都会影响解释的稳定性。

**三是归因与训练数据出处如何结合。** Circuit Tracing 可以说明某些内部特征参与了当前输出；Training Data Attribution 可以在给定候选语料中寻找可能支持回答的样本。两者结合才有机会建立从数据到内部机制再到输出行为的证据链。

**四是如何在高性能推理服务中稳定运行。** MIA 这类系统试图降低运行时读取和干预内部状态的成本，但模型架构、并行策略、CUDA Graph、量化和推理框架版本都会影响实现方式。

**五是怎样评价解释本身。** MIB、SAEBench 和其他评估研究说明，单一指标、单次干预或一段由 LLM 生成的自然语言解释，都不足以保证机制解释正确。未来需要更多标准化任务、反事实测试、独立复现和干预保真度评估。

## 十二、实施路线：先研究一个事实，再扩展到回答级归因

建议按下面的顺序推进。

| 阶段 | 工作内容 | 可交付结果 |
|---|---|---|
| POC 1 | Gemma 2 2B + 官方 Transcoder + Dallas/Austin | 第一张 Attribution Graph |
| POC 2 | 对目标 Feature 做 Ablation，并对比其他 Feature | 一个包含对照实验的因果证据记录 |
| POC 3 | 使用 Qwen3 对类似任务重复分析 | 跨模型比较，确认模型特异性 |
| POC 4 | 引入 Claim Extraction、Token Span Alignment 和归因记录 Schema | 多 Claim 的实验数据集 |
| POC 5 | 构建 Neuronpedia 或自定义 UI | Feature、Circuit、干预和评估结果可浏览 |
| POC 6 | 选取 vLLM-Hook MIA 的轻量 Probe 方案 | 在线状态监控的技术验证 |
| POC 7 | 将 Training Data Attribution 和企业候选语料结合 | 回答与候选资料的支持关系分析 |

第一阶段不需要自建 SAE，也不应该同时引入多个复杂框架。先复现官方 Graph，确认模型、Transcoder 和目标 Token 之间的关系，然后做干预和反例检查。只有当默认 Transcoder 不适合目标模型，或现有 Feature 粒度无法回答问题时，再考虑自行训练 SAE / Transcoder。

## 十三、对业界的实际影响：它会改变什么，又不会替代什么？

我认为这项技术中长期会影响三个方面。

第一，**模型调试将获得一层此前缺失的证据**。团队不仅能看到输入和输出，还可以在可访问的开源模型中观察哪些内部特征和计算路径与目标行为相关。这有机会降低模型行为回归、幻觉、偏见和异常拒答的排查成本，但目前没有充分的行业数据证明它已经普遍降低了生产事故率。

第二，**模型研发将从输出行为优化扩展到内部表征和训练数据诊断**。Feature、Circuit 和训练样本可以被联合研究。对开放权重、数据可控的模型，这可能帮助模型团队定位不希望出现的关联，并设计有针对性的训练数据处理或干预。需要注意的是，模型编辑也可能产生局部副作用，不能当成无风险的知识更新机制。

第三，**AI Observability 的范围可能继续扩大**。当前 Trace / Span 主要描述调用和外部依赖，未来可以增加内部 Feature、Probe、Circuit Artifact 与干预记录。它更像一层面向模型研发和风险分析的深度观测能力，不应直接把原始激活数据塞进普通请求日志，更不应该把某个 Feature Label 当成业务审计结论。

短期内，这项技术最适合模型研发团队、安全研究团队和拥有开源权重/训练数据访问权限的企业。对于只能调用闭源模型 API 的应用团队，仍然应该优先建设调用 Trace、Prompt / Completion 版本管理、RAG 证据、评估集和人工复核机制。除非供应商提供内部归因 API，否则应用方无法从一段 API 返回文本中反推出模型内部的 Feature 或 Circuit。

一个更务实的目标不是“让每个回答都能解释自己”，而是：**当模型在重要任务上出现异常时，企业有能力针对指定模型和指定输出运行可复现的内部实验，并把观察、干预、训练数据和业务证据分开记录。**

## 十四、中国研究与中国开源模型：从 Qwen-Scope 到 DeepSeek / Kimi 的内部分析

中国团队已经在机制可解释性（Mechanistic Interpretability）上形成了可辨认的研究和工具链，尤其是 SAE 特征、事实知识的 Feature 级分析、安全神经元、推理过程的内部表征，以及面向 Qwen 的模型专用 SAE。与此同时，DeepSeek、Kimi 等模型也开始成为国际研究团队直接分析的对象。

先区分两个经常被混在一起的范围：

- **中国团队开展的研究**：作者或主要研发团队来自中国高校、研究院或中国模型团队，例如清华、北大、中科院、复旦 / OpenMOSS、Qwen 团队和吉林大学。
- **以中国模型为对象的研究**：论文可能由海外高校或国际公司完成，但实验对象是 DeepSeek、Qwen、Kimi 等模型。这些论文同样有价值，不过不能把它们归类成中国研究机构的成果。

这一区分很重要。某个 Qwen 模型被国际研究团队分析，不等于 Qwen 官方发布了对应解释工具；某个中国高校提出了 SAE 方法，也不代表它已经在 DeepSeek、GLM 和 Kimi 上全部完成验证。

### 14.1 中国研究团队的几条主线

#### A. 中科院自动化所 / 中国科学院大学：The Knowledge Microscope

论文：[The Knowledge Microscope: Features as Better Analytical Lenses than Neurons](https://aclanthology.org/2025.acl-long.516/)，ACL 2025。

这项研究直接对应本文最初的问题：模型内部的事实知识究竟应该用什么粒度来观察？此前不少工作以 MLP Neuron 为分析单位，但一个 Neuron 可能具有多义性（Polysemanticity），同时参与多种不同语义或行为。研究团队提出把 SAE 分解出的 Feature 作为更细粒度的分析对象。

论文给出三个主要发现：

1. 相比单独 Neuron，Feature 对事实知识表达具有更强影响力，也更容易解释。
2. Feature 对相关事实与无关事实呈现出更有区分度的激活模式。
3. 基于 Feature 的 FeatureEdit 在删除模型中的隐私敏感知识方面优于 Neuron 级方法。

它的价值是把“某个事实与哪些内部单元有关”推进到 Feature 级，并进一步尝试知识编辑和隐私删除。这里的 Feature 仍然是 SAE 学出来的表征方向，不是模型内置的知识条目，也不意味着可以从某个 Feature 直接读取训练文档 ID。

论文页面说明代码和数据将会提供，但目前不应把它描述成已经具有成熟、通用的生产接口。实施时需要以作者后续正式代码发布为准。

#### B. 清华大学：Safety Neurons 与动态 Activation Patching

论文：[Towards Understanding Safety Alignment: A Mechanistic Perspective from Safety Neurons](https://papers.neurips.cc/paper_files/paper/2025/hash/12a00d85a76fe258e1242c3aced03250-Abstract-Conference.html)，NeurIPS 2025。

代码：[THU-KEG/SafetyNeuron](https://github.com/THU-KEG/SafetyNeuron)。

这项工作研究的是模型安全对齐机制，而不是事实知识本身。团队先比较模型在不同对齐阶段的内部激活，使用 Inference-time Activation Contrasting 找到与安全行为变化相关的候选神经元，再通过 Dynamic Activation Patching 检验它们对生成行为的因果影响。

论文报告，在其评估设置中，约 5% 的神经元构成有效的 Safety Neurons；只对这些神经元做激活修补，可以恢复超过 90% 的安全表现，同时不显著影响一般能力。这些是论文作者在指定模型和基准上的实验结果，不应直接视作所有模型都能达到的指标。

值得注意的是，这项研究明确测试了四种开源模型：Llama 2 7B、Mistral 7B、Gemma 7B 和 **Qwen2.5 3B**。因此它是目前可以核验的、中国团队直接在 Qwen 模型内部做 Activation Patching 的研究案例之一，但研究目标是安全行为，而不是“某个事实从哪里来”。

代码仓库也具备较好的研究复现入口：项目实现了继承 TransformerLens 和 Hugging Face Transformers 的 HookedModel，提供 Activation Change Score、Neuron Ranking 和 Dynamic Activation Patching。仓库 README 明确说明当前的生成干预实现主要覆盖 Greedy Decoding，其他 Sampling 策略不能默认视为同等支持。

#### C. 复旦大学 / 上海人工智能实验室 / 上海创新研究院：OpenMOSS 与 Llamascopium

项目：[OpenMOSS/Llamascopium](https://github.com/OpenMOSS/Llamascopium)。

研究基础之一：[Llama Scope: Extracting Millions of Features from Llama-3.1-8B with Sparse Autoencoders](https://arxiv.org/abs/2410.20526)。

OpenMOSS 的价值不只是发布一批 Feature，而是持续建设 SAE / Transcoder 的训练、分析、分布式计算和可视化工具链。其早期 Llama Scope 为 Llama 3.1 8B 提供跨 Layer 和子层的 SAE；后续 Llamascopium 已发展为支持多种稀疏字典方法的框架，包括 SAE、Transcoder、Crosscoder 和 Lorsa（Low-Rank Sparse Attention）等。

这条路线和 Anthropic 的 Circuit Tracing 关系密切：要把模型计算路径表示成 Feature 级图结构，除了捕获 Activation，还需要能够解释 MLP 或 Attention 计算的稀疏替代表示。OpenMOSS 的研究重点之一正是让这类表示能够规模化训练和分析。

更重要的是，当前 Llamascopium 文档已经提供了针对 **Qwen3 1.7B** 的 Llama-Scope 2 Transcoder 加载示例：

~~~python
from llamascopium import SparseDictionary

sae = SparseDictionary.from_pretrained(
    "OpenMOSS-Team/Llama-Scope-2-Qwen3-1.7B:transcoder/8x/k128/layer12_transcoder_8x_k128",
    fold_activation_scale=False,
)
~~~

这意味着 Qwen3 不再只有“可以用 Hook 读取 Hidden State”这种底层能力，而是至少有一套可以直接加载的模型专用 Transcoder 工件。它仍然只是指定模型、指定 Layer、指定版本的工件，不能拿来分析 Qwen3.5、DeepSeek 或 GLM。

#### D. 清华大学 / 北京大学：LinguaLens 与语言机制分析

论文：[LinguaLens: Towards Interpreting Linguistic Mechanisms of Large Language Models via Sparse Auto-Encoder](https://arxiv.org/abs/2502.20344)。

这项工作把机制分析扩展到语言学维度：形态、句法、语义和语用等语言特征。研究构造中英文最小对照和反事实数据，再用 SAE 定位对应特征，并通过 Feature Intervention 检查它们是否会影响模型对语言现象的处理。论文实验使用 Llama 3.1 8B，而不是 Qwen 或 DeepSeek。

另一个相关成果是：[Unveiling Language-Specific Features in Large Language Models via Sparse Autoencoders](https://aclanthology.org/2025.acl-long.229/)，ACL 2025，代码为 [Aatrox103/multilingual-llm-features](https://github.com/Aatrox103/multilingual-llm-features)。

它研究 SAE Feature 的语言特异性，发现一些 Feature 与特定语言显著相关；消融某种语言的 Feature，可能主要损害该语言能力，而对其他语言影响较小。研究还利用语言 Feature 改进 Steering Vector，以控制生成语言。

这些研究不等同于事实归因，但它们对中文、英文和跨语言回答的内部机制分析很有价值。例如，模型把中文问题转成英文式推理、在中文实体与英文术语之间切换，可能涉及语言相关 Feature 的协同，而不是简单的 Token 翻译。

### 14.2 Qwen：目前模型专用工具链最完整的一条路线

#### A. Qwen-Scope：Qwen 团队正式发布的 SAE 套件

论文：[Qwen-Scope: Turning Sparse Features into Development Tools for Large Language Models](https://arxiv.org/abs/2605.11887)，2026 年 5 月。

官方介绍：[Qwen-Scope: Decoding Intelligence, Unleashing Potential](https://qwen.ai/blog?id=qwen-scope)。

Qwen-Scope 是目前最值得关注的模型专用成果之一。它不是简单地在某个 Qwen Checkpoint 上临时训练一个 SAE，而是发布了覆盖 Qwen3 和 Qwen3.5 的 SAE 组合：论文列出 **14 组 SAE、覆盖 7 个模型变体**，包括 Dense 和 Mixture-of-Experts 架构。

论文将用途扩展到四个方向：

| 用途 | 具体做法 | 与内部知识分析的关系 |
|---|---|---|
| Inference-time Steering | 使用 SAE Feature 控制语言、概念或偏好，不直接修改模型权重 | 检验 Feature 是否具有可干预的行为影响 |
| Evaluation Analysis | 对比评测样本激活的 Feature | 分析不同 Benchmark 是否覆盖重复或不同的能力表征 |
| Data-centric Workflows | 使用 Feature 做多语言毒性分类和安全数据合成 | 把模型内部表征用于数据筛选与合成 |
| Post-training Optimization | 将 SAE 信号加入 SFT / RL 优化 | 让内部特征成为模型训练和行为调整的反馈信号 |

这里出现了一个值得重视的变化：SAE 不再只是模型训练完成后的“显微镜”，而是逐渐成为模型研发中的一种表示接口（Representation-level Interface）。它能够参与评测、数据处理、推理时控制和后训练优化。

但仍然要区分两个目标：

- Qwen-Scope 可以帮助观察和操纵某些内部 Feature。
- 它并没有承诺把任意回答中的每个 Claim 精确映射到某条训练样本或唯一的模型参数。

对于本文关心的“回答 Token 与内部知识关联”，Qwen-Scope 给出的是 Feature 侧的模型专用基础；还需要进一步结合 Token Alignment、Attribution、Activation Patching 和事实级评测，才能建立可验证的回答归因链。

#### B. Qwen2.5 的安全神经元与 Qwen3 的 Transcoder

把不同研究组合起来看，目前至少可以确认三类 Qwen 内部分析资产：

- Qwen2.5 3B：清华 SafetyNeuron 在安全对齐研究中做 Neuron 定位和 Dynamic Activation Patching。
- Qwen3 1.7B：OpenMOSS Llama-Scope 2 / Llamascopium 提供特定 Layer 的 Transcoder。
- Qwen3 / Qwen3.5：Qwen-Scope 提供模型专用 SAE 组，支持 Feature 分析和若干下游工作流。

这三者的粒度和目的不同。不要把 Safety Neuron、SAE Feature 和 Transcoder Feature 当成同一种对象，也不要把一个项目中学到的 Feature ID 套用到另一个项目。

### 14.3 DeepSeek：推理过程已经成为内部分析的重点对象

DeepSeek 的研究有一个特点：相比一般知识问答，它的推理模型会产生更长的中间推理序列，因此研究者可以重点分析 Thinking Token、Reasoning Feature 和最终答案之间的关系。不过，**分析 DeepSeek-R1-Distill-Qwen 并不等于分析 DeepSeek 原始 671B 模型**：前者是用 DeepSeek-R1 生成的样本蒸馏到 Qwen 基础模型上的独立权重。

#### A. 吉林大学：Thinking vs. NoThinking

论文：[Thinking vs. NoThinking: Towards Interpreting Reasoning Mechanisms of Large Language Models via Sparse Autoencoders](https://arxiv.org/abs/2608.08168)，2026 年 8 月预印本。

研究团队来自吉林大学人工智能学院，并与香港理工大学合作。论文直接对 **DeepSeek-R1-Distill-Qwen-7B** 做内部表征分析，而不是通过 API 观察可见的推理文本。

实验方法比较明确：

- 以 DeepMath-103K 数学问题作为激活采集语料。
- 在模型 Residual Stream 的第 13 层提取 Activation。
- 分别对 Thinking 和 NoThinking 两种运行模式训练 Top-K SAE。
- Thinking 模式采集约 108M Token，NoThinking 模式约 65M Token。
- 对高激活 Feature 做逐步抑制，观察推理文本和数学答案结构的变化。

作者报告的观察包括：Thinking 模式更依赖少数高强度 Feature；NoThinking 模式的 Feature 激活更分散。对少数主要 Feature 做抑制后，模型更容易出现 LaTeX / boxed 答案结构退化、元认知表达增加、重复和低信息量续写等现象。

这个研究很有价值，因为它没有把可见的 CoT 文本直接当成模型的内部算法，而是将 Thinking 和 NoThinking 两种推理模式的 Activation 分开采集、训练 SAE，再用干预验证 Feature 与行为之间的关系。

它的边界也很清楚：它研究的是 DeepSeek-R1 蒸馏到 Qwen 7B 后的数学推理行为，主要聚焦第 13 层和一组高影响 Feature；不能据此推断原始 DeepSeek-R1 671B 的全部推理机制。arXiv 页面目前未列出官方代码链接，复现需要根据论文方法重新实现或等待作者发布代码。

#### B. Microsoft：从 Reasoning Trace 到最终答案的机制分析

论文：[From Reasoning to Answer: Empirical, Attention-Based and Mechanistic Insights into Distilled DeepSeek R1 Models](https://aclanthology.org/2025.emnlp-main.198/)，EMNLP 2025。

代码：[microsoft/ACV/tree/main/misc/R2A](https://github.com/microsoft/ACV/tree/main/misc/R2A)。

这项研究由 Microsoft 团队完成，实验对象是三种 DeepSeek-R1 蒸馏模型。研究分为三步：

1. 比较保留和移除显式 Reasoning Trace 后的答题表现。
2. 分析 Attention，发现部分中间层 Reasoning-Focus Heads 会跟踪推理轨迹，包括自我检查信号。
3. 使用 Activation Patching 改变关键推理 Token 的激活，检查最终答案是否随之改变。

研究结果支持一个重要结论：在这些被测模型中，最终答案确实会受到先前推理激活的影响；改变关键推理 Token 的内部信号，可以可靠地改变最终答案。

代码仓库提供了可复现的实验 Notebook、Attention 分析和 Activation Patching 代码。其 README 给出一个明确的运行入口：

~~~bash
python trace_collection.py \
  --model_path "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B" \
  --dataset "MATH-500" \
  --with_math_instruction \
  --with_reasoning \
  --limit 1
~~~

这是一个很好的入门实验：先收集同一问题的推理轨迹，再分析 Answer Token 对 Reasoning Token 的 Attention，最后通过 Patching 验证方向性影响。它比直接上完整 671B 模型的 SAE 训练容易得多。

#### C. Goodfire：在完整 DeepSeek-R1 671B 上训练 SAE

研究：[Under the Hood of a Reasoning Model](https://www.goodfire.com/research/under-the-hood-of-a-reasoning-model)。

代码和数据：[goodfire-ai/r1-interpretability](https://github.com/goodfire-ai/r1-interpretability)。

Goodfire 在 671B 参数的 DeepSeek-R1 上训练并开放了两种 SAE：一种面向通用推理，一种面向数学推理。项目还发布了大量 Feature 激活样例的 SQL 数据库和 Colab Notebook，以降低其他研究者必须自行运行完整大模型的门槛。

研究展示的 Feature 包括回溯、引用先前陈述、实体跟踪等推理相关模式。这个工作的重要意义是证明 SAE 不只适用于几 B 参数的实验模型，也可以通过专门的激活采集工程扩展到真正的大规模 MoE 推理模型。

但要注意它是 Goodfire 的研究和工具发布，不是 DeepSeek 官方解释系统；公开 SAE 与 Feature 样例也不意味着已经完整解释 R1 的全部计算路径。

### 14.4 Kimi：已经有针对 Kimi K2 Thinking 的大规模内部激活采集和 SAE

Goodfire 在 2026 年 2 月发布了工程研究：[Interpretability Infrastructure at Frontier Scale: Harvesting Activations from a Trillion-Parameter Model](https://www.goodfire.com/blog/interpretability-infra-at-frontier-scale)。

分析对象是 **Kimi K2 Thinking**。这篇文章不是同行评审论文，而是 Goodfire 对内部分析基础设施的工程实践说明，但它提供了极有价值的可扩展性经验。

Goodfire 描述的主要工作包括：

- 基于 SGLang 做较小范围的 Inference Server Fork，增加 Activation Harvesting。
- 面对 Continuous Batching、Chunked Prefill、Tensor Parallelism 和 CUDA Graph 等优化带来的数据错位问题，恢复 Activation 与原始 Token / Sequence 的对应关系。
- 使用 GPU Staging Buffer、Ring Buffer、Pinned CPU Memory 和 Sidecar Thread，把 Tensor 拷贝、CPU 传输和磁盘写入异步化，避免同步 I/O 阻塞 Forward Pass。
- 为 Kimi K2 Thinking 的单层 Activation 采集约 3B Token；文章估算压缩后的数据约 33 TB。
- 作者报告单个 8-GPU 节点达到约 14,000 tokens/s；10 个节点并行时，约 6 小时可以完成这轮采集。

随后团队在这些 Activation 上训练 SAE，并展示了对模型内部 Feature 的分析和推理过程中的实时 Steering。

这一案例的产业意义不只是“找到几个 Kimi Feature”，而是揭示了前沿 MoE 模型内部分析的主要瓶颈已经从算法扩展到推理系统工程：

1. Activation Capture 必须理解推理引擎的真实 Batch / Sequence 布局。
2. Tensor 必须与 Token、Sequence、Chunk 和位置保持可追溯的 Provenance。
3. GPU -> CPU -> Disk 的数据传输必须异步化和批处理。
4. Prefill 和 Decode 应分开优化；采集 SAE 训练数据时，不一定需要在 Decode 阶段逐 Token 捕获。
5. 大模型内部分析需要把推理、激活采集、数据存储、SAE 训练和 Feature 分析设计成独立流水线。

文章中的吞吐和成本数字是 Goodfire 报告的自有实验结果，不是可直接套用的通用 SLA。它也没有提供一套完整的公开 Kimi Circuit Tracing SDK，因此更适合作为大型模型 Activation Capture 架构参考。

### 14.5 GLM：目前缺少可核验的模型专用内部解释工件

针对 GLM 系列，我检索了中文和英文的 Mechanistic Interpretability、SAE、Feature、Activation Patching、Circuit Tracing 等关键词。目前没有找到与 Qwen-Scope、Llama-Scope 或 Goodfire R1 SAE 同等明确、可复现的 GLM 专用 SAE / Transcoder 发布，也没有找到足够明确的、直接针对 GLM-4.x 内部计算路径的公开实验论文和代码仓库。

这不是说 GLM 不能做内部分析，也不能据此断言没有团队在做相关工作。更准确的判断是：**截至本次核查，尚未发现可以直接下载并复用的 GLM 模型专用 Feature Dictionary 或 Circuit Tracing 工具链。**

如果要研究 GLM，工程路径仍然可行：先确认具体 GLM Checkpoint 能否由当前 Transformers / vLLM / SGLang 版本正确加载，再用 NNsight 或自定义 Hook 捕获指定 Layer 的 Activation，构造稳定的采集语料，训练与该模型版本匹配的 SAE。之后才能做 Feature Explanation、Token / Logit Attribution 和 Activation Patching。

特别要注意，GLM 的 MoE 层、专家选择和 Attention 实现可能与 Llama / Qwen 不同。仅仅能调用模型生成文本，或能读到最后一层 Hidden State，并不意味着已经完成了内部特征分析适配。

### 14.6 模型与研究资产对照：哪些可以直接开始，哪些仍需自行建设？

| 模型 / 家族 | 已找到的内部分析工作 | 方法和分析粒度 | 公开工件 / 可复现性 | 当前判断 |
|---|---|---|---|---|
| Qwen2.5 3B | 清华 SafetyNeuron | Safety Neuron、Activation Contrasting、Dynamic Patching | 公开论文和代码 | 可直接研究安全对齐内部机制 |
| Qwen3 / Qwen3.5 | Qwen-Scope | 模型专用 SAE Feature、Steering、评估与数据流程 | 论文、官方介绍和 SAE 模型集合 | 目前最完整的模型专用 SAE 资产 |
| Qwen3 1.7B | OpenMOSS Llama-Scope 2 | Layer 12 Transcoder / Sparse Dictionary | Llamascopium 文档提供加载路径 | 适合继续做 Feature 与 Circuit 实验 |
| DeepSeek-R1-Distill-Qwen 1.5B | Microsoft R2A | Reasoning Attention、RFH、Activation Patching | 公开代码和 Notebook | 适合作为推理路径复现实验 |
| DeepSeek-R1-Distill-Qwen 7B | 吉林大学 Thinking vs. NoThinking | Top-K SAE、Residual Stream Feature、因果抑制 | 公开预印本；arXiv 页面未列官方代码 | 有具体论文路线，复现仍需自行实现 |
| DeepSeek-R1 671B | Goodfire R1 SAE | 通用推理 / 数学 SAE、Feature 示例 | 公开 SAE、SQL 样例数据和 Notebook | 可研究大模型 Feature；完整推理成本很高 |
| Kimi K2 Thinking | Goodfire 大规模 Activation Harvesting | SAE、Latent Feature、实时 CoT Steering | 工程报告公开；未见同等完整的公开 SDK | 有大模型内部分析工程案例 |
| GLM-4.x | 本次核查未找到同等级模型专用工件 | 需要自行捕获 Activation 并训练 SAE | 尚未确认可直接复用的模型专用 Feature 集 | 需要自行建立适配和数据集 |

注意 Qwen 与 DeepSeek 的实验对象存在交叉：DeepSeek-R1-Distill-Qwen 的模型底座是 Qwen，蒸馏数据与训练过程来自 DeepSeek-R1。研究结果必须按实际 Checkpoint 归类，不能把 Distill-Qwen 的 Feature 直接说成 DeepSeek 原始模型的 Feature。

### 14.7 如何把这些成果转化成自己的实验？

如果目标是研究中国开源模型的内部知识，而不是简单比较模型回答质量，我建议按下面顺序选择：

**第一步：优先从 Qwen3 / Qwen3.5 做 Feature 级实验。** Qwen-Scope 已经发布多组 SAE，OpenMOSS 也已经在 Llamascopium 中提供 Qwen3 1.7B 的 Transcoder 加载示例。相比从零训练 SAE，这能减少第一阶段的数据和训练成本。

**第二步：若目标是分析推理过程，使用 DeepSeek-R1-Distill-Qwen。** 可以从 Microsoft 的 1.5B Activation Patching 示例开始，再参考吉林大学的 7B Thinking / NoThinking 双 SAE 方案。先回答“推理中的某个 Token 是否影响最终答案”，再继续研究具体 Feature 的语义。

**第三步：如果目标是完整 DeepSeek-R1 或 Kimi K2 Thinking，要把 Activation Capture 当成独立基础设施建设。** 不能直接在高性能推理服务里随便注册一个 PyTorch Hook 就假设能够正确采集。必须处理 Tensor Parallel、Continuous Batching、Token Provenance、异步数据拷贝、磁盘容量和特征训练吞吐。

**第四步：GLM 应先做模型架构适配和数据集建设。** 先确认内部模块命名、Attention / MLP / MoE 专家输出位置和可捕获的张量，再验证 Hook 的正确性，之后再开始训练 SAE。不要将 Llama 的 Transcoder 或 Qwen 的 SAE 强行迁移到 GLM。

可以把整体工作组织为：

~~~mermaid
flowchart TD
    A["选择具体模型与权重 Revision"] --> B["确认架构、Tokenizer、Chat Template"]
    B --> C["构建可复现 Prompt / Token 数据集"]
    C --> D["Activation Capture + Token Provenance"]
    D --> E["加载匹配的 SAE / Transcoder"]
    E --> F["Feature 与目标 Token / Logit 对齐"]
    F --> G["Feature Explanation 与反例检查"]
    G --> H["Ablation / Activation Patching"]
    H --> I["重复实验与跨 Prompt 验证"]
    I --> J["形成模型版本化的归因证据记录"]
~~~

这里最重要的工程约束是：每个 SAE / Transcoder 都要与 Model Revision、Layer、Hook Point、Tokenizer 和具体激活定义绑定。一个 Qwen3 的 Layer 12 Transcoder 不是一个可以跨版本使用的通用中文知识字典。

### 14.8 对中国模型生态和产业实践的影响

目前可以看到三种正在形成的产业能力。

**其一，模型厂商开始把内部表征作为模型研发接口。** Qwen-Scope 是很明确的例子：SAE Feature 不仅供研究人员分析，还被用于推理控制、评测分析、数据处理与后训练优化。未来模型交付物可能不只包含 Weight、Tokenizer 和推理代码，还包含模型专用的 Feature Dictionary、解释样例和评估套件。

**其二，第三方研究机构开始对中国大模型做深层审计。** Goodfire 对 DeepSeek-R1 和 Kimi K2 Thinking 的工作说明，开放权重与可访问的推理执行环境能够让独立团队分析模型内部表征，甚至在推理过程中做 Feature Steering。模型提供方不再是唯一能解释模型内部行为的参与者。

**其三，企业部署开源模型时有机会建设内部 Model Internals Observability。** 对金融、医疗、政务等需要模型风险管理的团队，未来可以针对指定模型和关键业务 Prompt 记录内部 Feature、目标 Logit、干预结果与人工审查。它比单纯记录 Prompt / Completion 更深入，但还不能替代事实核验、数据来源审计或正式的模型验证。

现阶段的实际判断是：Qwen 已经出现较系统的模型专用 SAE 工具链；DeepSeek 已经有原始 R1 和 Distill 模型的 SAE、Attention 与 Patching 案例；Kimi 已有大规模内部激活采集和 SAE 的外部工程实践；GLM 还需要进一步建设公开、可复用的模型专用工件。

对应用团队来说，这些成果不会让闭源 API 的普通使用者突然获得内部归因能力。必须有权访问模型权重和内部 Activation，或者由模型供应方提供受控的内部观测接口，才能真正开展这些分析。

## 参考资料与项目

### 机制可解释性、Circuit Tracing 与 Feature

1. Anthropic, [Circuit Tracing: Revealing Computational Graphs in Language Models](https://transformer-circuits.pub/2025/attribution-graphs/methods.html), 2025.
2. Anthropic, [On the Biology of a Large Language Model](https://transformer-circuits.pub/2025/attribution-graphs/biology.html), 2025.
3. Anthropic, [Open-sourcing circuit tracing tools](https://www.anthropic.com/research/open-source-circuit-tracing), 2025.
4. [decoderesearch/circuit-tracer](https://github.com/decoderesearch/circuit-tracer).
5. [hijohnnylin/neuronpedia](https://github.com/hijohnnylin/neuronpedia).
6. [decoderesearch/SAELens](https://github.com/decoderesearch/SAELens).
7. [TransformerLensOrg/TransformerLens](https://github.com/TransformerLensOrg/TransformerLens).
8. [ndif-team/nnsight](https://github.com/ndif-team/nnsight).
9. [MIB: A Mechanistic Interpretability Benchmark](https://proceedings.mlr.press/v267/mueller25a.html), ICML 2025.
10. [SAEBench: A Comprehensive Benchmark for Sparse Autoencoders in Language Model Interpretability](https://proceedings.mlr.press/v267/karvonen25a.html), ICML 2025.
11. [A is for Absorption: Studying Feature Splitting and Absorption in Sparse Autoencoders](https://proceedings.neurips.cc/paper_files/paper/2025/hash/764ff7477b8e24dbe01531f6791e8bdf-Abstract-Conference.html), NeurIPS 2025.
12. [Factual Retrieval in LLMs Is a Redundant, Distributed and Non-Contiguous Process](https://aclanthology.org/2026.acl-long.2168/), ACL 2026.

### Knowledge Neurons、知识编辑与数据归因

13. [Knowledge Neurons in Pretrained Transformers](https://aclanthology.org/2022.acl-long.581/), ACL 2022.
14. [Locating and Editing Factual Associations in GPT](https://proceedings.neurips.cc/paper_files/paper/2022/hash/6f1d43d5a82a37e89b0665b33bf3a182-Abstract-Conference.html), NeurIPS 2022.
15. [Mass-Editing Memory in a Transformer](https://memit.baulab.info/), 2023.
16. [zjunlp/EasyEdit](https://github.com/zjunlp/EasyEdit).
17. [stanfordnlp/pyvene](https://github.com/stanfordnlp/pyvene).
18. [inseq-team/inseq](https://github.com/inseq-team/inseq).
19. [DataDignity: Training Data Attribution for Large Language Models](https://arxiv.org/abs/2605.05687), 2026.
20. [TRAK: Attributing Model Behavior at Scale](https://github.com/MadryLab/trak), ICML 2023.

### 产业实践与工具

21. IBM Research, [Toward fast AI interpretability and control](https://research.ibm.com/blog/fast-interpretability-plugin-vllm), 2026-10-21.
22. [IBM/vLLM-Hook](https://github.com/IBM/vLLM-Hook).
23. Goodfire, [Silico](https://www.goodfire.com/silico).
24. Goodfire, [Predictive Data Debugging: Reveal and Shape What Your Model Learns, Before You Train](https://www.goodfire.com/research/predictive-data-debugging), 2026-06-11.
25. Ai2, [How Goodfire used Ai2’s open post-training stack to trace unwanted model behavior](https://allenai.org/blog/goodfire-olmo), 2026-09-09.
26. Goodfire, [Silico Capabilities](https://docs.goodfire.com/concepts/capabilities/).
27. Oxford Martin School, [Automated Interpretability-Driven Model Auditing and Control: A Research Agenda](https://aigi.ox.ac.uk/wp-content/uploads/2026/01/Automated_interp_Research_Agenda.pdf), 2026-01.
28. [The Knowledge Microscope: Features as Better Analytical Lenses than Neurons](https://aclanthology.org/2025.acl-long.516/), ACL 2025.
29. [Towards Understanding Safety Alignment: A Mechanistic Perspective from Safety Neurons](https://arxiv.org/abs/2406.14144), NeurIPS 2025; [THU-KEG/SafetyNeuron](https://github.com/THU-KEG/SafetyNeuron).
30. [OpenMOSS/Llamascopium](https://github.com/OpenMOSS/Llamascopium), SAE / Transcoder training and analysis framework.
31. [LinguaLens: Towards Interpreting Linguistic Mechanisms of Large Language Models via Sparse Auto-Encoder](https://arxiv.org/abs/2502.20344).
32. [Unveiling Language-Specific Features in Large Language Models via Sparse Autoencoders](https://aclanthology.org/2025.acl-long.229/), ACL 2025; [Aatrox103/multilingual-llm-features](https://github.com/Aatrox103/multilingual-llm-features).
33. [Qwen-Scope: Turning Sparse Features into Development Tools for Large Language Models](https://arxiv.org/abs/2605.11887), 2026; [Qwen official introduction](https://qwen.ai/blog?id=qwen-scope).
34. [From Reasoning to Answer: Empirical, Attention-Based and Mechanistic Insights into Distilled DeepSeek R1 Models](https://aclanthology.org/2025.emnlp-main.198/), EMNLP 2025; [Microsoft R2A code](https://github.com/microsoft/ACV/tree/main/misc/R2A).
35. Goodfire, [Under the Hood of a Reasoning Model](https://www.goodfire.com/research/under-the-hood-of-a-reasoning-model), 2025; [goodfire-ai/r1-interpretability](https://github.com/goodfire-ai/r1-interpretability).
36. [Thinking vs. NoThinking: Towards Interpreting Reasoning Mechanisms of Large Language Models via Sparse Autoencoders](https://arxiv.org/abs/2608.08168), arXiv 2026.
37. Goodfire, [Interpretability Infrastructure at Frontier Scale: Harvesting Activations from a Trillion-Parameter Model](https://www.goodfire.com/blog/interpretability-infra-at-frontier-scale), 2026-02-25.

---

*资料核对截止日期：2026 年 11 月 4 日。开源项目的模型支持、API、依赖和硬件要求变化较快，实施前应以对应仓库当前 README、Release、模型卡和实验记录为准。本文中的 PoC 用于研究验证，不应直接作为生产环境的安全检测、事实验证或合规证明。*
