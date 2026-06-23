# 纯 Python 实现 Attention 机制：从零开始，逐行讲解

> 不用 PyTorch，不用 TensorFlow，只用 Python 标准库 + 一个小技巧实现矩阵运算。
> 读完这篇，你会真正理解 Attention 的每一个步骤在做什么。

---

## 一、Attention 到底在干什么？

先不谈公式，用一个生活场景建立直觉。

### 场景：你在读一句很长的话

假设你在读这句话：

> "小明去了商店，买了一瓶牛奶，然后回家把牛奶放进冰箱，因为冰箱里没有牛奶了。"

当你读到"冰箱"这个词的时候，你脑子里并不是把前面所有词一视同仁地回忆一遍。你会**自动把注意力集中**在跟"冰箱"最相关的词上：

- "牛奶" —— 高度相关（冰箱是用来放牛奶的）
- "回家" —— 中等相关（冰箱在家里）
- "商店" —— 弱相关（商店是买牛奶的地方，跟冰箱关系不大）

**Attention 机制干的就是这件事**：对于句子中的每一个词，计算它和其他所有词的"相关程度"，然后用这个相关程度作为权重，把所有词的信息加权求和，得到这个词的"新表示"。

### 三个角色：Q、K、V

Attention 用了三个概念，对应三个矩阵：

| 角色 | 比喻 | 作用 |
|------|------|------|
| **Q（Query）** | "我在找什么" | 当前这个词想要获取什么样的信息 |
| **K（Key）** | "我能提供什么" | 每个词能提供的信息标签 |
| **V（Value）** | "我实际的内容" | 每个词的实际内容 |

用图书馆来比喻：

- **Q** = 你拿着一张借书条，上面写着"我想找关于机器学习的书"
- **K** = 每本书封面上的标签/关键词
- **V** = 每本书的实际内容

你拿借书条（Q）去和每本书的标签（K）比对，相似度高的书你多看几眼，相似度低的书你略过。最后你获得的信息，是所有书内容（V）的加权混合——相似度越高的书权重越大。

---

## 二、Self-Attention 的完整流程

假设我们有一个句子，已经把它变成了一个矩阵 $X$（每一行是一个词的向量表示）。

Self-Attention 的步骤是：

```
第 1 步：生成 Q、K、V
    Q = X × W_Q
    K = X × W_K
    V = X × W_V

第 2 步：计算注意力分数
    scores = Q × K^T    （每个词和其他所有词的相似度）

第 3 步：缩放
    scores = scores / √d_k    （防止数值太大导致梯度消失）

第 4 步：Softmax 归一化
    weights = softmax(scores)    （把分数变成概率，加起来等于 1）

第 5 步：加权求和
    output = weights × V    （用权重把 V 混合起来）
```

下面我们逐步实现。

---

## 三、准备工作：纯 Python 的矩阵运算

Python 标准库没有矩阵运算。我们有两个选择：

1. 用 `numpy`（最常见）
2. 纯手写（真正"零依赖"）

为了让你看清每一步在做什么，我**两个版本都写**。先用 numpy 讲清楚逻辑，再给出纯 Python 手写版。

### 3.1 基础工具函数（纯 Python 版）

如果你不想装 numpy，下面这些函数可以实现最基本的矩阵运算：

```python
import math

def matmul(A, B):
    """矩阵乘法：A 是 m×n，B 是 n×p，返回 m×p"""
    m = len(A)
    n = len(A[0])
    p = len(B[0])
    result = [[0.0] * p for _ in range(m)]
    for i in range(m):
        for j in range(p):
            total = 0.0
            for k in range(n):
                total += A[i][k] * B[k][j]
            result[i][j] = total
    return result

def transpose(A):
    """转置矩阵"""
    rows = len(A)
    cols = len(A[0])
    return [[A[i][j] for i in range(rows)] for j in range(cols)]

def scalar_divide(A, s):
    """矩阵每个元素除以一个标量"""
    return [[val / s for val in row] for row in A]

def softmax_rows(A):
    """对矩阵的每一行做 softmax"""
    result = []
    for row in A:
        max_val = max(row)  # 减去最大值防止数值溢出
        exps = [math.exp(v - max_val) for v in row]
        total = sum(exps)
        result.append([e / total for e in exps])
    return result
```

### 3.2 numpy 版工具函数

如果你有 numpy（`pip install numpy`），上面的代码可以简化为：

```python
import numpy as np

# matmul  -> np.matmul(A, B) 或 A @ B
# transpose -> A.T
# scalar_divide -> A / s
# softmax_rows -> 自己写一行
def softmax_rows_np(A):
    max_vals = np.max(A, axis=1, keepdims=True)
    exps = np.exp(A - max_vals)
    return exps / np.sum(exps, axis=1, keepdims=True)
```

---

## 四、逐步实现 Scaled Dot-Product Attention

### 第 1 步：准备输入数据

假设我们的句子有 3 个词，每个词用一个 4 维向量表示。

```python
import numpy as np

# 3 个词，每个词 4 维向量
# 想象这是 "我 爱 你" 三个词经过 embedding 后的表示
X = np.array([
    [1.0, 0.0, 1.0, 0.0],   # "我"
    [0.0, 1.0, 0.0, 1.0],   # "爱"
    [1.0, 1.0, 0.0, 0.0],   # "你"
])

print("输入 X 的形状:", X.shape)  # (3, 4) —— 3个词，每个4维
```

### 第 2 步：创建 Q、K、V 的权重矩阵

这三个权重矩阵是模型要学习的参数。这里我们随机初始化，实际训练中它们会被梯度下降不断更新。

```python
np.random.seed(42)  # 固定随机种子，保证结果可复现

d_model = 4   # 输入维度
d_k = 4       # Q、K 的维度（通常和 d_model 一样或更小）

# 三个权重矩阵，形状都是 (d_model, d_k)
W_Q = np.random.randn(d_model, d_k)
W_K = np.random.randn(d_model, d_k)
W_V = np.random.randn(d_model, d_k)

print("W_Q 形状:", W_Q.shape)  # (4, 4)
```

**为什么需要三个不同的权重矩阵？**

因为同一个词，在"作为查询者"（Q）、"作为被查询者"（K）、"作为内容提供者"（V）这三种角色下，需要被投影到不同的空间。

打个比方：同一个人，在"找对象"时关注的是性格（Q），在"被别人评估"时展示的是学历（K），在"实际交往"时提供的是陪伴（V）。三个角色，三种维度，三种权重。

### 第 3 步：计算 Q、K、V

```python
Q = X @ W_Q   # (3, 4) @ (4, 4) = (3, 4)
K = X @ W_K   # (3, 4) @ (4, 4) = (3, 4)
V = X @ W_V   # (3, 4) @ (4, 4) = (3, 4)

print("Q:\n", Q)
print("K:\n", K)
print("V:\n", V)
```

此时：
- Q 的第 0 行 = "我"作为查询者的表示
- K 的第 1 行 = "爱"作为被查询者的表示
- V 的第 2 行 = "你"作为内容提供者的表示

### 第 4 步：计算注意力分数

```python
# Q @ K^T：每个词和所有词的点积相似度
scores = Q @ K.T   # (3, 4) @ (4, 3) = (3, 3)

print("注意力分数（未缩放）:\n", scores)
```

`scores[i][j]` 表示第 $i$ 个词对第 $j$ 个词的"关注程度"（未归一化）。

**为什么用点积来衡量相似度？**

点积的几何意义是：两个向量越"方向一致"，点积越大。如果两个向量完全垂直（正交），点积为 0，表示毫无关系。所以点积天然就是一种相似度度量。

### 第 5 步：缩放（Scale）

```python
d_k = K.shape[1]  # K 的维度，这里是 4
scaled_scores = scores / math.sqrt(d_k)

print("缩放后的分数:\n", scaled_scores)
```

**为什么要除以 $\sqrt{d_k}$？**

当维度 $d_k$ 很大时（比如 512），点积的值会变得很大。点积太大 → softmax 的输入太大 → softmax 的输出会变成"几乎全是 0 和一个 1" → 梯度几乎为 0 → 训练停滞。

除以 $\sqrt{d_k}$ 把数值拉回合理范围，让 softmax 的梯度保持健康。

### 第 6 步：Softmax 归一化

```python
def softmax(x):
    """对每一行做 softmax"""
    x_max = np.max(x, axis=1, keepdims=True)
    exps = np.exp(x - x_max)
    return exps / np.sum(exps, axis=1, keepdims=True)

weights = softmax(scaled_scores)

print("注意力权重:\n", weights)
print("每行求和（应该都是 1）:", np.sum(weights, axis=1))
```

Softmax 做了两件事：
1. 把所有分数变成正数（通过 $e^x$）
2. 让每一行的分数加起来等于 1（归一化）

这样 `weights[i][j]` 就可以理解为："第 $i$ 个词把百分之多少的注意力放在第 $j$ 个词上"。

### 第 7 步：加权求和

```python
output = weights @ V   # (3, 3) @ (3, 4) = (3, 4)

print("Attention 输出:\n", output)
print("输出形状:", output.shape)  # (3, 4) —— 和输入形状一样
```

输出的每一行是所有词的 V 表示的加权平均，权重就是刚才算出的注意力权重。

**第 $i$ 行的输出 = 第 $i$ 个词"综合了所有词的信息后"的新表示。**

---

## 五、把上面的步骤封装成函数

```python
import numpy as np
import math

def scaled_dot_product_attention(Q, K, V, mask=None):
    """
    Scaled Dot-Product Attention

    参数:
        Q: Query 矩阵, shape (seq_len, d_k)
        K: Key   矩阵, shape (seq_len, d_k)
        V: Value 矩阵, shape (seq_len, d_v)
        mask: 可选的掩码矩阵, shape (seq_len, seq_len)
              被掩码的位置设为 -inf 或非常大的负数

    返回:
        output: 注意力输出, shape (seq_len, d_v)
        weights: 注意力权重, shape (seq_len, seq_len)
    """
    d_k = K.shape[1]

    # 第 1 步：计算注意力分数
    scores = Q @ K.T  # (seq_len, seq_len)

    # 第 2 步：缩放
    scaled_scores = scores / math.sqrt(d_k)

    # 第 3 步：应用掩码（如果有）
    if mask is not None:
        scaled_scores = np.where(mask == 0, -1e9, scaled_scores)

    # 第 4 步：Softmax 归一化
    weights = softmax(scaled_scores)

    # 第 5 步：加权求和
    output = weights @ V

    return output, weights


def softmax(x):
    """数值稳定的 softmax，按行归一化"""
    x_max = np.max(x, axis=1, keepdims=True)
    exps = np.exp(x - x_max)
    return exps / np.sum(exps, axis=1, keepdims=True)
```

使用示例：

```python
# 准备数据
X = np.array([
    [1.0, 0.0, 1.0, 0.0],
    [0.0, 1.0, 0.0, 1.0],
    [1.0, 1.0, 0.0, 0.0],
])

np.random.seed(42)
W_Q = np.random.randn(4, 4)
W_K = np.random.randn(4, 4)
W_V = np.random.randn(4, 4)

Q = X @ W_Q
K = X @ W_K
V = X @ W_V

output, weights = scaled_dot_product_attention(Q, K, V)

print("注意力权重矩阵:")
print(weights)
print("\n每行求和:", np.sum(weights, axis=1))
print("\nAttention 输出:")
print(output)
```

---

## 六、Multi-Head Attention（多头注意力）

### 为什么要多头？

一个 Attention 头只能学到一种"关注模式"。但语言中的关系是多样的：

- 一个头可能学会关注"语法关系"（主语-谓语）
- 另一个头可能学会关注"指代关系"（"他"指代谁）
- 还有一个头可能关注"语义相似性"

多头注意力就是**同时运行多个 Attention，每个头关注不同的方面，最后把结果拼起来**。

### 完整实现

```python
class MultiHeadAttention:
    def __init__(self, d_model, num_heads):
        """
        d_model: 输入维度（比如 512）
        num_heads: 头的个数（比如 8）
        """
        assert d_model % num_heads == 0, "d_model 必须能被 num_heads 整除"

        self.d_model = d_model
        self.num_heads = num_heads
        self.d_k = d_model // num_heads  # 每个头的维度

        # 为每个头创建 Q、K、V 权重矩阵
        # 实际实现中通常用一个大矩阵然后切分，这里为了清晰用多个小矩阵
        np.random.seed(42)
        self.W_Qs = [np.random.randn(d_model, self.d_k) for _ in range(num_heads)]
        self.W_Ks = [np.random.randn(d_model, self.d_k) for _ in range(num_heads)]
        self.W_Vs = [np.random.randn(d_model, self.d_k) for _ in range(num_heads)]

        # 输出投影矩阵：把拼接后的结果映射回 d_model 维
        self.W_O = np.random.randn(d_model, d_model)

    def forward(self, X):
        """
        X: 输入, shape (seq_len, d_model)
        返回: shape (seq_len, d_model)
        """
        seq_len = X.shape[0]
        head_outputs = []

        # 每个头独立计算 attention
        for i in range(self.num_heads):
            Q = X @ self.W_Qs[i]  # (seq_len, d_k)
            K = X @ self.W_Ks[i]  # (seq_len, d_k)
            V = X @ self.W_Vs[i]  # (seq_len, d_k)

            head_output, _ = scaled_dot_product_attention(Q, K, V)
            head_outputs.append(head_output)  # 每个 (seq_len, d_k)

        # 把所有头的输出拼接起来: (seq_len, d_k * num_heads) = (seq_len, d_model)
        concat = np.concatenate(head_outputs, axis=1)

        # 通过输出投影矩阵
        output = concat @ self.W_O  # (seq_len, d_model)

        return output
```

使用示例：

```python
# 8 个头，每个头 64 维，总共 512 维
mha = MultiHeadAttention(d_model=512, num_heads=8)

# 模拟一个 10 个词的句子，每个词 512 维
X = np.random.randn(10, 512)

output = mha.forward(X)
print("输入形状:", X.shape)    # (10, 512)
print("输出形状:", output.shape)  # (10, 512)
```

---

## 七、Mask 机制：让 Attention "看不见"某些位置

### 两种常见 Mask

| 类型 | 用途 | 做法 |
|------|------|------|
| **Padding Mask** | 忽略填充的无意义位置（比如 batch 中短句子的 padding） | 把 padding 位置的分数设为 $-\infty$ |
| **Causal Mask（因果掩码）** | 让当前位置只能看到前面的词，不能"偷看"未来 | 把上三角部分设为 $-\infty$ |

### Causal Mask 示例

在解码器（GPT 这类自回归模型）中，生成第 $t$ 个词时只能看到前 $t-1$ 个词：

```python
def create_causal_mask(seq_len):
    """
    创建因果掩码（下三角矩阵）
    1 表示可见，0 表示不可见
    """
    mask = np.tril(np.ones((seq_len, seq_len)))
    return mask

# 示例：5 个词的因果掩码
mask = create_causal_mask(5)
print("因果掩码:")
print(mask)
```

输出：

```
[[1. 0. 0. 0. 0.]
 [1. 1. 0. 0. 0.]
 [1. 1. 1. 0. 0.]
 [1. 1. 1. 1. 0.]
 [1. 1. 1. 1. 1.]]
```

第 0 个词只能看到自己；第 1 个词能看到第 0 和第 1 个；以此类推。

在 `scaled_dot_product_attention` 函数中，mask 为 0 的位置会被设为 $-10^9$，经过 softmax 后变成 0，相当于"看不见"。

---

## 八、完整可运行版本（纯 Python，零依赖）

如果你不想装 numpy，下面是完全用 Python 标准库实现的版本：

```python
"""
纯 Python 实现的 Scaled Dot-Product Attention + Multi-Head Attention
零第三方依赖，只有标准库
"""
import math
import random


# ============ 矩阵运算工具 ============

def matmul(A, B):
    """矩阵乘法 A(m×n) × B(n×p) = C(m×p)"""
    m, n = len(A), len(A[0])
    p = len(B[0])
    C = [[0.0] * p for _ in range(m)]
    for i in range(m):
        for j in range(p):
            total = 0.0
            for k in range(n):
                total += A[i][k] * B[k][j]
            C[i][j] = total
    return C


def transpose(A):
    """矩阵转置"""
    return [list(row) for row in zip(*A)]


def softmax_rows(A):
    """对每一行做 softmax"""
    result = []
    for row in A:
        max_val = max(row)
        exps = [math.exp(v - max_val) for v in row]
        total = sum(exps)
        result.append([e / total for e in exps])
    return result


def concat_columns(matrices):
    """把多个矩阵按列拼接（每个矩阵行数相同）"""
    return [sum([m[i] for m in matrices], []) for i in range(len(matrices[0]))]


def random_matrix(rows, cols):
    """生成随机矩阵（标准正态分布近似）"""
    return [[random.gauss(0, 1) for _ in range(cols)] for _ in range(rows)]


# ============ Attention 实现 ============

def scaled_dot_product_attention(Q, K, V, mask=None):
    """
    Scaled Dot-Product Attention

    Q: (seq_len, d_k)
    K: (seq_len, d_k)
    V: (seq_len, d_v)
    mask: (seq_len, seq_len), 1=可见, 0=不可见, None=不掩码
    """
    d_k = len(K[0])

    # scores = Q @ K^T
    K_T = transpose(K)
    scores = matmul(Q, K_T)

    # 缩放
    for i in range(len(scores)):
        for j in range(len(scores[0])):
            scores[i][j] /= math.sqrt(d_k)

    # 应用掩码
    if mask is not None:
        for i in range(len(scores)):
            for j in range(len(scores[0])):
                if mask[i][j] == 0:
                    scores[i][j] = -1e9

    # Softmax
    weights = softmax_rows(scores)

    # output = weights @ V
    output = matmul(weights, V)

    return output, weights


class MultiHeadAttention:
    def __init__(self, d_model, num_heads):
        assert d_model % num_heads == 0
        self.d_model = d_model
        self.num_heads = num_heads
        self.d_k = d_model // num_heads

        random.seed(42)
        self.W_Qs = [random_matrix(d_model, self.d_k) for _ in range(num_heads)]
        self.W_Ks = [random_matrix(d_model, self.d_k) for _ in range(num_heads)]
        self.W_Vs = [random_matrix(d_model, self.d_k) for _ in range(num_heads)]
        self.W_O = random_matrix(d_model, d_model)

    def forward(self, X):
        head_outputs = []
        for i in range(self.num_heads):
            Q = matmul(X, self.W_Qs[i])
            K = matmul(X, self.W_Ks[i])
            V = matmul(X, self.W_Vs[i])
            out, _ = scaled_dot_product_attention(Q, K, V)
            head_outputs.append(out)

        concat = concat_columns(head_outputs)
        output = matmul(concat, self.W_O)
        return output


# ============ 运行示例 ============

if __name__ == "__main__":
    # 模拟输入：3 个词，每个词 8 维
    X = [
        [1.0, 0.0, 1.0, 0.0, 0.5, 0.3, 0.1, 0.2],
        [0.0, 1.0, 0.0, 1.0, 0.4, 0.6, 0.2, 0.1],
        [1.0, 1.0, 0.0, 0.0, 0.7, 0.5, 0.3, 0.4],
    ]

    print("=== 单头 Attention ===")
    random.seed(42)
    W_Q = random_matrix(8, 8)
    W_K = random_matrix(8, 8)
    W_V = random_matrix(8, 8)

    Q = matmul(X, W_Q)
    K = matmul(X, W_K)
    V = matmul(X, W_V)

    output, weights = scaled_dot_product_attention(Q, K, V)

    print("注意力权重矩阵:")
    for row in weights:
        print([f"{v:.4f}" for v in row])

    print("\n输出（前 4 维）:")
    for row in output:
        print([f"{v:.4f}" for v in row[:4]])

    print("\n=== 多头 Attention ===")
    mha = MultiHeadAttention(d_model=8, num_heads=4)
    mha_output = mha.forward(X)
    print("输出形状:", len(mha_output), "x", len(mha_output[0]))
    print("输出（前 4 维）:")
    for row in mha_output:
        print([f"{v:.4f}" for v in row[:4]])

    print("\n=== 因果掩码示例 ===")
    mask = [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
    ]
    masked_output, masked_weights = scaled_dot_product_attention(Q, K, V, mask=mask)
    print("带掩码的注意力权重:")
    for row in masked_weights:
        print([f"{v:.4f}" for v in row])
```

运行后你会看到：

- 单头 Attention 的权重矩阵是一个 3×3 矩阵，每行加起来等于 1
- 多头 Attention 的输出和输入形状一致（3×8）
- 带因果掩码的权重矩阵是下三角的（上三角全为 0）

---

## 九、关键问题答疑

### Q1：为什么 Q、K、V 要用不同的权重矩阵？

如果 Q = K = V = X，那 attention 就是在算每个词和自己的相似度，信息没有经过任何变换。用不同的权重矩阵把 X 投影到三个不同的"子空间"，让模型有能力区分"查询"、"匹配"和"内容"三种角色。

### Q2：为什么除以 $\sqrt{d_k}$ 而不是 $d_k$？

假设 Q 和 K 的每个元素是均值 0、方差 1 的独立随机变量，那点积 $Q \cdot K = \sum_{i=1}^{d_k} q_i k_i$ 的方差是 $d_k$。除以 $\sqrt{d_k}$ 后，方差变成 1，保持数值稳定。除以 $d_k$ 会让数值太小，过度抑制。

### Q3：Self-Attention 和 Cross-Attention 有什么区别？

- **Self-Attention**：Q、K、V 都来自同一个输入序列。每个词和自己所在的句子做 attention。
- **Cross-Attention**：Q 来自一个序列（比如解码器），K 和 V 来自另一个序列（比如编码器的输出）。用于两个序列之间的信息交互，比如翻译任务中"目标语言"去查询"源语言"。

### Q4：Multi-Head Attention 中每个头的维度为什么是 $d\_model / num\_heads$？

为了保持总计算量和参数量不变。8 个头每个 64 维，和 1 个头 512 维，总参数量一样。这样增加头的数量不会让模型变慢或变大，只是把同样的容量分配到不同的"关注模式"上。

### Q5：Attention 的计算复杂度是多少？

对于序列长度 $n$ 和维度 $d$：

- Q @ K^T：$O(n^2 \cdot d)$
- weights @ V：$O(n^2 \cdot d)$
- 总计：$O(n^2 \cdot d)$

**$n^2$ 是 Attention 的核心瓶颈**。当序列很长时（比如 $n = 10000$），$n^2 = 10^8$，计算量和内存都会爆炸。这就是为什么后来出现了 Flash Attention、Linear Attention、Sparse Attention 等优化方案。

---

## 十、一张图总结整个流程

```
输入 X (seq_len × d_model)
  │
  ├──→ × W_Q ──→ Q ─┐
  ├──→ × W_K ──→ K ─┤
  └──→ × W_V ──→ V ─┤
                    │
          ┌─────────┘
          │
    Q @ K^T          ← 计算相似度
          │
     / √d_k          ← 缩放
          │
    + mask           ← 可选：掩码
          │
    softmax          ← 归一化为概率
          │
    × V              ← 加权求和
          │
          ▼
    输出 (seq_len × d_v)
```

多头版本就是在上面这个流程外面套一层循环，每个头用不同的 W_Q/W_K/W_V，最后拼接再过一个 W_O。

---

## 十一、总结

| 概念 | 一句话解释 |
|------|-----------|
| Q（Query） | 当前词"想找什么信息" |
| K（Key） | 每个词"能提供什么标签" |
| V（Value） | 每个词"实际的内容" |
| Q·K^T | 计算当前词和所有词的相似度 |
| /√d_k | 防止数值过大导致 softmax 梯度消失 |
| Softmax | 把分数变成概率（加起来为 1） |
| ×V | 用概率作为权重，混合所有词的内容 |
| Multi-Head | 多个 attention 并行，各自关注不同方面 |
| Causal Mask | 让每个位置只能看到前面的词（用于 GPT 类模型） |
| 复杂度 | O(n²·d)，n 是序列长度，这是长序列的瓶颈 |
