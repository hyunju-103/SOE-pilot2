"""Fetch nominal GDP (local currency and US dollars) from the IMF World Economic Outlook and write assets/weo_gdp.json.

    python scripts/fetch_weo_gdp.py [--vintage "October 2026"] [--out assets/weo_gdp.json]

Source: IMF SDMX 3.0 API, dataflow IMF.RES:WEO, indicators NGDP (national currency, "CN") and NGDPD (US dollars, "CD").
Standard library only. Keys are sorted so that reruns give stable diffs.
"""
import argparse, csv, datetime as dt, io, json, sys, urllib.request
from pathlib import Path

URL = "https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/WEO/+/*.{ind}.A"
SERIES = {"CN": "NGDP", "CD": "NGDPD"}
YEARS = range(2000, 2032)
# WEO ISO3 code -> the code the app's GDP_COUNTRIES (templates/app.js) uses
REMAP = {"WBG": "PSE", "UVK": "XKX", "KOS": "XKX"}  # the WEO has used UVK and now uses KOS for Kosovo
# WEO country groups (G001 ... GX123): not economies, left out
is_group = lambda c: c.startswith("G") and any(ch.isdigit() for ch in c)


def fetch(ind):
    req = urllib.request.Request(URL.format(ind=ind), headers={"Accept": "application/vnd.sdmx.data+csv;version=2.0.0", "User-Agent": "soe-tool-build/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8-sig"))))


def parse_date(s):
    for f in ("%m/%d/%Y", "%Y-%m-%d"):
        try: return dt.datetime.strptime(s.strip(), f).date()
        except ValueError: pass
    return None


def app_codes():
    js = (Path(__file__).resolve().parent.parent / "templates" / "app.js").read_text(encoding="utf-8")
    body = js.split("const GDP_COUNTRIES = (", 1)[1].split(".split(", 1)[0]
    text = "".join(p.split('"')[1] for p in body.split("+") if '"' in p)
    return {x.split("|")[0] for x in text.split(";") if x}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--vintage", help='e.g. "October 2026"; default: derived from the latest COUNTRY_UPDATE_DATE')
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "assets" / "weo_gdp.json"))
    a = ap.parse_args()
    out, upd, flows = {}, [], set()
    for key, ind in SERIES.items():
        tab = {}
        for r in fetch(ind):
            if r.get("INDICATOR") != ind: continue
            try: yr, v = int(r["TIME_PERIOD"]), float(r["OBS_VALUE"])
            except (ValueError, KeyError, TypeError): continue
            if yr not in YEARS or v != v: continue
            c = REMAP.get(r["COUNTRY"], r["COUNTRY"])
            if is_group(c): continue
            tab.setdefault(c, {})[str(yr)] = int(round(v))
            flows.add(r.get("STRUCTURE_ID", ""))
            d = parse_date(r.get("COUNTRY_UPDATE_DATE", ""))
            if d: upd.append(d)
        out[key] = tab
    if not upd: sys.exit("no COUNTRY_UPDATE_DATE found")
    latest = max(upd)
    vintage = a.vintage or f"{'April' if latest.month <= 6 else 'October'} {latest.year}"
    flow = sorted(f for f in flows if f)
    doc = {"source": "IMF World Economic Outlook", "vintage": vintage, "dataflow": flow[0] if flow else "IMF.RES:WEO",
           "updated": latest.isoformat(), "fetched": dt.date.today().isoformat(), "CN": out["CN"], "CD": out["CD"]}
    Path(a.out).write_text(json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    codes, weo = app_codes(), set(out["CN"]) | set(out["CD"])
    print(f"wrote {a.out}: CN {len(out['CN'])} economies, CD {len(out['CD'])}; vintage {vintage}; updated {latest}; dataflows {flow}")
    print("remaps:", REMAP)
    print("GDP_COUNTRIES codes with no WEO data:", " ".join(sorted(codes - weo)))
    print("WEO codes not in GDP_COUNTRIES:", " ".join(sorted(weo - codes)))


if __name__ == "__main__":
    main()
