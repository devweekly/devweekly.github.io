# CS336 Assignment 1: 从零实现 Transformer 语言模型（完整 PyTorch 实现）

> 基于 Stanford CS336 (Spring 2026) Assignment 1 要求，从零实现 BPE 分词器、Transformer 架构、训练循环和文本生成。
> 不使用 `torch.nn`（除 `Parameter`/`Module` 容器）、`torch.nn.functional`、`torch.optim`（除 `Optimizer` 基类）。

---

## 目录

1. [BPE Tokenizer](#1-bpe-tokenizer)
2. [基础构建块（Linear / Embedding / RMSNorm）](#2-基础构建块)
3. [SwiGLU 前馈网络](#3-swiglu-前馈网络)
4. [旋转位置嵌入 RoPE](#4-旋转位置嵌入-rope)
5. [Attention 机制](#5-attention-机制)
6. [Transformer Block 与完整模型](#6-transformer-block-与完整模型)
7. [交叉熵损失](#7-交叉熵损失)
8. [AdamW 优化器](#8-adamw-优化器)
9. [学习率调度与梯度裁剪](#9-学习率调度与梯度裁剪)
10. [训练循环](#10-训练循环)
11. [文本生成](#11-文本生成)

---

## 1. BPE Tokenizer

### 1.1 核心思想

BPE（Byte-Pair Encoding）从字节级词表（256 个字节）开始，反复合并出现频率最高的相邻字节对，直到词表达到目标大小。

### 1.2 完整实现

```python
"""
BPE Tokenizer: 字节级实现
"""
import re
import json
import time
from collections import Counter
from typing import Optional


def pre_tokenize(text: str, special_tokens: list[str] = None) -> list[bytes]:
    """
    预分词：把文本切成"词"，每个词转为 bytes。
    使用类似 GPT-2 的正则，按空格和标点切分。
    特殊 token 会被单独提取，不参与 BPE 合并。
    """
    if special_tokens:
        # 用特殊 token 作为分隔符，先切分
        pattern = "(" + "|".join(re.escape(t) for t in special_tokens) + ")"
        segments = re.split(pattern, text)
    else:
        segments = [text]

    word_bytes_list = []
    for seg in segments:
        if not seg:
            continue
        if special_tokens and seg in special_tokens:
            # 特殊 token 不参与 BPE，直接作为一个整体
            word_bytes_list.append(seg.encode("utf-8"))
            continue
        # GPT-2 风格的预分词正则
        for match in re.finditer(
            r"""'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+""",
            seg,
        ):
            word_bytes_list.append(match.group().encode("utf-8"))

    return word_bytes_list


def train_bpe(
    input_path: str,
    vocab_size: int,
    special_tokens: list[str] = None,
) -> tuple[dict[int, bytes], list[tuple[bytes, bytes]]]:
    """
    训练字节级 BPE 分词器。

    参数:
        input_path: 训练数据文件路径
        vocab_size: 目标词表大小（含 256 个基础字节 + 特殊 token）
        special_tokens: 特殊 token 列表

    返回:
        vocab: {token_id: bytes} 词表
        merges: [(bytes, bytes), ...] 按合并顺序排列的合并记录
    """
    special_tokens = special_tokens or []

    # 第 1 步：初始化词表
    # 前 256 个是基础字节
    vocab: dict[int, bytes] = {i: bytes([i]) for i in range(256)}
    # 特殊 token 紧跟在 256 之后
    next_id = 256
    for token in special_tokens:
        vocab[next_id] = token.encode("utf-8")
        next_id += 1

    # 第 2 步：读取文件并预分词
    with open(input_path, "r", encoding="utf-8") as f:
        text = f.read()

    word_bytes_list = pre_tokenize(text, special_tokens)

    # 第 3 步：把每个词表示为 token id 序列，并统计词频
    # word_freqs: {tuple_of_ids: frequency}
    word_freqs: Counter = Counter()
    for word_bytes in word_bytes_list:
        ids = tuple(bytes([b]) for b in word_bytes)  # 每个字节单独作为一个 bytes token
        word_freqs[ids] += 1

    # 第 4 步：统计所有相邻 token 对的出现频率
    def get_pair_stats(word_freqs: dict) -> Counter:
        """统计所有相邻 token 对的加权频率"""
        pair_counts: Counter = Counter()
        for word_tuple, freq in word_freqs.items():
            for i in range(len(word_tuple) - 1):
                pair_counts[(word_tuple[i], word_tuple[i + 1])] += freq
        return pair_counts

    # 第 5 步：合并最高频的 token 对，重复直到词表达到目标大小
    merges: list[tuple[bytes, bytes]] = []
    target_num_merges = vocab_size - 256 - len(special_tokens)

    for merge_step in range(target_num_merges):
        pair_counts = get_pair_stats(word_freqs)

        if not pair_counts:
            break  # 没有更多可合并的对了

        # 找到频率最高的 token 对
        best_pair = max(pair_counts, key=pair_counts.get)
        best_count = pair_counts[best_pair]

        if best_count < 1:
            break

        # 记录合并
        merges.append(best_pair)
        merged_token = best_pair[0] + best_pair[1]
        vocab[next_id] = merged_token
        merge_id = next_id
        next_id += 1

        # 在所有词中执行这次合并
        new_word_freqs: Counter = Counter()
        for word_tuple, freq in word_freqs.items():
            new_word = []
            i = 0
            while i < len(word_tuple):
                if i < len(word_tuple) - 1 and word_tuple[i] == best_pair[0] and word_tuple[i + 1] == best_pair[1]:
                    new_word.append(merged_token)
                    i += 2
                else:
                    new_word.append(word_tuple[i])
                    i += 1
            new_word_freqs[tuple(new_word)] += freq
        word_freqs = new_word_freqs

    return vocab, merges


class BPETokenizer:
    """BPE 分词器：支持编码和解码"""

    def __init__(self, vocab: dict[int, bytes], merges: list[tuple[bytes, bytes]], special_tokens: list[str] = None):
        self.vocab = vocab
        self.merges = merges
        self.special_tokens = special_tokens or []

        # 构建 bytes -> id 的反向词表
        self.inverse_vocab: dict[bytes, int] = {v: k for k, v in vocab.items()}

        # 构建 merge 优先级表：{(bytes, bytes): rank}
        self.merge_ranks: dict[tuple[bytes, bytes], int] = {}
        for rank, (a, b) in enumerate(merges):
            self.merge_ranks[(a, b)] = rank

    def encode(self, text: str) -> list[int]:
        """将文本编码为 token id 序列"""
        # 处理特殊 token
        if self.special_tokens:
            pattern = "(" + "|".join(re.escape(t) for t in self.special_tokens) + ")"
            segments = re.split(pattern, text)
        else:
            segments = [text]

        all_ids: list[int] = []

        for seg in segments:
            if not seg:
                continue
            if seg in self.special_tokens:
                all_ids.append(self.inverse_vocab[seg.encode("utf-8")])
                continue

            # 预分词
            word_bytes_list = pre_tokenize(seg, special_tokens=None)

            for word_bytes in word_bytes_list:
                # 对每个词应用 BPE 合并
                tokens = [bytes([b]) for b in word_bytes]
                ids = self._apply_merges(tokens)
                all_ids.extend(ids)

        return all_ids

    def _apply_merges(self, tokens: list[bytes]) -> list[int]:
        """对一个词的 token 列表应用 BPE 合并"""
        # 反复合并优先级最高的 token 对
        while len(tokens) >= 2:
            # 找到优先级最高（rank 最小）的可合并对
            best_rank = float("inf")
            best_idx = -1
            for i in range(len(tokens) - 1):
                pair = (tokens[i], tokens[i + 1])
                if pair in self.merge_ranks:
                    rank = self.merge_ranks[pair]
                    if rank < best_rank:
                        best_rank = rank
                        best_idx = i

            if best_idx == -1:
                break  # 没有可合并的对了

            # 执行合并
            tokens = (
                tokens[:best_idx]
                + [tokens[best_idx] + tokens[best_idx + 1]]
                + tokens[best_idx + 2:]
            )

        # 转为 id
        return [self.inverse_vocab[tok] for tok in tokens]

    def decode(self, ids: list[int]) -> str:
        """将 token id 序列解码为文本"""
        byte_chunks = []
        for token_id in ids:
            if token_id in self.vocab:
                byte_chunks.append(self.vocab[token_id])
        return b"".join(byte_chunks).decode("utf-8", errors="replace")

    def save(self, path: str):
        """保存分词器"""
        data = {
            "vocab": {str(k): v.hex() for k, v in self.vocab.items()},
            "merges": [[a.hex(), b.hex()] for a, b in self.merges],
            "special_tokens": self.special_tokens,
        }
        with open(path, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: str):
        """加载分词器"""
        with open(path, "r") as f:
            data = json.load(f)
        vocab = {int(k): bytes.fromhex(v) for k, v in data["vocab"].items()}
        merges = [(bytes.fromhex(a), bytes.fromhex(b)) for a, b in data["merges"]]
        special_tokens = data.get("special_tokens", [])
        return cls(vocab, merges, special_tokens)
```

### 1.3 使用示例

```python
# 训练
vocab, merges = train_bpe(
    input_path="data/TinyStories.txt",
    vocab_size=10000,
    special_tokens=["<|endoftext|>"],
)
tokenizer = BPETokenizer(vocab, merges, special_tokens=["<|endoftext|>"])

# 编码
ids = tokenizer.encode("Once upon a time, there was a little cat.")
print(ids)

# 解码
print(tokenizer.decode(ids))
```

---

## 2. 基础构建块

### 2.1 Linear 层（无 bias）

```python
import torch
import torch.nn as nn
import torch.nn.init as init


class Linear(nn.Module):
    """
    线性变换层 y = xW^T（无 bias）
    权重初始化：截断正态分布 N(0, 2/(d_in + d_out))，截断范围 [-3σ, 3σ]
    """

    def __init__(self, in_features: int, out_features: int, device=None, dtype=None):
        super().__init__()
        self.in_features = in_features
        self.out_features = out_features

        # 截断正态分布初始化
        # 方差 = 2 / (d_in + d_out)，标准差 = sqrt(2 / (d_in + d_out))
        std = (2.0 / (in_features + out_features)) ** 0.5
        weight = torch.empty(out_features, in_features, device=device, dtype=dtype)
        init.trunc_normal_(weight, mean=0.0, std=std, a=-3 * std, b=3 * std)

        # 用 nn.Parameter 包装，使其可被优化器追踪
        self.weight = nn.Parameter(weight)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (..., in_features)
        return: (..., out_features)
        """
        return x @ self.weight.T
```

### 2.2 Embedding 层

```python
class Embedding(nn.Module):
    """
    嵌入查找表：通过 token id 查找对应的向量
    初始化：截断正态分布 N(0, 1)，截断范围 [-3, 3]
    """

    def __init__(self, num_embeddings: int, embedding_dim: int, device=None, dtype=None):
        super().__init__()
        self.num_embeddings = num_embeddings
        self.embedding_dim = embedding_dim

        weight = torch.empty(num_embeddings, embedding_dim, device=device, dtype=dtype)
        init.trunc_normal_(weight, mean=0.0, std=1.0, a=-3.0, b=3.0)
        self.weight = nn.Parameter(weight)

    def forward(self, token_ids: torch.Tensor) -> torch.Tensor:
        """
        token_ids: (batch, seq_len) 或 (seq_len,) 整数张量
        return: (batch, seq_len, embedding_dim) 或 (seq_len, embedding_dim)
        """
        return self.weight[token_ids]
```

### 2.3 RMSNorm

```python
class RMSNorm(nn.Module):
    """
    Root Mean Square Layer Normalization
    公式: RMSNorm(a_i) = a_i / RMS(a) * g_i
    其中 RMS(a) = sqrt(mean(a^2) + eps)

    前向传播时先转 float32 防止数值溢出，计算完转回原 dtype。
    """

    def __init__(self, d_model: int, eps: float = 1e-6, device=None, dtype=None):
        super().__init__()
        self.eps = eps
        # 可学习的增益参数，初始化为全 1
        self.weight = nn.Parameter(torch.ones(d_model, device=device, dtype=dtype))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (..., d_model)
        return: (..., d_model) 形状不变
        """
        # 转为 float32 计算以防平方溢出
        x_float = x.to(torch.float32)
        # 计算 RMS
        rms = torch.sqrt(torch.mean(x_float ** 2, dim=-1, keepdim=True) + self.eps)
        # 归一化并乘以增益
        output = (x_float / rms) * self.weight.to(torch.float32)
        # 转回原始 dtype
        return output.to(x.dtype)
```

---

## 3. SwiGLU 前馈网络

```python
class SiLU(nn.Module):
    """SiLU 激活函数: silu(x) = x * sigmoid(x)"""

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x * torch.sigmoid(x)


class SwiGLU(nn.Module):
    """
    SwiGLU 前馈网络:
    FFN(x) = W2(SiLU(W1 @ x) * (W3 @ x))

    其中 d_ff ≈ (8/3) * d_model，向上取整到 64 的倍数。
    三个线性层：W1, W3 把 d_model -> d_ff，W2 把 d_ff -> d_model。
    """

    def __init__(self, d_model: int, d_ff: int = None, device=None, dtype=None):
        super().__init__()
        if d_ff is None:
            # 默认 d_ff = ceil((8/3) * d_model / 64) * 64
            d_ff = int((8 * d_model / 3 + 63) // 64 * 64)

        self.d_ff = d_ff
        self.w1 = Linear(d_model, d_ff, device=device, dtype=dtype)  # gate projection
        self.w2 = Linear(d_ff, d_model, device=device, dtype=dtype)  # down projection
        self.w3 = Linear(d_model, d_ff, device=device, dtype=dtype)  # up projection
        self.act = SiLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (..., d_model)
        return: (..., d_model)
        """
        gate = self.act(self.w1(x))  # SiLU(W1 @ x)
        up = self.w3(x)               # W3 @ x
        return self.w2(gate * up)     # W2(SiLU(W1x) * W3x)
```

---

## 4. 旋转位置嵌入 RoPE

```python
class RotaryPositionalEmbedding(nn.Module):
    """
    旋转位置嵌入 (Rotary Position Embedding, RoPE)

    对位置 i 处的向量，按相邻两个维度一组进行旋转：
    第 k 组的旋转角度 θ_{i,k} = i * base^(-2k/d)

    RoPE 只应用于 Q 和 K，不应用于 V。
    """

    def __init__(self, d_model: int, max_seq_len: int = 4096, base: float = 10000.0):
        super().__init__()
        self.d_model = d_model
        self.base = base

        # 预计算旋转角度
        # θ_k = base^(-2k/d), k = 0, 1, ..., d/2-1
        d_half = d_model // 2
        freqs = 1.0 / (base ** (torch.arange(0, d_half).float() / d_half))  # (d/2,)

        # 位置索引
        positions = torch.arange(max_seq_len).float()  # (max_seq_len,)

        # 角度矩阵: (max_seq_len, d/2)
        angles = torch.outer(positions, freqs)  # θ_{i,k} = i * freq_k

        # 预计算 cos 和 sin: (max_seq_len, d_model)
        # 每个角度重复一次，因为相邻两个维度共享一个角度
        self.register_buffer("cos_cached", torch.cos(angles).repeat_interleave(2, dim=-1), persistent=False)
        self.register_buffer("sin_cached", torch.sin(angles).repeat_interleave(2, dim=-1), persistent=False)

    def _rotate_half(self, x: torch.Tensor) -> torch.Tensor:
        """
        将向量的后半部分取负并交换前后半部分。
        对于 [x1, x2, x3, x4] 返回 [-x3, -x4, x1, x2]

        这是 RoPE 旋转矩阵的等价实现，避免构造稀疏矩阵。
        """
        d = x.shape[-1]
        x1 = x[..., :d // 2]
        x2 = x[..., d // 2:]
        return torch.cat([-x2, x1], dim=-1)

    def forward(self, x: torch.Tensor, seq_len: int = None) -> torch.Tensor:
        """
        x: (batch, num_heads, seq_len, d_head) 或 (seq_len, d)
        return: 旋转后的张量，形状不变
        """
        if seq_len is None:
            seq_len = x.shape[-2]

        # 取出对应位置的 cos 和 sin
        cos = self.cos_cached[:seq_len].to(x.dtype)  # (seq_len, d)
        sin = self.sin_cached[:seq_len].to(x.dtype)

        # 扩展维度以广播
        # 如果 x 是 4D: (batch, heads, seq_len, d)
        # cos/sin 需要变成 (1, 1, seq_len, d)
        while cos.dim() < x.dim():
            cos = cos.unsqueeze(0)
            sin = sin.unsqueeze(0)

        # RoPE: x' = x * cos + rotate_half(x) * sin
        return x * cos + self._rotate_half(x) * sin
```

---

## 5. Attention 机制

### 5.1 Softmax

```python
def softmax(x: torch.Tensor, dim: int = -1) -> torch.Tensor:
    """
    数值稳定的 softmax。
    减去最大值防止 exp 溢出。

    x: (..., dim_size, ...)
    return: 同形状，指定维度上和为 1
    """
    x_max = torch.max(x, dim=dim, keepdim=True).values
    exps = torch.exp(x - x_max)
    return exps / torch.sum(exps, dim=dim, keepdim=True)
```

### 5.2 Scaled Dot-Product Attention

```python
def scaled_dot_product_attention(
    Q: torch.Tensor,
    K: torch.Tensor,
    V: torch.Tensor,
    mask: torch.Tensor = None,
) -> torch.Tensor:
    """
    缩放点积注意力

    参数:
        Q: (batch, num_heads, seq_len, d_head)
        K: (batch, num_heads, seq_len, d_head)
        V: (batch, num_heads, seq_len, d_head)
        mask: (batch, num_heads, seq_len, seq_len) 或可广播的形状
              mask=1 表示可见，mask=0 表示不可见
              None 表示不掩码

    return: (batch, num_heads, seq_len, d_head)
    """
    d_k = Q.shape[-1]

    # 计算注意力分数: Q @ K^T
    scores = Q @ K.transpose(-2, -1)  # (batch, heads, seq_len, seq_len)

    # 缩放
    scaled_scores = scores / (d_k ** 0.5)

    # 应用掩码
    if mask is not None:
        scaled_scores = scaled_scores.masked_fill(mask == 0, float("-inf"))

    # Softmax 归一化
    weights = softmax(scaled_scores, dim=-1)

    # 加权求和
    output = weights @ V  # (batch, heads, seq_len, d_head)

    return output
```

### 5.3 因果掩码

```python
def create_causal_mask(seq_len: int, device=None) -> torch.Tensor:
    """
    创建因果掩码（下三角矩阵）。
    位置 i 只能看到位置 0, 1, ..., i。

    return: (seq_len, seq_len)，1=可见，0=不可见
    """
    mask = torch.tril(torch.ones(seq_len, seq_len, device=device))
    return mask
```

### 5.4 多头自注意力

```python
class CausalMultiHeadSelfAttention(nn.Module):
    """
    因果多头自注意力

    流程:
    1. 用三个线性层把输入投影为 Q, K, V
    2. 把 Q, K, V 拆分为多个头
    3. 对 Q, K 应用 RoPE
    4. 计算带因果掩码的 scaled dot-product attention
    5. 拼接所有头的输出
    6. 通过输出线性层
    """

    def __init__(
        self,
        d_model: int,
        num_heads: int,
        max_seq_len: int = 4096,
        rope_base: float = 10000.0,
        device=None,
        dtype=None,
    ):
        super().__init__()
        assert d_model % num_heads == 0, "d_model 必须能被 num_heads 整除"

        self.d_model = d_model
        self.num_heads = num_heads
        self.d_head = d_model // num_heads

        # Q, K, V 投影
        self.q_proj = Linear(d_model, d_model, device=device, dtype=dtype)
        self.k_proj = Linear(d_model, d_model, device=device, dtype=dtype)
        self.v_proj = Linear(d_model, d_model, device=device, dtype=dtype)
        # 输出投影
        self.o_proj = Linear(d_model, d_model, device=device, dtype=dtype)

        # RoPE
        self.rope = RotaryPositionalEmbedding(self.d_head, max_seq_len, base=rope_base)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (batch, seq_len, d_model)
        return: (batch, seq_len, d_model)
        """
        batch_size, seq_len, _ = x.shape

        # 1. 投影
        Q = self.q_proj(x)  # (batch, seq_len, d_model)
        K = self.k_proj(x)
        V = self.v_proj(x)

        # 2. 拆分为多个头
        # (batch, seq_len, d_model) -> (batch, seq_len, num_heads, d_head) -> (batch, num_heads, seq_len, d_head)
        Q = Q.view(batch_size, seq_len, self.num_heads, self.d_head).transpose(1, 2)
        K = K.view(batch_size, seq_len, self.num_heads, self.d_head).transpose(1, 2)
        V = V.view(batch_size, seq_len, self.num_heads, self.d_head).transpose(1, 2)

        # 3. 对 Q, K 应用 RoPE（不对 V 应用）
        Q = self.rope(Q, seq_len=seq_len)
        K = self.rope(K, seq_len=seq_len)

        # 4. 因果掩码
        causal_mask = create_causal_mask(seq_len, device=x.device)
        # 扩展为 (1, 1, seq_len, seq_len) 以广播
        causal_mask = causal_mask.unsqueeze(0).unsqueeze(0)

        # 5. 计算注意力
        attn_output = scaled_dot_product_attention(Q, K, V, mask=causal_mask)
        # (batch, num_heads, seq_len, d_head)

        # 6. 拼接所有头
        # (batch, num_heads, seq_len, d_head) -> (batch, seq_len, num_heads, d_head) -> (batch, seq_len, d_model)
        attn_output = attn_output.transpose(1, 2).contiguous().view(batch_size, seq_len, self.d_model)

        # 7. 输出投影
        return self.o_proj(attn_output)
```

---

## 6. Transformer Block 与完整模型

### 6.1 Pre-Norm Transformer Block

```python
class TransformerBlock(nn.Module):
    """
    Pre-Norm Transformer Block

    z = x + MultiHeadSelfAttention(RMSNorm(x))
    y = z + FFN(RMSNorm(z))
    """

    def __init__(
        self,
        d_model: int,
        num_heads: int,
        d_ff: int = None,
        max_seq_len: int = 4096,
        device=None,
        dtype=None,
    ):
        super().__init__()
        # Attention 子层
        self.attn_norm = RMSNorm(d_model, device=device, dtype=dtype)
        self.attn = CausalMultiHeadSelfAttention(
            d_model, num_heads, max_seq_len, device=device, dtype=dtype
        )

        # FFN 子层
        self.ffn_norm = RMSNorm(d_model, device=device, dtype=dtype)
        self.ffn = SwiGLU(d_model, d_ff, device=device, dtype=dtype)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (batch, seq_len, d_model)
        return: (batch, seq_len, d_model)
        """
        # Pre-Norm Attention + 残差
        z = x + self.attn(self.attn_norm(x))

        # Pre-Norm FFN + 残差
        y = z + self.ffn(self.ffn_norm(z))

        return y
```

### 6.2 完整 Transformer 语言模型

```python
class TransformerLM(nn.Module):
    """
    完整的 Transformer 语言模型

    结构:
    1. Token Embedding
    2. N 个 Transformer Block
    3. 最终 RMSNorm
    4. 输出投影（与 Embedding 权重共享，即 tied weights）

    输入: (batch, seq_len) 的 token id
    输出: (batch, seq_len, vocab_size) 的 logits
    """

    def __init__(
        self,
        vocab_size: int,
        d_model: int = 512,
        num_heads: int = 8,
        num_layers: int = 6,
        d_ff: int = None,
        max_seq_len: int = 4096,
        tie_weights: bool = True,
        device=None,
        dtype=None,
    ):
        super().__init__()
        self.vocab_size = vocab_size
        self.d_model = d_model
        self.max_seq_len = max_seq_len

        # Token Embedding
        self.token_embedding = Embedding(vocab_size, d_model, device=device, dtype=dtype)

        # Transformer Blocks
        self.blocks = nn.ModuleList([
            TransformerBlock(
                d_model=d_model,
                num_heads=num_heads,
                d_ff=d_ff,
                max_seq_len=max_seq_len,
                device=device,
                dtype=dtype,
            )
            for _ in range(num_layers)
        ])

        # 最终 Norm
        self.final_norm = RMSNorm(d_model, device=device, dtype=dtype)

        # 输出投影
        self.lm_head = Linear(d_model, vocab_size, device=device, dtype=dtype)

        # 权重共享：输出投影和 Embedding 使用同一组权重
        if tie_weights:
            self.lm_head.weight = self.token_embedding.weight

    def forward(self, token_ids: torch.Tensor) -> torch.Tensor:
        """
        token_ids: (batch, seq_len)
        return: (batch, seq_len, vocab_size) logits
        """
        # 1. Embedding
        x = self.token_embedding(token_ids)  # (batch, seq_len, d_model)

        # 2. Transformer Blocks
        for block in self.blocks:
            x = block(x)

        # 3. 最终 Norm
        x = self.final_norm(x)

        # 4. 输出投影
        logits = self.lm_head(x)  # (batch, seq_len, vocab_size)

        return logits

    def num_parameters(self) -> int:
        """统计模型参数量"""
        return sum(p.numel() for p in self.parameters())
```

### 6.3 模型配置示例

```python
# 类似 GPT-2 Small 的配置
model_config = {
    "vocab_size": 10000,
    "d_model": 512,
    "num_heads": 8,
    "num_layers": 6,
    "d_ff": 1408,       # ceil(8/3 * 512 / 64) * 64 = 1408
    "max_seq_len": 1024,
    "tie_weights": True,
}

model = TransformerLM(**model_config)
print(f"参数量: {model.num_parameters() / 1e6:.1f}M")

# 测试前向传播
token_ids = torch.randint(0, 10000, (2, 64))  # batch=2, seq_len=64
logits = model(token_ids)
print(f"输入形状: {token_ids.shape}")   # (2, 64)
print(f"输出形状: {logits.shape}")      # (2, 64, 10000)
```

---

## 7. 交叉熵损失

```python
def cross_entropy_loss(logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
    """
    交叉熵损失（数值稳定版）

    公式: L = -log(softmax(logits)[target])
    实现: 利用 log-sum-exp 技巧避免数值不稳定

    参数:
        logits: (batch, seq_len, vocab_size) 模型输出
        targets: (batch, seq_len) 正确的 token id

    return: 标量损失值（对 batch 求均值）
    """
    # 展平以便计算
    # logits: (batch * seq_len, vocab_size)
    # targets: (batch * seq_len,)
    flat_logits = logits.reshape(-1, logits.shape[-1])
    flat_targets = targets.reshape(-1)

    # 数值稳定的 log-softmax
    # log_softmax(x) = x - max(x) - log(sum(exp(x - max(x))))
    x_max = torch.max(flat_logits, dim=-1, keepdim=True).values
    shifted = flat_logits - x_max
    log_sum_exp = torch.log(torch.sum(torch.exp(shifted), dim=-1, keepdim=True))
    log_probs = shifted - log_sum_exp  # (N, vocab_size)

    # 取出正确类别对应的 log prob
    # gather: 按目标索引提取
    correct_log_probs = log_probs.gather(-1, flat_targets.unsqueeze(-1)).squeeze(-1)  # (N,)

    # 负对数似然，对 batch 求均值
    loss = -correct_log_probs.mean()

    return loss


def perplexity(loss: torch.Tensor) -> torch.Tensor:
    """
    困惑度 = exp(交叉熵损失)
    """
    return torch.exp(loss)
```

---

## 8. AdamW 优化器

```python
from torch.optim import Optimizer


class AdamW(Optimizer):
    """
    AdamW 优化器（解耦权重衰减）

    更新规则:
    m_t = β1 * m_{t-1} + (1 - β1) * g_t          # 一阶矩（动量）
    v_t = β2 * v_{t-1} + (1 - β2) * g_t^2         # 二阶矩（梯度平方的指数移动平均）
    m_hat = m_t / (1 - β1^t)                        # 偏差校正
    v_hat = v_t / (1 - β2^t)
    θ_t = θ_{t-1} - α * (m_hat / (sqrt(v_hat) + ε) + λ * θ_{t-1})

    其中 λ 是权重衰减系数，与梯度更新解耦。
    """

    def __init__(
        self,
        params,
        lr: float = 1e-3,
        betas: tuple[float, float] = (0.9, 0.999),
        eps: float = 1e-8,
        weight_decay: float = 0.01,
    ):
        if lr < 0:
            raise ValueError(f"Invalid learning rate: {lr}")
        defaults = {
            "lr": lr,
            "betas": betas,
            "eps": eps,
            "weight_decay": weight_decay,
        }
        super().__init__(params, defaults)

    @torch.no_grad()
    def step(self, closure=None):
        loss = None
        if closure is not None:
            with torch.enable_grad():
                loss = closure()

        for group in self.param_groups:
            lr = group["lr"]
            beta1, beta2 = group["betas"]
            eps = group["eps"]
            weight_decay = group["weight_decay"]

            for param in group["params"]:
                if param.grad is None:
                    continue

                grad = param.grad

                # 获取或初始化状态
                state = self.state[param]
                if len(state) == 0:
                    state["step"] = 0
                    state["m"] = torch.zeros_like(param)  # 一阶矩
                    state["v"] = torch.zeros_like(param)  # 二阶矩

                m = state["m"]
                v = state["v"]
                state["step"] += 1
                t = state["step"]

                # 更新一阶矩和二阶矩
                m.mul_(beta1).add_(grad, alpha=1 - beta1)
                v.mul_(beta2).addcmul_(grad, grad, value=1 - beta2)

                # 偏差校正
                m_hat = m / (1 - beta1 ** t)
                v_hat = v / (1 - beta2 ** t)

                # 参数更新（解耦权重衰减）
                # 先做权重衰减：θ = θ * (1 - lr * λ)
                if weight_decay > 0:
                    param.mul_(1 - lr * weight_decay)

                # 再做梯度更新：θ = θ - lr * m_hat / (sqrt(v_hat) + eps)
                param.add_(m_hat / (torch.sqrt(v_hat) + eps), alpha=-lr)

        return loss
```

---

## 9. 学习率调度与梯度裁剪

### 9.1 学习率调度（Cosine + Warmup）

```python
import math


def get_lr_cosine_schedule(
    step: int,
    max_lr: float,
    min_lr: float,
    warmup_steps: int,
    total_steps: int,
) -> float:
    """
    余弦退火学习率调度（带 warmup）

    阶段 1 (warmup): 从 0 线性增长到 max_lr
    阶段 2 (cosine): 从 max_lr 余弦衰减到 min_lr
    阶段 3 (constant): 保持 min_lr

    参数:
        step: 当前训练步数
        max_lr: 最大学习率
        min_lr: 最小学习率（余弦衰减的下限）
        warmup_steps: warmup 步数
        total_steps: 总训练步数

    return: 当前步的学习率
    """
    if step < warmup_steps:
        # Warmup: 线性增长
        return max_lr * (step + 1) / warmup_steps
    elif step > total_steps:
        # 超过总步数后保持 min_lr
        return min_lr
    else:
        # 余弦退火
        decay_ratio = (step - warmup_steps) / (total_steps - warmup_steps)
        coeff = 0.5 * (1.0 + math.cos(math.pi * decay_ratio))
        return min_lr + coeff * (max_lr - min_lr)


def apply_lr_schedule(optimizer: AdamW, step: int, **schedule_kwargs):
    """更新优化器的学习率"""
    lr = get_lr_cosine_schedule(step, **schedule_kwargs)
    for param_group in optimizer.param_groups:
        param_group["lr"] = lr
    return lr
```

### 9.2 梯度裁剪

```python
def gradient_clipping(parameters, max_norm: float, eps: float = 1e-6):
    """
    梯度裁剪（按全局 L2 范数）

    如果所有梯度的全局 L2 范数超过 max_norm，
    则按比例缩放所有梯度使其范数等于 max_norm。

    参数:
        parameters: 模型参数迭代器
        max_norm: 最大梯度范数
        eps: 防止除零的小常数
    """
    # 收集所有非空梯度
    grads = [p.grad for p in parameters if p.grad is not None]
    if not grads:
        return

    # 计算全局梯度范数
    total_norm = torch.norm(torch.stack([g.norm(2) for g in grads]), 2)

    # 如果超过阈值，按比例缩放
    if total_norm > max_norm:
        scale = max_norm / (total_norm + eps)
        for g in grads:
            g.mul_(scale)
```

---

## 10. 训练循环

### 10.1 数据加载器

```python
import numpy as np


class DataLoader:
    """
    语言模型数据加载器

    从二进制文件中读取 token id，按 (batch_size, seq_len) 组织 batch。
    每个 batch 的输入和目标错开一位（next-token prediction）。
    """

    def __init__(self, data_path: str, batch_size: int, seq_len: int, device: str = "cpu"):
        self.batch_size = batch_size
        self.seq_len = seq_len
        self.device = device

        # 加载数据为 numpy 数组（假设已预处理为 uint16 的 token id）
        self.data = np.memmap(data_path, dtype=np.uint16, mode="r")
        self.num_tokens = len(self.data)

        # 每个 batch 消耗的 token 数 = batch_size * (seq_len + 1)
        # +1 是因为需要错开一位做目标
        tokens_per_batch = batch_size * (seq_len + 1)
        self.num_batches = self.num_tokens // tokens_per_batch

    def __iter__(self):
        """随机打乱起始位置，生成 batch"""
        # 随机选择 batch 的起始偏移量
        batch_offsets = np.random.randint(
            0, self.num_tokens - self.batch_size * (self.seq_len + 1),
            size=self.num_batches,
        )

        for offset in batch_offsets:
            # 构造 batch
            input_ids = torch.empty(self.batch_size, self.seq_len, dtype=torch.long)
            target_ids = torch.empty(self.batch_size, self.seq_len, dtype=torch.long)

            for i in range(self.batch_size):
                start = offset + i * (self.seq_len + 1)
                chunk = self.data[start:start + self.seq_len + 1]
                input_ids[i] = torch.from_numpy(chunk[:self.seq_len].astype(np.int64))
                target_ids[i] = torch.from_numpy(chunk[1:seq_len + 1].astype(np.int64))

            yield input_ids.to(self.device), target_ids.to(self.device)

    def __len__(self):
        return self.num_batches
```

### 10.2 检查点保存与加载

```python
def save_checkpoint(
    path: str,
    model: TransformerLM,
    optimizer: AdamW,
    step: int,
    **extra_info,
):
    """保存训练检查点"""
    checkpoint = {
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "step": step,
        **extra_info,
    }
    torch.save(checkpoint, path)


def load_checkpoint(
    path: str,
    model: TransformerLM,
    optimizer: AdamW = None,
) -> int:
    """加载训练检查点，返回当前步数"""
    checkpoint = torch.load(path, map_location="cpu")
    model.load_state_dict(checkpoint["model_state"])
    if optimizer is not None:
        optimizer.load_state_dict(checkpoint["optimizer_state"])
    return checkpoint["step"]
```

### 10.3 完整训练循环

```python
def train(
    model: TransformerLM,
    train_data_path: str,
    optimizer: AdamW,
    num_steps: int = 10000,
    batch_size: int = 32,
    seq_len: int = 256,
    warmup_steps: int = 200,
    max_lr: float = 3e-4,
    min_lr: float = 3e-5,
    max_grad_norm: float = 1.0,
    log_interval: int = 50,
    save_interval: int = 1000,
    save_path: str = "checkpoint.pt",
    device: str = "cpu",
):
    """
    完整训练循环

    流程:
    1. 创建数据加载器
    2. 对每个 step:
       a. 获取一个 batch
       b. 前向传播计算 logits
       c. 计算交叉熵损失
       d. 反向传播
       e. 梯度裁剪
       f. 更新学习率
       g. 优化器步进
       h. 定期打印日志和保存检查点
    """
    model = model.to(device)
    model.train()

    dataloader = DataLoader(train_data_path, batch_size, seq_len, device)
    data_iter = iter(dataloader)

    print(f"开始训练，共 {num_steps} 步")
    print(f"模型参数量: {model.num_parameters() / 1e6:.2f}M")

    for step in range(num_steps):
        # 获取 batch
        try:
            input_ids, target_ids = next(data_iter)
        except StopIteration:
            data_iter = iter(dataloader)
            input_ids, target_ids = next(data_iter)

        # 前向传播
        logits = model(input_ids)  # (batch, seq_len, vocab_size)

        # 计算损失
        loss = cross_entropy_loss(logits, target_ids)

        # 反向传播
        optimizer.zero_grad()
        loss.backward()

        # 梯度裁剪
        gradient_clipping(model.parameters(), max_grad_norm)

        # 更新学习率
        lr = get_lr_cosine_schedule(
            step=step,
            max_lr=max_lr,
            min_lr=min_lr,
            warmup_steps=warmup_steps,
            total_steps=num_steps,
        )
        for param_group in optimizer.param_groups:
            param_group["lr"] = lr

        # 优化器步进
        optimizer.step()

        # 日志
        if step % log_interval == 0:
            ppl = torch.exp(loss).item()
            print(f"Step {step:5d} | Loss: {loss.item():.4f} | PPL: {ppl:.2f} | LR: {lr:.2e}")

        # 保存检查点
        if step > 0 and step % save_interval == 0:
            save_checkpoint(save_path, model, optimizer, step)
            print(f"  -> 检查点已保存到 {save_path}")

    # 最终保存
    save_checkpoint(save_path, model, optimizer, num_steps)
    print(f"训练完成！最终检查点已保存到 {save_path}")
```

### 10.4 启动训练

```python
# 模型配置
model = TransformerLM(
    vocab_size=10000,
    d_model=256,
    num_heads=8,
    num_layers=4,
    d_ff=768,
    max_seq_len=512,
)

# 优化器
optimizer = AdamW(
    model.parameters(),
    lr=3e-4,
    betas=(0.9, 0.999),
    eps=1e-8,
    weight_decay=0.01,
)

# 训练
train(
    model=model,
    train_data_path="data/TinyStories_tokens.bin",
    optimizer=optimizer,
    num_steps=5000,
    batch_size=32,
    seq_len=256,
    warmup_steps=200,
    max_lr=3e-4,
    min_lr=3e-5,
    max_grad_norm=1.0,
    log_interval=50,
    save_interval=1000,
    save_path="checkpoints/model.pt",
    device="cuda" if torch.cuda.is_available() else "cpu",
)
```

---

## 11. 文本生成

```python
def generate(
    model: TransformerLM,
    tokenizer: BPETokenizer,
    prompt: str,
    max_new_tokens: int = 100,
    temperature: float = 1.0,
    top_k: int = None,
    device: str = "cpu",
) -> str:
    """
    自回归文本生成

    参数:
        model: 训练好的模型
        tokenizer: 分词器
        prompt: 提示文本
        max_new_tokens: 最大生成 token 数
        temperature: 采样温度（1.0=正常，<1.0=更确定，>1.0=更随机）
        top_k: 只从概率最高的 k 个 token 中采样（None=不限制）
        device: 计算设备

    return: 生成的完整文本
    """
    model.eval()
    model = model.to(device)

    # 编码提示
    token_ids = tokenizer.encode(prompt)
    input_ids = torch.tensor([token_ids], dtype=torch.long, device=device)  # (1, seq_len)

    with torch.no_grad():
        for _ in range(max_new_tokens):
            # 截断到最大序列长度
            if input_ids.shape[1] >= model.max_seq_len:
                input_ids = input_ids[:, -model.max_seq_len:]

            # 前向传播，取最后一个位置的 logits
            logits = model(input_ids)  # (1, seq_len, vocab_size)
            next_logits = logits[:, -1, :]  # (1, vocab_size)

            # 温度缩放
            if temperature != 1.0:
                next_logits = next_logits / temperature

            # Top-K 采样
            if top_k is not None:
                # 只保留概率最高的 k 个，其余设为 -inf
                top_k_values, top_k_indices = torch.topk(next_logits, top_k, dim=-1)
                mask = torch.full_like(next_logits, float("-inf"))
                mask.scatter_(-1, top_k_indices, top_k_values)
                next_logits = mask

            # 采样
            probs = softmax(next_logits, dim=-1)
            next_token = torch.multinomial(probs, num_samples=1)  # (1, 1)

            # 拼接到序列
            input_ids = torch.cat([input_ids, next_token], dim=1)

    # 解码
    generated_ids = input_ids[0].tolist()
    return tokenizer.decode(generated_ids)


def generate_greedy(
    model: TransformerLM,
    tokenizer: BPETokenizer,
    prompt: str,
    max_new_tokens: int = 100,
    device: str = "cpu",
) -> str:
    """贪心解码：每步选概率最高的 token"""
    model.eval()
    model = model.to(device)

    token_ids = tokenizer.encode(prompt)
    input_ids = torch.tensor([token_ids], dtype=torch.long, device=device)

    with torch.no_grad():
        for _ in range(max_new_tokens):
            if input_ids.shape[1] >= model.max_seq_len:
                input_ids = input_ids[:, -model.max_seq_len:]

            logits = model(input_ids)
            next_logits = logits[:, -1, :]  # (1, vocab_size)
            next_token = torch.argmax(next_logits, dim=-1, keepdim=True)  # (1, 1)
            input_ids = torch.cat([input_ids, next_token], dim=1)

    return tokenizer.decode(input_ids[0].tolist())
```

### 生成示例

```python
# 加载训练好的模型
checkpoint = torch.load("checkpoints/model.pt", map_location="cpu")
model.load_state_dict(checkpoint["model_state"])

# 贪心生成
text = generate_greedy(
    model, tokenizer,
    prompt="Once upon a time",
    max_new_tokens=200,
)
print(text)

# 带温度的采样生成
text = generate(
    model, tokenizer,
    prompt="Once upon a time",
    max_new_tokens=200,
    temperature=0.8,
    top_k=50,
)
print(text)
```

---

## 附录：完整文件结构

```
project/
├── tokenizer/
│   ├── bpe.py              # BPE 分词器（train_bpe, BPETokenizer）
│   └── train_tokenizer.py  # 训练脚本
├── model/
│   ├── linear.py           # Linear 层
│   ├── embedding.py        # Embedding 层
│   ├── rmsnorm.py          # RMSNorm
│   ├── swiglu.py           # SwiGLU FFN
│   ├── rope.py             # 旋转位置嵌入
│   ├── attention.py        # Attention（softmax, SDPA, MHA）
│   ├── transformer.py      # TransformerBlock + TransformerLM
│   └── __init__.py
├── training/
│   ├── loss.py             # 交叉熵损失
│   ├── optimizer.py        # AdamW
│   ├── scheduler.py        # 学习率调度
│   ├── clipping.py         # 梯度裁剪
│   ├── dataloader.py       # 数据加载器
│   ├── checkpoint.py       # 检查点
│   └── train.py            # 训练循环
├── generation/
│   └── generate.py         # 文本生成
├── tests/
│   ├── test_bpe.py
│   ├── test_attention.py
│   └── test_transformer.py
└── config.yaml             # 超参数配置
```

---

## 附录：关键公式速查

| 组件 | 公式 |
|------|------|
| RMSNorm | $\text{RMSNorm}(a_i) = \frac{a_i}{\sqrt{\frac{1}{d}\sum a_i^2 + \varepsilon}} \cdot g_i$ |
| SwiGLU | $\text{FFN}(x) = W_2(\text{SiLU}(W_1 x) \odot W_3 x)$ |
| RoPE | $q'_i = R_i q_i$，$R_i$ 是旋转角度为 $\theta_{i,k} = i \cdot 10000^{-2k/d}$ 的块对角矩阵 |
| Attention | $\text{Attn}(Q,K,V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$ |
| Cross-Entropy | $\ell = -\log \text{softmax}(o)[\text{target}]$ |
| AdamW | $\theta_t = \theta_{t-1} - \alpha\left(\frac{\hat{m}_t}{\sqrt{\hat{v}_t}+\varepsilon} + \lambda \theta_{t-1}\right)$ |
| Cosine LR | $\text{lr}(t) = \text{min\_lr} + \frac{1}{2}\left(1+\cos\pi\frac{t-w}{T-w}\right)(\text{max\_lr}-\text{min\_lr})$ |
| Pre-Norm Block | $z = x + \text{Attn}(\text{RMSNorm}(x))$，$y = z + \text{FFN}(\text{RMSNorm}(z))$ |
