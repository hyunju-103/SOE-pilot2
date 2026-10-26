"""Rating-anchored PD (the Monte Carlo default): anchors, monotone, AAA floor, rising logistic tail below the
D threshold (identical to the rating_tail tail), continuity, Python/JS parity on Z in [-8, 12] step 1e-3,
tail slope b moves both engines alike, and the Monte Carlo default method in both engines."""
import json, math, subprocess, sys
from pathlib import Path
R = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(R))
import config, report, data_loader, calculations, shocks
from pd_curves import anchored_pd

fails = []
def check(name, ok, detail=""):
    print(("OK   " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""))
    if not ok: fails.append(name)

# anchors and bounds, derived from the rating table
anch = []
for lo, hi, r, p in config.Z_RATING_TABLE:
    z = lo if math.isfinite(lo) and not math.isfinite(hi) else hi if not math.isfinite(lo) else (lo + hi) / 2
    anch.append((z, p, r))
z_lo, z_hi = min(a[0] for a in anch), max(a[0] for a in anch)
pd_lo = [p for z, p, r in anch if z == z_lo][0]; pd_hi = [p for z, p, r in anch if z == z_hi][0]
check("20 rating anchors", len(anch) == 20)
check("bounds are the D and AAA anchors", (z_lo, z_hi, pd_lo, pd_hi) == (-1.5, 4.9, 0.40, 0.0002), f"{z_lo} {z_hi} {pd_lo} {pd_hi}")

grid = [-8 + i * 1e-3 for i in range(20001)]            # -8 .. 12
py = [anchored_pd(z) for z in grid]
eps = 1e-12
check("Python exact at all 20 anchors", max(abs(anchored_pd(z) - p) for z, p, _ in anch) < eps)
check("Python monotone non-increasing", all(py[i + 1] <= py[i] + 1e-15 for i in range(len(py) - 1)))
B = config.DEFAULT_CASH_SETTINGS["pd_logit_b"]
tailpy = lambda z, b=B: shocks.pd_value(z, "D", False, {"pd_method": "rating_tail", "pd_logit_b": b})
check("Python rating_smooth == rating_tail tail for Z < -1.5 (< 1e-12)", max(abs(v - tailpy(z)) for z, v in zip(grid, py) if z < z_lo) < eps)
check("Python PD == 40% at Z = -1.5", abs(anchored_pd(z_lo) - 0.40) < eps)
tl = [(z, v) for z, v in zip(grid, py) if z <= z_lo]
check("Python strictly increasing as Z falls below -1.5", all(tl[i][1] > tl[i + 1][1] for i in range(len(tl) - 1)))
check("Python continuous at -1.5 (|PD(-1.5-1e-9) - 0.40| < 1e-6)", abs(anchored_pd(z_lo - 1e-9) - 0.40) < 1e-6)
check("Python PD(-7) > 0.98 and < 1", 0.98 < anchored_pd(-7) < 1.0, f"{anchored_pd(-7):.6f}")
check("Python tail follows b (b=-1.5 differs from default, equals rating_tail)", abs(anchored_pd(-3, -1.5) - tailpy(-3, -1.5)) < eps and abs(anchored_pd(-3, -1.5) - anchored_pd(-3)) > 0.05)
check("Python pd_value passes params b to rating_smooth", abs(shocks.pd_value(-3, "D", False, {"pd_method": "rating_smooth", "pd_logit_b": -1.5}) - anchored_pd(-3, -1.5)) < eps)
check("Python PD == 0.02% for Z >= 4.9", all(abs(v - 0.0002) < eps for z, v in zip(grid, py) if z >= z_hi))
mx = max(abs(py[i + 1] - py[i]) for i in range(len(py) - 1))
check("Python continuous: max |dPD| between grid points < 2e-3", mx < 2e-3, f"max {mx:.3e}")
check("NaN in -> NaN out (Python)", math.isnan(anchored_pd(float('nan'))))

payload = {'config': report.config_payload(), 'zs': grid, 'anchors': [a[0] for a in anch], 'b': B, 'engine': str(R / 'templates/engine.js')}
runner = r'''const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));const e=require(p.engine).create(p.config);
const f=z=>e.pdValue(z,e.zRating(z),false,{pd_method:'rating_smooth',pd_logit_b:p.b});
const t=(z,b)=>e.pdValue(z,e.zRating(z),false,{pd_method:'rating_tail',pd_logit_b:b});
const g=(z,b)=>e.pdValue(z,e.zRating(z),false,{pd_method:'rating_smooth',pd_logit_b:b});
console.log(JSON.stringify({grid:p.zs.map(f),anch:p.anchors.map(f),tail:p.zs.map(z=>t(z,p.b)),nan:Number.isNaN(f(NaN)),
 e9:f(-1.5-1e-9),m7:f(-7),bdiff:Math.max(...[-1.6,-3,-6].map(z=>Math.abs(g(z,-1.5)-t(z,-1.5)))),bmove:Math.abs(g(-3,-1.5)-g(-3,p.b)),
 noB:e.pdValue(-3,'D',false,{pd_method:'rating_smooth'}),noBtail:e.pdValue(-3,'D',false,{pd_method:'rating_tail'})}));'''
out = json.loads(subprocess.run(['node', '-e', runner], capture_output=True, text=True, input=json.dumps(payload), check=True).stdout)
js = out['grid']
check("JS exact at all 20 anchors", max(abs(v - p) for v, (z, p, _) in zip(out['anch'], anch)) < eps)
check("JS monotone non-increasing", all(js[i + 1] <= js[i] + 1e-15 for i in range(len(js) - 1)))
check("JS rating_smooth == rating_tail tail for Z < -1.5 (< 1e-12)", max(abs(v - t) for z, v, t in zip(grid, js, out['tail']) if z < z_lo) < eps)
check("JS PD == 40% at Z = -1.5", abs(js[grid.index(min(grid, key=lambda z: abs(z - z_lo)))] - 0.40) < eps)
jt = [(z, v) for z, v in zip(grid, js) if z <= z_lo]
check("JS strictly increasing as Z falls below -1.5", all(jt[i][1] > jt[i + 1][1] for i in range(len(jt) - 1)))
check("JS continuous at -1.5 (|PD(-1.5-1e-9) - 0.40| < 1e-6)", abs(out['e9'] - 0.40) < 1e-6)
check("JS PD(-7) > 0.98 and < 1", 0.98 < out['m7'] < 1.0, f"{out['m7']:.6f}")
check("JS tail follows b (equals rating_tail at b=-1.5; moves with b)", out['bdiff'] < eps and out['bmove'] > 0.05)
pv = shocks.pd_value(-3, "D", False, {"pd_method": "rating_smooth"})      # no pd_logit_b: the pd_value fallback (-1.17), as for rating_tail
check("rating_smooth without pd_logit_b: same fallback b as rating_tail, Py == JS", abs(out['noB'] - pv) < eps and abs(out['noB'] - out['noBtail']) < eps and abs(pv - tailpy(-3, -1.17)) < eps)
check("JS PD == 0.02% for Z >= 4.9", all(abs(v - 0.0002) < eps for z, v in zip(grid, js) if z >= z_hi))
mxj = max(abs(js[i + 1] - js[i]) for i in range(len(js) - 1))
check("JS continuous: max |dPD| between grid points < 2e-3", mxj < 2e-3, f"max {mxj:.3e}")
check("NaN in -> NaN out (JS)", out['nan'])
par = max(abs(a - b) for a, b in zip(py, js))
check("Py/JS parity < 1e-12 on the whole grid", par < eps, f"max {par:.3e}")

# Monte Carlo default method and EFC column, both engines
raw = data_loader.demo_portfolio(); en = calculations.compute_zem_components(data_loader.coerce_numeric(raw)); base = en.iloc[-1]
p = dict(config.DEFAULT_SHOCK_PARAMS, **config.DEFAULT_CASH_SETTINGS); p.update(fuel_shock_pct=.5, fuel_cost_share=.35)
mc = shocks.run_monte_carlo(base, p, n_sims=10, fuel_std=.05, fx_std=.07, correlation=.2, horizon_years=2, lgd_pct=70, seed=42)
check("Python MC default method is rating_smooth", set(mc['MC_PD_Model']) == {'rating_smooth'})
check("Python MC default EFC == EFC_Rating_Anchored", bool((abs(mc['EFC'] - mc['EFC_Rating_Anchored']) < 1e-9).all()))
payload = {'config': report.config_payload(), 'base': json.loads(base.to_json()), 'params': p, 'engine': str(R / 'templates/engine.js')}
runner = r'''const fs=require('fs');const i=JSON.parse(fs.readFileSync(0,'utf8'));const E=require(i.engine).create(i.config);
const s=E.monteCarlo(i.base,i.params,{n:10,fuelSd:.05,fxSd:.07,rho:.2,H:2,lgd:70,seed:42});
const rows=s.flatMap(x=>x.path);
console.log(JSON.stringify({m:[...new Set(rows.map(r=>r.MC_PD_Model))],e:Math.max(...rows.map(r=>Math.abs(r.EFC-r.EFC_Rating_Anchored)))}));'''
o = json.loads(subprocess.run(['node', '-e', runner], capture_output=True, text=True, input=json.dumps(payload), check=True).stdout)
check("JS MC default method is rating_smooth", o['m'] == ['rating_smooth'], str(o['m']))
check("JS MC default EFC == EFC_Rating_Anchored", o['e'] < 1e-9, f"max diff {o['e']:.1e}")
# Monte Carlo through the tail: a stressed SOE whose simulated Z-EM falls below -1.5, with a non-default b.
# Every rating-anchored PD column must equal anchored_pd(z, b) in both engines (b is passed through, not defaulted).
sb = en.iloc[3]; ps = dict(config.DEFAULT_SHOCK_PARAMS, **config.DEFAULT_CASH_SETTINGS); ps.update(config.OIL_SHOCK_PRESET); ps['pd_logit_b'] = -1.4
kwm = dict(n_sims=6, fuel_std=.1, fx_std=.08, correlation=.3, horizon_years=3, lgd_pct=70, seed=42)
mt = shocks.run_monte_carlo(sb, ps, **kwm)
below = mt['Z_EM'] < z_lo
check("MC tail test has simulated Z-EM below -1.5", int(below.sum()) > 0, f"{int(below.sum())} of {len(mt)}")
check("Python MC PD and PD_Rating_Anchored == anchored_pd(z, b=-1.4)", max(abs(mt['PD'][i] - anchored_pd(z, -1.4)) + abs(mt['PD_Rating_Anchored'][i] - anchored_pd(z, -1.4)) for i, z in mt['Z_EM'].items()) < eps)
check("Python MC tail PD above 40% where Z-EM < -1.5", bool((mt.loc[below, 'PD'] > 0.40).all()))
payload = {'config': report.config_payload(), 'base': json.loads(sb.to_json()), 'params': ps, 'engine': str(R / 'templates/engine.js')}
runner = r'''const fs=require('fs');const i=JSON.parse(fs.readFileSync(0,'utf8'));const E=require(i.engine).create(i.config);
const s=E.monteCarlo(i.base,i.params,{n:6,fuelSd:.1,fxSd:.08,rho:.3,H:3,lgd:70,seed:42});
console.log(JSON.stringify(s.flatMap(x=>x.path).map(r=>[r.Z_EM,r.PD,r.PD_Rating_Anchored])));'''
rows = json.loads(subprocess.run(['node', '-e', runner], capture_output=True, text=True, input=json.dumps(payload), check=True).stdout)
check("JS MC PD and PD_Rating_Anchored == Python anchored_pd(z, b=-1.4)", max(max(abs(pd_ - anchored_pd(z, -1.4)), abs(pa - anchored_pd(z, -1.4))) for z, pd_, pa in rows) < eps and len(rows) == len(mt))
if fails:
    print("FAILED:", ", ".join(fails)); sys.exit(1)
print("PASS rating-anchored PD")
