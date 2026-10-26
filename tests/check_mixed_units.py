"""
Checks that mixed Units / Currency in an upload are handled: amounts are put on
one scale before any portfolio sum, a file mixing currencies is rejected, and
the browser engine (templates/engine.js and the copy inside
SOE-Fiscal-Risk-Final.html) gives the same answers as data_loader.
The JS parts need Node.js on PATH and are skipped without it.

    python tests/check_mixed_units.py
"""

import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import calculations  # noqa: E402
import config  # noqa: E402
import data_loader  # noqa: E402
import report  # noqa: E402
import schema  # noqa: E402
from utils.portfolio import latest_per_entity  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
    if not ok:
        fails.append(name)


def total_efc(df):
    latest = latest_per_entity(calculations.compute_zem_components(df))
    return float(calculations.compute_efc(latest, config.LGD_SLIDER_DEFAULT)["EFC"].sum())


AMOUNTS = [v["column"] for v in schema.VARIABLES if v["kind"] == "amount"]

# (a) the label parser
for label, want in [("LCU millions", 1e6), ("Millions", 1e6), ("In thousands", 1e3), ("'000", 1e3), ("000s", 1e3), ("bn", 1e9),
                    ("USD billion", 1e9), ("Mio", 1e6), ("USD m", 1e6), ("k", 1e3), ("Amount", 1.0), ("Absolute", 1.0),
                    ("1000", 1.0), ("", 1.0), (None, 1.0), (float("nan"), 1.0)]:
    check(f"unit_scale_of({label!r}) = {want:g}", data_loader.unit_scale_of(label) == want, data_loader.unit_scale_of(label))

# (b) mixed units: one entity re-expressed in thousands, one in billions -> same portfolio EFC after harmonising
base = data_loader.coerce_numeric(data_loader.demo_portfolio())
baseline = total_efc(base)
AMOUNTS = [c for c in AMOUNTS if c in base.columns]  # the demo carries a subset
base[AMOUNTS] = base[AMOUNTS].astype(float)
units0 = base["Units"].iloc[0]
mixed = base.copy()
for ent, label, k in [("SOE C", "Thousands", 1e-3), ("SOE E", "Billions", 1e-9)]:  # same money, quoted in bigger units
    m = mixed["Entity"] == ent
    mixed.loc[m, AMOUNTS] = mixed.loc[m, AMOUNTS].mul(k)
    mixed.loc[m, "Units"] = label
check("mixed units distort the unharmonised total", abs(total_efc(mixed) - baseline) > 1e-6 * abs(baseline))
fixed, note = data_loader.harmonize_units(mixed)
print("     " + note)
check("harmonised total EFC equals baseline", math.isclose(total_efc(fixed), baseline, rel_tol=1e-9), (total_efc(fixed), baseline))
check("Units column uniform", fixed["Units"].nunique() == 1 and fixed["Units"].iloc[0] == units0, fixed["Units"].unique())
check("note names the conversion", note.startswith("Units harmonised: ") and note.endswith(f"to {units0}."), note)
check("idempotent", data_loader.harmonize_units(fixed)[1] == "" and data_loader.harmonize_units(fixed)[0].equals(fixed))
check("uniform file untouched, no note", data_loader.harmonize_units(base)[1] == "")
check("Year and shares not rescaled", fixed["Year"].equals(mixed["Year"]) and fixed["FX Debt Share"].equals(mixed["FX Debt Share"]) or
      fixed["FX Debt Share"].fillna(-1).equals(mixed["FX Debt Share"].fillna(-1)))
blank = mixed.copy()
blank.loc[blank["Entity"] == "SOE A", "Units"] = ""
fb, nb = data_loader.harmonize_units(blank)
check("blank Units rows inherit the main unit, unconverted",
      fb.loc[fb["Entity"] == "SOE A", "Total Assets"].equals(blank.loc[blank["Entity"] == "SOE A", "Total Assets"]) and fb["Units"].nunique() == 1)

# (c) mixed currency
cur0 = base["Currency"].iloc[0]
mc = base.copy()
mc.loc[mc["Entity"] == "SOE B", "Currency"] = " usd "
msg = data_loader.currency_mix(mc)
v = data_loader.validate_schema(mc)
check("mixed currency flagged", bool(msg) and v["mixed_currency"] == msg and v["ok"] is False and "SOE B" in msg, msg)
print("     " + msg)
check("one currency passes", data_loader.currency_mix(base) == "" and data_loader.validate_schema(base)["ok"])
sw = base.copy()
sw.loc[(sw["Entity"] == "SOE A") & (sw["Year"] == sw["Year"].max()), "Currency"] = "USD"
check("entity switching currency across years is flagged", "SOE A" in data_loader.currency_mix(sw))
many = base.copy()
many["Entity"] = [f"E{i:02d}" for i in range(len(many))]
many["Currency"] = ["XOF" if i < 8 else "USD" for i in range(len(many))]
check("long entity lists truncated", "+3 more" in data_loader.currency_mix(many), data_loader.currency_mix(many))

# (c, d) the same through the browser engine
node = shutil.which("node")
if not node:
    print("SKIP Node.js not found - skipping the engine parity parts (c, d).")
else:
    RUNNER = r"""
const fs = require("fs");
const inp = JSON.parse(fs.readFileSync(0, "utf8"));
const E = require(inp.engine).create(inp.config);
const NUM = new Set(inp.config.ALL_NUMERIC_COLUMNS);
const fix = (rows) => rows.map(r => { const o = {}; for (const k in r) o[k] = NUM.has(k) ? (r[k] === null ? NaN : r[k]) : (r[k] === null ? "" : r[k]); return o; });
const h = E.harmonizeUnits(fix(inp.mixed)), hb = E.harmonizeUnits(fix(inp.blank));
const keep = (rows) => rows.map(r => inp.keys.map(k => r[k]));
process.stdout.write(JSON.stringify({
  scales: inp.labels.map(l => E.unitScale(l)), note: h.note, rows: keep(h.rows), noteBlank: hb.note, rowsBlank: keep(hb.rows),
  noteUniform: E.harmonizeUnits(fix(inp.base)).note, again: E.harmonizeUnits(h.rows).note,
  cur: E.currencyMix(fix(inp.mc)), curOne: E.currencyMix(fix(inp.base)), curSwitch: E.currencyMix(fix(inp.sw)), curMany: E.currencyMix(fix(inp.many)),
}));
"""
    html = (ROOT / "SOE-Fiscal-Risk-Final.html").read_text(encoding="utf-8")
    blocks = re.findall(r"<script>(.*?)</script>", html, re.S)
    inline = next(b for b in blocks if "function create(CFG)" in b)
    tmp = Path(tempfile.mkdtemp())
    (tmp / "engine_final.js").write_text(inline, encoding="utf-8")
    keys = ["Entity", "Year", "Units"] + AMOUNTS
    labels = ["LCU millions", "In thousands", "'000", "bn", "Amount", "Absolute", "1000", "", "Mio", "000s", "USD m", "k"]
    rec = lambda d: json.loads(d.astype(object).where(d.notna(), None).to_json(orient="records"))
    payload = dict(config=report.config_payload(), keys=keys, labels=labels, mixed=rec(mixed), blank=rec(blank), base=rec(base),
                   mc=rec(mc), sw=rec(sw), many=rec(many))
    pyrows = [[(None if (isinstance(x, float) and math.isnan(x)) else x) for x in r] for r in fixed[keys].astype(object).values.tolist()]
    pyblank = [[(None if (isinstance(x, float) and math.isnan(x)) else x) for x in r] for r in fb[keys].astype(object).values.tolist()]

    def same(a, b):
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
            return a == b or math.isclose(a, b, rel_tol=1e-12)
        return a == b

    for tag, path in [("templates/engine.js", ROOT / "templates" / "engine.js"), ("Final.html inline engine", tmp / "engine_final.js")]:
        res = subprocess.run([node, "-e", RUNNER], input=json.dumps(dict(payload, engine=str(path))), capture_output=True, text=True)
        if res.returncode:
            check(f"[{tag}] runs", False, res.stderr[-400:])
            continue
        out = json.loads(res.stdout)
        check(f"[{tag}] unitScale matches Python", out["scales"] == [data_loader.unit_scale_of(l) for l in labels], out["scales"])
        check(f"[{tag}] harmonizeUnits note identical", out["note"] == note and out["noteBlank"] == nb, (out["note"], note))
        check(f"[{tag}] harmonizeUnits numbers identical",
              all(same(a, b) for ra, rb in zip(out["rows"] + out["rowsBlank"], pyrows + pyblank) for a, b in zip(ra, rb))
              and len(out["rows"]) == len(pyrows))
        check(f"[{tag}] uniform and repeat runs convert nothing", out["noteUniform"] == "" and out["again"] == "")
        check(f"[{tag}] currencyMix identical", out["cur"] == msg and out["curOne"] == "" and out["curSwitch"] == data_loader.currency_mix(sw)
              and out["curMany"] == data_loader.currency_mix(many), (out["cur"], msg))

print()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: {', '.join(fails)}")
sys.exit(1 if fails else 0)
