#!/usr/bin/env python3
"""Transformer forecast of forward realized volatility for a small ETF universe.

Educational research example; not investment advice.
"""
from __future__ import annotations
import argparse, json, random
from pathlib import Path
import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.preprocessing import StandardScaler
from research import TICKERS_DEFAULT, download_prices

LOOKBACK = 60
HORIZON = 5

def seed_all(seed):
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)

def make_data(prices):
    daily = prices.pct_change(fill_method=None)
    rows=[]
    for ticker in prices.columns:
        r=daily[ticker]
        # Forecast next-five-session realized volatility, annualized.
        future = pd.concat([r.shift(-i) for i in range(1,HORIZON+1)],axis=1)
        target = future.std(axis=1, ddof=1) * np.sqrt(252)
        f=pd.DataFrame(index=prices.index)
        f["ret_1d"]=r
        f["ret_5d"]=prices[ticker].pct_change(5,fill_method=None)
        f["ret_20d"]=prices[ticker].pct_change(20,fill_method=None)
        f["vol_5d"]=r.rolling(5).std()*np.sqrt(252)
        f["vol_20d"]=r.rolling(20).std()*np.sqrt(252)
        f["vol_60d"]=r.rolling(60).std()*np.sqrt(252)
        f["trend_20d"]=prices[ticker]/prices[ticker].rolling(20).mean()-1
        f["trend_60d"]=prices[ticker]/prices[ticker].rolling(60).mean()-1
        f["market_ret_1d"]=daily["SPY"] if "SPY" in daily else daily.mean(axis=1)
        f["cross_asset_vol"]=daily.std(axis=1)*np.sqrt(252)
        f["target"]=target
        f["ticker"]=ticker
        rows.append(f.reset_index(names="date"))
    frame=pd.concat(rows,ignore_index=True)
    frame["date"]=pd.to_datetime(frame["date"])
    cols=[c for c in frame.columns if c not in ("date","ticker","target")]
    frame=frame.replace([np.inf,-np.inf],np.nan).dropna(subset=cols+["target"])
    return frame.sort_values(["ticker","date"]).reset_index(drop=True), cols

def windows(frame, features):
    xs=[]; ys=[]; meta=[]
    for ticker,g in frame.groupby("ticker",sort=False):
        g=g.sort_values("date").reset_index(drop=True)
        a=g[features].to_numpy(dtype=np.float32); y=g.target.to_numpy(dtype=np.float32)
        for i in range(LOOKBACK-1,len(g)):
            xs.append(a[i-LOOKBACK+1:i+1]); ys.append(y[i])
            meta.append((g.loc[i,"date"],ticker,float(y[i])))
    return np.stack(xs),np.asarray(ys,dtype=np.float32),pd.DataFrame(meta,columns=["date","ticker","target"])

class VolatilityTransformer(nn.Module):
    def __init__(self,n_features,d_model=32,heads=4,layers=2,dropout=.1):
        super().__init__()
        self.input=nn.Linear(n_features,d_model)
        self.position=nn.Parameter(torch.zeros(1,LOOKBACK,d_model))
        layer=nn.TransformerEncoderLayer(d_model=d_model,nhead=heads,dim_feedforward=64,
            dropout=dropout,batch_first=True,activation="gelu")
        self.encoder=nn.TransformerEncoder(layer,num_layers=layers,enable_nested_tensor=False)
        self.head=nn.Sequential(nn.LayerNorm(d_model),nn.Linear(d_model,16),nn.GELU(),nn.Linear(16,1),nn.Softplus())
    def forward(self,x):
        z=self.input(x)+self.position[:,:x.size(1)]
        return self.head(self.encoder(z)[:,-1]).squeeze(-1)

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start",default="2012-01-01"); ap.add_argument("--end",default="2026-01-01")
    ap.add_argument("--tickers",nargs="+",default=TICKERS_DEFAULT); ap.add_argument("--epochs",type=int,default=12)
    ap.add_argument("--batch-size",type=int,default=256); ap.add_argument("--seed",type=int,default=42)
    ap.add_argument("--device",choices=["auto","cpu","mps","cuda"],default="auto")
    ap.add_argument("--output-dir",default="outputs/volatility_transformer"); args=ap.parse_args()
    seed_all(args.seed); out=Path(args.output_dir); out.mkdir(parents=True,exist_ok=True)
    tickers=list(dict.fromkeys(args.tickers))
    if "SPY" not in tickers: tickers.append("SPY")
    prices=download_prices(tickers,args.start,args.end)
    frame,features=make_data(prices); x,y,meta=windows(frame,features)
    dates=np.array(sorted(meta.date.unique()))
    train_end=pd.Timestamp(dates[int(len(dates)*.70)]); val_end=pd.Timestamp(dates[int(len(dates)*.85)])
    tr=(meta.date < train_end-pd.offsets.BDay(HORIZON)).to_numpy()
    va=((meta.date>=train_end)&(meta.date<val_end-pd.offsets.BDay(HORIZON))).to_numpy()
    te=(meta.date>=val_end).to_numpy()
    if tr.sum()<100 or va.sum()<30 or te.sum()<30: raise RuntimeError("Insufficient data; widen the date range.")
    scaler=StandardScaler().fit(x[tr].reshape(-1,x.shape[-1]))
    def transform(a): return scaler.transform(a.reshape(-1,a.shape[-1])).reshape(a.shape).astype(np.float32)
    xt,xv,xe=transform(x[tr]),transform(x[va]),transform(x[te]); yt,yv,ye=y[tr],y[va],y[te]
    device=args.device
    if device=="auto": device="cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
    device=torch.device(device)
    model=VolatilityTransformer(len(features)).to(device)
    opt=torch.optim.AdamW(model.parameters(),lr=1e-3,weight_decay=1e-4); loss_fn=nn.HuberLoss()
    loader=DataLoader(TensorDataset(torch.from_numpy(xt),torch.from_numpy(yt)),batch_size=args.batch_size,shuffle=True)
    best=float("inf"); best_state=None; stale=0
    for epoch in range(1,args.epochs+1):
        model.train(); losses=[]
        for xb,yb in loader:
            xb,yb=xb.to(device),yb.to(device); opt.zero_grad(set_to_none=True)
            loss=loss_fn(model(xb),yb); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(),1.0); opt.step()
            losses.append(float(loss.detach().cpu()))
        model.eval()
        with torch.no_grad(): pv=model(torch.from_numpy(xv).to(device)).cpu().numpy()
        mae=mean_absolute_error(yv,pv); print(f"epoch={epoch:02d} train_huber={np.mean(losses):.6f} val_mae={mae:.6f}")
        if mae<best:
            best=mae; best_state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}; stale=0
        else:
            stale+=1
            if stale>=3: print("Early stopping."); break
    if best_state: model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad(): pred=model(torch.from_numpy(xe).to(device)).cpu().numpy()
    result=meta.loc[te].copy(); result["prediction"]=pred
    result["zero_vol_baseline"]=float(np.median(yt))
    result["mae_model"]=np.abs(result.target-result.prediction)
    result["mae_baseline"]=np.abs(result.target-result.zero_vol_baseline)
    result.to_csv(out/"volatility_predictions.csv",index=False)
    metrics={"test_mae":float(mean_absolute_error(ye,pred)),"test_rmse":float(np.sqrt(mean_squared_error(ye,pred))),
        "median_baseline_mae":float(mean_absolute_error(ye,np.full_like(ye,np.median(yt)))),
        "n_test":int(len(ye)),"target":"annualized standard deviation of next 5 daily returns",
        "features":features,"tickers":list(prices.columns),"limitations":["Public adjusted daily prices; not intraday realized volatility.",
        "Single chronological split; forward 5-day labels require purging at split boundaries.",
        "Forecast is a risk estimate, not a directional return forecast or trading signal."]}
    (out/"summary.json").write_text(json.dumps(metrics,indent=2),encoding="utf-8")
    print(json.dumps(metrics,indent=2))
if __name__=="__main__": main()
