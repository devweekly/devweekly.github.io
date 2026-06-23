好的，那我们就彻底脱离任何第三方库（不用 PyTorch，甚至不用 Numpy），只用 **纯 Python 的列表（List）和数学库（math）**，从零实现一个最顶层的 Self-Attention 核心逻辑。

我们可以把整个实现拆解为以下几个干净的步骤：

1. **准备输入数据**（模拟 Embedding 后的矩阵）
2. **定义权重矩阵** ($W_q, W_k, W_v$)
3. **矩阵乘法函数**（纯 Python 循环实现）
4. **计算 Q, K, V 矩阵**
5. **计算点积注意力得分（Attention Scores）**
6. **Softmax 函数实现**（将得分归一化为概率）
7. **加权求和**（输出最终的注意力结果）

---

## 纯 Python 代码实现

你可以直接复制这段代码在任何安装了 Python 的环境里运行：

```python
import math

# =====================================================================
# 1. 工具函数：纯 Python 实现矩阵乘法和点积
# =====================================================================

def matmul(A, B):
    """矩阵乘法：A 的形状为 (m, n), B 的形状为 (n, p), 返回 (m, p)"""
    m, n = len(A), len(A[0])
    p = len(B[0])
    
    # 初始化全 0 矩阵
    result = [[0.0] * p for _ in range(m)]
    
    for i in range(m):
        for j in range(p):
            s = 0.0
            for k in range(n):
                s += A[i][k] * B[k][j]
            result[i][j] = s
    return result

def dot_product(v1, v2):
    """计算两个向量的点积"""
    return sum(x * y for x, y in zip(v1, v2))

def softmax(vector):
    """Softmax 函数：将一组实数转换为概率分布"""
    # 减去最大值防止 exp 溢出（一种常见的调试/稳定工程技巧）
    max_val = max(vector)
    exps = [math.exp(x - max_val) for x in vector]
    sum_exps = sum(exps)
    return [e / sum_exps for e in exps]

# =====================================================================
# 2. 模拟 Transformer 运算
# =====================================================================

# 假设输入一句话有 3 个 Token，每个 Token 的 Embedding 维度是 2
# X 的形状: (3, 2)  --> (seq_len, d_model)
X = [
    [1.0, 0.0],  # Token 1 (比如 "I")
    [0.0, 1.0],  # Token 2 (比如 "love")
    [1.0, 1.0]   # Token 3 (比如 "AI")
]

# 随机初始化三个权重矩阵 Wq, Wk, Wv (假设输出维度也是 2)
# 形状均为: (2, 2) --> (d_model, d_k)
Wq = [[1.0, 0.0], [0.0, 1.0]]
Wk = [[0.5, 0.5], [0.0, 1.0]]
Wv = [[2.0, 0.0], [1.0, 3.0]]

# Step 1: 计算 Q, K, V 矩阵
# Q = X * Wq,  K = X * Wk,  V = X * Wv
Q = matmul(X, Wq)
K = matmul(X, Wk)
V = matmul(X, Wv)

print("--- Q Matrix ---")
for row in Q: print([round(x, 2) for x in row])

# Step 2: 计算注意力得分矩阵 (Scores)
# 每一个 Q 向量都要和所有的 K 向量做点积
seq_len = len(X)
scores = [[0.0] * seq_len for _ in range(seq_len)]

for i in range(seq_len):
    for j in range(seq_len):
        scores[i][j] = dot_product(Q[i], K[j])

# Transformer 核心公式里有一个缩放因子: sqrt(d_k)
# 这里 d_k = 2
d_k = len(K[0])
scale = math.sqrt(d_k)

# 应用缩放
scaled_scores = [[cell / scale for cell in row] for row in scores]

print("\n--- Scaled Scores Matrix ---")
for row in scaled_scores: print([round(x, 2) for x in row])

# Step 3: 对每一行应用 Softmax，得到权重矩阵 (Attention Weights)
attention_weights = [softmax(row) for row in scaled_scores]

print("\n--- Attention Weights (Softmax) ---")
for row in attention_weights: print([round(x, 2) for x in row])

# Step 4: 权重矩阵与 V 矩阵相乘，得到最终的 Output
# Output = Attention_Weights * V
output = matmul(attention_weights, V)

print("\n--- Final Attention Output ---")
for row in output: print([round(x, 2) for x in row])

```

---

## 核心步骤解析

这段纯 Python 代码完美复现了标准的数学公式：

$$Attention(Q, K, V) = Softmax(\frac{QK^T}{\sqrt{d_k}})V$$

### 1. `matmul(X, W)` 是在干什么？

在第一步中，我们通过矩阵乘法把输入的原始词向量 `X` 分别投影到了三个不同的空间。

* **Q (Query)**：当前词去“询问”别人时展现的特征。
* **K (Key)**：当前词被别人“匹配”时展现的特征。
* **V (Value)**：当前词实际包含的信息内容。

### 2. 双重循环算得分

代码中用了一个双层 `for` 循环来计算 `scores[i][j]`：

```python
for i in range(seq_len):
    for j in range(seq_len):
        scores[i][j] = dot_product(Q[i], K[j])

```

这其实就是在模拟矩阵乘法 $Q \times K^T$。它让每一个单词（`i`）都去和句子里的所有单词（`j`）对暗号（做点积）。点积结果越大，说明两个词在这个上下文里的相关性越高。

### 3. 行 Softmax 的含义

`attention_weights` 矩阵的每一行加起来都等于 `1.0`。
例如如果打印出来某一行是 `[0.1, 0.7, 0.2]`，这意味着：**当前这个单词，有 10% 的精力关注第一个词，70% 的精力关注第二个词，20% 的精力关注第三个词。**

### 4. 最后的加权求和

最后一步 `matmul(attention_weights, V)`，就是根据上面算出来的百分比权重，把每个词的 `Value`（真正的内容）融合到一起。关注度越高的词，它的 `Value` 在最终的输出里占的比例就越大。
