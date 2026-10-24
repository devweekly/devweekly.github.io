"""PaySim temporal fraud baseline and small GRU sequence model (educational only)."""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, Dataset

NUMERIC = ["amount", "oldbalanceOrg", "newbalanceOrig", "oldbalanceDest", "newbalanceDest"]
REQUIRED = ["step", "type", "nameOrig", "isFraud"] + NUMERIC


def metrics(y, score):
    y = np.asarray(y).astype(int)
    score = np.asarray(score)
    out = {"rows": len(y), "positive_rate": float(y.mean())}
    if len(np.unique(y)) < 2:
        out["warning"] = "Only one class present; AUC undefined."
        return out
    out["pr_auc"] = float(average_precision_score(y, score))
    out["roc_auc"] = float(roc_auc_score(y, score))
    n = max(1, int(np.ceil(len(y) * 0.01)))
    top = np.argpartition(score, -n)[-n:]
    out["recall_at_1pct_review_budget"] = float(y[top].sum() / max(1, y.sum()))
    out["precision_at_1pct_review_budget"] = float(y[top].mean())
    return out


class Rows(Dataset):
    def __init__(self, x, y):
        self.x, self.y = torch.tensor(x, dtype=torch.float32), torch.tensor(y, dtype=torch.float32)
    def __len__(self):
        return len(self.y)
    def __getitem__(self, i):
        return self.x[i], self.y[i]


class GRU(nn.Module):
    def __init__(self, n_features, hidden):
        super().__init__()
        self.rnn = nn.GRU(n_features, hidden, batch_first=True)
        self.head = nn.Linear(hidden, 1)
    def forward(self, x):
        _, h = self.rnn(x)
        return self.head(h[-1]).squeeze(-1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--model", choices=["baseline", "gru"], default="gru")
    ap.add_argument("--seq-len", type=int, default=20)
    ap.add_argument("--hidden-size", type=int, default=32)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch-size", type=int, default=512)
    ap.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="auto")
    ap.add_argument("--output-dir", type=Path, default=Path("outputs"))
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    df = pd.read_csv(args.data)
    missing = sorted(set(REQUIRED) - set(df.columns))
    if missing:
        raise ValueError(f"Missing columns: {missing}")
    df = df.sort_values("step", kind="stable").reset_index(drop=True)
    steps = np.sort(df.step.unique())
    train_cut, val_cut = steps[int(len(steps)*.70)], steps[int(len(steps)*.85)]
    splits = [df[df.step < train_cut].copy(), df[(df.step >= train_cut) & (df.step < val_cut)].copy(), df[df.step >= val_cut].copy()]
    if any(s.empty for s in splits):
        raise ValueError("Empty temporal split; check data coverage.")
    cats = sorted(splits[0].type.astype(str).unique())
    def features(frame):
        z = pd.DataFrame(index=frame.index)
        for c in NUMERIC:
            z[c] = np.log1p(frame[c].clip(lower=0).astype(float))
        z["step_scaled"] = frame.step.astype(float) / max(float(splits[0].step.max()), 1.0)
        for cat in cats:
            z["type_" + cat] = (frame.type.astype(str) == cat).astype(float)
        return z
    transformed = [features(s) for s in splits]
    cols = list(transformed[0].columns)
    scaler = StandardScaler().fit(transformed[0])
    transformed = [scaler.transform(x[cols]).astype(np.float32) for x in transformed]

    def sequences(frame, x):
        xs, ys = [], []
        for ids in frame.groupby("nameOrig", sort=False).indices.values():
            ids = np.asarray(ids, dtype=int)
            ids = ids[np.argsort(frame.iloc[ids].step.to_numpy(), kind="stable")]
            history = []
            for i in ids:
                history.append(x[i])
                h = history[-args.seq_len:]
                pad = np.zeros((args.seq_len, x.shape[1]), dtype=np.float32)
                pad[-len(h):] = np.stack(h)
                xs.append(pad); ys.append(float(frame.iloc[i].isFraud))
        return np.stack(xs), np.asarray(ys, dtype=np.float32)
    data = [sequences(f.reset_index(drop=True), x) for f, x in zip(splits, transformed)]
    # reset_index preserves row order; features were created from the same ordered split.
    device = torch.device(args.device if args.device != "auto" else ("cuda" if torch.cuda.is_available() else ("mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu")))
    print(json.dumps({"split_rows": [len(s) for s in splits], "time_cutoffs": [float(train_cut), float(val_cut)], "device": str(device)}, indent=2))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.model == "baseline":
        model = LogisticRegression(max_iter=300, class_weight="balanced", solver="liblinear")
        model.fit(data[0][0][:, -1, :], data[0][1])
        print("validation:", json.dumps(metrics(data[1][1], model.predict_proba(data[1][0][:, -1, :])[:, 1]), indent=2))
        result = metrics(data[2][1], model.predict_proba(data[2][0][:, -1, :])[:, 1])
        print("test:", json.dumps(result, indent=2))
        (args.output_dir / "baseline_metrics.json").write_text(json.dumps(result, indent=2))
        return
    model = GRU(len(cols), args.hidden_size).to(device)
    ytr = data[0][1]
    pos, neg = max(1., float(ytr.sum())), max(1., float(len(ytr)-ytr.sum()))
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([neg/pos], device=device))
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
    train_loader = DataLoader(Rows(*data[0]), batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(Rows(*data[1]), batch_size=args.batch_size)
    test_loader = DataLoader(Rows(*data[2]), batch_size=args.batch_size)
    best_ap, best = -1, None
    for epoch in range(1, args.epochs+1):
        model.train(); losses = []
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad(set_to_none=True); loss = loss_fn(model(xb), yb)
            loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step()
            losses.append(float(loss.detach().cpu()))
        model.eval(); ys=[]; scores=[]
        with torch.no_grad():
            for xb, yb in val_loader:
                scores.extend(torch.sigmoid(model(xb.to(device))).cpu().numpy())
                ys.extend(yb.numpy())
        vm = metrics(ys, scores)
        print(json.dumps({"epoch": epoch, "mean_loss": float(np.mean(losses)), "validation": vm}))
        if vm.get("pr_auc", -1) > best_ap:
            best_ap = vm.get("pr_auc", -1)
            best = {k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
    if best: model.load_state_dict(best)
    model.eval(); ys=[]; scores=[]
    with torch.no_grad():
        for xb, yb in test_loader:
            scores.extend(torch.sigmoid(model(xb.to(device))).cpu().numpy())
            ys.extend(yb.numpy())
    result = metrics(ys, scores)
    print("test:", json.dumps(result, indent=2))
    torch.save({"state_dict": model.cpu().state_dict(), "features": cols, "seq_len": args.seq_len, "hidden_size": args.hidden_size}, args.output_dir / "gru.pt")
    (args.output_dir / "gru_metrics.json").write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
