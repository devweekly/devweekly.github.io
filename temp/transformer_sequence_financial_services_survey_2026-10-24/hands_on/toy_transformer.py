#!/usr/bin/env python3
"""A tiny, self-contained Transformer tutorial using synthetic financial time series.

The data are deliberately synthetic: this program teaches tensor shapes, temporal
splits, training, and evaluation. Its metrics are NOT evidence of a tradable edge.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


FEATURE_NAMES = ["return_1d", "momentum_5d", "volatility_20d", "market_factor", "volume_shock"]


def choose_device(requested: str) -> torch.device:
    if requested != "auto":
        if requested == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is not available.")
        if requested == "mps" and not (
            hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        ):
            raise RuntimeError("MPS was requested but is not available.")
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def make_synthetic_market(n: int, seed: int) -> tuple[pd.DataFrame, np.ndarray]:
    """Generate a toy, non-real market series with weak temporal dependence."""
    rng = np.random.default_rng(seed)

    market = np.zeros(n, dtype=np.float64)
    returns = np.zeros(n, dtype=np.float64)
    volume = np.zeros(n, dtype=np.float64)
    latent_trend = np.zeros(n, dtype=np.float64)
    latent_vol = np.zeros(n, dtype=np.float64)

    for t in range(1, n):
        latent_trend[t] = 0.96 * latent_trend[t - 1] + rng.normal(0, 0.0015)
        market[t] = 0.97 * market[t - 1] + rng.normal(0, 0.006)
        latent_vol[t] = 0.94 * latent_vol[t - 1] + rng.normal(0, 0.05)
        sigma = np.clip(0.012 * np.exp(latent_vol[t]), 0.004, 0.05)
        previous_momentum = np.sum(returns[max(0, t - 5):t])
        returns[t] = (
            0.08 * returns[t - 1]
            + 0.20 * previous_momentum
            + 0.35 * latent_trend[t]
            + 0.12 * market[t - 1]
            + rng.normal(0, sigma)
        )
        volume[t] = 0.65 * volume[t - 1] + 0.35 * abs(returns[t]) + rng.normal(0, 0.004)

    frame = pd.DataFrame({
        "return_1d": returns,
        "market_factor": market,
        "volume_raw": volume,
    })
    frame["momentum_5d"] = frame["return_1d"].rolling(5).sum()
    frame["volatility_20d"] = frame["return_1d"].rolling(20).std()
    volume_mean = frame["volume_raw"].rolling(20).mean()
    volume_std = frame["volume_raw"].rolling(20).std()
    frame["volume_shock"] = (frame["volume_raw"] - volume_mean) / volume_std.replace(0, np.nan)
    frame = frame.replace([np.inf, -np.inf], np.nan).fillna(0.0)

    # At close t, predict cumulative return from t+1 through t+horizon.
    return frame[FEATURE_NAMES], returns


class WindowDataset(TensorDataset):
    pass


class TinyTransformer(nn.Module):
    """Encoder-only Transformer for fixed-length, already-observed histories."""

    def __init__(
        self,
        n_features: int,
        window: int,
        d_model: int = 32,
        n_heads: int = 4,
        n_layers: int = 2,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        if d_model % n_heads:
            raise ValueError("d_model must be divisible by n_heads.")
        self.input_projection = nn.Linear(n_features, d_model)
        # Learnable position vectors: attention alone does not know event order.
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
        self.head = nn.Sequential(nn.LayerNorm(d_model), nn.Linear(d_model, 1))

        # PyTorch clones the encoder layer; explicitly reinitialize each layer.
        for module in self.encoder.layers:
            for parameter in module.parameters():
                if parameter.dim() > 1:
                    nn.init.xavier_uniform_(parameter)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [batch, sequence_length, feature_count]
        _, seq_len, _ = x.shape
        z = self.input_projection(x) + self.position[:, :seq_len, :]
        z = self.encoder(z)
        # Every token is in the observed past relative to the forecast target,
        # so no causal mask is needed for this fixed-window forecasting task.
        return self.head(z[:, -1, :]).squeeze(-1)


def build_windows(
    x: np.ndarray,
    returns: np.ndarray,
    window: int,
    horizon: int,
    train_end: int,
    val_end: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    """Build X[t-window+1:t+1] -> sum(return[t+1:t+horizon+1])."""
    n = len(x)
    last_target = n - horizon - 1
    target_indices = np.arange(window - 1, last_target + 1, dtype=np.int64)

    # The label for each target uses future returns. Purge horizon samples at
    # boundaries so no training label extends into validation/test time.
    splits = {
        "train": target_indices[target_indices < train_end - horizon],
        "validation": target_indices[
            (target_indices >= train_end) & (target_indices < val_end - horizon)
        ],
        "test": target_indices[target_indices >= val_end],
    }
    all_x = np.stack([x[t - window + 1:t + 1] for t in target_indices]).astype(np.float32)
    y = np.asarray([
        np.sum(returns[t + 1:t + horizon + 1]) for t in target_indices
    ], dtype=np.float32)
    offset = target_indices[0]
    index_map = {int(t): i for i, t in enumerate(target_indices)}
    split_arrays = {
        name: np.asarray([index_map[int(t)] for t in ids], dtype=np.int64)
        for name, ids in splits.items()
    }
    if min(map(len, split_arrays.values())) == 0:
        raise ValueError("An empty split was created; increase --rows or reduce --window.")
    return all_x, y, split_arrays


def evaluate(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    return {
        "mae_basis_points": float(mean_absolute_error(y_true, y_pred) * 10_000),
        "rmse_basis_points": float(np.sqrt(mean_squared_error(y_true, y_pred)) * 10_000),
        "mean_actual_return_pct": float(np.mean(y_true) * 100),
        "mean_predicted_return_pct": float(np.mean(y_pred) * 100),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=12000)
    parser.add_argument("--window", type=int, default=30)
    parser.add_argument("--horizon", type=int, default=5)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--d-model", type=int, default=32)
    parser.add_argument("--heads", type=int, default=4)
    parser.add_argument("--layers", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="auto")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/toy_transformer"))
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = choose_device(args.device)

    frame, returns = make_synthetic_market(args.rows, args.seed)
    raw_x = frame.to_numpy(dtype=np.float64)
    train_end, val_end = int(args.rows * 0.70), int(args.rows * 0.85)

    # Fit preprocessing only on the training period; transform later periods
    # using those same parameters (never fit the scaler on the test period).
    scaler = StandardScaler().fit(raw_x[:train_end])
    x_scaled = scaler.transform(raw_x).astype(np.float32)
    x, y, split = build_windows(
        x_scaled, returns, args.window, args.horizon, train_end, val_end
    )

    print(json.dumps({
        "device": str(device),
        "rows": args.rows,
        "feature_names": FEATURE_NAMES,
        "input_shape_one_batch": [args.batch_size, args.window, len(FEATURE_NAMES)],
        "split_samples": {name: int(len(idx)) for name, idx in split.items()},
        "warning": "Synthetic data only; not an investment signal.",
    }, indent=2))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    tensors = {
        name: TensorDataset(
            torch.from_numpy(x[idx]), torch.from_numpy(y[idx])
        )
        for name, idx in split.items()
    }
    loaders = {
        "train": DataLoader(tensors["train"], batch_size=args.batch_size, shuffle=True),
        "validation": DataLoader(tensors["validation"], batch_size=args.batch_size),
        "test": DataLoader(tensors["test"], batch_size=args.batch_size),
    }

    # A transparent, non-neural baseline sees only features known at t.
    # It is intentionally simple; on real data compare with Ridge/GBDT too.
    y_all = y
    train_last = x[split["train"], -1, :]
    ridge = Ridge(alpha=1.0).fit(train_last, y_all[split["train"]])
    ridge_pred = ridge.predict(x[split["test"], -1, :])
    zero_pred = np.zeros_like(y_all[split["test"]])
    baseline_report = {
        "zero_change_baseline": evaluate(y_all[split["test"]], zero_pred),
        "ridge_on_current_features": evaluate(y_all[split["test"]], ridge_pred),
    }

    model = TinyTransformer(
        n_features=len(FEATURE_NAMES),
        window=args.window,
        d_model=args.d_model,
        n_heads=args.heads,
        n_layers=args.layers,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    loss_fn = nn.HuberLoss()
    best_val = float("inf")
    best_state = None
    history: list[dict[str, float]] = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        train_losses = []
        for xb, yb in loaders["train"]:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad(set_to_none=True)
            prediction = model(xb)
            loss = loss_fn(prediction, yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            train_losses.append(float(loss.detach().cpu()))

        model.eval()
        val_y, val_pred = [], []
        with torch.no_grad():
            for xb, yb in loaders["validation"]:
                prediction = model(xb.to(device))
                val_pred.extend(prediction.cpu().numpy().tolist())
                val_y.extend(yb.numpy().tolist())
        val_loss = float(np.mean((np.asarray(val_pred) - np.asarray(val_y)) ** 2))
        row = {
            "epoch": epoch,
            "train_huber_loss": float(np.mean(train_losses)),
            "validation_mse": val_loss,
            "validation_mae_bps": float(mean_absolute_error(val_y, val_pred) * 10_000),
        }
        history.append(row)
        print(json.dumps(row))
        if val_loss < best_val:
            best_val = val_loss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    test_y, test_pred = [], []
    with torch.no_grad():
        for xb, yb in loaders["test"]:
            prediction = model(xb.to(device))
            test_pred.extend(prediction.cpu().numpy().tolist())
            test_y.extend(yb.numpy().tolist())

    report = {
        "device": str(device),
        "seed": args.seed,
        "rows": args.rows,
        "window": args.window,
        "horizon": args.horizon,
        "feature_names": FEATURE_NAMES,
        "split_samples": {name: int(len(idx)) for name, idx in split.items()},
        "baseline_metrics": baseline_report,
        "transformer_metrics": evaluate(np.asarray(test_y), np.asarray(test_pred)),
        "training_history": history,
        "warning": (
            "This experiment uses synthetic, deliberately simplified data. "
            "It teaches the ML workflow and does not demonstrate real market predictability."
        ),
    }
    pd.DataFrame({
        "target_index": split["test"] + (args.window - 1),
        "actual_future_return_pct": np.asarray(test_y) * 100,
        "predicted_future_return_pct": np.asarray(test_pred) * 100,
    }).to_csv(args.output_dir / "predictions.csv", index=False)
    (args.output_dir / "summary.json").write_text(json.dumps(report, indent=2))
    torch.save({
        "state_dict": model.cpu().state_dict(),
        "feature_names": FEATURE_NAMES,
        "window": args.window,
        "horizon": args.horizon,
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
    }, args.output_dir / "transformer.pt")
    print(json.dumps({
        "output_dir": str(args.output_dir),
        "transformer_metrics": report["transformer_metrics"],
        "baseline_metrics": baseline_report,
    }, indent=2))


if __name__ == "__main__":
    main()
