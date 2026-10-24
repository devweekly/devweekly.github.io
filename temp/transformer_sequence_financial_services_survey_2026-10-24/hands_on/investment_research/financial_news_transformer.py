#!/usr/bin/env python3
"""Financial PhraseBank sentiment research with a pretrained FinBERT Transformer.

Loads the Financial PhraseBank dataset from Hugging Face, runs FinBERT inference,
and evaluates sentiment classification. It then writes sentence-level scores that
can be used as a research feature. The dataset has sentence labels, not firm IDs or
timestamps, so this script does NOT claim to backtest stock returns.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from datasets import load_dataset
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from transformers import AutoModelForSequenceClassification, AutoTokenizer, pipeline

LABELS = ["negative", "neutral", "positive"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="ProsusAI/finbert")
    parser.add_argument("--dataset", default="financial_phrasebank",
                        help="Hugging Face dataset id; default is Financial PhraseBank.")
    parser.add_argument("--config", default="sentences_50agree",
                        help="PhraseBank agreement subset; 50agree is a conservative default.")
    parser.add_argument("--split", default="train")
    parser.add_argument("--max-samples", type=int, default=0, help="0 means use the full selected split.")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--output-dir", default="outputs/financial_news_sentiment")
    args = parser.parse_args()
    out = Path(args.output_dir); out.mkdir(parents=True, exist_ok=True)

    print(f"Loading dataset: {args.dataset}/{args.config}")
    ds = load_dataset(args.dataset, args.config, split=args.split)
    frame = ds.to_pandas()
    # Dataset versions may use either 'sentence' or 'text' as the text field.
    text_col = "sentence" if "sentence" in frame.columns else "text"
    label_col = "label"
    if text_col not in frame or label_col not in frame:
        raise ValueError(f"Expected text and label columns; received {list(frame.columns)}")
    if args.max_samples > 0:
        frame = frame.head(args.max_samples).copy()
    frame = frame.dropna(subset=[text_col, label_col]).reset_index(drop=True)
    # HF dataset label ids are commonly 0=negative, 1=neutral, 2=positive; infer names where available.
    features = ds.features.get(label_col)
    names = getattr(getattr(features, "feature", features), "names", None)
    if names and len(names) == 3:
        truth_names = [str(names[int(i)]).lower() for i in frame[label_col]]
    else:
        truth_names = [LABELS[int(i)] for i in frame[label_col]]
    # Normalize label spellings from dataset metadata.
    truth_names = [("negative" if "neg" in x else "positive" if "pos" in x else "neutral") for x in truth_names]

    print(f"Loading Transformer model: {args.model}")
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(args.model)
    classifier = pipeline("text-classification", model=model, tokenizer=tokenizer,
                          device=0 if __import__("torch").cuda.is_available() else -1,
                          top_k=None, truncation=True, batch_size=args.batch_size)
    results = classifier(frame[text_col].astype(str).tolist(), batch_size=args.batch_size, truncation=True)
    rows = []
    for text, truth, scores in zip(frame[text_col], truth_names, results):
        mapping = {}
        for item in scores:
            label = item["label"].lower()
            normalized = "negative" if "neg" in label else "positive" if "pos" in label else "neutral"
            mapping[normalized] = float(item["score"])
        predicted = max(mapping, key=mapping.get)
        rows.append({"text": text, "actual_sentiment": truth, "predicted_sentiment": predicted,
                     "negative_probability": mapping.get("negative", 0.0),
                     "neutral_probability": mapping.get("neutral", 0.0),
                     "positive_probability": mapping.get("positive", 0.0),
                     "sentiment_score": mapping.get("positive", 0.0) - mapping.get("negative", 0.0)})
    scored = pd.DataFrame(rows)
    y_true, y_pred = scored["actual_sentiment"], scored["predicted_sentiment"]
    summary = {
        "model": args.model, "dataset": args.dataset, "config": args.config,
        "split": args.split, "samples": len(scored),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "classification_report": classification_report(y_true, y_pred, labels=LABELS,
                                                        output_dict=True, zero_division=0),
        "confusion_matrix_labels": LABELS,
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=LABELS).tolist(),
        "mean_sentiment_score": float(scored["sentiment_score"].mean()),
        "limitations": [
            "Financial PhraseBank is sentence-level and does not provide a reliable company identifier or event timestamp.",
            "This is model/dataset evaluation, not a stock-return backtest or evidence of investment alpha.",
            "For event studies, join timestamped licensed news to stable company identifiers and use point-in-time prices."
        ]
    }
    scored.to_csv(out / "scored_sentences.csv", index=False)
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({k:v for k,v in summary.items() if k != "classification_report"}, indent=2))
    print("Wrote scored_sentences.csv and summary.json")


if __name__ == "__main__":
    main()
