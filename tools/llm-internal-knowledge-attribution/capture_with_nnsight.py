#!/usr/bin/env python3
"""Capture a hidden state and next-token logits with NNsight."""

from __future__ import annotations

import argparse

import torch
from nnsight import TransformersModel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="openai-community/gpt2")
    parser.add_argument("--prompt", default="The capital of France is")
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
