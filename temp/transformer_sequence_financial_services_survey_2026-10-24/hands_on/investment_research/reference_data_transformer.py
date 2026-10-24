#!/usr/bin/env python3
"""Reference-data quality classifier: OpenFIGI mappings + Transformer over metadata fields.

Fetches listed-instrument metadata for a configurable ticker set, then trains a
small Transformer to distinguish untouched reference records from deliberately
corrupted training examples. Synthetic corruptions are not real vendor defects;
the experiment evaluates whether the model learns the injected consistency rules.
"""
import argparse,json,time
from pathlib import Path
import numpy as np,pandas as pd,requests,torch
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import classification_report,balanced_accuracy_score
from torch import nn
from torch.utils.data import DataLoader,TensorDataset
DEVICE=torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
TICKERS=["AAPL","MSFT","JPM","SPY","TLT","GLD","NVDA","XOM","KO","IBM","AMZN","META","BAC","GS","QQQ","IWM"]
FIELDS=["ticker","name","securityType","marketSector","exchCode","currency"]
def fetch(tickers,api_key):
 headers={"Content-Type":"application/json"}
 if api_key:headers["X-OPENFIGI-APIKEY"]=api_key
 rows=[]
 for t in tickers:
  r=requests.post("https://api.openfigi.com/v3/mapping",headers=headers,json=[{"idType":"TICKER","idValue":t,"exchCode":"US"}],timeout=30);r.raise_for_status()
  arr=r.json()[0].get("data",[])
  if arr:
   z=arr[0];rows.append({"ticker":t,"name":z.get("name",""),"securityType":z.get("securityType",""),"marketSector":z.get("marketSector",""),"exchCode":z.get("exchCode",""),"currency":z.get("currency","USD"),"figi":z.get("figi","")})
  time.sleep(.15)
 return pd.DataFrame(rows)
def encode(df):
 # Each field is a token; char hashing gives deterministic field-level representations without a pretrained tokenizer.
 arr=np.zeros((len(df),len(FIELDS),64),np.float32)
 for i,(_,row) in enumerate(df.iterrows()):
  for j,f in enumerate(FIELDS):
   s=str(row.get(f,"")).lower()
   for k,ch in enumerate(s[:80]):
    h=(ord(ch)*31+(k+1)*17+(j+1)*131)%64;arr[i,j,h]+=1
   arr[i,j]/=max(1,np.linalg.norm(arr[i,j]))
 return arr
class RefTransformer(nn.Module):
 def __init__(self,d=64):
  super().__init__();self.pos=nn.Parameter(torch.zeros(1,len(FIELDS),d));self.enc=nn.TransformerEncoder(nn.TransformerEncoderLayer(d,4,128,batch_first=True,dropout=.1),2);self.head=nn.Sequential(nn.LayerNorm(d),nn.Linear(d,2))
 def forward(self,x):return self.head(self.enc(x+self.pos)[:,-1])
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument("--tickers",default=",".join(TICKERS));p.add_argument("--api-key",default="");p.add_argument("--epochs",type=int,default=30);p.add_argument("--output-dir",default="outputs/reference_data");a=p.parse_args()
 out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True);base=fetch([x.strip() for x in a.tickers.split(",") if x.strip()],a.api_key)
 if len(base)<8:raise RuntimeError("Too few OpenFIGI results; try a larger ticker set or verify API limits.")
 base.to_csv(out/"openfigi_reference.csv",index=False)
 # Repeat records to make a teaching-sized sample and inject explicit errors into a subset.
 originals=pd.concat([base]*20,ignore_index=True); originals["label"]=0; originals["group_id"]=originals["ticker"]
 corrupted=originals.copy();rng=np.random.default_rng(42)
 for i in range(len(corrupted)):
  if rng.random()<.5:
   field=rng.choice(["ticker","name","securityType","marketSector","exchCode","currency"])
   corrupted.loc[i,field]=str(corrupted.loc[i,field])+"__BAD"
 corrupted["label"]=1
 allrows=pd.concat([originals,corrupted],ignore_index=True);X=encode(allrows);y=allrows.label.to_numpy()
 splitter=GroupShuffleSplit(n_splits=1,test_size=.25,random_state=42);tr,te=next(splitter.split(X,y,groups=allrows["group_id"]))
 model=RefTransformer().to(DEVICE);opt=torch.optim.AdamW(model.parameters(),lr=1e-3);lossfn=nn.CrossEntropyLoss()
 dl=DataLoader(TensorDataset(torch.tensor(X[tr]),torch.tensor(y[tr])),batch_size=64,shuffle=True)
 for ep in range(a.epochs):
  model.train();losses=[]
  for xb,yb in dl:
   xb,yb=xb.to(DEVICE),yb.to(DEVICE);opt.zero_grad();loss=lossfn(model(xb),yb);loss.backward();opt.step();losses.append(loss.item())
  print(f"epoch={ep+1} train_loss={np.mean(losses):.4f}")
 model.eval()
 with torch.no_grad():pred=model(torch.tensor(X[te]).to(DEVICE)).argmax(1).cpu().numpy()
 report={"base_instruments":len(base),"synthetic_records":len(allrows),"balanced_accuracy":float(balanced_accuracy_score(y[te],pred)),"classification_report":classification_report(y[te],pred,output_dict=True,zero_division=0),"warning":"Synthetic corruption benchmark only; not a measured production reference-data error rate."}
 (out/"summary.json").write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!="classification_report"},indent=2))
if __name__=="__main__":main()
