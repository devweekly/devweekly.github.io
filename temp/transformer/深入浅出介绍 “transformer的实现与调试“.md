如果你已经会 Python 和 JS，但对 AI/LLM 还是“小白”，那么学习 Transformer 最好的路线不是直接看论文，而是：

> 数学公式 → 纯 Python 实现 → Numpy 实现 → PyTorch 实现 → 调试真实模型 → 阅读 GPT/Llama 源码

这是我认为工程师最快掌握 Transformer 的路径。

---

# 第一阶段：理解 Transformer 在干什么

先忘掉 AI。

假设有一句话：

```text
I love OpenAI
```

计算机看到的是：

```python
["I", "love", "OpenAI"]
```

Transformer 的任务：

```text
输入 Token
    ↓
Embedding
    ↓
Attention
    ↓
Feed Forward
    ↓
输出 Token
```

核心其实只有两个模块：

1. Self Attention
2. Feed Forward Network

GPT、Llama、DeepSeek、Qwen 本质都一样。

---

# 第二阶段：纯 Python 实现 Attention

先不使用 numpy。

## Step1 Token Embedding

假设：

```python
tokens = ["I", "love", "OpenAI"]

embedding = {
    "I": [1, 0],
    "love": [0, 1],
    "OpenAI": [1, 1]
}
```

转换：

```python
X = [
    [1,0],
    [0,1],
    [1,1]
]
```

这就是：

```text
3个token
每个token 2维
```

---

# Step2 Q K V

Transformer第一件事：

```text
X
 ↓
Q = XWq
K = XWk
V = XWv
```

纯 Python：

```python
Wq = [
    [1,0],
    [0,1]
]

Wk = [
    [1,0],
    [0,1]
]

Wv = [
    [1,0],
    [0,1]
]
```

矩阵乘法：

```python
def matmul(a,b):
    rows = len(a)
    cols = len(b[0])

    result = []

    for i in range(rows):
        row = []

        for j in range(cols):
            s = 0
            for k in range(len(b)):
                s += a[i][k] * b[k][j]

            row.append(s)

        result.append(row)

    return result
```

得到：

```python
Q = matmul(X,Wq)
K = matmul(X,Wk)
V = matmul(X,Wv)
```

---

# Step3 计算 Attention Score

Transformer 最重要公式：

[
Attention(Q,K,V)=Softmax(\frac{QK^T}{\sqrt d})V
]

不要怕。

其实只是：

```text
看看谁和谁最相关
```

例如：

```python
Q[0] = [1,0]
K[2] = [1,1]
```

点积：

```python
1*1 + 0*1 = 1
```

相关性：

```text
score = 1
```

---

实现：

```python
def dot(a,b):
    return sum(x*y for x,y in zip(a,b))
```

计算：

```python
scores = []

for q in Q:
    row = []

    for k in K:
        row.append(dot(q,k))

    scores.append(row)
```

得到：

```python
[
 [1,0,1],
 [0,1,1],
 [1,1,2]
]
```

---

# Step4 Softmax

Transformer最容易调试的地方。

实现：

```python
import math

def softmax(xs):

    exps = [math.exp(x) for x in xs]

    total = sum(exps)

    return [e/total for e in exps]
```

例如：

```python
softmax([1,0,1])

=
[0.42,0.15,0.42]
```

含义：

```text
"I"

42%关注自己
15%关注love
42%关注OpenAI
```

这就是 Attention。

---

# Step5 加权求和

```python
output = Σ(weight * V)
```

代码：

```python
def weighted_sum(weights, values):

    result = [0,0]

    for w,v in zip(weights, values):

        result[0] += w*v[0]
        result[1] += w*v[1]

    return result
```

计算：

```python
outputs = []

for weights in attention_weights:
    outputs.append(
        weighted_sum(weights,V)
    )
```

这就是 Self-Attention 完整实现。

---

# 第三阶段：Numpy实现 Transformer

真实工程已经不会手写循环。

例如：

```python
import numpy as np

Q = X @ Wq
K = X @ Wk
V = X @ Wv

scores = Q @ K.T

scores /= np.sqrt(d)

weights = softmax(scores)

out = weights @ V
```

十几行代码。

Transformer核心已经完成。

---

# 第四阶段：加入 Multi Head

GPT 真正使用：

```text
Head1
Head2
Head3
...
HeadN
```

例如：

```text
Head1 看语法

Head2 看主谓关系

Head3 看上下文

Head4 看实体关系
```

结构：

```text
Attention
      ↓
Attention
      ↓
Attention
      ↓
Concat
      ↓
Linear
```

Llama3：

```text
32 Heads
```

甚至更多。

---

# 第五阶段：实现一个 Tiny GPT

大约 200 行代码。

结构：

```python
class Attention:
    pass

class MLP:
    pass

class Block:
    pass

class GPT:
    pass
```

Block：

```text
Attention
 ↓
Residual
 ↓
MLP
 ↓
Residual
```

即：

```python
x = x + attention(x)

x = x + mlp(x)
```

这已经是 GPT 基本结构。

---

# 第六阶段：开始调试 Transformer

这里才是真正的工程能力。

---

## 调试1 Attention Matrix

打印：

```python
print(weights)
```

观察：

```text
token1 看谁

token2 看谁

token3 看谁
```

形状：

```python
(seq_len, seq_len)
```

例如：

```python
(128,128)
```

---

## 调试2 检查 NaN

训练最常见问题：

```python
torch.isnan(tensor)
```

例如：

```python
if torch.isnan(loss):
    print("boom")
```

---

## 调试3 查看梯度

```python
for n,p in model.named_parameters():

    print(
        n,
        p.grad.norm()
    )
```

看：

```text
梯度消失

梯度爆炸
```

---

## 调试4 Hook

PyTorch 最重要能力：

```python
def hook(module,input,output):

    print(module)
    print(output.shape)

layer.register_forward_hook(hook)
```

实时看：

```text
Embedding输出

Attention输出

MLP输出
```

---

# 第七阶段：阅读真实源码

推荐顺序。

## 1 nanoGPT

作者：

Andrej Karpathy

项目：

```text
~300 行
```

最适合入门。

---

## 2 minGPT

同作者。

```text
~1000 行
```

开始接近真实 GPT。

---

## 3 Llama

看：

```python
LlamaAttention
```

重点：

```python
q_proj
k_proj
v_proj
```

---

## 4 vLLM

理解：

```text
KV Cache

PagedAttention

Continuous Batching
```

这是推理系统。

---

# 推荐学习路线（架构师视角）

考虑你有多年开发经验，而不是学生：

第一周：

* Embedding
* Self Attention
* Softmax
* 手写纯 Python

第二周：

* Numpy Transformer
* Multi Head
* Positional Encoding

第三周：

* PyTorch
* nanoGPT

第四周：

* KV Cache
* FlashAttention
* vLLM

第五周：

* 阅读 Llama/Qwen 源码
* 修改 Attention 实现
* 增加自己的实验模块

如果按这个路线走，一个月后你基本可以阅读大部分开源 LLM 的核心代码，不再把 Transformer 看成“黑盒”，而是一个由矩阵乘法、Softmax、残差连接和 MLP 组成的普通软件系统。

对于有 Python/JS 基础的工程师，我最推荐的入门材料其实不是论文，而是 Andrej Karpathy 的《Let's build GPT from scratch》系列，以及 nanoGPT 源码。先把一个 300 行的 GPT 跑通，再回头看论文，会容易很多。



这是 Transformer 最容易让初学者困惑的地方。

如果你会前端或者后端开发，可以把它理解成：

```text
X = 原始数据

Wq/Wk/Wv = 三组不同的"观察角度"

Q/K/V = 从不同角度提取出来的特征
```

先解释 `XW`。

---

# 什么是 XW

假设一句话：

```text
I love OpenAI
```

Embedding之后：

```python
X = [
    [1,0],
    [0,1],
    [1,1]
]
```

这里：

```text
3 个 token
每个 token 2 个特征
```

矩阵形状：

```text
X

3 × 2
```

可以想象成：

```text
          feature1  feature2

I            1         0

love         0         1

OpenAI       1         1
```

---

现在定义一个权重矩阵：

```python
Wq = [
    [2,1],
    [1,2]
]
```

形状：

```text
2 × 2
```

做矩阵乘法：

```text
Q = XWq
```

实际上：

```python
[1,0] × Wq
=
[2,1]

[0,1] × Wq
=
[1,2]

[1,1] × Wq
=
[3,3]
```

得到：

```python
Q = [
    [2,1],
    [1,2],
    [3,3]
]
```

本质上和神经网络里面：

```python
y = Wx + b
```

是一回事。

只是 Transformer 一次处理所有 token：

```text
整个矩阵一起乘
```

---

# 为什么要乘 Wq

因为 Embedding 本身不一定适合计算 Attention。

例如：

```text
OpenAI

embedding:
[0.12, -0.55, 1.23, ...]
```

这些数字只是语义表示。

Attention需要一种新的表示：

```text
我应该关注谁？
```

所以训练过程中会学出：

```text
Wq
Wk
Wv
```

三个不同矩阵。

---

# Q/K/V 名字哪里来的

来自数据库。

Transformer作者借用了：

```text
Query
Key
Value
```

概念。

---

例如字典：

```python
{
  "name": "Tom",
  "age": 20
}
```

这里：

```text
Key   -> name
Value -> Tom

Key   -> age
Value -> 20
```

查询：

```python
query = "name"
```

得到：

```python
Tom
```

Transformer作者觉得：

```text
Attention

其实也是一种查询过程
```

所以：

```text
Q = Query
K = Key
V = Value
```

---

# Attention到底在干什么

假设句子：

```text
The animal didn't cross the street because it was too tired.
```

模型看到：

```text
it
```

需要知道：

```text
it 指谁？
```

可能：

```text
animal
street
```

Attention流程：

---

第一步

生成 Query：

```text
当前 token(it)
↓
Q
```

相当于：

```text
我正在寻找相关信息
```

---

第二步

所有 token 生成 Key：

```text
The
animal
didn't
cross
...
```

变成：

```text
K1
K2
K3
...
```

相当于：

```text
我是一个候选信息
```

---

第三步

计算匹配度：

```text
Q · K
```

例如：

```text
it 与 animal

score = 8.7

it 与 street

score = 0.4
```

说明：

```text
animal 更相关
```

---

第四步

拿 Value

注意：

```text
Q 负责查询

K 负责匹配

V 负责提供内容
```

例如：

```text
animal

Key:
[0.8,0.2]

Value:
[9.1,4.5]
```

Attention最终拿的是：

```text
Value
```

不是 Key。

---

# 为什么不直接用一个矩阵

很多新人都会问：

```text
为什么不是：

XW

直接 Attention？
```

完全可以。

事实上最早很多论文都试过。

但是效果差。

---

Transformer发现：

```text
查询特征
匹配特征
内容特征
```

最好分开学。

于是：

```text
Q = XWq

K = XWk

V = XWv
```

三套参数。

---

# 一个更形象的理解

假设公司通讯录：

```text
张三
李四
王五
```

每个人有三张名片。

---

Q名片

```text
我想找什么样的人
```

---

K名片

```text
我是什么样的人
```

---

V名片

```text
我的详细资料
```

---

Attention过程：

```text
拿着Q

逐个比对所有K

找到最匹配的人

取出他们的V

汇总
```

公式：

[
Attention(Q,K,V)
================

Softmax(QK^T)V
]

现在应该能看懂了：

```text
QKᵀ
    ↓
算相关性

Softmax
    ↓
变概率

×V
    ↓
提取真正的信息
```

从工程实现角度看，Transformer 最核心的一句话其实就是：

> Q 用来“提问”，K 用来“匹配”，V 用来“携带内容”；Attention 就是在所有 Token 中，根据 Q 和 K 的相似度，动态聚合 V。

后面你再看 GPT、Llama、Qwen 源码，会发现真正的 Attention 核心代码通常只有十几行，而大部分复杂度来自 KV Cache、FlashAttention、多头注意力和分布式训练。
