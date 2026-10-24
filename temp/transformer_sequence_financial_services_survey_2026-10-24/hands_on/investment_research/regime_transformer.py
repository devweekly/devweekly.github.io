#!/usr/bin/env python3
"""Transformer classifier for forward SPY market regimes; educational only."""
from __future__ import annotations
import argparse, json, random
from pathlib import Path
import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import classification_report, confusion_matrix, balanced_accuracy_score
from sklearn.preprocessing import StandardScaler
from research import TICKERS_DEFAULT, download_prices

LOOKBACK=60
HORIZON=20
FEATURES=["spy_ret_1d","spy_ret_5d","spy_ret_20d","spy_vol_20d","spy_vol_60d",
          "spy_trend_20d","spy_trend_60d","cross_asset_mean","cross_asset_vol","tlt_ret_5d","gld_ret_5d","qqq_ret_5d"]

def seed_all(seed):
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)

def make_data(prices):
    rets=prices.pct_change(fill_method=None)
    if "SPY" not in prices: raise RuntimeError("SPY is required as the regime reference.")
    spy=prices["SPY"]; r=rets["SPY"]
    f=pd.DataFrame(index=prices.index)
    f["spy_ret_1d"]=r; f["spy_ret_5d"]=spy.pct_change(5,fill_method=None); f["spy_ret_20d"]=spy.pct_change(20,fill_method=None)
    f["spy_vol_20d"]=r.rolling(20).std()*np.sqrt(252); f["spy_vol_60d"]=r.rolling(60).std()*np.sqrt(252)
    f["spy_trend_20d"]=spy/spy.rolling(20).mean()-1; f["spy_trend_60d"]=spy/spy.rolling(60).mean()-1
    f["cross_asset_mean"]=rets.mean(axis=1); f["cross_asset_vol"]=rets.std(axis=1)*np.sqrt(252)
    for ticker in ["TLT","GLD","QQQ"]:
        f[f"{ticker.lower()}_ret_5d"]=prices[ticker].pct_change(5,fill_method=None) if ticker in prices else 0.0
    future=spy.shift(-HORIZON)/spy-1
    # Labels use a fixed, interpretable threshold and only future outcomes; features are past-only.
    f["target"]=np.select([future>=0.03,future<=-0.03],[2,0],default=1)
    f["future_return"]=future
    f=f.replace([np.inf,-np.inf],np.nan).dropna(subset=FEATURES+["future_return"])
    return f,FEATURES

def make_windows(frame,features):
    xs=[]; ys=[]; meta=[]
    a=frame[features].to_numpy(dtype=np.float32); y=frame.target.to_numpy(dtype=np.int64)
    for i in range(LOOKBACK-1,len(frame)):
        xs.append(a[i-LOOKBACK+1:i+1]); ys.append(y[i])
        meta.append((frame.index[i],int(y[i]),float(frame.future_return.iloc[i])))
    return np.stack(xs),np.asarray(ys,dtype=np.int64),pd.DataFrame(meta,columns=["date","target","future_return"])

class RegimeTransformer(nn.Module):
    def __init__(self,n_features,d_model=32,heads=4,layers=2):
        super().__init__(); self.input=nn.Linear(n_features,d_model)
        self.position=nn.Parameter(torch.zeros(1,LOOKBACK,d_model))
        layer=nn.TransformerEncoderLayer(d_model=d_model,nhead=heads,dim_feedforward=64,
            dropout=.1,batch_first=True,activation="gelu")
        self.encoder=nn.TransformerEncoder(layer,num_layers=layers,enable_nested_tensor=False)
        self.head=nn.Sequential(nn.LayerNorm(d_model),nn.Linear(d_model,16),nn.GELU(),nn.Linear(16,3))
    def forward(self,x): return self.head(self.encoder(self.input(x)+self.position[:,:x.size(1)])[:,-1])

def main():
    ap=argparse.ArgumentParser(description=__doc__); ap.add_argument("--start",default="2012-01-01")
    ap.add_argument("--end",default="2026-01-01"); ap.add_argument("--tickers",nargs="+",default=TICKERS_DEFAULT)
    ap.add_argument("--epochs",type=int,default=12); ap.add_argument("--batch-size",type=int,default=256)
    ap.add_argument("--seed",type=int,default=42); ap.add_argument("--device",choices=["auto","cpu","mps","cuda"],default="auto")
    ap.add_argument("--output-dir",default="outputs/regime_transformer"); args=ap.parse_args()
    seed_all(args.seed); out=Path(args.output_dir); out.mkdir(parents=True,exist_ok=True)
    tickers=list(dict.fromkeys(args.tickers))
    for t in ["SPY","TLT","GLD","QQQ"]:
        if t not in tickers: tickers.append(t)
    prices=download_prices(tickers,args.start,args.end); frame,features=make_data(prices)
    x,y,meta=make_windows(frame,features); dates=np.array(sorted(meta.date.unique()))
    train_end=pd.Timestamp(dates[int(len(dates)*.70)]); val_end=pd.Timestamp(dates[int(len(dates)*.85)])
    tr=(meta.date<train_end-pd.offsets.BDay(HORIZON)).to_numpy()
    va=((meta.date>=train_end)&(meta.date<val_end-pd.offsets.BDay(HORIZON))).to_numpy()
    te=(meta.date>=val_end).to_numpy()
    if tr.sum()<100 or va.sum()<30 or te.sum()<30: raise RuntimeError("Insufficient data; widen the date range.")
    scaler=StandardScaler().fit(x[tr].reshape(-1,x.shape[-1]))
    def transform(a): return scaler.transform(a.reshape(-1,a.shape[-1])).reshape(a.shape).astype(np.float32)
    xt,xv,xe=transform(x[tr]),transform(x[va]),transform(x[te]); yt,yv,ye=y[tr],y[va],y[te]
    counts=np.bincount(yt,minlength=3); weights=counts.sum()/np.maximum(counts,1); weights=weights/weights.mean()
    device=args.device
    if device=="auto": device="cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
    device=torch.device(device); model=RegimeTransformer(len(features)).to(device)
    opt=torch.optim.AdamW(model.parameters(),lr=1e-3,weight_decay=1e-4)
    loss_fn=nn.CrossEntropyLoss(weight=torch.tensor(weights,dtype=torch.float32,device=device))
    loader=DataLoader(TensorDataset(torch.from_numpy(xt),torch.from_numpy(yt)),batch_size=args.batch_size,shuffle=True)
    best=-1; best_state=None; stale=0
    for epoch in range(1,args.epochs+1):
        model.train(); losses=[]
        for xb,yb in loader:
            xb,yb=xb.to(device),yb.to(device); opt.zero_grad(set_to_none=True)
            loss=loss_fn(model(xb),yb); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(),1.0); opt.step()
            losses.append(float(loss.detach().cpu()))
        model.eval()
        with torch.no_grad(): pv=model(torch.from_numpy(xv).to(device)).argmax(1).cpu().numpy()
        score=balanced_accuracy_score(yv,pv); print(f"epoch={epoch:02d} train_loss={np.mean(losses):.5f} val_balanced_accuracy={score:.4f}")
        if score>best:
            best=score; best_state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}; stale=0
        else:
            stale+=1
            if stale>=3: print("Early stopping."); break
    if best_state: model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad(): probs=torch.softmax(model(torch.from_numpy(xe).to(device)),dim=1).cpu().numpy()
    pred=probs.argmax(axis=1); labels=["bear/risk-off","sideways","bull/risk-on"]
    report=classification_report(ye,pred,labels=[0,1,2],target_names=labels,output_dict=True,zero_division=0)
    result=meta.loc[te].copy(); result["predicted_regime"]=pred
    for i,label in enumerate(labels): result[f"prob_{label.replace('/','_').replace('-','_')}"]=probs[:,i]
    result.to_csv(out/"regime_predictions.csv",index=False)
    cm=confusion_matrix(ye,pred,labels=[0,1,2]).tolist()
    summary={"labels":{"0":"bear/risk-off: next 20-session SPY return <= -3%","1":"sideways: between -3% and +3%","2":"bull/risk-on: next 20-session SPY return >= +3%"},
      "balanced_accuracy":float(balanced_accuracy_score(ye,pred)),"classification_report":report,"confusion_matrix_labels":labels,
      "confusion_matrix":cm,"features":features,"n_test":int(len(ye)),
      "limitations":["Regime labels are rule-defined outcomes, not objective market truths.",
       "Fixed thresholds may create class imbalance and overlap of adjacent 20-day outcomes.",
       "Single chronological split; use purged walk-forward evaluation before any portfolio use.",
       "Model probabilities are not calibrated without additional validation."]}
    (out/"summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    print(json.dumps({"balanced_accuracy":summary["balanced_accuracy"],"classification_report":report,"confusion_matrix":cm},indent=2))
if __name__=="__main__": main()
