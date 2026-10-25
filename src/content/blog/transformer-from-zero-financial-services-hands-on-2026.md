---
author: SW
featured: false
draft: false
description: 面向有扎实编程基础、但没有深度学习经验的开发者，从张量和矩阵乘法讲起，手写注意力，再用 PyTorch 训练 Transformer，最后把它用于金融时序、欺诈检测、收益率曲线和基金业务数据。
pubDatetime: 2026-10-25T01:00:00Z
title: 给老程序员的 Transformer 实战入门：从矩阵乘法到金融时序模型
tags:
  - AI
  - deep-learning
  - transformer
  - pytorch
  - time-series
  - finance
---

如果你熟悉 C++、Java、Python 或数据库系统，理解 Transformer 不需要先把自己变成数学家。你需要补上的主要不是编程能力，而是几套新的思维模型：用张量表达批量数据，用可微分函数表达模型，用损失函数表达“错得有多严重”，再通过自动求导和优化器不断调整模型内部的数字。

本文就是为这样的读者写的：有多年软件开发经验，但没有系统学习过深度学习。目标不是让你背诵一堆神经网络名词，而是让你看懂 Transformer 的数据流，亲手实现注意力机制，跑通训练与评估，并知道怎么把同一套方法迁移到市场价格、交易欺诈、利率曲线、持仓、交易订单簿和基金会计等金融场景。

文中的样例分为两类。第一类是小型合成时间序列，用于稳定、快速地观察模型训练流程；它不是实际市场数据，也不能证明存在可交易的预测能力。第二类是研究目录里已有的公开数据实验，适合进一步做真实数据验证。两类实验不能混为一谈。

**建议按顺序动手，而不是一次性读完整篇文章：**

1. 先理解张量形状与训练循环。
2. 运行手写注意力实现，观察 Q、K、V 和 Attention Weights。
3. 训练一个很小的 Transformer，确认损失下降、模型能保存和加载。
4. 再运行 ETF 或国债收益率曲线实验，并与简单基线比较。
5. 最后再阅读多头注意力、掩码、长序列、预训练以及金融生产架构。

## 一、先建立正确的心理模型：Transformer 到底是什么？

### 1.1 它不是一种特殊的程序语言，也不等于 ChatGPT

Transformer 是一种神经网络架构。2017 年论文 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) 提出了以注意力机制为核心、摆脱循环结构的序列建模架构。它最初用于机器翻译，后来被广泛应用于文本、图像、时间序列、推荐系统和结构化事件数据。

LLM（大语言模型）通常是以 Transformer 为主体、用海量文本进行预训练的一类模型，但 Transformer 的输入并不一定是文字。输入也可以是价格、收益率、订单簿、持仓数量、风险指标、交易类型等结构化数据。

因此，应当区分三个概念：

| 概念 | 可以怎么理解 | 典型例子 |
|---|---|---|
| Transformer | 一种神经网络架构，提供序列中各位置交换信息的方式 | 使用最近 60 个交易日预测未来 5 日收益 |
| 训练目标 | 告诉模型应该学会什么 | 预测下一事件、补全被遮住的字段、预测未来收益或欺诈标签 |
| LLM | 通常使用 Transformer、在大规模文本上预训练的模型类别 | 对话、代码生成、文本摘要 |

在金融应用中，完全可以训练一个几万或几十万个参数的小型 Transformer，让它处理数字序列。它既不需要生成文本，也不需要调用外部大模型。

### 1.2 模型是一个可训练的函数

在普通业务系统里，我们会写一组固定规则：

- 输入数据；
- 执行确定的逻辑；
- 返回输出。

神经网络也可以看作一个函数，不过其内部包含很多可调整的数值，称为参数。设输入为 \(x\)，模型参数为 \(\theta\)，则模型输出可以写成：

\[
\hat{y}=f_\theta(x)
\]

例如，给模型最近 30 个交易日、每一天 5 个特征的数据，它可能输出未来 5 个交易日的累计收益预测。函数结构由我们编写，参数则由训练过程根据数据调整。

深度学习不是让计算机自己发明程序结构。我们仍然决定输入字段、模型架构、输出含义、损失函数、数据切分、优化器和运行环境。训练只是根据样本寻找一组更合适的参数。

### 1.3 训练、验证、推理是三种不同工作

**训练（training）** 是把已知输入与目标送入模型，根据预测错误调整参数。**验证（validation）** 是用未参与本轮参数更新的数据比较不同训练轮次或超参数，决定选哪一个模型。**推理（inference）** 是固定参数，只计算新输入的输出。

这三件事对应三种不同的数据使用规则。测试集不应参与参数更新，也不应被反复用于挑选模型；否则测试集就不再是独立的最终评估。

对于有时间顺序的金融数据，训练、验证和测试通常需要按时间先后划分，而不是把所有样本随机打乱后再拆分。否则模型可能在训练阶段看到发生在测试时点之后的数据，造成时间泄漏。可参考 [scikit-learn 的 TimeSeriesSplit 文档](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)。

## 二、老程序员最先要理解的新概念：Tensor

### 2.1 Tensor 并不神秘

可以把 Tensor 理解为带有形状、数据类型和设备位置的多维数组。它与 NumPy 数组相似，但 PyTorch Tensor 还能参与自动求导，并可在 CPU、GPU 或 Apple Silicon 的 MPS 设备上运算。

| 名称 | 维度 | 例子 | 在金融数据里的含义 |
|---|---:|---|---|
| Scalar | 0 维 | 0.031 | 一笔预测误差 |
| Vector | 1 维 | 5 个数字 | 一个交易日的 5 个特征 |
| Matrix | 2 维 | 30 × 5 | 连续 30 个交易日，每天 5 个特征 |
| Tensor | 3 维 | 128 × 30 × 5 | 一批 128 个样本，每个样本 30 天、每天 5 个特征 |

Transformer 入门阶段最重要的形状是：

\[
X \in \mathbb{R}^{B\times T\times F}
\]

其中：

- \(B\)：batch size，一次并行处理多少个训练样本；
- \(T\)：sequence length，每个样本包含多少个时间位置；
- \(F\)：每个时间位置包含多少个原始特征。

比如形状是 128 × 30 × 5，表示一次处理 128 个样本，每个样本有 30 个时间位置，每个时间位置含 5 个数值特征。

这和传统程序的循环可以对应起来：如果逐个样本、逐个时间点循环，会反复执行相似运算；Tensor 运算则把这些操作批量化，由底层数值库决定如何利用 CPU 向量指令、并行线程或 GPU。

### 2.2 先认识 Linear：它就是矩阵乘法加偏置

最常见的神经网络层之一是线性层：

\[
Y=XW+b
\]

假设输入有 5 个特征，输出宽度设为 32，那么权重矩阵 \(W\) 可以是 5 × 32，偏置 \(b\) 的长度为 32。每个样本的 5 个数字就被映射成 32 个数字。

这不比普通的矩阵运算神秘。不同之处在于，矩阵里的权重不是我们手工配置，而是训练时会不断调整的参数。

一个模型由多个这样的映射、非线性函数、注意力层和归一化层组成。参数数量决定了模型可以表达多复杂的关系，但参数多不保证准确率更高。

### 2.3 为什么还需要非线性？

如果只把多个线性层连续相乘：

\[
XW_1W_2W_3
\]

从整体看仍然只是一个线性变换，可以合并为 \(XW\)。它不能表达任意复杂的非线性关系。

因此，神经网络会在一些层之间加入非线性激活函数，例如 ReLU 或 GELU。这些函数使网络不仅能重新组合特征，还能学习非线性的决策边界。

Transformer 中有一个前馈网络（Feed-Forward Network, FFN），本质上就是每个时间位置各自执行的一组线性变换和非线性激活。注意力负责位置之间的信息交互，FFN 负责对每个位置的表示进一步计算。

## 三、从机器学习训练循环看 PyTorch

先不讨论 Transformer。任何常见的监督学习训练流程，几乎都可以拆成下面几步。

~~~mermaid
flowchart TD
    A[准备输入 X 与目标 y] --> B[模型前向计算]
    B --> C[计算预测与真实目标之间的 Loss]
    C --> D[自动求导计算梯度]
    D --> E[优化器更新模型参数]
    E --> F{还有训练 Batch？}
    F -->|是| B
    F -->|否| G[在验证集评估]
    G --> H[选择最佳模型并在测试集评估]
~~~

### 3.1 Loss 是训练的目标，不是业务最终指标

例如，模型预测未来收益为 0.012，真实值为 0.008，预测误差是 0.004。对于连续数值预测，可以用均方误差（MSE）：

\[
\operatorname{MSE}=\frac{1}{N}\sum_{i=1}^{N}(\hat y_i-y_i)^2
\]

或者使用 Huber Loss，它在小误差附近类似平方损失，在大误差时对极端值相对稳健。对于二分类问题，可以使用 Binary Cross-Entropy；对于多分类问题，常见的是 Cross-Entropy。

但 Loss 并不等于所有业务目标。例如，风险模型训练时可以最小化分类损失；业务部门可能真正关心的是每天只能调查最高风险 1% 的情况下能找到多少欺诈。训练目标与业务评估指标应当明确区分。

### 3.2 梯度下降和自动求导

假设模型参数是 \(\theta\)，损失是 \(L(\theta)\)。直觉上，梯度告诉我们每个参数增加或减少一点，会怎样影响损失。优化器按梯度给出的方向更新参数：

\[
\theta \leftarrow \theta-\eta \nabla_\theta L
\]

这里的 \(\eta\) 是学习率，控制每一步更新的尺度。

多层神经网络有很多参数，手工推导全部偏导数既繁琐又容易出错。PyTorch 使用自动求导（autograd）记录前向计算过程，再按链式法则计算梯度。官方文档将其描述为一种反向自动微分系统：[PyTorch Autograd mechanics](https://docs.pytorch.org/docs/stable/notes/autograd.html)。

在代码里，核心流程通常只有几行：

~~~python
optimizer.zero_grad(set_to_none=True)  # 清除上一个 Batch 的梯度
prediction = model(x)                  # Forward pass
loss = loss_fn(prediction, y)          # 计算 Loss
loss.backward()                        # 计算每个可训练参数的梯度
optimizer.step()                       # 根据梯度更新参数
~~~

这几行的执行顺序很重要。忘记清理梯度会让不同 Batch 的梯度意外累加；漏掉 backward，参数就没有新的梯度；漏掉 optimizer.step，模型也不会更新。

### 3.3 Epoch、Batch 和 Learning Rate

- **Batch**：一次前向计算和反向计算处理的一批样本。
- **Epoch**：训练集完整参与一次训练所需的全部 Batch。
- **Learning rate**：一次参数更新的步幅。
- **Optimizer**：根据梯度更新参数的算法，例如 AdamW。
- **Validation loss**：参数更新后，在独立验证数据上的损失。

训练 100 个 Epoch 不一定比训练 10 个更好。如果模型在训练集上继续变好，但验证集指标开始变差，很可能出现了过拟合。通常保存验证指标最好的模型，而不是无条件使用最后一个 Epoch 的参数。

## 四、Transformer 的核心：Self-Attention

这部分是整篇教程的关键。你不需要一开始就记住所有层的名字，只要先真正弄懂注意力如何用矩阵运算建立时间位置之间的联系。

### 4.1 普通序列模型为什么需要注意力？

假设某个企业账户最近有 30 笔支付。我们要判断当前交易是否可疑。

只使用当前交易行，模型看不到完整历史；使用固定窗口统计可以知道过去一小时交易 8 笔，但不一定能区分这 8 笔的顺序和组合；传统 RNN 或 GRU 逐步读取历史，通过隐藏状态汇总过去，但序列越长，训练并行化和长期依赖处理就可能越困难。

Self-Attention 的思路是：在计算一个时间位置的表示时，让它能够根据内容直接读取其他位置的信息，并学习每个位置应获得多大权重。

例如当前交易是第一次在某国出现的大额消费，模型可能需要同时考虑过去的地理习惯、近期金额、刚刚发生的设备变更和相似交易。注意力提供的是一种可学习的信息组合机制，它本身并不懂什么叫“欺诈”或“异常”；这些关系仍然需要由训练数据和损失函数教给模型。

### 4.2 Query、Key、Value 是什么？

对每个输入位置的向量 \(x_i\)，通过三个可学习的线性映射得到：

\[
q_i=x_iW_Q,\quad k_i=x_iW_K,\quad v_i=x_iW_V
\]

可以把它们当作三种不同用途的向量：

- **Query（Q）**：当前位置要寻找什么样的信息。
- **Key（K）**：每个历史位置提供什么样的匹配线索。
- **Value（V）**：每个位置真正携带、供其他位置读取的信息。

这只是理解机制的类比。模型并不会把它们解释成自然语言问题，也不需要我们手工规定每个维度是什么意义。Q、K、V 的权重都是可训练的。

当前位置的 Query 与所有 Key 计算相似度，得到注意力分数。Transformer 通常使用点积相似度，并除以 \(\sqrt{d_k}\) 做缩放：

\[
S=\frac{QK^\top}{\sqrt{d_k}}
\]

除以 \(\sqrt{d_k}\) 是为了让点积的数值尺度不随维度增长得过大，从而让 Softmax 和梯度更容易工作。

随后沿着 Key 的维度执行 Softmax，把分数转为一组总和为 1 的权重：

\[
A=\operatorname{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right)
\]

最终输出是各个 Value 的加权组合：

\[
Z=AV
\]

用程序思维看，这就是矩阵乘法、缩放和 Softmax。需要训练的是 Q、K、V 三个投影矩阵，以及模型其他层里的参数。

### 4.3 一个形状示例

假设输入是 30 天、每一天映射成 32 维向量：

- 输入的投影结果形状为 \(B\times30\times32\)；
- 如果只有一个注意力头，Q、K、V 可以分别按形状 \(B\times30\times32\) 表示；
- \(QK^\top\) 的分数矩阵形状为 \(B\times30\times30\)；
- 其中一行表示某个时间位置对 30 个位置的关注程度；
- \(AV\) 的形状又回到 \(B\times30\times32\)。

注意力分数矩阵不是一个普通的“相关系数矩阵”。它是可学习投影后的点积，再经过 Softmax 得到的权重。不能直接把它当成因果关系、统计相关性或模型解释。

### 4.4 动手：用 PyTorch 手写 Attention

下面是注意力核心计算的最小实现。完整、可运行的版本放在 [attention_from_scratch.py](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/attention_from_scratch.py)，文件中还实现了多头注意力和因果掩码，并包含形状及权重校验。

~~~python
import math
import torch

def scaled_dot_product_attention(q, k, v, allowed=None):
    # q: [batch, heads, query_len, head_dim]
    # k: [batch, heads, key_len, head_dim]
    # v: [batch, heads, key_len, head_dim]
    scores = q @ k.transpose(-2, -1) / math.sqrt(q.shape[-1])

    if allowed is not None:
        # allowed=True 表示可见；False 表示屏蔽该位置
        scores = scores.masked_fill(~allowed, torch.finfo(scores.dtype).min)

    weights = torch.softmax(scores, dim=-1)
    output = weights @ v
    return output, weights
~~~

现在你可以在本地执行：

~~~bash
cd temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on
pip install -r requirements.txt
python attention_from_scratch.py
~~~

重点观察以下内容，而不是只看程序有没有报错：

1. 输入的每个 Token 有多少维，经过几个投影之后形状是否符合预期。
2. Attention Weights 的最后一维沿 Key 位置展开，各行的权重和应当接近 1。
3. 关闭因果掩码时，每个位置能关注窗口内所有位置。
4. 打开因果掩码时，位置 \(i\) 不能关注 \(i+1\) 及之后的未来位置。

### 4.5 什么时候需要 Causal Mask？

这取决于任务，不能把掩码作为 Transformer 的固定装饰。

如果任务是预测下一个 Token，输入序列在每个位置只能利用当前及之前的 Token，否则训练时就会通过未来 Token 直接看到答案。这时需要因果掩码（causal mask）。

如果任务是用过去 30 个完整交易日来预测第 31 天之后的结果，那么整个窗口在预测时都已发生。窗口内没有相对于当前预测时点的未来事件，因此 Encoder 可以让这 30 个历史位置彼此关注，不一定需要因果掩码。

这两种任务经常被混淆。决定是否使用掩码的标准，不是“时间序列就必须 mask”，而是**每一个输出在业务决策时点究竟允许看到哪些输入**。

## 五、多头注意力、位置编码与 Transformer Block

理解一个注意力头之后，再看剩下的结构会容易得多。

### 5.1 Multi-Head Attention：不是简单重复算几遍

多头注意力将表示投影到多个较小的子空间，每个头独立计算自己的 Q、K、V 和注意力权重，随后拼接并投影回模型维度：

\[
\operatorname{MultiHead}(Q,K,V)
=\operatorname{Concat}(head_1,\ldots,head_h)W_O
\]

例如模型宽度 \(d_{\text{model}}=32\)，使用 4 个头，则每个头的维度 \(d_k=8\)。每个头都有独立的投影参数，可以学习不同的信息交互模式。

但不要过度解释某一个头。一个头可能对近期事件、另一头可能对金额或类别模式形成响应，但不能因为注意力权重高，就直接断言它是某种业务因果关系。注意力权重只是模型内部计算的一部分。

### 5.2 Transformer 并不会自动知道时间顺序

注意力本身处理的是内容之间的匹配。如果把一组输入位置交换，注意力机制并不会像 RNN 一样因为读取顺序不同就自动得到不同表示；如果只给它一组完全不带位置信息的向量，就无法仅凭注意力区分“第 2 天”和“第 20 天”。

因此，Transformer 需要位置或时间信息。常见做法包括：

- 正弦/余弦位置编码；
- 可学习的位置向量；
- 相对位置偏置；
- 时间间隔（例如距上一笔交易过去多少分钟）编码；
- 日历周期特征，例如星期、月份、交易时段；
- 针对不规则事件序列设计的连续时间编码。

入门案例使用可学习的位置向量；金融事件序列中还常需要将事件间隔作为独立特征。一天前的交易和三个月前的交易，即使位置索引相同，也不应该自动被视为同样遥远或同样相关。

### 5.3 一个完整的 Transformer Encoder Layer

常见的 Encoder Layer 可以概括成：

~~~mermaid
flowchart TD
    A[输入表示 X] --> B[Multi-Head Self-Attention]
    B --> C[Residual + LayerNorm]
    C --> D[逐位置 Feed-Forward Network]
    D --> E[Residual + LayerNorm]
    E --> F[输出表示]
~~~

这里有几个重要构件：

**Residual Connection（残差连接）** 把原始输入加回子层输出，使网络在较深时更容易优化，并保留原有信息通路。

**LayerNorm（层归一化）** 对单个样本内部的特征进行归一化，帮助训练数值更稳定。它与对原始金融字段做 StandardScaler 不是同一回事：前者是模型内部的运算，后者是训练数据的预处理。

**Feed-Forward Network** 对每个位置独立执行线性映射、非线性激活和投影。它负责加工表示，Self-Attention 则负责不同位置之间的信息交流。

多层 Encoder 将这些计算重复堆叠。入门不需要从零复刻所有生产优化；先理解数据形状、前向传播、损失和梯度，再逐步阅读框架实现，效率更高。

## 六、Encoder、Decoder 与不同的训练目标

不是所有 Transformer 都有相同的结构。理解任务与结构之间的对应关系，比记住架构名称更重要。

| 架构 | 典型工作方式 | 适合的任务 |
|---|---|---|
| Encoder-only | 读取完整输入上下文，产生每个位置的表示 | 事件序列分类、欺诈评分、市场状态识别、数值预测 |
| Decoder-only | 使用因果掩码，逐步预测下一个 Token | 文本生成、下一事件预测、交易序列生成 |
| Encoder-Decoder | Encoder 编码输入，Decoder 生成目标序列 | 机器翻译、条件序列生成、某些多步预测任务 |

训练目标也有所不同：

- **监督学习**：给出输入和标注目标，例如欺诈标签、未来收益、是否发生结算异常。
- **下一事件预测**：根据过去事件预测下一笔交易的类别、金额区间或事件类型。
- **掩码重建**：把已知序列的一部分隐藏，让模型还原隐藏字段。
- **对比学习**：让模型学习哪些序列表示应该接近、哪些应当分开。
- **多任务学习**：同时学习多个相关目标，例如下一商户、金额区间和事件类型。

自监督学习不是无中生有地发现事实，而是从未标注数据里构造训练目标。对于金融应用，“行为不常见”并不等于“欺诈”，“历史上很像正常用户”也不等于“一定安全”。自监督输出通常需要通过有标签的下游任务、业务规则和独立验证来形成业务决策。

## 七、从理论到可执行程序：跑通一个小型 Transformer

现在开始第一个完整练习。为了避免将真实市场的复杂性与初学者的程序错误混在一起，我们先用合成数据构造一个具有弱时间依赖的序列，预测未来 5 个时间点的累计收益。这个实验用来理解模型训练，不代表真实市场存在可稳定利用的预测信号。

### 7.1 安装环境

项目的实验代码位于研究目录下：

- [手写 Attention 实现](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/attention_from_scratch.py)
- [可独立运行的小型 Transformer](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/toy_transformer.py)
- [依赖列表](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/requirements.txt)

在 macOS、Linux 或 Windows 的 Python 环境中执行：

~~~bash
cd temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

python attention_from_scratch.py
python toy_transformer.py --epochs 8
~~~

Windows PowerShell 的虚拟环境激活命令为：

~~~powershell
.venv\Scripts\Activate.ps1
~~~

样例默认自动选择 CUDA、Apple Silicon MPS 或 CPU。它是一个小模型，一开始使用 CPU 完全可以。不要为了运行一个教学级 Transformer，先把大把时间花在配置 GPU 环境上。

### 7.2 这个数据集到底是什么？

程序生成一条可重复的合成时间序列，包含 5 个特征：

| 特征 | 含义 | 是否在时点 t 可用 |
|---|---|---|
| return_1d | 当前时间点已观察到的收益 | 是 |
| momentum_5d | 截至 t 的过去 5 个时间点累计收益 | 是 |
| volatility_20d | 截至 t 的历史波动率 | 是 |
| market_factor | 合成市场因子 | 是 |
| volume_shock | 当前量能相对于过去窗口的偏离 | 是 |

输入窗口的形状为：

\[
X\in\mathbb{R}^{B\times30\times5}
\]

目标则是时点 \(t\) 之后第 1 到第 5 个时间点的收益累计值。也就是说，我们用截至 \(t\) 的 30 个位置来预测未来，而不是将未来数据作为当前输入。

程序会按时间切分训练、验证和测试数据；标准化器只使用训练时间范围内的数据拟合。标签跨越训练/验证/测试边界时，会在边界附近留出隔离间隔，以减少未来标签与之前训练数据重叠的问题。

### 7.3 先看模型定义：把输入映射成表示

核心模型在 toy_transformer.py 中。下面是最关键的部分：

~~~python
class TinyTransformer(nn.Module):
    def __init__(self, n_features, window, d_model=32,
                 n_heads=4, n_layers=2, dropout=0.1):
        super().__init__()
        self.input_projection = nn.Linear(n_features, d_model)
        self.position = nn.Parameter(torch.randn(1, window, d_model) * 0.02)

        layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_model * 4,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=n_layers)
        self.head = nn.Sequential(
            nn.LayerNorm(d_model),
            nn.Linear(d_model, 1),
        )

    def forward(self, x):
        # x: [batch, window, input_features]
        z = self.input_projection(x) + self.position[:, :x.shape[1], :]
        z = self.encoder(z)
        # 最后一个历史位置的表示 -> 一个未来收益预测值
        return self.head(z[:, -1, :]).squeeze(-1)
~~~

这段程序与传统的业务代码有些相似：输入先经过一组映射，然后进入多层处理，再将最终结果送入输出头。不过，映射的参数不是我们手工配置，而是在训练中逐步学习。

逐行拆开看：

1. **input_projection** 把每个时间点的 5 个输入特征映射成 32 维表示。注意，它对每个时间点做相同的映射。
2. **position** 给不同时间位置加入可学习的位置信息。不加入位置信息，模型很难稳定地理解历史顺序。
3. **TransformerEncoder** 堆叠两层 Encoder。每层包含多头注意力、前馈网络、残差连接和归一化。
4. **z[:, -1, :]** 取最后一个时间位置的向量，因为这个位置对应输入窗口的结束时点。
5. **head** 将 32 维表示映射到一个标量，也就是未来 5 个时间点的累计收益预测。

此处选 Encoder-only 架构，是因为预测目标是一个数值，并不需要逐步生成一个 Token 序列。

### 7.4 为什么训练代码有这么多步骤？

Transformer 模型定义出来，并不意味着它已经学会任何东西。它刚初始化的参数通常是随机的，必须通过训练来调整。

~~~python
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
loss_fn = nn.HuberLoss()

for xb, yb in train_loader:
    optimizer.zero_grad(set_to_none=True)
    prediction = model(xb)
    loss = loss_fn(prediction, yb)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
    optimizer.step()
~~~

理解这段代码时，可以把它拆成一个迭代事务：

- 获取一个 Batch；
- 执行前向计算，得到预测；
- 将预测与真实目标比较，计算 Loss；
- 沿计算图反向计算梯度；
- 根据梯度更新参数；
- 进入下一个 Batch。

这里使用 AdamW，它是深度学习中常见的优化器之一。Gradient Clipping 会限制梯度范数，避免某些训练步骤的梯度过大。它们是可配置的训练策略，不是 Transformer 注意力公式的一部分。

训练结束后，程序不会直接拿最后一轮模型做最终评估。它会根据验证集误差保留表现最好的参数，再在测试集上进行一次最终测量。

### 7.5 运行结果应该怎样看？

命令执行时会打印设备、数据形状、训练/验证/测试样本数量，以及每一轮训练损失和验证指标。最终会在 outputs/toy_transformer/ 中生成：

| 文件 | 用途 |
|---|---|
| summary.json | 训练配置、验证过程和最终评估指标 |
| predictions.csv | 测试区间的真实值与预测值 |
| transformer.pt | 模型参数、输入特征名、窗口、预测跨度和标准化信息 |

程序同时计算零预测基线和一个简单 Ridge 回归基线。你应当比较 Transformer 是否在同一测试样本上获得更低的 MAE / RMSE，而不是只看训练损失有没有下降。

如果 Transformer 输给基线，这并不表示程序出错。合成数据可能只包含有限的时间依赖，线性模型本来就可能足够好。这个结果恰恰说明：增加模型复杂度，不等于增加预测价值。

### 7.6 推荐的调试顺序

如果结果不对，不要立刻增加层数或参数。更有效的排查顺序如下：

1. 检查输入与标签的时间对齐，确认预测目标确实位于输入窗口之后。
2. 打印一个样本的特征矩阵和标签，人工确认取样逻辑。
3. 检查张量形状，尤其是 Batch、序列长度和特征数是否按预期排列。
4. 先把模型缩小、训练少量样本，确认 Loss 可以下降。
5. 检查训练集与验证集曲线；训练损失下降而验证损失持续上升，通常需要考虑过拟合。
6. 与简单基线比较，确认模型不只是学会了输出一个接近平均值的结果。

软件工程师通常会写单元测试验证函数契约。深度学习项目也需要类似纪律：检查数据契约、形状、损失数值、梯度是否为有限值、模型序列化是否可恢复，以及预测时是否依赖了不可用字段。

## 八、把样例迁移到真实金融时序

合成数据适合调试，却不能回答真实业务问题。接下来使用研究目录中已有的公开数据实验，观察同一类模型在实际数据管道里还要面对哪些问题。

### 8.1 ETF 多资产趋势与风险分析

项目提供了 [investment_research/transformer_research.py](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/investment_research/transformer_research.py)，使用 Yahoo Finance 的公开 ETF 行情，构造多资产特征，并预测未来 5 个交易日收益。默认资产包括 SPY、QQQ、IWM、EFA、TLT、GLD 和 SHY，分别代表不同市场和资产类别的代理。

运行方式：

~~~bash
cd temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/investment_research

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python transformer_research.py \
  --start 2012-01-01 \
  --end 2026-01-01 \
  --epochs 10
~~~

具体参数以脚本的命令行帮助与 README 为准。第一次运行需要能访问行情源；如果下载失败，应先检查数据是否成功取得，不要把空数据或不完整数据当作模型结果。

这个研究项目的重要之处不是承诺通过 Transformer 赚钱，而是让你检查完整的研究流程：行情下载、特征构造、标签对齐、时间外划分、训练标准化、模型训练、预测评估和示例组合回测。项目同时保留动量、Ridge 和零预测等基线，有利于验证复杂模型是否真的带来增量价值。

Yahoo Finance 数据适合教学和研究练习，但并不等同于严谨的机构级 point-in-time 数据。它不能自动处理历史证券池变化、退市样本、生存者偏差、真实成交价差、交易限制、完整公司行为和可交易性问题。回测结果不能被当成投资建议或实盘盈利保证。

### 8.2 用 FRED 国债收益率曲线做多变量预测

另一个例子是 [pricing_curve_transformer.py](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/investment_research/pricing_curve_transformer.py)。它从 FRED 获取不同期限的美国国债收益率，例如 3 个月、2 年、5 年、10 年和 30 年，并利用历史收益率水平、期限差和变化构造输入，预测未来 5 个交易日的 10 年期收益率变化。

它展示了 Transformer 对多变量时间序列的用法：模型不是把每个期限独立预测，而是能够在历史窗口中建模不同期限的共同变化。不过，收益率预测与债券定价、风险计量、P&L 预测仍是不同任务。若要把预测结果用于定价或风险管理，还要加上久期、凸性、曲线构建、现金流和业务规则，并进行独立验证。

### 8.3 支付欺诈序列：为什么是序列模型而不只是表格分类

研究目录还包括 PaySim 的手把手实验 [hands_on/README.md](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/README.md) 和 [train.py](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/train.py)。这个实验从逻辑回归开始，再用 GRU 处理账户交易序列，按时间切分，并输出 PR-AUC、ROC-AUC 和人工审核预算下的 Recall 等指标。

为什么先提供 GRU？因为先建立一个能运行、有基线、有正确时间切分的序列模型，比直接上复杂 Transformer 更容易判断新增结构是否有用。之后可以将 GRU Encoder 替换成 Transformer Encoder，保持数据、标签、时间切分和评估方法不变，做可比较的实验。

PaySim 是模拟的移动支付数据，并不是真实银行交易。它能够帮助初学者学习类别不平衡、序列构造和评估方法，但结果不能直接外推到真实银行卡欺诈、反洗钱或信用风险。

## 九、金融数据不是普通文本：几个专门需要处理的问题

在 NLP 里，一个 Token 可能是一个词或子词；金融序列里的一个 Token 则经常是一笔交易、一个市场时间点或一项业务事件。事件有多种字段，常见处理方式是分别编码，再组合成事件表示。

例如，一笔交易可能包含：

- 数值字段：金额、交易前后余额、价格、数量、收益率；
- 类别字段：交易类型、币种、支付方式、商户类别、资产类别；
- 时间字段：事件发生时间、事件到达系统时间、与上一个事件的间隔；
- 状态字段：成交、撤单、结算、已确认欺诈、人工调整等业务状态。

### 9.1 数值字段与类别字段

金额、余额和价格不能直接当作类别 ID。可以对偏态严重的非负金额做 log1p 变换，再用训练集的均值和标准差进行标准化；收益率、利率差和变化量则要根据业务意义与分布选择合适的变换。

类别字段通常要映射到 Embedding 或 One-Hot 表示。对商户、账户、证券、交易对手等高基数字段，独立维护每一个 ID 的参数可能非常昂贵，还会遇到新 ID 的冷启动问题。可采用频率阈值、哈希桶、层级回退或类别级默认表示，但必须在训练与服务中使用同一套规则。

### 9.2 时间信息至少有三种

对每个事件，最好区分：

- **Event time**：业务事件实际发生的时刻。
- **Observed/arrival time**：系统真正收到事件、使它可被模型使用的时刻。
- **Decision time**：模型做出评分或业务决策的时刻。

在支付授权、反欺诈、AML、持仓快照和基金会计中，这三类时间可能不同。如果回填历史时仅按事件发生时间取数，可能把当时尚未到达系统的信息加入输入，造成训练时使用未来信息的泄漏。

必须为模型定义一份明确的 point-in-time 契约：在每一个决策时点，哪些事件已经发生、哪些数据已经到达、哪些标签已经成熟。训练与在线特征服务必须遵守同一契约。

### 9.3 Padding 与 Masking

为了把多个不同长度的序列放入同一个 Batch，常见做法是将较短序列补成相同长度，这称为 Padding。但补齐位置不是真实事件，如果模型没有正确屏蔽这些位置，注意力可能从无意义的零值中学习到错误模式。

当序列长度差异很大时，Padding 还会白白增加计算量。金融生产系统中，事件长度可能从 1 笔到几百笔；因此，选择固定窗口、按长度分桶、使用正确的 Padding Mask 或构造不补齐的小 Batch，都有实际影响。模型结构的收益必须和数据准备、内存、CPU/GPU 延迟一同评估。

## 十、不同金融业务场景如何选择 Transformer 目标

不是每一种金融数据都应该直接输出一个分类标签。先定义业务问题，再选择序列主体、输入窗口和训练目标。

| 业务领域 | 可以建立的任务 | 主要输入 | 适合的模型输出 | 重要的数据问题 |
|---|---|---|---|---|
| 投资研究 | 未来收益、波动率或资产排序预测 | 历史价格、收益、成交量、跨资产因子 | 连续预测值、排序分数或区间 | 时间外验证、退市与生存者偏差、交易成本 |
| Pricing / 利率 | 未来曲线变化、波动率或定价残差预测 | 不同期限利率、期限差、市场状态 | 多变量连续预测、区间 | 发布日/可用时间、日历、曲线构建规则 |
| Holdings | 持仓变化、集中度或风险异常识别 | 证券、数量、市值、组合与交易事件 | 异常分数、未来持仓变化 | 公司行动、持仓快照时点、证券主数据 |
| Reference Data | 主数据变更异常、映射错误或变更影响识别 | 标的、实体映射、源系统变更事件 | 异常分类、影响范围或优先级 | 生效日期、版本、来源系统、人工确认 |
| Fund Accounting | 现金差异、应计异常、break 类型与解决时间 | 交易、结算、应计、费用、余额、工单状态 | 残差预测、分类或超时概率 | 会计规则版本、合同参数、结算日历、标签删失 |
| Trade / Order Book | 执行成本代理、成交概率或订单流异常 | 订单簿快照、成交、撤单、市场状态 | 成交概率、未来价格变化、成本区间 | 决策时点、队列位置、基准价格和成交假设 |
| Payment / Fraud | 欺诈评分、下一事件意外程度 | 账户/卡/设备的历史交易、事件类型和时间差 | 风险分数、异常字段分数、Embedding | 延迟标签、类别不平衡、跨实体历史、点时一致性 |
| Financial News | 新闻事件对市场状态或风险的关联分析 | 时间戳、来源、实体、文本向量和行情序列 | 文本/市场融合表示、事件分类 | 新闻可用时间、重复报道、前视偏差和文本标签 |

注意：此表中的“可以建立”是任务设计方向，不意味着公开数据已经具备全部业务字段。研究目录的补充报告 [additional_financial_transformer_use_cases_data_gaps_2026-10-24.md](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/additional_financial_transformer_use_cases_data_gaps_2026-10-24.md) 专门记录了哪些用例有可用数据、哪些还缺真实业务标签和数据契约。

特别是基金会计和交易执行：公共市场数据可以帮助学习收益率曲线和订单簿的序列建模，但不等于拥有真实基金分录、合同费率、成交意图、清算状态或确认的会计差错标签。缺少业务数据时，应先构建合成数据来验证程序流程，再明确列出真实 PoC 仍需要哪些字段，不能将模拟标签说成真实业务结果。

## 十一、生产实践为什么经常采用“Transformer + GBDT”而不是全面替换

一个非常实用的架构模式是让 Transformer 负责学习历史序列的上下文表示，再把这些表示和已有的结构化特征交给 LightGBM、XGBoost、逻辑回归或其他决策模型。

这不是说 Transformer 不够强，而是不同模型擅长的事情不同：

- Transformer 能够在历史事件之间建立可学习的关系。
- GBDT 对结构化特征和非线性交互有很强的工程适配性，训练、推理与局部解释工具也相对成熟。
- 规则引擎适合表达明确、需要确定性执行的业务规则。
- 最终决策系统还要处理阈值、预算、权限、人工复核和审计，不应等同于单个模型。

金融交易反欺诈就是很典型的例子。研究材料中的 Ramp 案例使用 Transformer 学习交易历史，并把行为 Embedding、字段级意外程度等特征送入现有 XGBoost，而不是让 Transformer 单独承担所有拒绝决策。原文还显示，总收益中有相当部分来自金额加权损失，不能把完整方案的收益都归因于 Transformer。参见 [Ramp 案例研究材料](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/transformer_sequence_financial_services_survey_2026-10-24.md)。

这个组合架构有几个优势：它可以复用既有的数值特征平台、标签训练管道和决策系统；可以单独验证 Transformer 提供的特征是否真正增加预测价值；出现延迟问题时，也可以降级到已验证的旧模型。

但也不能把这个模式当成固定答案。在有大量、可靠序列数据并且目标适合端到端学习的场景，直接训练序列分类或多任务模型也可能合理。正确做法是从简单基线开始，通过消融实验确认每一个新增组件的价值。

## 十二、金融时序模型的评估：比训练本身更容易出错

### 12.1 先定义问题，再选择指标

不同输出类型对应不同指标。预测未来收益或利率变化，可以使用 MAE、RMSE、方向命中率和按时间切片的误差；欺诈检测需要 PR-AUC、Recall@K、Precision@K 和损失金额覆盖率；异常检测要重视误报成本、检测提前量和调查预算；基金会计差异预测可以评估异常金额误差、根因分类和 SLA 内解决的概率。

不要仅使用 Accuracy。假设 100,000 笔交易中有 100 笔欺诈，一个将所有交易都判为正常的模型仍然能达到 99.9% 准确率，却完全没有发现欺诈。类别不平衡问题必须采用符合任务与业务预算的指标。

### 12.2 时间切分与标签成熟度

对于时间序列，训练集应来自较早时段，验证集位于其后，测试集再位于更晚时段。若标签定义为未来 5 天累计收益，训练目标就必须在训练边界前完整结束；否则边界附近的训练样本会使用验证期的未来收益作为标签。

欺诈标签和基金会计差错标签也有成熟期。例如支付之后数周才确认的欺诈，如果把近期尚未收到争议的交易直接标为正常，模型训练和测试都会被污染。这类数据需要显式记录标签状态与成熟时间，并避免把“暂未发现问题”直接当成“已确认正常”。

### 12.3 标准化、填充和编码也可能泄漏

常见的数据泄漏不只发生在标签字段中：

- 如果先对全量数据计算标准化参数，再按时间切分，未来数据已经影响了训练预处理。
- 如果类别词表、目标编码或异常阈值利用全量标签生成，可能隐含使用了测试期的信息。
- 如果用最终修订的参考数据替代当时版本，历史结果不再代表当时可获得的数据。
- 如果对不同长度序列填充后，没有屏蔽 padding 位置，模型可能学到数据准备过程的伪模式。

因此，数据管道也需要版本化和测试。训练时如何构造输入，应该尽可能与生产推理时实际能拿到的输入一致。

### 12.4 消融：证明复杂度创造了增量价值

至少比较以下几组模型：

1. 简单业务基线，例如零预测、动量、固定规则或当前生产模型。
2. 常见机器学习基线，例如逻辑回归、Ridge、LightGBM 或 XGBoost。
3. 纯序列模型，例如 GRU、TCN 或小型 Transformer。
4. 组合模型，例如原有结构化特征加 Transformer 的 Embedding 或异常分数。

每组应使用相同测试窗口、相同标签定义、可比的数据清洗和相同的成本假设。若 Transformer 与现有基线相差不大，就要问它是否真的增加了业务价值；有时候更好的特征工程、更合理的损失函数、更及时的重训或更低的延迟，比扩展模型更有价值。

## 十三、常见误区：程序能跑不代表实验可信

**误区一：模型训练损失下降，就说明模型有效。** 训练损失下降只能表明模型在训练样本上拟合得更好。还要检查验证集、测试集和与简单基线的对比。

**误区二：Transformer 天生适合所有表格数据。** 如果每个样本是一行没有可靠时序关系的表格，梯度提升树往往是值得优先比较的强基线。Transformer 的优势更可能来自有意义的序列结构和跨事件交互。

**误区三：注意力权重就是解释。** 注意力权重显示计算过程中如何分配信息混合的权重，但它不自动构成业务因果解释，也不能直接视为监管需要的理由码。高风险业务仍需独立的特征归因、规则证据、案例分析和人工复核流程。

**误区四：模型越大、窗口越长越好。** 长序列可能带来更高计算开销和更多噪声。在一些欺诈案例里，近期行为断裂比极长的历史更有价值；更长的历史也可以通过检索、统计特征或分层编码处理。

**误区五：Transformer 一定需要 GPU。** 小型模型在 CPU 上也可以完成教学和中等规模实验；GPU 的价值取决于序列长度、批量大小、模型结构和吞吐要求。训练和生产推理应分别测试。

**误区六：预测分数可以直接触发业务动作。** 在金融服务里，模型分数通常只是决策系统的一个输入。权限、规则、阈值、损失成本、服务时限、审计和人工复核仍须明确定义。

## 十四、从入门走向生产的建议架构

下面的架构把模型本身放在整个系统中的正确位置：数据契约决定可见历史，序列编码器学习表示，任务头或下游模型输出预测，最后由业务决策层结合约束与规则形成动作。

~~~mermaid
flowchart TD
    A[业务事件与市场数据] --> B[Point-in-time 数据契约]
    B --> C[数据清洗与字段编码]
    C --> D[历史窗口与时间特征]
    D --> E[Transformer Encoder]
    E --> F[Embedding / 任务分数]
    F --> G[下游分类器或风险模型]
    H[确定性规则与业务约束] --> I[决策服务]
    G --> I
    I --> J[允许 / 拒绝 / 告警 / 人工复核]
    J --> K[审计记录与后续标签]
    K --> L[评估、漂移监控和重训]
    L --> E
~~~

一个可治理的实现至少应保存：数据快照与特征版本、训练/验证/测试的时间范围、标签成熟策略、模型版本、代码和依赖版本、训练配置、基线和消融结果、推理延迟、输出分布及异常情况。上线还需要影子运行、受控流量、降级路径和回滚方式。

对于实时授权或其他同步关键链路，应先定义严格的时延预算。特征读取、序列构造、推理与决策会共同消耗时间。超时后应退回经过验证的旧模型或规则，而不是无限等待模型输出。

## 十五、动手练习：按这个顺序扩展，而不是一开始就堆模型

完成前面的代码后，可以按阶段继续。

**练习 1：观察 Attention。** 在 attention_from_scratch.py 中分别运行因果与非因果注意力。改变输入向量，检查各个位置的注意力权重如何变化，并验证每一行权重之和仍然接近 1。

**练习 2：控制模型容量。** 将 toy_transformer.py 的层数从 2 改成 1，将模型宽度从 32 改成 16，观察训练时间和验证指标变化。再分别试更长的历史窗口，记录训练成本，不要仅凭一次结果判断优劣。

**练习 3：做一个公平的时间外对比。** 在 ETF 研究脚本中分别运行 Transformer、动量基线和 Ridge。固定日期区间、资产池、预测跨度和测试样本，比较 MAE、方向判断以及交易成本敏感性分析。不要用测试集挑参数。

**练习 4：将 GRU 替换为 Transformer。** 在 PaySim 反欺诈实验里保持标签、样本切分、输入特征和指标一致，只替换序列编码器。先确认数据流程和基线正确，再观察 Transformer 有没有增益。

**练习 5：增加时间间隔特征。** 对交易事件加入与上一事件的时间差，并比较加入前后的验证指标。特别注意事件时间与到达时间不能混淆。时间差应使用当前决策时点可见的信息构造。

**练习 6：从单输出扩展为多任务。** 对交易序列同时预测下一事件类型、金额区间或掩码字段；再将学到的表示输出给一个简单分类器。比较多任务表征是否改善下游预测，以及额外训练和维护成本是否合理。

做这些练习的目的是建立可复现的实验纪律，而不是寻找一次性最高的指标。每次变更都应该留下参数、数据范围、测试结果和基线对照。

## 十六、参考材料与代码导航

### 本文相关论文和官方文档

- Vaswani et al., [Attention Is All You Need](https://arxiv.org/abs/1706.03762), 2017。Transformer 架构的原始论文。
- [PyTorch TransformerEncoder 文档](https://docs.pytorch.org/docs/stable/generated/torch.nn.TransformerEncoder.html)。Encoder 结构、参数与输入输出约定。
- [PyTorch Autograd mechanics](https://docs.pytorch.org/docs/stable/notes/autograd.html)。自动求导与反向传播。
- [scikit-learn TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)。时间序列的验证切分。
- [yfinance 文档](https://ranaroussi.github.io/yfinance/)。教学用公开行情数据接口。

### devweekly 中的配套研究与代码

- [Transformer 金融服务序列建模综述](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/transformer_sequence_financial_services_survey_2026-10-24.md)：工业案例、研究谱系、模型架构和落地模式。
- [金融 Transformer 用例与数据缺口清单](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/additional_financial_transformer_use_cases_data_gaps_2026-10-24.md)：Pricing、Holdings、Reference Data、Fund Accounting、Trade 等场景的输入、标签和数据需求。
- [手写 Attention](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/attention_from_scratch.py)：从 Q/K/V 到多头注意力和因果掩码。
- [小型 Transformer 教学程序](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/toy_transformer.py)：合成金融时序、训练循环、基线和输出文件。
- [ETF 多资产 Transformer 实验](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/investment_research/transformer_research.py)：公开行情与时间外预测研究。
- [国债收益率曲线实验](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/investment_research/pricing_curve_transformer.py)：多期限利率与未来曲线变化预测。
- [PaySim 序列欺诈实验](https://github.com/devweekly/devweekly.github.io/blob/main/temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/train.py)：逻辑回归和 GRU 基线，可作为 Transformer 替换实验的起点。

## 结语

对有编程经验的人来说，掌握 Transformer 的第一步不是直接微调一个大模型，而是理解它的计算结构：输入是带明确形状的张量；注意力用 Q、K、V 计算序列位置之间的加权信息组合；位置编码提供时序信息；损失函数定义学习目标；自动求导计算梯度；优化器不断更新参数。

要把这个模型变成可信的金融应用，还得再加上数据时间契约、时间外测试、基线对照、类别不平衡指标、推理时延和降级机制。真正的工程能力不是让 Transformer 跑起来，而是能够证明它在指定业务条件下，比更简单的替代方案多带来了什么价值，并且知道当数据、模型或服务出现问题时如何安全地处理。
