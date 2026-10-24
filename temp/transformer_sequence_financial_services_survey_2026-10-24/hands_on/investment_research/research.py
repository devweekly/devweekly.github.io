#!/usr/bin/env python3
"""Educational multi-asset ETF forecasting and backtest pipeline.

Uses public Yahoo Finance data via yfinance. Research/education only; not investment advice.
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
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
import yfinance as yf

TICKERS_DEFAULT = ["SPY", "QQQ", "IWM", "EFA", "TLT", "GLD", "SHY"]
FEATURE_COLUMNS = [
    "ret_1d", "ret_5d", "ret_20d", "vol_20d", "trend_60d",
    "market_ret_1d", "cross_asset_mean_1d", "cross_asset_std_1d",
]
LOOKBACK = 60
HORIZON = 5


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def download_prices(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    raw = yf.download(
        tickers=tickers, start=start, end=end, interval="1d",
        auto_adjust=True, group_by="column", progress=False, threads=True,
    )
    if raw.empty:
        raise RuntimeError("行情下载结果为空。请检查网络、日期范围或行情源是否可访问。")
    if isinstance(raw.columns, pd.MultiIndex):
        if "Close" not in raw.columns.get_level_values(0):
            raise RuntimeError(f"下载结果没有 Close 列，实际列为：{raw.columns}")
        close = raw["Close"].copy()
    else:
        # yfinance may return flat columns when only one ticker is requested.
        close = raw[["Close"]].rename(columns={"Close": tickers[0]})
    close = close.sort_index().apply(pd.to_numeric, errors="coerce")
    close = close.loc[:, [t for t in tickers if t in close.columns]]
    close = close.dropna(how="all").ffill(limit=3).dropna(how="all")
    if close.shape[1] < 2:
        raise RuntimeError(f"有效资产数量不足：{list(close.columns)}")
    return close


def build_panel(prices: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Create per-asset samples; each row is a decision after that day's close."""
    returns = prices.pct_change(fill_method=None)
    cross_mean = returns.mean(axis=1)
    cross_std = returns.std(axis=1)
    rows: list[pd.DataFrame] = []
    for ticker in prices.columns:
        p = prices[ticker]
        r = returns[ticker]
        f = pd.DataFrame(index=prices.index)
        f["ret_1d"] = r
        f["ret_5d"] = p.pct_change(5, fill_method=None)
        f["ret_20d"] = p.pct_change(20, fill_method=None)
        f["vol_20d"] = r.rolling(20, min_periods=20).std() * np.sqrt(252)
        f["trend_60d"] = p / p.rolling(60, min_periods=60).mean() - 1.0
        f["market_ret_1d"] = returns["SPY"] if "SPY" in returns else cross_mean
        f["cross_asset_mean_1d"] = cross_mean
        f["cross_asset_std_1d"] = cross_std
        f["ticker"] = ticker
        f["target"] = p.shift(-HORIZON) / p - 1.0
        f["asset_return"] = r
        rows.append(f.reset_index(names="date"))
    panel = pd.concat(rows, ignore_index=True).rename(columns={"index": "date"})
    panel["date"] = pd.to_datetime(panel["date"])
    panel = panel.replace([np.inf, -np.inf], np.nan)
    panel = panel.dropna(subset=FEATURE_COLUMNS + ["target", "asset_return"]).sort_values(["date", "ticker"])
    return panel.reset_index(drop=True), returns


def make_windows(panel: pd.DataFrame, lookback: int = LOOKBACK):
    """Build windows within each asset. Window ends at decision date; target is future H-day return."""
    x_rows, y_rows, meta = [], [], []
    for ticker, g in panel.groupby("ticker", sort=False):
        g = g.sort_values("date").reset_index(drop=True)
        feats = g[FEATURE_COLUMNS].to_numpy(dtype=np.float32)
        target = g["target"].to_numpy(dtype=np.float32)
        for i in range(lookback - 1, len(g)):
            x_rows.append(feats[i - lookback + 1:i + 1])
            y_rows.append(target[i])
            meta.append((g.loc[i, "date"], ticker, float(g.loc[i, "asset_return"]), float(target[i]), float(g.loc[i, "ret_20d"])))
    if not x_rows:
        raise RuntimeError("样本不足以构造序列。请扩大日期范围或缩短 LOOKBACK。")
    x = np.stack(x_rows)
    y = np.asarray(y_rows, dtype=np.float32)
    m = pd.DataFrame(meta, columns=["date", "ticker", "daily_return", "target", "momentum_20d"])
    m["date"] = pd.to_datetime(m["date"])
    return x, y, m


class GRURegressor(nn.Module):
    def __init__(self, n_features: int, hidden: int = 32):
        super().__init__()
        self.gru = nn.GRU(input_size=n_features, hidden_size=hidden, batch_first=True)
        self.head = nn.Sequential(nn.Linear(hidden, 16), nn.ReLU(), nn.Linear(16, 1))

    def forward(self, x):
        out, _ = self.gru(x)
        return self.head(out[:, -1, :]).squeeze(-1)


def regression_metrics(y: np.ndarray, pred: np.ndarray) -> dict[str, float]:
    mask = np.isfinite(y) & np.isfinite(pred)
    y, pred = y[mask], pred[mask]
    if len(y) == 0:
        return {"mae": float("nan"), "rmse": float("nan"), "direction_accuracy": float("nan")}
    return {
        "mae": float(np.mean(np.abs(y - pred))),
        "rmse": float(np.sqrt(np.mean((y - pred) ** 2))),
        "direction_accuracy": float(np.mean(np.sign(y) == np.sign(pred))),
    }


def daily_rank_ic(frame: pd.DataFrame, prediction_col: str) -> float:
    vals = []
    for _, g in frame.groupby("date"):
        if len(g) >= 3 and g[prediction_col].nunique() > 1 and g["target"].nunique() > 1:
            vals.append(g[prediction_col].corr(g["target"], method="spearman"))
    return float(np.nanmean(vals)) if vals else float("nan")


def backtest(frame: pd.DataFrame, prediction_col: str, cost_bps: float = 5.0, top_k: int = 2) -> tuple[pd.DataFrame, dict]:
    """Signal at close t; selected holdings earn close-to-close return from t to t+1."""
    f = frame.sort_values(["date", "ticker"]).copy()
    dates = sorted(f["date"].unique())
    daily = []
    previous: set[str] = set()
    for i, date in enumerate(dates[:-1]):
        today = f[f["date"] == date].copy()
        next_date = dates[i + 1]
        tomorrow = f[f["date"] == next_date][["ticker", "daily_return"]].set_index("ticker")["daily_return"]
        ranked = today.dropna(subset=[prediction_col]).sort_values(prediction_col, ascending=False)
        selected = set(ranked.head(top_k)["ticker"])
        if not selected:
            continue
        held = tomorrow.reindex(sorted(selected)).dropna()
        if held.empty:
            continue
        turnover = len(selected.symmetric_difference(previous)) / max(2 * top_k, 1)
        gross = float(held.mean())
        net = gross - (cost_bps / 10000.0) * turnover
        daily.append({"date": pd.Timestamp(next_date), "gross_return": gross, "net_return": net, "turnover": turnover,
                      "holdings": ",".join(sorted(selected))})
        previous = selected
    curve = pd.DataFrame(daily)
    if curve.empty:
        return curve, {}
    curve["equity"] = (1.0 + curve["net_return"]).cumprod()
    curve["peak"] = curve["equity"].cummax()
    curve["drawdown"] = curve["equity"] / curve["peak"] - 1.0
    n = len(curve)
    total = float(curve["equity"].iloc[-1] - 1.0)
    ann_return = float(curve["equity"].iloc[-1] ** (252.0 / n) - 1.0) if curve["equity"].iloc[-1] > 0 else float("nan")
    vol = float(curve["net_return"].std(ddof=1) * np.sqrt(252)) if n > 1 else float("nan")
    sharpe = float(curve["net_return"].mean() / curve["net_return"].std(ddof=1) * np.sqrt(252)) if n > 1 and curve["net_return"].std(ddof=1) > 0 else float("nan")
    stats = {
        "total_return": total, "annualized_return": ann_return, "annualized_volatility": vol,
        "sharpe_rf0": sharpe, "max_drawdown": float(curve["drawdown"].min()),
        "mean_daily_turnover": float(curve["turnover"].mean()), "observations": int(n),
    }
    return curve, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", default="2012-01-01")
    ap.add_argument("--end", default="2026-01-01", help="Exclusive end date, following yfinance convention.")
    ap.add_argument("--tickers", nargs="+", default=TICKERS_DEFAULT)
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--batch-size", type=int, default=256)
    ap.add_argument("--cost-bps", type=float, default=5.0, help="One-way turnover cost in basis points.")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="auto")
    ap.add_argument("--output-dir", default="outputs")
    args = ap.parse_args()

    set_seed(args.seed)
    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    tickers = list(dict.fromkeys(args.tickers))
    if "SPY" not in tickers:
        tickers.append("SPY")

    print(f"Downloading {tickers} from {args.start} to {args.end} (exclusive end)...")
    prices = download_prices(tickers, args.start, args.end)
    panel, daily_returns = build_panel(prices)
    x, y, meta = make_windows(panel)
    dates = np.array(sorted(meta["date"].unique()))
    if len(dates) < 500:
        print(f"Warning: only {len(dates)} distinct decision dates; interpret metrics cautiously.")
    train_end = dates[int(len(dates) * 0.70)]
    val_end = dates[int(len(dates) * 0.85)]
    train_mask = meta["date"] < pd.Timestamp(train_end)
    val_mask = (meta["date"] >= pd.Timestamp(train_end)) & (meta["date"] < pd.Timestamp(val_end))
    test_mask = meta["date"] >= pd.Timestamp(val_end)
    # Purge samples whose forward 5-day label overlaps the next split boundary.
    train_mask &= meta["date"] < (pd.Timestamp(train_end) - pd.offsets.BDay(HORIZON))
    val_mask &= meta["date"] < (pd.Timestamp(val_end) - pd.offsets.BDay(HORIZON))
    if train_mask.sum() < 100 or val_mask.sum() < 30 or test_mask.sum() < 30:
        raise RuntimeError("训练/验证/测试样本不足，请使用更长日期范围。")

    x_train, x_val, x_test = x[train_mask], x[val_mask], x[test_mask]
    y_train, y_val, y_test = y[train_mask], y[val_mask], y[test_mask]
    # Fit scaling on training rows only. Apply same transform to all time steps.
    scaler = StandardScaler()
    scaler.fit(x_train.reshape(-1, x_train.shape[-1]))
    def scale(arr):
        return scaler.transform(arr.reshape(-1, arr.shape[-1])).reshape(arr.shape).astype(np.float32)
    x_train, x_val, x_test = scale(x_train), scale(x_val), scale(x_test)

    # Baselines: zero return, simple 20-day momentum, and Ridge on the last-day features.
    meta_train, meta_val, meta_test = meta[train_mask].copy(), meta[val_mask].copy(), meta[test_mask].copy()
    preds = pd.DataFrame({
        "date": meta_test["date"].to_numpy(),
        "ticker": meta_test["ticker"].to_numpy(),
        "target": y_test,
        "daily_return": meta_test["daily_return"].to_numpy(),
        "momentum_20d": meta_test["momentum_20d"].to_numpy(),
        "zero_pred": np.zeros_like(y_test),
        "momentum_pred": meta_test["momentum_20d"].to_numpy(),
    })
    ridge = Ridge(alpha=10.0)
    ridge.fit(x_train[:, -1, :], y_train)
    preds["ridge_pred"] = ridge.predict(x_test[:, -1, :])

    device_name = args.device
    if device_name == "auto":
        device_name = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
    device = torch.device(device_name)
    model = GRURegressor(len(FEATURE_COLUMNS)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_fn = nn.HuberLoss()
    loader = DataLoader(TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train)), batch_size=args.batch_size, shuffle=True)
    best_val, best_state = float("inf"), None
    patience, stale = 3, 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(xb), yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        model.eval()
        with torch.no_grad():
            val_pred = model(torch.from_numpy(x_val).to(device)).cpu().numpy()
        val_mae = float(np.mean(np.abs(val_pred - y_val)))
        print(f"epoch={epoch:02d} train_huber={np.mean(losses):.6f} val_mae={val_mae:.6f} device={device}")
        if val_mae < best_val:
            best_val, best_state, stale = val_mae, {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}, 0
        else:
            stale += 1
            if stale >= patience:
                print("Early stopping on validation MAE.")
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        preds["gru_pred"] = model(torch.from_numpy(x_test).to(device)).cpu().numpy()

    # Evaluate forecasts on the same out-of-time test samples.
    metric_rows = []
    for name in ["zero_pred", "momentum_pred", "ridge_pred", "gru_pred"]:
        row = {"model": name, **regression_metrics(preds["target"].to_numpy(), preds[name].to_numpy()),
               "daily_rank_ic": daily_rank_ic(preds.rename(columns={name: "prediction"}), "prediction")}
        metric_rows.append(row)
    metrics = pd.DataFrame(metric_rows)
    metrics.to_csv(outdir / "forecast_metrics.csv", index=False)
    preds.to_csv(outdir / "test_predictions.csv", index=False)

    curves, backtest_summary = {}, {}
    for name in ["momentum_pred", "ridge_pred", "gru_pred"]:
        curve, stats = backtest(preds, name, cost_bps=args.cost_bps)
        if not curve.empty:
            curve.to_csv(outdir / f"backtest_{name}.csv", index=False)
        backtest_summary[name] = stats
    # Benchmarks over the same test date range: equal-weight available ETFs and SPY.
    test_dates = sorted(preds["date"].unique())
    test_prices = prices.reindex(pd.to_datetime(test_dates))
    test_ret = test_prices.pct_change(fill_method=None).fillna(0.0)
    if "SPY" in test_ret:
        spy_curve = (1 + test_ret["SPY"]).cumprod()
        spy_curve.rename("equity").to_frame().to_csv(outdir / "benchmark_spy.csv")
    equal_ret = test_ret.mean(axis=1)
    ((1 + equal_ret).cumprod()).rename("equity").to_frame().to_csv(outdir / "benchmark_equal_weight.csv")

    summary = {
        "date_range": {"start": str(prices.index.min().date()), "end": str(prices.index.max().date())},
        "tickers": list(prices.columns), "lookback_days": LOOKBACK, "forecast_horizon_days": HORIZON,
        "cost_bps_one_way": args.cost_bps, "device": str(device), "seed": args.seed,
        "forecast_metrics": metric_rows, "backtests": backtest_summary,
        "limitations": [
            "Educational example, not investment advice.",
            "Yahoo Finance data and the selected ETF universe are not point-in-time institutional datasets.",
            "The strategy is a simplified ranking illustration; it omits realistic execution, spreads, market impact, taxes and capacity.",
            "Historical results are not evidence of future profitability."
        ],
    }
    (outdir / "summary.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    print("\nForecast metrics (out-of-time test):")
    print(metrics.to_string(index=False))
    print(f"\nOutputs written to: {outdir.resolve()}")
    print("Read summary.json and inspect turnover/cost sensitivity before interpreting any backtest.")


if __name__ == "__main__":
    main()
