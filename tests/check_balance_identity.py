"""
Balance-sheet identity and borrowing-cap checks for shocks.run_scenario and
templates/engine.js.

    python tests/check_balance_identity.py

1. TA - TL - Equity is constant across the projection years (|drift| < 1e-6 TA)
   for the demo portfolio under the default shock and the oil preset, with
   arrears_pct_of_revenue in {0, 0.1, 0.3}, the waterfall on and off, and the
   borrowing cap at 0 and 0.7 - in Python and in the JavaScript engine (which
   must also match Python on TA, TL, Equity, Retained Earnings).
2. Borrowing cap: in every year the SOE borrows under a cap (waterfall off, opening
   TL/TA below the cap), year-end TL/TA is at or below the cap (+1e-9), in both
   engines. The cap limits NEW BORROWING only. It cannot hold in a year with no
   borrowing in which total assets shrink (a receivable collected and spent on a
   loss, an arrears write-down) or in which unpaid bills are added to liabilities
   by the waterfall (the cap is inert under the waterfall by design, see
   check_cash_waterfall.py part 6); those years are not asserted.
3. Cash never exceeds current assets (C3b), for arrears_pct_of_revenue <= 0.1. At
   0.3 of revenue per year the write-down used to exceed the non-cash current
   assets of some demo SOEs; since 2026-10-26 it is capped at the non-cash current
   assets left (see check_arrears_cap.py), but this check still asserts C3b only
   up to 0.1.
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
KEYS = ["Cash Funding Gap", "Total Assets", "Total Liabilities", "Equity", "Retained Earnings", "Current Assets", "Cash", "Z_EM", "Rating"]

NODE_RUNNER = r"""
const fs = require("fs");
const inp = JSON.parse(fs.readFileSync(0, "utf8"));
const E = require(inp.engine).create(inp.config);
const NUM = new Set(inp.config.ALL_NUMERIC_COLUMNS);
const rows = inp.rows.map(r => { const o = {}; for (const k in r) o[k] = NUM.has(k) ? (r[k] === null ? NaN : r[k]) : r[k]; return o; });
const latest = E.latestPerEntity(E.enrich(rows));
const by = Object.fromEntries(latest.map(r => [r.Entity, r]));
const out = inp.cases.map(c => E.runScenario(by[c.entity], c.params, inp.H).map(x => Object.fromEntries(inp.keys.map(k => [k, x[k]]))));
process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)));
"""


def cases_for(latest):
    base = dict(config.DEFAULT_SHOCK_PARAMS)
    oil = {**config.DEFAULT_SHOCK_PARAMS, **config.OIL_SHOCK_PRESET, "fx_shock_pct": 0.3}
    for pname, p0 in [("default", base), ("oil", oil)]:
        for arr in (0.0, 0.1, 0.3):
            for wf in (0.0, 1.0):
                for cap in (0.0, 0.7):
                    for _, r in latest.iterrows():
                        p = params_for(r, dict(p0, arrears_pct_of_revenue=arr, waterfall_on=wf, borrowing_cap_debt_to_assets=cap))
                        yield f"{pname} arrears={arr} wf={wf:g} cap={cap} {r['Entity']}", r, p


def clean(p):
    return {k: (None if isinstance(v, float) and v != v else v) for k, v in p.items()}


def main():
    fails, n = [], 0
    raw = with_cash(data_loader.demo_portfolio())
    latest = panel(raw)
    cases = list(cases_for(latest))
    py = [shocks.run_scenario(r, p, H) for _, r, p in cases]

    node = shutil.which("node")
    js = None
    if node:
        payload = {"engine": str(ROOT / "templates" / "engine.js"), "config": report.config_payload(), "rows": report.rows_payload(raw),
                   "cases": [{"entity": r["Entity"], "params": clean(p)} for _, r, p in cases], "keys": KEYS, "H": H}
        js = json.loads(subprocess.run([node, "-e", NODE_RUNNER], input=json.dumps(payload), capture_output=True, text=True, check=True).stdout)
    else:
        print("Node.js not found - JavaScript half of the balance-identity check skipped.")

    n_cap = 0
    for i, (label, r, p) in enumerate(cases):
        path = py[i]
        ta0 = float(r["Total Assets"])
        gap0 = ta0 - r["Total Liabilities"] - r["Equity"]
        cap = p["borrowing_cap_debt_to_assets"]
        capped = cap > 0 and r["Total Liabilities"] / ta0 < cap and not p["waterfall_on"]
        for engine in ("py", "js"):
            if engine == "js" and js is None:
                continue
            for t in range(len(path)):
                if engine == "py":
                    ta, tl, eq, ca, cash = (float(path[k].iloc[t]) for k in ("Total Assets", "Total Liabilities", "Equity", "Current Assets", "Cash"))
                else:
                    row = js[i][t]
                    ta, tl, eq, ca, cash = (row[k] for k in ("Total Assets", "Total Liabilities", "Equity", "Current Assets", "Cash"))
                    for k in ("Total Assets", "Total Liabilities", "Equity", "Retained Earnings", "Current Assets", "Cash", "Z_EM"):
                        n += 1
                        a = float(path[k].iloc[t])
                        if abs(a - row[k]) > 1e-9 * max(1.0, abs(a)):
                            fails.append(f"{label} t={t} {k}: py={a} js={row[k]}")
                n += 1
                if abs(ta - tl - eq - gap0) >= 1e-6 * ta0:
                    fails.append(f"1 identity {engine} {label} t={t}: drift {ta - tl - eq - gap0:.6g}")
                if p["arrears_pct_of_revenue"] <= 0.1:
                    n += 1
                if p["arrears_pct_of_revenue"] <= 0.1 and cash > ca + 1e-6 * ta0:
                    fails.append(f"3 cash {cash:.6g} > current assets {ca:.6g} {engine} {label} t={t}")
                borrowed = float(path["Cash Funding Gap"].iloc[t]) if engine == "py" else row["Cash Funding Gap"]
                if capped and borrowed > 0:
                    n += 1
                    n_cap += 1
                    if tl / ta > cap + 1e-9:
                        fails.append(f"2 cap {engine} {label} t={t}: TL/TA {tl / ta:.6f} > {cap}")
    n += 1
    if n_cap == 0:
        fails.append("2 no case borrowed under a cap - vacuous")

    if fails:
        print(f"{len(fails)} failures (of {n} checks):")
        print("\n".join(fails[:60]))
        return 1
    print(f"OK - balance identity and borrowing cap: {n} checks passed ({len(cases)} cases, {n_cap} cap-year checks, JS {'on' if js else 'off'}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
