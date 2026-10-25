#!/usr/bin/env python3
"""Minimal scaled dot-product and multi-head self-attention in plain PyTorch.

This is an educational implementation, not a performance-optimized replacement
for torch.nn.MultiheadAttention or nn.TransformerEncoderLayer.
"""
from __future__ import annotations

import math

import torch
from torch import nn


def scaled_dot_product_attention(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    *,
    allowed: torch.Tensor | None = None,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Compute attention.

    q: [..., query_length, head_dim]
    k: [..., key_length, head_dim]
    v: [..., key_length, value_dim]
    allowed: optional boolean mask broadcastable to [..., query_length, key_length].
             True means the query is allowed to see that key.
    """
    scores = q @ k.transpose(-2, -1) / math.sqrt(q.shape[-1])
    if allowed is not None:
        scores = scores.masked_fill(~allowed, torch.finfo(scores.dtype).min)
    weights = torch.softmax(scores, dim=-1)
    output = weights @ v
    return output, weights


class MultiHeadSelfAttention(nn.Module):
    """A compact, inspectable multi-head self-attention layer."""

    def __init__(self, d_model: int, n_heads: int, causal: bool = False) -> None:
        super().__init__()
        if d_model % n_heads != 0:
            raise ValueError("d_model must be divisible by n_heads")
        self.d_model = d_model
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        self.causal = causal
        self.qkv = nn.Linear(d_model, d_model * 3)
        self.output_projection = nn.Linear(d_model, d_model)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # x: [batch, tokens, d_model]
        batch, tokens, _ = x.shape
        qkv = self.qkv(x).reshape(
            batch, tokens, 3, self.n_heads, self.head_dim
        )
        # [3, batch, heads, tokens, head_dim]
        q, k, v = qkv.permute(2, 0, 3, 1, 4).unbind(0)

        allowed = None
        if self.causal:
            # Token i can look at positions 0..i, never positions i+1...
            allowed = torch.tril(
                torch.ones(tokens, tokens, dtype=torch.bool, device=x.device)
            )[None, None, :, :]

        out, weights = scaled_dot_product_attention(q, k, v, allowed=allowed)
        # [batch, heads, tokens, head_dim] -> [batch, tokens, d_model]
        out = out.transpose(1, 2).contiguous().reshape(batch, tokens, self.d_model)
        return self.output_projection(out), weights


def main() -> None:
    torch.manual_seed(7)
    torch.set_printoptions(precision=3, sci_mode=False)

    # Three events, each represented by four numbers. In a real use case, these
    # could be projected numeric/categorical features for three historical trades.
    x = torch.tensor(
        [[[0.2, 1.0, -0.3, 0.5],
          [0.1, 0.4,  0.8, 0.2],
          [1.2, 0.0,  0.1, 0.7]]],
        dtype=torch.float32,
    )
    print("input x:", tuple(x.shape), "=> [batch=1, tokens=3, d_model=4]")

    layer = MultiHeadSelfAttention(d_model=4, n_heads=2, causal=False)
    output, weights = layer(x)
    print("non-causal output:", tuple(output.shape))
    print("attention weights:", tuple(weights.shape), "=> [batch, heads, query, key]")
    print("weights sum over keys (should be 1):")
    print(weights.sum(dim=-1))

    causal_layer = MultiHeadSelfAttention(d_model=4, n_heads=2, causal=True)
    causal_output, causal_weights = causal_layer(x)
    print("causal output:", tuple(causal_output.shape))
    print("causal head 0 weights:")
    print(causal_weights[0, 0])
    # The first token is forbidden from attending to later positions.
    assert torch.allclose(causal_weights[0, 0, 0, 1:], torch.zeros(2), atol=1e-6)
    assert torch.allclose(
        causal_weights.sum(dim=-1),
        torch.ones_like(causal_weights.sum(dim=-1)),
        atol=1e-6,
    )
    print("Checks passed: attention distributions sum to 1; future positions are masked.")


if __name__ == "__main__":
    main()
