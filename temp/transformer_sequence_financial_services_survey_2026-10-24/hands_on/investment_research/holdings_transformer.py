#!/usr/bin/env python3
"""Forecast next-period fund holding weight change from SEC Form N-PORT holdings CSV.

Input is a normalized extract from SEC Form N-PORT FUND_REPORTED_HOLDING. The script
does not silently guess the SEC's changing raw column names: provide a CSV with
fund_id, report_date, security_id, market_value, and net_assets columns.
"""
import argparse,json
from pathlib import Path
import numpy as np,pandas as pd,torch
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error
from torch import nn
from torch.utils.data import DataLoader,TensorDataset
DEVICE=torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")

class HoldingsTransformer(nn.Module):
 def __init__(self,nf,window,d=32):
  super().__init__(); self.proj=nn.Linear(nf,d); self.pos=nn.Parameter(torch.zeros(1,window,d)); self.enc=nn.TransformerEncoder(nn.TransformerEncoderLayer(d,4,64,batch_first=True,dropout=.1),2); self.head=nn.Linear(d,1)
 def forward(self,x): return self.head(self.enc(self.proj(x)+self.pos[:,:x.shape[1]])[:,-1]).squeeze(-1)

def main():
 p=argparse.ArgumentParser(description=__doc__); p.add_argument("--csv",required=True); p.add_argument("--window",type=int,default=4); p.add_argument("--epochs",type=int,default=30); p.add_argument("--output-dir",default="outputs/holdings"); a=p.parse_args()
 out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True); d=pd.read_csv(a.csv)
 required={"fund_id","report_date","security_id","market_value","net_assets"}
 if not required.issubset(d.columns): raise ValueError(f"CSV requires columns {sorted(required)}")
 d["report_date"]=pd.to_datetime(d.report_date); d["weight"]=d.market_value/d.net_assets.replace(0,np.nan)
 d=d.replace([np.inf,-np.inf],np.nan).dropna(subset=["weight"]).sort_values(["fund_id","security_id","report_date"])
 # Use holding weight and lagged weight changes. Target is next report's weight minus current weight.
 d["weight_change"]=d.groupby(["fund_id","security_id"]).weight.diff()
 d["target"]=d.groupby(["fund_id","security_id"]).weight.shift(-1)-d.weight
 features=["weight","weight_change"]
 d[features]=d[features].fillna(0).clip(-5,5)
 X=[];y=[];dates=[]
 for _,g in d.groupby(["fund_id","security_id"]):
  g=g.sort_values("report_date").reset_index(drop=True)
  if len(g)<=a.window: continue
  vals=g[features].to_numpy(np.float32); targets=g.target.to_numpy(np.float32)
  for i in range(a.window-1,len(g)-1):
   if not np.isfinite(targets[i]): continue
   X.append(vals[i-a.window+1:i+1]);y.append(targets[i]);dates.append(g.report_date.iloc[i])
 if len(X)<30: raise RuntimeError("Too few sequences. Use multiple N-PORT quarters and many fund/security pairs.")
 X=np.asarray(X);y=np.asarray(y);dates=np.asarray(dates,dtype="datetime64[ns]");order=np.argsort(dates);X,y,dates=X[order],y[order],dates[order]
 n=len(y);c1=int(n*.7);c2=int(n*.85);train=np.arange(max(0,c1-1));val=np.arange(min(n,c1+1),max(c1+1,c2-1));test=np.arange(min(n,c2+1),n)
 scaler=StandardScaler().fit(X[train].reshape(-1,len(features)));X=scaler.transform(X.reshape(-1,len(features))).reshape(X.shape).astype(np.float32)
 def dl(idx,sh=False):return DataLoader(TensorDataset(torch.tensor(X[idx]),torch.tensor(y[idx])),batch_size=64,shuffle=sh)
 m=HoldingsTransformer(len(features),a.window).to(DEVICE);opt=torch.optim.AdamW(m.parameters(),lr=1e-3);lossfn=nn.HuberLoss();best=float("inf");state=None;wait=0
 for ep in range(a.epochs):
  m.train()
  for xb,yb in dl(train,True):
   xb,yb=xb.to(DEVICE),yb.to(DEVICE);opt.zero_grad();loss=lossfn(m(xb),yb);loss.backward();nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
  m.eval()
  with torch.no_grad():vl=np.mean([lossfn(m(xb.to(DEVICE)),yb.to(DEVICE)).item() for xb,yb in dl(val)])
  print(f"epoch={ep+1} val_huber={vl:.6f}")
  if vl<best:best=vl;state={k:v.detach().cpu().clone() for k,v in m.state_dict().items()};wait=0
  else:
   wait+=1
   if wait>=5:break
 if state:m.load_state_dict(state)
 m.eval()
 with torch.no_grad():pred=np.concatenate([m(xb.to(DEVICE)).cpu().numpy() for xb,_ in dl(test)])
 baseline=np.zeros_like(pred);actual=y[test]
 report={"test_samples":len(test),"mae_weight_points":float(mean_absolute_error(actual,pred)*100),"zero_change_baseline_mae_weight_points":float(mean_absolute_error(actual,baseline)*100),"note":"N-PORT holdings are disclosed with delay and may be amended. Use filing-availability date, not just report_date, for point-in-time backtests."}
 pd.DataFrame({"report_date":dates[test],"actual_next_weight_change":actual,"predicted_next_weight_change":pred}).to_csv(out/"predictions.csv",index=False);(out/"summary.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=="__main__":main()
