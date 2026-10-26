#!/usr/bin/env python3
"""Offline research baseline for matching game screenshots by visual features.

This script ONLY reads image files explicitly supplied by the researcher. It does
not capture a TV screen, connect to a device, persist viewing history, or upload data.

Dataset layout for `build-gallery`:
    gallery/
      game_a/frame_001.jpg
      game_a/frame_002.jpg
      game_b/frame_001.jpg

This is a generic ImageNet-pretrained AlexNet feature baseline, NOT a game-trained
recognizer. Use a held-out set to calibrate match thresholds. For serious results,
train/fine-tune with game-frame pairs and evaluate across separate play sessions.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image, ImageOps
from torchvision.models import AlexNet_Weights, alexnet

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
INPUT_SIZE = 224
IMAGENET_MEAN = torch.tensor([0.485, 0.456, 0.406], dtype=torch.float32).view(3, 1, 1)
IMAGENET_STD = torch.tensor([0.229, 0.224, 0.225], dtype=torch.float32).view(3, 1, 1)


class AlexNetGameEmbedder(nn.Module):
    """Use AlexNet's penultimate 4096-D activation as a frame descriptor."""

    def __init__(self) -> None:
        super().__init__()
        base = alexnet(weights=AlexNet_Weights.IMAGENET1K_V1)
        self.features = base.features
        self.avgpool = base.avgpool
        # AlexNet classifier: Dropout, Linear, ReLU, Dropout, Linear, ReLU, logits.
        # Dropout layers are omitted; the final ImageNet classification layer is
        # omitted because our goal is feature similarity, not ImageNet labels.
        self.fc1 = base.classifier[1]
        self.fc2 = base.classifier[4]

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        x = self.features(images)
        x = self.avgpool(x)
        x = torch.flatten(x, 1)
        x = F.relu(self.fc1(x), inplace=False)
        x = F.relu(self.fc2(x), inplace=False)
        return x  # Shape: [batch, 4096]. Normalize outside the exportable model.


def preprocess_image(path: Path) -> torch.Tensor:
    """Preserve the full 16:9 frame and pad to a 224x224 square."""
    with Image.open(path) as source:
        image = source.convert("RGB")
        image = ImageOps.contain(
            image, (INPUT_SIZE, INPUT_SIZE), method=Image.Resampling.BILINEAR
        )
        canvas = Image.new("RGB", (INPUT_SIZE, INPUT_SIZE), (114, 114, 114))
        canvas.paste(
            image,
            ((INPUT_SIZE - image.width) // 2, (INPUT_SIZE - image.height) // 2),
        )
        array = np.asarray(canvas, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(array).permute(2, 0, 1).contiguous()
    return (tensor - IMAGENET_MEAN) / IMAGENET_STD


def image_files(root: Path) -> Iterable[tuple[str, Path]]:
    """Read images from one directory level per game label."""
    if not root.is_dir():
        raise ValueError(f"Not a directory: {root}")
    game_dirs = sorted(p for p in root.iterdir() if p.is_dir())
    for game_dir in game_dirs:
        for path in sorted(game_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
                yield game_dir.name, path


def choose_device(requested: str) -> torch.device:
    if requested == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available")
    return torch.device(requested)


def embed_batch(
    model: nn.Module, paths: list[Path], device: torch.device
) -> np.ndarray:
    batch = torch.stack([preprocess_image(path) for path in paths]).to(device)
    with torch.inference_mode():
        embeddings = model(batch)
        embeddings = F.normalize(embeddings, p=2, dim=1)
    return embeddings.detach().cpu().numpy().astype(np.float32, copy=False)


def build_gallery(args: argparse.Namespace) -> None:
    device = choose_device(args.device)
    records = list(image_files(args.gallery_dir))
    if not records:
        raise ValueError(
            "No images found. Expected gallery/<game_name>/<image-file> layout."
        )
    model = AlexNetGameEmbedder().to(device).eval()
    vectors: list[np.ndarray] = []
    labels: list[str] = []
    paths: list[str] = []

    for start in range(0, len(records), args.batch_size):
        chunk = records[start : start + args.batch_size]
        chunk_paths = [path for _, path in chunk]
        vectors.append(embed_batch(model, chunk_paths, device))
        labels.extend(label for label, _ in chunk)
        paths.extend(str(path.resolve()) for _, path in chunk)
        print(f"Embedded {min(start + len(chunk), len(records))}/{len(records)} images")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output,
        embeddings=np.concatenate(vectors, axis=0),
        labels=np.asarray(labels, dtype=str),
        paths=np.asarray(paths, dtype=str),
    )
    print(json.dumps({
        "output": str(args.output.resolve()),
        "frames": len(paths),
        "games": sorted(set(labels)),
        "embedding_dim": int(vectors[0].shape[1]),
        "device": str(device),
        "warning": "Generic ImageNet features only; validate before treating matches as recognition.",
    }, ensure_ascii=False, indent=2))


def match_frame(args: argparse.Namespace) -> None:
    device = choose_device(args.device)
    if not args.gallery_file.is_file():
        raise FileNotFoundError(args.gallery_file)
    with np.load(args.gallery_file, allow_pickle=False) as gallery:
        gallery_vectors = np.asarray(gallery["embeddings"], dtype=np.float32)
        labels = np.asarray(gallery["labels"], dtype=str)
        paths = np.asarray(gallery["paths"], dtype=str)

    if gallery_vectors.ndim != 2 or len(gallery_vectors) != len(labels):
        raise ValueError("Gallery artifact has inconsistent embedding/label shapes")

    model = AlexNetGameEmbedder().to(device).eval()
    query = embed_batch(model, [args.image], device)[0]
    similarities = gallery_vectors @ query  # vectors are L2-normalized
    top_indices = np.argsort(similarities)[::-1][: args.top_k]

    # The max similarity per game gives a simple candidate score. It is a baseline,
    # not a calibrated probability; more gallery images can bias max-score matching.
    class_scores: dict[str, float] = {}
    for label, score in zip(labels.tolist(), similarities.tolist()):
        class_scores[label] = max(class_scores.get(label, -1.0), float(score))
    ranked_games = sorted(class_scores.items(), key=lambda item: item[1], reverse=True)
    best_game, best_score = ranked_games[0]
    second_score = ranked_games[1][1] if len(ranked_games) > 1 else -1.0
    margin = best_score - second_score

    accepted: bool | None = None
    if args.min_score is not None and args.min_margin is not None:
        accepted = best_score >= args.min_score and margin >= args.min_margin

    output = {
        "query": str(args.image.resolve()),
        "best_candidate_game": best_game,
        "best_candidate_similarity": round(best_score, 6),
        "second_candidate_similarity": round(second_score, 6),
        "top1_top2_margin": round(margin, 6),
        "accepted": accepted,
        "threshold_note": (
            "Not calibrated; accepted=null because thresholds were not supplied."
            if accepted is None
            else "Thresholds are user-supplied and must be chosen on a separate validation set."
        ),
        "top_neighbours": [
            {
                "rank": rank,
                "game": str(labels[index]),
                "cosine_similarity": round(float(similarities[index]), 6),
                "reference_image": str(paths[index]),
            }
            for rank, index in enumerate(top_indices, start=1)
        ],
        "warning": "Similarity is not a probability. This is a generic-feature baseline, not a validated game recognizer.",
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


def export_litert(args: argparse.Namespace) -> None:
    """Export a FLOAT model first. Quantization is a separate validated step."""
    try:
        import litert_torch
    except ImportError as exc:
        raise RuntimeError(
            "Install LiteRT Torch as documented by Google AI Edge: "
            "pip install litert-torch ai-edge-litert"
        ) from exc

    model = AlexNetGameEmbedder().eval()
    sample_inputs = (torch.randn(1, 3, INPUT_SIZE, INPUT_SIZE),)
    edge_model = litert_torch.convert(model, sample_inputs)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    edge_model.export(str(args.output))
    print(json.dumps({
        "output": str(args.output.resolve()),
        "input_shape": [1, 3, INPUT_SIZE, INPUT_SIZE],
        "output_shape": [1, 4096],
        "quantized": False,
        "next_step": "Compare source and exported outputs, then run representative-data INT8 quantization and evaluate retrieval quality.",
    }, ensure_ascii=False, indent=2))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subparsers = result.add_subparsers(required=True)

    gallery_parser = subparsers.add_parser("build-gallery", help="Embed offline reference images")
    gallery_parser.add_argument("gallery_dir", type=Path)
    gallery_parser.add_argument("output", type=Path)
    gallery_parser.add_argument("--batch-size", type=int, default=4)
    gallery_parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    gallery_parser.set_defaults(func=build_gallery)

    match_parser = subparsers.add_parser("match", help="Find nearest offline reference frames")
    match_parser.add_argument("image", type=Path)
    match_parser.add_argument("gallery_file", type=Path)
    match_parser.add_argument("--top-k", type=int, default=5)
    match_parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    match_parser.add_argument("--min-score", type=float, default=None)
    match_parser.add_argument("--min-margin", type=float, default=None)
    match_parser.set_defaults(func=match_frame)

    export_parser = subparsers.add_parser("export-litert", help="Export a float LiteRT .tflite model")
    export_parser.add_argument("output", type=Path)
    export_parser.set_defaults(func=export_litert)

    return result


def main() -> None:
    args = parser().parse_args()
    if hasattr(args, "top_k") and args.top_k < 1:
        raise SystemExit("--top-k must be >= 1")
    if hasattr(args, "batch_size") and args.batch_size < 1:
        raise SystemExit("--batch-size must be >= 1")
    if getattr(args, "min_score", None) is not None and getattr(args, "min_margin", None) is None:
        raise SystemExit("Use --min-score and --min-margin together; calibrate both on validation data.")
    if getattr(args, "min_margin", None) is not None and getattr(args, "min_score", None) is None:
        raise SystemExit("Use --min-score and --min-margin together; calibrate both on validation data.")
    args.func(args)


if __name__ == "__main__":
    main()
