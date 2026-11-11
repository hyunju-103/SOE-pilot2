"""
Lower customer collections must never raise Z-EM (both engines).

A toy SOE (total assets 1000, current assets 200 of which cash 50, current
liabilities 250, equity 300) is projected with full collection and with 10% or
30% of customer bills unpaid, in three cases: A profit 30, B loss 100 with the
cash gap borrowed long-term, D loss 100 borrowed short-term. Across arrears
collection rates 0 / 0.5 / 1 and horizons 1 and 3, Z with unpaid bills must be
at or below Z with full collection in every year, and TA = TL + equity must
hold. Also checks that a profitable year's surplus is held as cash.

    python tests/check_collections_sign.py      (needs Node.js on PATH for the JS half)
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

import config  # noqa: E402
import report  # noqa: E402
import shocks  # noqa: E402

EPS = 1e-9
ZERO = {k: 0.0 for k in ["fuel_shock_pct", "fx_shock_pct", "rate_shock_bps", "revenue_shock_std_devs",
                         "refinancing_spread_bps", "arrears_pct_of_revenue", "tariff_increase_pct"]}


def base_row(ni):
    ebit = ni + 20.0                                     # interest 20, tax 0
    return {"Entity": "Toy", "Sector": "Power / Utilities", "Year": 2025, "Operating Profits (EBIT)": ebit,
            "Interest Expense": 20.0, "Tax Expense": 0.0, "Retained Earnings": 100.0, "Equity": 300.0,
            "Total Liabilities": 700.0, "Total Assets": 1000.0, "Current Assets": 200.0, "Current Liabilities": 250.0,
            "Depreciation": 50.0, "Revenues": 500.0, "Operating Expense": 500.0 - ebit, "Net Income": ni,
            "Cash and Equivalents": 50.0, "Government Grants": 0.0}


def params(extra):
    p = dict(config.DEFAULT_SHOCK_PARAMS, **config.DEFAULT_EXPOSURES, **config.DEFAULT_CASH_SETTINGS, **ZERO,
             fuel_shock_path=[], fuel_cost_share=0.3, shock_duration_years=1, revenue_shock_pct=0.0)
    p.update(extra)
    return p


CASES = {"A profit 30": (30.0, {}), "B loss 100, long-term": (-100.0, {}),
         "D loss 100, short-term": (-100.0, {"cash_gap_short_term_share": 1.0})}
UNPAID = [0.10, 0.30]
COLLECTED = [0.0, 0.5, 1.0]
HORIZONS = [1, 3]


def runs():
    """(label, ni, params, H) for every full-collection run and its low-collection twins."""
    out = []
    for case, (ni, extra) in CASES.items():
        for cc in COLLECTED:
            for h in HORIZONS:
                full = params(dict(extra, customer_arrears_collected=cc))
                out.append((f"{case} | collected {cc} | H {h} | full", ni, full, h))
                for u in UNPAID:
                    low = dict(full, collect_households=1 - u, collect_large_private=1 - u, collect_public=1 - u)
                    out.append((f"{case} | collected {cc} | H {h} | unpaid {u:.0%}", ni, low, h))
    return out


def py_paths(rs):
    res = {}
    for label, ni, p, h in rs:
        df = shocks.run_scenario(pd.Series(base_row(ni)), p, h)
        res[label] = {k: df[k].tolist() for k in ["Z_EM", "Total Assets", "Total Liabilities", "Equity", "Cash", "Current Assets"]}
    return res


NODE = r"""
const fs = require("fs");
const inp = JSON.parse(fs.readFileSync(0, "utf8"));
const E = require(inp.engine).create(inp.config);
const out = {};
for (const [label, row, p, h] of inp.runs) {
  const path = E.runScenario(row, p, h);
  out[label] = Object.fromEntries(inp.keys.map(k => [k, path.map(x => x[k])]));
}
process.stdout.write(JSON.stringify(out));
"""


def js_paths(rs):
    node = shutil.which("node")
    if not node:
        print("SKIP: node not on PATH, JS engine not checked")
        return None
    payload = {"engine": str(ROOT / "templates" / "engine.js"), "config": report.config_payload(),
               "keys": ["Z_EM", "Total Assets", "Total Liabilities", "Equity", "Cash", "Current Assets"],
               "runs": [[label, base_row(ni), p, h] for label, ni, p, h in rs]}
    res = subprocess.run([node, "-e", NODE], input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def check(engine, paths, fails):
    n = 0
    for label, v in paths.items():
        for t, (ta, tl, eq) in enumerate(zip(v["Total Assets"], v["Total Liabilities"], v["Equity"])):
            n += 1
            if abs(ta - tl - eq) > 1e-6:
                fails.append(f"{engine} {label} year {t}: TA - TL - equity = {ta - tl - eq:.6g}")
        if "unpaid" not in label:
            continue
        ref = paths[label.rsplit("|", 1)[0] + "| full"]
        for t, (z, z0) in enumerate(zip(v["Z_EM"], ref["Z_EM"])):
            n += 1
            if z > z0 + EPS:
                fails.append(f"{engine} {label} year {t}: Z {z:.4f} > full-collection Z {z0:.4f}")
    # Fix 1: case A, full collection, one year: the 30 surplus is held as cash (50 + 30) and counts as a current asset
    a = paths["A profit 30 | collected 0.5 | H 1 | full"]
    for k, want in [("Cash", 80.0), ("Current Assets", 230.0)]:
        n += 1
        if abs(a[k][1] - want) > 1e-9:
            fails.append(f"{engine} case A full collection: {k} year 1 = {a[k][1]:.4f}, expected {want}")
    return n


def main():
    rs = runs()
    fails = []
    n = check("py", py_paths(rs), fails)
    js = js_paths(rs)
    if js is not None:
        n += check("js", js, fails)
    if fails:
        print(f"FAIL: {len(fails)} of {n} checks")
        for f in fails[:40]:
            print("  " + f)
        sys.exit(1)
    print(f"OK: {n} checks, lower collections never raise Z-EM (py{' + js' if js is not None else ''})")


if __name__ == "__main__":
    main()
