#!/usr/bin/env python3
"""Educational point-in-time-ish bank fundamentals sequence classifier using SEC Company Facts.

Predicts whether a bank's next reported quarterly net income is higher than its
previous reported quarter, using only historical financial facts. This is a
research exercise, not an investment signal. SEC facts can be restated; a full
production pipeline must retain filing-version history and use only facts filed
by each decision date.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import torch
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

COMPANIES = {
    "JPM": "0000019617",
    "BAC": "0000070858",
    "GS": "0000886982",
    "MS": "0000895421",
    "WFC": "0000072971",
    "C": "0000831001",
}
TAGS = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "InterestAndDividendIncomeOperating"],
    "net_income": ["NetIncomeLoss"],
    "assets": ["Assets"],
    "liabilities": ["Liabilities"],
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities"],
}
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")


def get_json(url: str, user_agent: str) -> dict:
    response = requests.get(url, headers={"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"}, timeout=45)
    response.raise_for_status()
    return response.json()


def quarterly_facts(companyfacts: dict) -> pd.DataFrame:
    """Extract standalone quarterly values from SEC duration facts; use filed date for availability."""
    facts = companyfacts.get("facts", {}).get("us-gaap", {})
    rows = []
    for feature, candidate_tags in TAGS.items():
        tag = next((t for t in candidate_tags if t in facts), None)
        if not tag:
            continue
        units = facts[tag].get("units", {})
        unit = "USD" if "USD" in units else next(iter(units), None)
        if not unit:
            continue
        for item in units[unit]:
            if item.get("form") not in {"10-Q", "10-K"} or not item.get("end") or not item.get("filed"):
                continue
            start, end = item.get("start"), item["end"]
            # Duration concepts only; instantaneous balance-sheet concepts are kept as reported.
            rows.append({"feature": feature, "start": start, "end": end, "filed": item["filed"],
                         "value": item.get("val"), "fp": item.get("fp"), "form": item.get("form"),
                         "fy": item.get("fy"), "frame": item.get("frame")})
    if not rows:
        return pd.DataFrame()
    raw = pd.DataFrame(rows).dropna(subset=["value", "end", "filed"])
    out = []
    for feature, group in raw.groupby("feature"):
        # Deduplicate amended/repeated facts for identical start/end periods, keeping the latest filing.
        group = group.sort_values("filed").drop_duplicates(["start", "end"], keep="last")
        for _, row in group.iterrows():
            value = float(row["value"])
            start, end = row["start"], row["end"]
            if start:
                days = (pd.Timestamp(end) - pd.Timestamp(start)).days + 1
                # SEC YTD duration values are converted to standalone quarter values by subtracting
                # the previous YTD value for the same fiscal year. Annual Q4 is annual minus 9M.
                if days > 120:
                    prev = group[(group["fy"] == row["fy"]) & (group["end"] < end) &
                                 (group["start"].notna())].sort_values("end")
                    if not prev.empty:
                        prior = prev.iloc[-1]
                        prior_days = (pd.Timestamp(prior["end"]) - pd.Timestamp(prior["start"])).days + 1
                        if prior_days < days and prior_days < 330:
                            value -= float(prior["value"])
                        elif days > 330:
                            ytd = prev[prev.apply(lambda r: (pd.Timestamp(r["end"]) - pd.Timestamp(r["start"])).days + 1 < 330, axis=1)]
                            if not ytd.empty:
                                value -= float(ytd.iloc[-1]["value"])
            out.append({"feature": feature, "date": end, "filed": row["filed"], "value": value})
    long = pd.DataFrame(out)
    if long.empty:
        return long
    # For each period, keep the latest available filing per metric. Production use must preserve
    # each as-of vintage; this compact teaching dataset uses reported period-end snapshots.
    return long.sort_values("filed").drop_duplicates(["feature", "date"], keep="last")


def download_panel(user_agent: str) -> pd.DataFrame:
    panel = []
    for ticker, cik in COMPANIES.items():
        url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
        print(f"Downloading SEC Company Facts: {ticker}")
        payload = get_json(url, user_agent)
        facts = quarterly_facts(payload)
        if facts.empty:
            print(f"  no supported facts found for {ticker}")
            continue
        wide = facts.pivot_table(index="date", columns="feature", values="value", aggfunc="last").reset_index()
        wide["ticker"] = ticker
        panel.append(wide)
        time.sleep(0.15)  # be polite to SEC endpoints
    if not panel:
        raise RuntimeError("No SEC facts downloaded. Check network access and SEC User-Agent.")
    data = pd.concat(panel, ignore_index=True).sort_values(["ticker", "date"])
    for col in TAGS:
        if col not in data:
            data[col] = np.nan
    data["date"] = pd.to_datetime(data["date"])
    data["net_income_growth"] = data.groupby("ticker")["net_income"].pct_change()
    data["target"] = (data.groupby("ticker")["net_income"].shift(-1) >
                      data["net_income"]).astype("float")
    data.loc[data.groupby("ticker")["net_income"].shift(-1).isna(), "target"] = np.nan
    # Ratios are scale-normalized and more interpretable across banks.
    data["net_income_to_assets"] = data["net_income"] / data["assets"].replace(0, np.nan)
    data["liabilities_to_assets"] = data["liabilities"] / data["assets"].replace(0, np.nan)
    data["revenue_to_assets"] = data["revenue"] / data["assets"].replace(0, np.nan)
    data["ocf_to_assets"] = data["operating_cash_flow"] / data["assets"].replace(0, np.nan)
    feature_cols = ["net_income_growth", "net_income_to_assets", "liabilities_to_assets",
                    "revenue_to_assets", "ocf_to_assets"]
    for col in feature_cols:
        data[col] = data.groupby("ticker")[col].transform(lambda s: s.replace([np.inf, -np.inf], np.nan))
        data[col] = data.groupby("ticker")[col].transform(lambda s: s.fillna(s.median()))
    data[feature_cols] = data[feature_cols].replace([np.inf, -np.inf], np.nan).fillna(0).clip(-10, 10)
    data = data.dropna(subset=["target"]).copy()
    data["target"] = data["target"].astype(int)
    return data, feature_cols


class FundamentalsTransformer(nn.Module):
    def __init__(self, n_features: int, d_model: int = 32, heads: int = 4, layers: int = 2, window: int = 8):
        super().__init__()
        self.input_projection = nn.Linear(n_features, d_model)
        self.position = nn.Parameter(torch.zeros(1, window, d_model))
        block = nn.TransformerEncoderLayer(d_model=d_model, nhead=heads, dim_feedforward=64,
                                           dropout=0.1, batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(block, num_layers=layers)
        self.head = nn.Sequential(nn.LayerNorm(d_model), nn.Linear(d_model, 2))

    def forward(self, x):
        x = self.input_projection(x) + self.position[:, :x.shape[1]]
        return self.head(self.encoder(x)[:, -1])


def make_windows(data: pd.DataFrame, features: list[str], window: int):
    X, y, dates = [], [], []
    for _, group in data.sort_values("date").groupby("ticker"):
        group = group.sort_values("date").reset_index(drop=True)
        values = group[features].to_numpy(dtype=np.float32)
        labels = group["target"].to_numpy(dtype=np.int64)
        for i in range(window - 1, len(group)):
            X.append(values[i-window+1:i+1])
            y.append(labels[i])
            dates.append(group.loc[i, "date"])
    return np.asarray(X, dtype=np.float32), np.asarray(y), np.asarray(dates, dtype="datetime64[ns]")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-agent", default="InvestmentResearchTutorial contact@example.com",
                        help="SEC requires a descriptive User-Agent; replace with your name/email.")
    parser.add_argument("--window", type=int, default=8)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--output-dir", default="outputs/bank_fundamentals")
    args = parser.parse_args()
    out = Path(args.output_dir); out.mkdir(parents=True, exist_ok=True)
    panel, features = download_panel(args.user_agent)
    panel.to_csv(out / "sec_bank_fundamentals.csv", index=False)
    X, y, dates = make_windows(panel, features, args.window)
    order = np.argsort(dates); X, y, dates = X[order], y[order], dates[order]
    # Strict chronological split with a one-sample purge around boundaries.
    n = len(y); a, b = int(n * .65), int(n * .82)
    train_idx = np.arange(0, max(0, a-1)); val_idx = np.arange(min(n, a+1), max(a+1, b-1))
    test_idx = np.arange(min(n, b+1), n)
    if min(len(train_idx), len(val_idx), len(test_idx)) == 0:
        raise RuntimeError("Not enough quarterly samples. Expand the sample or reduce the window.")
    scaler = StandardScaler()
    scaler.fit(X[train_idx].reshape(-1, X.shape[-1]))
    X = scaler.transform(X.reshape(-1, X.shape[-1])).reshape(X.shape).astype(np.float32)
    def loader(idx, shuffle=False):
        return DataLoader(TensorDataset(torch.tensor(X[idx]), torch.tensor(y[idx])),
                          batch_size=32, shuffle=shuffle)
    model = FundamentalsTransformer(X.shape[-1], window=args.window).to(DEVICE)
    counts = np.bincount(y[train_idx], minlength=2)
    weights = torch.tensor(len(train_idx) / (2 * np.maximum(counts, 1)), dtype=torch.float32, device=DEVICE)
    loss_fn = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    best, best_state, patience = float("inf"), None, 0
    for epoch in range(args.epochs):
        model.train()
        for xb, yb in loader(train_idx, True):
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            optimizer.zero_grad(); loss = loss_fn(model(xb), yb); loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
        model.eval(); losses = []
        with torch.no_grad():
            for xb, yb in loader(val_idx):
                losses.append(loss_fn(model(xb.to(DEVICE)), yb.to(DEVICE)).item())
        val_loss = float(np.mean(losses))
        print(f"epoch={epoch+1:02d} val_loss={val_loss:.4f}")
        if val_loss < best:
            best, patience = val_loss, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 5: break
    if best_state: model.load_state_dict(best_state)
    model.eval(); probs=[]
    with torch.no_grad():
        for xb, _ in loader(test_idx):
            probs.extend(torch.softmax(model(xb.to(DEVICE)), dim=1)[:, 1].cpu().numpy())
    pred = (np.asarray(probs) >= .5).astype(int)
    report = {"device": str(DEVICE), "n_samples": int(n), "train_samples": len(train_idx),
              "validation_samples": len(val_idx), "test_samples": len(test_idx),
              "accuracy": float(accuracy_score(y[test_idx], pred)),
              "balanced_accuracy": float(balanced_accuracy_score(y[test_idx], pred)),
              "classification_report": classification_report(y[test_idx], pred, output_dict=True, zero_division=0),
              "note": "Exploratory only. Company Facts may contain restatements and the compact panel is not a full filing-vintage database."}
    pd.DataFrame({"date": dates[test_idx], "actual_next_quarter_income_up": y[test_idx],
                  "predicted_probability": probs, "prediction": pred}).to_csv(out / "test_predictions.csv", index=False)
    (out / "summary.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k != "classification_report"}, indent=2))


if __name__ == "__main__":
    main()
