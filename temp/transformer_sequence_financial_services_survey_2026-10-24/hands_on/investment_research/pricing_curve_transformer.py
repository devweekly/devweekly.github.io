#!/usr/bin/env python3
"""Transformer forecast of Treasury yield-curve changes using public FRED CSV data."""
import argparse, json
from pathlib import Path
import numpy as np, pandas as pd, requests, torch
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

SERIES=["DGS3MO","DGS2","DGS5","DGS10","DGS30"]
DEVICE=torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")

def load_data(start,end):
    url="https://fred.stlouisfed.org/graph/fredgraph.csv?id="+",".join(SERIES)
    df=pd.read_csv(url, na_values=["."])
    df=df.rename(columns={"observation_date":"date"})
    if "date" not in df: df=df.rename(columns={df.columns[0]:"date"})
    df["date"]=pd.to_datetime(df["date"])
    df=df[(df.date>=start)&(df.date<end)].sort_values("date").ffill().dropna()
    # Features use only yields observed at date t; labels are future 5-session changes in 10Y yield.
    y=df["DGS10"].shift(-5)-df["DGS10"]
    x=pd.DataFrame(index=df.index)
    for c in SERIES:
        x[c+"_level"]=df[c]
        x[c+"_chg5"]=df[c].diff(5)
    x["slope_10y_3m"]=df["DGS10"]-df["DGS3MO"]
    x["slope_30y_5y"]=df["DGS30"]-df["DGS5"]
    valid=y.notna() & x.notna().all(axis=1)
    return df.loc[valid].reset_index(drop=True), x.loc[valid].to_numpy(np.float32), y.loc[valid].to_numpy(np.float32)

class CurveTransformer(nn.Module):
    def __init__(self,nf,window,d=32):
        super().__init__(); self.proj=nn.Linear(nf,d); self.pos=nn.Parameter(torch.zeros(1,window,d))
        layer=nn.TransformerEncoderLayer(d,4,64,dropout=.1,batch_first=True)
        self.enc=nn.TransformerEncoder(layer,2); self.head=nn.Sequential(nn.LayerNorm(d),nn.Linear(d,1))
    def forward(self,x): return self.head(self.enc(self.proj(x)+self.pos[:,:x.shape[1]])[:,-1]).squeeze(-1)

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("--start",default="2000-01-01"); p.add_argument("--end",default="2026-01-01")
    p.add_argument("--window",type=int,default=60); p.add_argument("--epochs",type=int,default=20); p.add_argument("--output-dir",default="outputs/pricing_curve"); a=p.parse_args()
    out=Path(a.output_dir); out.mkdir(parents=True,exist_ok=True)
    df,raw,y=load_data(a.start,a.end); n=len(y); cut1=int(n*.7); cut2=int(n*.85)
    # Purge label horizon around boundaries to reduce overlapping-label leakage.
    train=np.arange(a.window-1,max(a.window-1,cut1-5)); val=np.arange(cut1+5,max(cut1+5,cut2-5)); test=np.arange(cut2+5,n)
    scaler=StandardScaler().fit(raw[:cut1]); x=scaler.transform(raw).astype(np.float32)
    X=np.stack([x[i-a.window+1:i+1] for i in range(a.window-1,n)])
    yy=y[a.window-1:]; dates=df.date.to_numpy()[a.window-1:]
    # index alignment after windowing
    offset=a.window-1; train=train-offset; val=val-offset; test=test-offset
    train=train[(train>=0)&(train<len(yy))]; val=val[(val>=0)&(val<len(yy))]; test=test[(test>=0)&(test<len(yy))]
    def dl(idx,shuffle=False): return DataLoader(TensorDataset(torch.tensor(X[idx]),torch.tensor(yy[idx])),batch_size=64,shuffle=shuffle)
    model=CurveTransformer(X.shape[-1],a.window).to(DEVICE); opt=torch.optim.AdamW(model.parameters(),lr=1e-3); lossfn=nn.HuberLoss()
    best=float("inf"); state=None; patience=0
    for ep in range(a.epochs):
        model.train()
        for xb,yb in dl(train,True):
            xb,yb=xb.to(DEVICE),yb.to(DEVICE); opt.zero_grad(); loss=lossfn(model(xb),yb); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(),1); opt.step()
        model.eval()
        with torch.no_grad(): vl=np.mean([lossfn(model(xb.to(DEVICE)),yb.to(DEVICE)).item() for xb,yb in dl(val)])
        print(f"epoch={ep+1} val_huber={vl:.5f}")
        if vl<best: best=vl; state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}; patience=0
        else:
            patience+=1
            if patience>=5: break
    if state:model.load_state_dict(state)
    model.eval()
    with torch.no_grad(): pred=np.concatenate([model(xb.to(DEVICE)).cpu().numpy() for xb,_ in dl(test)])
    actual=yy[test]; baseline=np.zeros_like(actual)
    metrics={"device":str(DEVICE),"test_samples":len(test),"mae_bp":float(mean_absolute_error(actual,pred)*100),
             "rmse_bp":float(np.sqrt(mean_squared_error(actual,pred))*100),
             "zero_change_baseline_mae_bp":float(mean_absolute_error(actual,baseline)*100),
             "note":"Yield changes are in percentage points; multiplying by 100 expresses basis points. Research only."}
    pd.DataFrame({"date":dates[test],"actual_5session_10y_change_pp":actual,"predicted_change_pp":pred}).to_csv(out/"predictions.csv",index=False)
    (out/"summary.json").write_text(json.dumps(metrics,indent=2)); print(json.dumps(metrics,indent=2))
if __name__=="__main__": main()
