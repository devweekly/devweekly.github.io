#!/usr/bin/env python3
"""Synthetic fund-accounting reconciliation anomaly detection with a Transformer.

There is no broadly open, realistic daily fund-accounting ledger with administrator
books, accruals, cash, corporate actions and NAV breaks. This script generates
transparent synthetic daily ledger features and tests anomaly classification.
It is a pipeline demonstration, not a real-world model benchmark.
"""
import argparse,json
from pathlib import Path
import numpy as np,pandas as pd,torch
from sklearn.metrics import classification_report,balanced_accuracy_score
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader,TensorDataset
DEVICE=torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
FEATURES=["cash_break_bps","position_value_break_bps","accrual_break_bps","nav_return_bps","unmatched_transactions","stale_price_count"]
def make_data(n,seed):
 r=np.random.default_rng(seed);x=np.column_stack([r.normal(0,1, n),r.normal(0,1,n),r.normal(0,1,n),r.normal(0,30,n),r.poisson(.2,n),r.poisson(.4,n)]).astype(float)
 y=np.zeros(n,dtype=int)
 # Explicit injected operational breaks: stale prices, missed accruals, unmatched trades, valuation mismatch.
 for i in r.choice(np.arange(30,n-5),size=max(10,n//30),replace=False):
  y[i:i+3]=1;x[i,0]+=r.choice([-1,1])*r.uniform(8,30);x[i,1]+=r.uniform(10,60);x[i,2]+=r.uniform(5,25);x[i,4]+=r.integers(3,12);x[i,5]+=r.integers(2,10)
 return x,y
class AccountingTransformer(nn.Module):
 def __init__(self,w,d=32):
  super().__init__();self.proj=nn.Linear(len(FEATURES),d);self.pos=nn.Parameter(torch.zeros(1,w,d));self.enc=nn.TransformerEncoder(nn.TransformerEncoderLayer(d,4,64,batch_first=True,dropout=.1),2);self.head=nn.Linear(d,2)
 def forward(self,x):return self.head(self.enc(self.proj(x)+self.pos[:,:x.shape[1]])[:,-1])
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument("--days",type=int,default=6000);p.add_argument("--window",type=int,default=10);p.add_argument("--epochs",type=int,default=20);p.add_argument("--output-dir",default="outputs/fund_accounting");a=p.parse_args()
 out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True);raw,y=make_data(a.days,42);X=[];Y=[];idxs=[]
 for i in range(a.window-1,len(y)):X.append(raw[i-a.window+1:i+1]);Y.append(y[i]);idxs.append(i)
 X=np.asarray(X,np.float32);Y=np.asarray(Y);idxs=np.asarray(idxs);n=len(Y);c1=int(n*.7);c2=int(n*.85);tr=np.arange(0,c1-2);va=np.arange(c1+2,c2-2);te=np.arange(c2+2,n)
 scaler=StandardScaler().fit(X[tr].reshape(-1,len(FEATURES)));X=scaler.transform(X.reshape(-1,len(FEATURES))).reshape(X.shape).astype(np.float32)
 def dl(ii,sh=False):return DataLoader(TensorDataset(torch.tensor(X[ii]),torch.tensor(Y[ii])),batch_size=64,shuffle=sh)
 m=AccountingTransformer(a.window).to(DEVICE);weights=torch.tensor([1.,8.],device=DEVICE);lossfn=nn.CrossEntropyLoss(weight=weights);opt=torch.optim.AdamW(m.parameters(),lr=1e-3);best=float("inf");state=None;wait=0
 for ep in range(a.epochs):
  m.train()
  for xb,yb in dl(tr,True):
   xb,yb=xb.to(DEVICE),yb.to(DEVICE);opt.zero_grad();loss=lossfn(m(xb),yb);loss.backward();opt.step()
  m.eval()
  with torch.no_grad():vl=np.mean([lossfn(m(xb.to(DEVICE)),yb.to(DEVICE)).item() for xb,yb in dl(va)])
  print(f"epoch={ep+1} val_loss={vl:.4f}")
  if vl<best:best=vl;state={k:v.detach().cpu().clone() for k,v in m.state_dict().items()};wait=0
  else:
   wait+=1
   if wait>=4:break
 if state:m.load_state_dict(state)
 m.eval()
 with torch.no_grad():pred=np.concatenate([m(xb.to(DEVICE)).argmax(1).cpu().numpy() for xb,_ in dl(te)])
 report={"device":str(DEVICE),"test_samples":len(te),"balanced_accuracy":float(balanced_accuracy_score(Y[te],pred)),"classification_report":classification_report(Y[te],pred,output_dict=True,zero_division=0),"features":FEATURES,"note":"Synthetic anomaly labels are injected by construction; these scores do not estimate performance on a real fund ledger."}
 pd.DataFrame({"day_index":idxs[te],"actual_break":Y[te],"predicted_break":pred}).to_csv(out/"test_predictions.csv",index=False);(out/"summary.json").write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!="classification_report"},indent=2))
if __name__=="__main__":main()
