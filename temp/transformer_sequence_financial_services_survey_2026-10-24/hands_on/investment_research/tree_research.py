#!/usr/bin/env python3
"""Educational ETF forecast using histogram gradient-boosted trees; not investment advice."""
from __future__ import annotations
import argparse, json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from research import FEATURE_COLUMNS, HORIZON, TICKERS_DEFAULT, backtest, build_panel, daily_rank_ic, download_prices, regression_metrics

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", default="2012-01-01")
    ap.add_argument("--end", default="2026-01-01", help="Exclusive end date.")
    ap.add_argument("--tickers", nargs="+", default=TICKERS_DEFAULT)
    ap.add_argument("--cost-bps", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--output-dir", default="outputs/hist_gradient_boosting")
    args = ap.parse_args()
    out = Path(args.output_dir); out.mkdir(parents=True, exist_ok=True)
    tickers = list(dict.fromkeys(args.tickers))
    if "SPY" not in tickers: tickers.append("SPY")
    prices = download_prices(tickers, args.start, args.end)
    panel, _ = build_panel(prices)
    dates = np.array(sorted(panel.date.unique()))
    if len(dates) < 500: print(f"Warning: only {len(dates)} dates; interpret cautiously.")
    train_end, val_end = pd.Timestamp(dates[int(len(dates)*.70)]), pd.Timestamp(dates[int(len(dates)*.85)])
    train = panel[panel.date < train_end].copy()
    val = panel[(panel.date >= train_end) & (panel.date < val_end)].copy()
    test = panel[panel.date >= val_end].copy()
    # Purge labels whose forward horizon overlaps a split boundary.
    train = train[train.date < train_end - pd.offsets.BDay(HORIZON)]
    val = val[val.date < val_end - pd.offsets.BDay(HORIZON)]
    if min(len(train), len(val), len(test)) < 100:
        raise RuntimeError("Insufficient samples; use a longer date range.")
    xtr, ytr = train[FEATURE_COLUMNS], train.target.to_numpy()
    xva, yva = val[FEATURE_COLUMNS], val.target.to_numpy()
    xte, yte = test[FEATURE_COLUMNS], test.target.to_numpy()
    # Trees learn nonlinear feature interactions and do not need standardization.
    model = make_pipeline(
        SimpleImputer(strategy="median"),
        HistGradientBoostingRegressor(
            learning_rate=.05, max_iter=250, max_leaf_nodes=15,
            min_samples_leaf=30, l2_regularization=1.0,
            early_stopping=True, validation_fraction=.15,
            n_iter_no_change=15, random_state=args.seed,
        ),
    )
    model.fit(xtr, ytr)
    val_pred, test_pred = model.predict(xva), model.predict(xte)
    print("Validation metrics:", regression_metrics(yva, val_pred))
    preds = test[["date", "ticker", "target", "asset_return", "ret_20d"]].copy()
    preds.rename(columns={"asset_return":"daily_return","ret_20d":"momentum_20d"}, inplace=True)
    preds["zero_pred"] = 0.0
    preds["momentum_pred"] = preds.momentum_20d
    preds["hist_gbr_pred"] = test_pred
    preds.to_csv(out / "test_predictions.csv", index=False)
    metric_rows = []
    for name in ["zero_pred", "momentum_pred", "hist_gbr_pred"]:
        metric_rows.append({"model":name, **regression_metrics(preds.target.to_numpy(), preds[name].to_numpy()),
            "daily_rank_ic":daily_rank_ic(preds.rename(columns={name:"prediction"}), "prediction")})
    metrics = pd.DataFrame(metric_rows); metrics.to_csv(out / "forecast_metrics.csv", index=False)
    backtests = {}
    for name in ["momentum_pred", "hist_gbr_pred"]:
        curve, stats = backtest(preds, name, cost_bps=args.cost_bps)
        if not curve.empty: curve.to_csv(out / f"backtest_{name}.csv", index=False)
        backtests[name] = stats
    summary = {
        "model":"HistGradientBoostingRegressor",
        "date_range":{"start":str(prices.index.min().date()),"end":str(prices.index.max().date())},
        "tickers":list(prices.columns),"features":FEATURE_COLUMNS,"forecast_horizon_days":HORIZON,
        "cost_bps_one_way":args.cost_bps,"validation_metrics":regression_metrics(yva,val_pred),
        "forecast_metrics":metric_rows,"backtests":backtests,
        "limitations":["Educational example, not investment advice.",
          "Public Yahoo Finance data and fixed ETF universe are not point-in-time institutional data.",
          "Single chronological split; use walk-forward validation and cost sensitivity for serious research.",
          "Simplified backtest omits realistic execution, spreads, market impact, taxes and capacity.",
          "Historical results do not establish future profitability."]
    }
    (out/"summary.json").write_text(json.dumps(summary,indent=2,default=str),encoding="utf-8")
    print("\nOut-of-time forecast metrics:"); print(metrics.to_string(index=False))
    print(f"\nOutputs written to: {out.resolve()}")

if __name__ == "__main__": main()
