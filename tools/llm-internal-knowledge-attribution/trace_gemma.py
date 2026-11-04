#!/usr/bin/env python3
"""Build a Circuit Tracer attribution graph for a next-token prediction."""

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
    parser.add_argument("--model", default="google/gemma-2-2b")
    parser.add_argument("--transcoder", default="gemma")
    parser.add_argument(
        "--prompt",
        default="The capital of state containing Dallas is",
        help="Exact prefix whose next-token logits should be explained.",
    )
    parser.add_argument(
        "--backend",
        choices=("transformerlens", "nnsight"),
        default="transformerlens",
    )
    parser.add_argument("--dtype", choices=("bfloat16", "float32"), default="bfloat16")
    parser.add_argument("--max-logits", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--max-feature-nodes", type=int, default=8192)
    parser.add_argument("--offload", choices=("cpu", "disk"), default="cpu")
    parser.add_argument("--output", type=Path, default=Path("./artifacts/dallas-austin"))
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=8046)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not torch.cuda.is_available():
        raise RuntimeError(
            "This example expects a CUDA GPU. Use a supported Colab or local GPU runtime."
        )
    if args.batch_size < 1 or args.max_feature_nodes < 1 or args.max_logits < 1:
        raise ValueError("batch-size, max-feature-nodes, and max-logits must be positive.")

    dtype = torch.bfloat16 if args.dtype == "bfloat16" else torch.float32
    args.output.mkdir(parents=True, exist_ok=True)

    model = ReplacementModel.from_pretrained(
        args.model,
        args.transcoder,
        dtype=dtype,
        backend=args.backend,
    )

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

    graph_files_dir = args.output / "graph_files"
    create_graph_files(
        graph_or_path=graph_path,
        slug="llm-internal-knowledge-attribution",
        output_path=str(graph_files_dir),
        node_threshold=0.80,
        edge_threshold=0.98,
    )

    print(f"Raw graph: {graph_path}")
    print(f"Visualization files: {graph_files_dir}")

    if args.serve:
        from circuit_tracer.frontend.local_server import serve

        serve(data_dir=str(graph_files_dir), port=args.port)
        print(f"Graph UI: http://localhost:{args.port}/index.html")


if __name__ == "__main__":
    main()
