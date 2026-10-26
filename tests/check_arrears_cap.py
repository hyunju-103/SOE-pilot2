"""
Government-arrears write-down cap (meeting of 2026-10-26).

    python tests/check_arrears_cap.py

In the review meeting a large arrears shock (+130% of revenue a year) moved a
distressed SOE to the "Safe" zone: the write-down of current assets exceeded the
assets left, total assets turned negative and the Z-EM ratios flipped sign. The
write-down is now capped at the non-cash current assets left (shocks.py and
templates/engine.js). This script checks, for the demo portfolio (with and
without opening cash) and the long panel, arrears of 0 to 130% of revenue a year
and the default and oil exposures, that

1. total assets stay positive in every projection year (Python and JavaScript);
2. the arrears shock never leaves an SOE in a BETTER zone than the same SOE with
   no arrears, in any year (Python and JavaScript);
3. the two engines agree on Total Assets, Current Assets and Z-EM.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

import config  # noqa: E402
import data_loader  # noqa: E402
import report  # noqa: E402
import shocks  # noqa: E402
from check_fuel_path_cash import panel, params_for, with_cash  # noqa: E402

H = 5
ARREARS = (0.0, 0.05, 0.3, 0.5, 1.0, 1.3)
ZONE_RANK = {"Distress": 0, "Grey": 1, "Safe": 2}
KEYS = ["Total Assets", "Current Assets", "Z_EM", "Zone"]

NODE_RUNNER = r"""
const fs = require("fs");
const inp = JSON.parse(fs.readFileSync(0, "utf8"));
const E = require(inp.engine).create(inp.config);
const NUM = new Set(inp.config.ALL_NUMERIC_COLUMNS);
const out = inp.cases.map(c => {
  const r = {}; for (const k in c.row) r[k] = NUM.has(k) ? (c.row[k] === null ? NaN : c.row[k]) : c.row[k];
  return E.runScenario(E.enrichRow(r), c.params, inp.H).map(x => Object.fromEntries(inp.keys.map(k => [k, x[k]])));
});
process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)));
"""


def zero_magnitudes(p0):
    p = dict(p0)
    for k in ["fuel_shock_pct", "fx_shock_pct", "rate_shock_bps", "revenue_shock_std_devs", "refinancing_spread_bps", "tariff_increase_pct"]:
        p[k] = 0.0
    p["fuel_shock_path"] = []
    return p


def cases():
    base = zero_magnitudes(config.DEFAULT_SHOCK_PARAMS)
    oil = zero_magnitudes({**config.DEFAULT_SHOCK_PARAMS, **config.OIL_SHOCK_PRESET})
    for dname, raw in [("demo", data_loader.demo_portfolio()), ("demo+cash", with_cash(data_loader.demo_portfolio())), ("long", data_loader.long_panel_demo())]:
        latest = panel(raw)
        for pname, p0 in [("default", base), ("oil-exposures", oil)]:
            for _, r in latest.iterrows():
                for arr in ARREARS:
                    yield f"{dname} {pname} {r['Entity']} arrears={arr}", r, params_for(r, dict(p0, arrears_pct_of_revenue=arr))


def clean(v):
    if isinstance(v, float) and v != v:
        return None
    if hasattr(v, "item"):
        v = v.item()
    return v


def main():
    fails, n = [], 0
    cs = list(cases())
    py = [shocks.run_scenario(r, p, H) for _, r, p in cs]
    node = shutil.which("node")
    js = None
    if node:
        cfg = report.config_payload()
        inp = {"engine": str(ROOT / "templates" / "engine.js"), "config": cfg, "H": H, "keys": KEYS,
               "cases": [{"row": {k: clean(v) for k, v in r.items()}, "params": {k: clean(v) for k, v in p.items()}} for _, r, p in cs]}
        res = subprocess.run([node, "-e", NODE_RUNNER], input=json.dumps(inp), capture_output=True, text=True, check=True)
        js = json.loads(res.stdout)
    # the zero-arrears path of each SOE / data set / exposure set comes first in its block
    ref_py, ref_js = {}, {}
    for i, ((name, r, p), path) in enumerate(zip(cs, py)):
        key = name.rsplit(" arrears=", 1)[0]
        arr = p["arrears_pct_of_revenue"]
        if arr == 0:
            ref_py[key] = path
            if js is not None:
                ref_js[key] = js[i]
        ta0 = float(r["Total Assets"])
        for t in range(1, H + 1):
            n += 1
            if ta0 > 0 and not path["Total Assets"].iloc[t] > 0:
                fails.append(f"1 py {name} t={t}: total assets {path['Total Assets'].iloc[t]:.4g}")
            n += 1
            if ZONE_RANK.get(path["Zone"].iloc[t], -1) > ZONE_RANK.get(ref_py[key]["Zone"].iloc[t], -1):
                fails.append(f"2 py {name} t={t}: zone {path['Zone'].iloc[t]} better than no arrears ({ref_py[key]['Zone'].iloc[t]})")
            if js is not None:
                j = js[i][t]
                n += 1
                if ta0 > 0 and not (j["Total Assets"] or 0) > 0:
                    fails.append(f"1 js {name} t={t}: total assets {j['Total Assets']}")
                n += 1
                if ZONE_RANK.get(j["Zone"], -1) > ZONE_RANK.get(ref_js[key][t]["Zone"], -1):
                    fails.append(f"2 js {name} t={t}: zone {j['Zone']} better than no arrears ({ref_js[key][t]['Zone']})")
                for k in ["Total Assets", "Current Assets", "Z_EM"]:
                    n += 1
                    a, b = float(path[k].iloc[t]), j[k]
                    if b is None or abs(a - b) > 1e-6 * max(1.0, abs(a), ta0 if k != "Z_EM" else 1.0):
                        fails.append(f"3 {name} t={t} {k}: py {a} js {b}")
    if fails:
        print(f"FAIL — {len(fails)} of {n} checks:")
        for f in fails[:40]:
            print("  ", f)
        sys.exit(1)
    print(f"OK — arrears write-down cap: {n} checks passed ({len(cs)} cases, arrears up to {max(ARREARS):.0%} of revenue a year{', JS on' if js is not None else ', JS skipped (no node)'}).")


if __name__ == "__main__":
    main()
