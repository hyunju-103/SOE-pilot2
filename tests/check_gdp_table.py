"""Checks the saved IMF WEO GDP table (assets/weo_gdp.json) and that report.py embeds it in the built page.

Run: python tests/check_gdp_table.py   (needs SOE-Fiscal-Risk-Final.html, built by report.py)"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails = []


def check(ok, msg):
    if not ok:
        fails.append(msg)


path = ROOT / "assets" / "weo_gdp.json"
try:
    tab = json.loads(path.read_text(encoding="utf-8"))
except (OSError, ValueError) as e:
    print(f"FAIL: cannot load {path}: {e}")
    sys.exit(1)

for key in ("CN", "CD"):
    t = tab.get(key, {})
    check(len(t) >= 190, f"{key}: {len(t)} economies, expected at least 190")
    bad = [(c, y, v) for c, ys in t.items() for y, v in ys.items()
           if not (isinstance(v, int) and not isinstance(v, bool) and v > 0 and y.isdigit() and 2000 <= int(y) <= 2031)]
    check(not bad, f"{key}: {len(bad)} values not a positive integer in 2000-2031, e.g. {bad[:3]}")
    for c in ("PSE", "XKX"):
        check(c in t, f"{key}: {c} missing")
    for c in ("WBG", "UVK"):
        check(c not in t, f"{key}: {c} should have been remapped")
check(tab.get("CN", {}).get("SEN", {}).get("2024") == 19506125843000, "CN SEN 2024 != 19506125843000")
check(bool(tab.get("vintage")) and bool(tab.get("updated")), "vintage / updated missing")

html = ROOT / "SOE-Fiscal-Risk-Final.html"
if html.exists():
    m = re.search(r'<script id="app-data" type="application/json">(.*?)</script>', html.read_text(encoding="utf-8"), re.S)
    data = json.loads(m.group(1).replace("<\\/", "</")) if m else {}
    check(data.get("gdp") == tab, "the table embedded in SOE-Fiscal-Risk-Final.html (app-data, key gdp) differs from assets/weo_gdp.json")
else:
    fails.append("SOE-Fiscal-Risk-Final.html not built")

for f in fails:
    print("FAIL:", f)
print("GDP table checks:", "FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
