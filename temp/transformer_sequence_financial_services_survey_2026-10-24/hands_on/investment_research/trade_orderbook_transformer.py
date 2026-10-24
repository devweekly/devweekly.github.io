#!/usr/bin/env python3
"""Short-horizon mid-price movement classification from LOBSTER order-book CSVs.

Use licensed/downloaded LOBSTER message and order-book files. This script expects
a normalized CSV with timestamp, bid_price_1, ask_price_1, bid_size_1, ask_size_1
and optionally deeper levels. It predicts whether the mid-price moves up, flat, or
down over the next N events. Do not treat event-level accuracy as executable PnL.
"""
import argparse,json
from pathlib import Path
import numpy as np,pandas as pd,torch
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report,balanced_accuracy_score
from torch import nn
from torch.utils.data import DataLoader,TensorDataset
DEVICE=torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument("--csv",required=True);p.add_argument("--window",type=int,default=100);p.add_argument("--horizon",type=int,default=10);p.add_argument("--epochs",type=int,default=20);p.add_argument("--output-dir",default="outputs/trade_orderbook");a=p.parse_args()
 out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True);d=pd.read_csv(a.csv)
 needed=["timestamp","bid_price_1","ask_price_1","bid_size_1","ask_size_1"]
 if not set(needed).issubset(d.columns):raise ValueError(f"CSV requires {needed}")
 d=d.sort_values("timestamp").reset_index(drop=True);mid=(d.bid_price_1+d.ask_price_1)/2
 spread=(d.ask_price_1-d.bid_price_1).replace(0,np.nan);imb=(d.bid_size_1-d.ask_size_1)/(d.bid_size_1+d.ask_size_1+1e-8)
 feats=pd.DataFrame({"mid_return":mid.pct_change().fillna(0),"spread_bps":(spread/mid*1e4).replace([np.inf,-np.inf],np.nan).fillna(0),"size_imbalance":imb.fillna(0),"log_bid_size":np.log1p(d.bid_size_1),"log_ask_size":np.log1p(d.ask_size_1)})
 for c in ["bid_price_1","ask_price_1"]:
  feats[c+"_change"]=d[c].diff().fillna(0)
 future=mid.shift(-a.horizon)-mid
 # Price-change classes with a small flat band based on tick-scale; adjust to instrument tick size.
 tick=float(np.nanmedian(np.abs(mid.diff().replace(0,np.nan).dropna()))) if mid.diff().abs().gt(0).any() else 0.01
 y=np.where(future>tick,2,np.where(future< -tick,0,1));valid=future.notna().to_numpy();raw=feats.to_numpy(np.float32)
 X=[];Y=[];dates=[]
 for i in range(a.window-1,len(d)-a.horizon):
  X.append(raw[i-a.window+1:i+1]);Y.append(y[i]);dates.append(d.timestamp.iloc[i])
 X=np.asarray(X,np.float32);Y=np.asarray(Y);dates=np.asarray(dates);n=len(Y);c1=int(n*.7);c2=int(n*.85);tr=np.arange(0,c1-a.horizon);va=np.arange(c1+a.horizon,c2-a.horizon);te=np.arange(c2+a.horizon,n)
 scaler=StandardScaler().fit(X[tr].reshape(-1,X.shape[-1]));X=scaler.transform(X.reshape(-1,X.shape[-1])).reshape(X.shape).astype(np.float32)
 class Model(nn.Module):
  def __init__(self):
   super().__init__();self.proj=nn.Linear(X.shape[-1],32);self.pos=nn.Parameter(torch.zeros(1,a.window,32));self.enc=nn.TransformerEncoder(nn.TransformerEncoderLayer(32,4,64,batch_first=True,dropout=.1),2);self.head=nn.Linear(32,3)
  def forward(self,z):return self.head(self.enc(self.proj(z)+self.pos[:,:z.shape[1]])[:,-1])
 def dl(ii,sh=False):return DataLoader(TensorDataset(torch.tensor(X[ii]),torch.tensor(Y[ii])),batch_size=128,shuffle=sh)
 m=Model().to(DEVICE);counts=np.bincount(Y[tr],minlength=3);weights=torch.tensor(len(tr)/(3*np.maximum(counts,1)),dtype=torch.float32,device=DEVICE);lossfn=nn.CrossEntropyLoss(weight=weights);opt=torch.optim.AdamW(m.parameters(),lr=1e-3);best=float("inf");state=None;wait=0
 for ep in range(a.epochs):
  m.train()
  for xb,yb in dl(tr,True):
   xb,yb=xb.to(DEVICE),yb.to(DEVICE);opt.zero_grad();loss=lossfn(m(xb),yb);loss.backward();nn.utils.clip_grad_norm_(m.parameters(),1);opt.step()
  m.eval()
  with torch.no_grad():vl=np.mean([lossfn(m(xb.to(DEVICE)),yb.to(DEVICE)).item() for xb,yb in dl(va)])
  print(f"epoch={ep+1} val_loss={vl:.4f}")
  if vl<best:best=vl;state={k:v.detach().cpu().clone() for k,v in m.state_dict().items()};wait=0
  else:
   wait+=1
   if wait>=5:break
 if state:m.load_state_dict(state)
 m.eval()
 with torch.no_grad():probs=torch.cat([torch.softmax(m(xb.to(DEVICE)),1).cpu() for xb,_ in dl(te)]).numpy()
 pred=probs.argmax(1);report={"test_samples":len(te),"balanced_accuracy":float(balanced_accuracy_score(Y[te],pred)),"classification_report":classification_report(Y[te],pred,labels=[0,1,2],target_names=["down","flat","up"],output_dict=True,zero_division=0),"note":"LOBSTER access may require a license/account. Event-level classification does not model queue position, fees, latency, market impact or fill probability."}
 pd.DataFrame({"timestamp":dates[te],"actual_class":Y[te],"predicted_class":pred,"p_down":probs[:,0],"p_flat":probs[:,1],"p_up":probs[:,2]}).to_csv(out/"predictions.csv",index=False);(out/"summary.json").write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!="classification_report"},indent=2))
if __name__=="__main__":main()
