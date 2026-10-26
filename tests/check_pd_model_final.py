"""PD reference anchors, monotone C1 behavior, JS parity, MC same-draw EFC checks."""
import json, math, subprocess, sys
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(R))
import config, report, data_loader, calculations, shocks
from pd_curves import anchored_pd
zs=[];pdref=[]
for lo,hi,r,p in config.Z_RATING_TABLE:
 z=lo if np.isfinite(lo) and not np.isfinite(hi) else hi if not np.isfinite(lo) else (lo+hi)/2
 zs.append(z);pdref.append(p)
 assert abs(anchored_pd(z)-p)<1e-14,(r,z,p,anchored_pd(z))
# C1 numerical derivative across the interior knots, with allowance for floating precision.
# The two end anchors are where the curve changes branch, so the slope is allowed to change there: at the AAA
# anchor the PD is floored (right slope exactly 0); at the D anchor the left side is the logistic tail, whose
# slope is b*PD*(1-PD) = b*0.24 (the PCHIP end slope on the right is a separate quantity: a kink, not a jump).
for z in sorted(zs):
 h=1e-5
 l=(anchored_pd(z)-anchored_pd(z-h))/h
 r=(anchored_pd(z+h)-anchored_pd(z))/h
 if z==min(zs): assert abs(l-config.DEFAULT_CASH_SETTINGS['pd_logit_b']*0.4*0.6)<1e-4 and r<0,(z,l,r)
 elif z==max(zs): assert r==0 and l<0,(z,l,r)
 else: assert abs(l-r)<1e-4,(z,l,r)
values=[anchored_pd(z) for z in np.linspace(-8,9,25001)]
assert all(0<y<1 for y in values)
assert max(np.diff(values))<=1e-12
zcheck=list(np.linspace(-7,8,301))+zs
payload={'config':report.config_payload(),'zs':zcheck,'engine':str(R/'templates/engine.js')}
runner=r'''const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));const e=require(p.engine).create(p.config);
console.log(JSON.stringify(p.zs.map(z=>[e.pdValue(z,e.zRating(z),false,{pd_method:'rating_smooth',pd_logit_b:p.config.DEFAULT_CASH_SETTINGS.pd_logit_b}),e.pdValue(z,e.zRating(z),false,{pd_method:'logistic',pd_logit_a:p.config.DEFAULT_CASH_SETTINGS.pd_logit_a,pd_logit_b:p.config.DEFAULT_CASH_SETTINGS.pd_logit_b})])));
'''
r=subprocess.run(['node','-e',runner],capture_output=True,text=True,input=json.dumps(payload),check=True)
out=json.loads(r.stdout)
a=config.DEFAULT_CASH_SETTINGS['pd_logit_a'];b=config.DEFAULT_CASH_SETTINGS['pd_logit_b']
for z,(x,y) in zip(zcheck,out):
 assert abs(x-anchored_pd(z))<1e-12,(z,x,anchored_pd(z))
 expected=1/(1+math.exp(-(a+b*z)))
 assert abs(y-expected)<1e-12,(z,y,expected)
# Same run, identical stochastic paths. Alternative outputs retained and selected ones must match.
raw=data_loader.demo_portfolio();en=calculations.compute_zem_components(data_loader.coerce_numeric(raw))
base=en.iloc[-1]
p=dict(config.DEFAULT_SHOCK_PARAMS,**config.DEFAULT_CASH_SETTINGS)
p.update(fuel_shock_pct=.5, fuel_cost_share=.35,waterfall_on=1,default_on_missed_debt=1)
kw=dict(n_sims=12,fuel_std=.05,fx_std=.07,correlation=.2,horizon_years=2,lgd_pct=70,seed=42)
a1=shocks.run_monte_carlo(base,dict(p,mc_pd_method='logistic'),**kw)
a2=shocks.run_monte_carlo(base,dict(p,mc_pd_method='rating_smooth'),**kw)
for name in ('Z_EM','Total Liabilities','EAD','LGD','EFC_Full_Logistic','EFC_Rating_Anchored','PD_Full_Logistic','PD_Rating_Anchored'):
 assert np.allclose(a1[name],a2[name],rtol=1e-12,atol=1e-12),name
assert np.allclose(a1['EFC'],a1['EFC_Full_Logistic'])
assert np.allclose(a2['EFC'],a2['EFC_Rating_Anchored'])
assert set(a1['MC_PD_Model'])=={'logistic'} and set(a2['MC_PD_Model'])=={'rating_smooth'}
a0=shocks.run_monte_carlo(base,p,**kw)          # no method requested -> rating_smooth
assert set(a0['MC_PD_Model'])=={'rating_smooth'} and np.allclose(a0['EFC'],a0['EFC_Rating_Anchored'])
try: shocks.run_monte_carlo(base,dict(p,mc_pd_method='bogus'),**kw); raise SystemExit('invalid mc_pd_method accepted')
except ValueError: pass
assert not any(s in a1.columns for s in ['Default Year','Realised Cost'])
# JS alternative: expected cost must use the selected PD curve, no realised loss.
payload={'config':report.config_payload(),'base':json.loads(base.to_json()),'params':p,'engine':str(R/'templates/engine.js')}
runner=r'''const fs=require('fs');const i=JSON.parse(fs.readFileSync(0,'utf8'));const E=require(i.engine).create(i.config);
const o={n:6,fuelSd:.05,fxSd:.07,rho:.2,H:2,lgd:70,seed:42};
const arr=['logistic','rating_smooth'].map(k=>E.monteCarlo(i.base,{...i.params,mc_pd_method:k},o));
const {mc_pd_method,...noMethod}=i.params;
const none=E.monteCarlo(i.base,noMethod,o);
let threw=false;try{E.monteCarlo(i.base,{...i.params,mc_pd_method:'bogus'},o);}catch(e){threw=true;}
if(!threw)throw Error('invalid mc_pd_method accepted');
let tested=0;let maxErr=0;
for(let j=0;j<6;j++)for(let t=0;t<3;t++){
 const x=arr[0][j].path[t],y=arr[1][j].path[t],w=none[j].path[t];
 if(x.MC_PD_Model!=='logistic')throw Error('logistic request must give logistic');
 if(y.MC_PD_Model!=='rating_smooth')throw Error('rating_smooth request must give rating_smooth');
 if(w.MC_PD_Model!=='rating_smooth')throw Error('no method must default to rating_smooth');
 if(Math.abs(x.Z_EM-y.Z_EM)>1e-12)throw Error('different shocks');
 for(const [r,col] of [[x,'EFC_Full_Logistic'],[y,'EFC_Rating_Anchored'],[w,'EFC_Rating_Anchored']]){
  maxErr=Math.max(maxErr,Math.abs(r.EFC-r[col]));
  if('Realised Cost' in r)throw Error('realised loss');
  tested++;
 }
}
console.log(JSON.stringify({tested,maxErr}));'''
r=subprocess.run(['node','-e',runner],capture_output=True,text=True,input=json.dumps(payload),check=True)
assert json.loads(r.stdout)['maxErr']<1e-7
print('PASS 20 rating anchors, 25k-point monotonicity, C1 at interior knots, 321 Python-JS PD comparisons and MC same-draw selection in both engines.')
