"""
The Simple view, round 2 (docs/DESIGN-simple-view.md, sections "Hard rules", "GDP", "DOM contract", "Copy"):
the built SOE-Fiscal-Risk-Final.html opens in Simple view, every cost is a share of GDP taken from the saved WEO
table, charts lead, no local-currency amount and no technical label appears, the figures equal the Analyst view's,
and the Analyst view (with the new KPI Dashboard) is intact behind the mode switch. Written against the contract.

Checks (numbers as in the failure messages):
  0 no page error, no World Bank request unless a check allows it     1 landing state
  2 GDP for the default data, network blocked
  3 per built-in dataset: a totals vs Analyst view, b scenario cards, c answer + portfolio chart, d SOE rows,
                          e no local currency, f State's-share range
  4 snapshot under a row      5 one-SOE page      6 banned labels      7 mode switch, Analyst view intact
  8 uploads: a Country column, b country from the currency, c country asked for, d earlier GDP year, e typed GDP
  9 KPI Dashboard (Analyst view)

Every http(s) request of the run is aborted and recorded: the page must work from its own saved table.
Shares are compared on data-v (fractions of GDP) with a relative tolerance of 1e-6; costs (data-now, data-fut,
totals) with 1e-9. All failures are collected and printed, then the exit code is 1.

Analyst-view sources (templates/app.js):
  * Expected Fiscal Cost tab, first tile "Aggregate EFC": `#efc .statstrip .tile` number 1, `.tile-value` first
    text node = money(total).
  * Report tab, card "Stress by channel": one row per CHANNELS() entry in order combined, fuel, fx, rate, revenue,
    refi, arrears; td index 4 = stressed portfolio cost, shown with money(). The Simple cards carry no money any
    more, only data-v; it is formatted here exactly as money() formats it (built-in data are in absolute units, so
    internal units = currency units) and compared with that text.
  * GDP at the horizon follows E.gdpPath(gdp, growth, H)[H] = gdp * (1 + growth) ** H (engine.js), growth =
    CFG.DEFAULT_GDP_GROWTH for the built-in data.

    python3 tests/check_simple_view.py      (run from the repo root; needs playwright + chromium)
"""

import csv
import json
import math
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "SOE-Fiscal-Risk-Final.html"
WEO = ROOT / "assets" / "weo_gdp.json"

try:
    from playwright.sync_api import sync_playwright
except Exception:  # noqa: BLE001
    print("SKIPPED: playwright is not installed (pip install playwright && playwright install chromium)")
    sys.exit(0)

URL = HTML.resolve().as_uri()
SHORT = 4000          # ms, for elements that should already be there
CHANNEL_KEYS = ["fuel", "fx", "rate", "revenue", "refi", "arrears", "combined"]
REPORT_ORDER = ["combined", "fuel", "fx", "rate", "revenue", "refi", "arrears"]   # CHANNELS() order
SCENARIOS = ["none"] + CHANNEL_KEYS
# (dataset key in app-data, chip label in 'Try example data'; None = the dataset the page opens on)
DATASETS = [("report", None), ("sample", "Example"), ("long", "Long panel")]
TABS = ["Home", "How it works", "KPI Dashboard", "Distress Indicator", "Expected Fiscal Cost", "Early Warning",
        "Report", "Shock Scenarios"]
BANNED = ["PD", "LGD", "EAD", "EFC", "Z″", "Z-EM", "X1", "X2", "X3", "X4", "bps", "s.d.", "std. dev.", "Monte Carlo",
          "P5", "P95", "percentile"]
CASE_INSENSITIVE = {"bps", "std. dev.", "s.d.", "Monte Carlo", "percentile"}
MONEY_RE = re.compile(r"\d[\d,.]*\s?(tn|bn|m)\b")          # a money amount such as "1.2 bn", "350 m", "2.05 tn"
LEVELS = ["none", "mild", "standard", "severe"]

FAILS = []
CHECKS = 0
CTX = {"errors": [], "requests": [], "wb": [], "wb_ok": False}


def check(cond, msg):
    global CHECKS
    CHECKS += 1
    if not cond:
        FAILS.append(msg)
    return bool(cond)


def fail(msg):
    check(False, msg)


def num(s):
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def close(a, b, tol=1e-9):
    return a is not None and b is not None and abs(a - b) <= tol * max(abs(a), abs(b), 1e-300)


def money_text(s):
    """Displayed money with whitespace and the currency suffix removed ('1.2 bn FCFA' -> '1.2 bn')."""
    s = re.sub(r"\s+", " ", (s or "").replace(" ", " ")).strip()
    m = re.match(r"^(−?[\d,]+(?:\.\d+)?(?: (?:tn|bn|m))?)(?: [A-Za-z]{2,5})?$", s)
    return m.group(1) if m else s


def js_fmt(v, d):
    """fmt() of templates/app.js: Math.round(v * 10**d) / 10**d, toFixed(d), '-' -> '−'."""
    r = math.floor(v * 10 ** d + 0.5) / 10 ** d
    return f"{r:.{d}f}".replace("-", "−")


def money_py(v):
    """money(v) of templates/app.js with the scale 1 and no currency (built-in data are in absolute units)."""
    if v is None:
        return "—"
    a = abs(v)
    if a >= 1e12:
        return js_fmt(v / 1e12, 2) + " tn"
    if a >= 1e9:
        return js_fmt(v / 1e9, 1) + " bn"
    if a >= 1e6:
        return js_fmt(v / 1e6, 1) + " m"
    return f"{math.floor(v + 0.5):,}".replace("-", "−")


def new_page(browser, url=URL, **kw):
    """A fresh page; every http(s) request is aborted and recorded, file:// and data: go through."""
    ctx = browser.new_context(reduced_motion="reduce", viewport={"width": 1400, "height": 1000}, **kw)

    def gate(route):
        u = route.request.url
        if u.startswith("http"):
            CTX["requests"].append(u)
            if "api.worldbank.org" in u and not CTX["wb_ok"]:
                CTX["wb"].append(u)
            route.abort()
        else:
            route.continue_()

    ctx.route("**/*", gate)
    page = ctx.new_page()
    page.set_default_timeout(SHORT)
    page.on("pageerror", lambda e: CTX["errors"].append(str(e)))
    page.goto(url)
    page.wait_for_load_state("load")
    return page


def present(page, sel, what, timeout=SHORT):
    """True when sel appears; otherwise record one 'cannot check' failure."""
    try:
        page.wait_for_selector(sel, state="attached", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        fail(f"cannot check {what}: {sel} missing")
        return False


def attr(page, sel, name):
    try:
        loc = page.locator(sel)
        return loc.first.get_attribute(name, timeout=SHORT) if loc.count() else None
    except Exception:  # noqa: BLE001
        return None


def text(page, sel):
    try:
        loc = page.locator(sel)
        return (loc.first.text_content(timeout=SHORT) or "") if loc.count() else None
    except Exception:  # noqa: BLE001
        return None


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace(" ", " ")).strip()


def visible_count(page, sel):
    return page.locator(sel).evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length")


def is_visible(page, sel):
    return visible_count(page, sel) > 0


def open_details(page, scope):
    page.evaluate("s => document.querySelectorAll(s + ' details').forEach(d => { d.open = true; })", scope)


def set_assume(page, state):
    page.evaluate("s => { const d = document.querySelector('#sv-assume'); if (d) d.open = s; }", state)
    page.wait_for_timeout(100)


def app_data(page):
    return json.loads(page.evaluate("document.getElementById('app-data').textContent"))


def app_config(page):
    return json.loads(page.evaluate("document.getElementById('app-config').textContent"))


def series(page, sel):
    """The JSON of an element's data-series, or None."""
    raw = attr(page, sel, "data-series")
    try:
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


def n_soes(ds):
    return len({r[ds["cols"].index("Entity")] for r in ds["data"]})


def last_year(ds):
    return max(r[ds["cols"].index("Year")] for r in ds["data"])


def pick(page, k):
    """Click the scenario card k and wait until it is pressed and the page has redrawn."""
    btn = page.locator(f'#sv-scen button[data-scen="{k}"]')
    if btn.count() == 0:
        return False
    btn.first.click()
    try:
        page.wait_for_function("k => document.querySelector(`#sv-scen button[data-scen=${k}]`)?.getAttribute('aria-pressed') === 'true'",
                               arg=k, timeout=SHORT)
    except Exception:  # noqa: BLE001
        return False
    page.wait_for_timeout(200)
    return True


def row_count(page):
    return page.locator("#sv-rows .sv-row").count()


def wait_rows(page, want, timeout=20000):
    try:
        page.wait_for_function("w => document.querySelectorAll('#sv-rows .sv-row').length === w", arg=want, timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def show_all(page):
    btn = page.locator("#simple button").filter(has_text=re.compile(r"^\s*Show all"))
    if btn.count() == 0:
        return False
    btn.first.click()
    page.wait_for_timeout(300)
    return True


def load_via_simple(page, label, n):
    """Pick a built-in dataset in the Simple view's 'Try example data' fold; True when the rows follow."""
    if not present(page, "#sv-data", "example-data fold"):
        return False
    open_details(page, "#sv-data")
    chip = page.locator("#sv-data :is(button, [role=button], label, a)").filter(has_text=re.compile(r"^\s*" + re.escape(label)))
    if chip.count() == 0:
        fail(f"cannot check dataset {label}: no '{label}' control inside #sv-data")
        return False
    chip.first.click()
    if not wait_rows(page, min(n, 12)):
        fail(f"{label}: expected {min(n, 12)} rows in #sv-rows after loading, found {row_count(page)}")
        return False
    page.wait_for_timeout(200)
    return True


def gdp_h(gdp, g, H):
    return gdp * (1 + g) ** H


# ----------------------------------------------------------------------------------------------- 1
def t1_landing(browser):
    page = new_page(browser)
    ok = present(page, "#simple", "1 landing state")
    check(page.evaluate("document.body.dataset.mode") == "simple", "1 landing: body[data-mode] is not 'simple'")
    if not ok:
        page.context.close()
        return
    check(is_visible(page, "#simple"), "1 landing: #simple is not visible on load")
    check(not is_visible(page, "nav.tabs"), "1 landing: tab bar (nav.tabs) is visible in Simple view")
    for sec in ("#simple", "#soe"):
        n = page.locator(f"{sec} input[type=range]").count()
        check(n == 0, f"1 landing: {n} input[type=range] inside {sec} (rule 6)")
    n = page.locator("#simple :is(input:not([type=hidden]), select, textarea)").evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length")
    check(n <= 8, f"1 landing: {n} visible input/select/textarea in #simple (max 8)")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 2
def t2_gdp_default(browser):
    weo = json.loads(WEO.read_text(encoding="utf-8"))
    page = new_page(browser)
    if not present(page, "#sv-gdp", "2 GDP for the default data"):
        page.context.close()
        return
    d = app_data(page)["datasets"]["report"]
    year = last_year(d)
    check(year == 2024, f"2 GDP: the default data's latest accounts year is {year}, expected 2024")
    want = (weo.get("CN", {}).get("SEN") or {}).get(str(year))
    check(want is not None, f"2 GDP: assets/weo_gdp.json has no CN.SEN[{year}]")
    check(attr(page, "#sv-gdp", "data-src") == "weo", f"2 GDP: #sv-gdp data-src is {attr(page, '#sv-gdp', 'data-src')!r}, expected 'weo'")
    check(attr(page, "#sv-gdp", "data-country") == "SEN", f"2 GDP: data-country is {attr(page, '#sv-gdp', 'data-country')!r}, expected 'SEN'")
    check(attr(page, "#sv-gdp", "data-year") == str(year), f"2 GDP: data-year is {attr(page, '#sv-gdp', 'data-year')!r}, expected {year!r}")
    check(want is not None and close(num(attr(page, "#sv-gdp", "data-v")), float(want), 1e-12),
          f"2 GDP: data-v {attr(page, '#sv-gdp', 'data-v')!r} != weo_gdp.json CN.SEN[{year}] {want}")
    t = norm(text(page, "#sv-gdp"))
    check("for illustration" in t, f"2 GDP: the GDP line lacks 'for illustration': {t!r}")
    check(not re.search(r"\d\s?(bn|tn|m)\b", t), f"2 GDP: the GDP line shows a money amount: {t!r}")
    check(visible_count(page, "#sv-country") == 0, "2 GDP: #sv-country is visible for the built-in data")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 3
def analyst_refs(page, label):
    """(Expected Fiscal Cost aggregate tile text, {channel: Report stressed-cost text}) read in the Analyst view,
    then back to the Simple view."""
    page.click('#modeSwitch [data-mode-target="analyst"]')
    page.click("#t-efc")
    tile = page.locator("#efc .statstrip .tile .tile-value").first
    try:
        tile.wait_for(state="visible", timeout=15000)
        efc_money = money_text(tile.evaluate("e => e.childNodes[0].textContent"))
    except Exception:  # noqa: BLE001
        fail(f"3a totals ({label}): Expected Fiscal Cost tab first tile not found")
        efc_money = None
    page.click("#t-report")
    rows = page.locator("#report .card:has(h3:text-is('Stress by channel')) tbody tr")
    try:
        rows.first.wait_for(state="attached", timeout=20000)
    except Exception:  # noqa: BLE001
        pass
    rep = {}
    if rows.count() == len(REPORT_ORDER):
        for i, k in enumerate(REPORT_ORDER):
            rep[k] = money_text(rows.nth(i).locator("td").nth(4).text_content())
    else:
        fail(f"3a totals ({label}): Report 'Stress by channel' has {rows.count()} rows, expected {len(REPORT_ORDER)}")
    page.click('#modeSwitch [data-mode-target="simple"]')
    if not (present(page, "#simple", f"3a totals ({label})") and is_visible(page, "#simple")):
        fail(f"3a totals ({label}): #modeSwitch from Analyst view did not show #simple")
        return None, None
    return efc_money, rep


def t3_dataset(browser, key, chip, cfg):
    label = chip or "default data"
    H, g = int(cfg["MC_HORIZON_YEARS"]), float(cfg["DEFAULT_GDP_GROWTH"])
    page = new_page(browser)
    if not present(page, "#sv-scen", f"3 ({label})"):
        page.context.close()
        return
    n = n_soes(app_data(page)["datasets"][key])
    if chip and not load_via_simple(page, chip, n):
        page.context.close()
        return
    if not wait_rows(page, min(n, 12), 15000):
        fail(f"3 ({label}): {row_count(page)} rows on arrival, expected {min(n, 12)}")
    GDP = num(attr(page, "#sv-gdp", "data-v"))
    if not check(GDP is not None and GDP > 0, f"3 ({label}): #sv-gdp has no positive data-v ({attr(page, '#sv-gdp', 'data-v')!r})"):
        page.context.close()
        return
    GH = gdp_h(GDP, g, H)

    # a. local-currency totals equal the Analyst view's
    efc_money, rep = analyst_refs(page, label)
    if rep is None:
        page.context.close()
        return
    if not present(page, "#sv-scen", f"3a totals ({label}) after the Analyst view"):
        page.context.close()
        return
    page.wait_for_timeout(300)
    now_total = num(attr(page, "#sv-ans", "data-now-total"))
    if efc_money and check(now_total is not None, f"3a totals ({label}): #sv-ans has no data-now-total"):
        check(money_py(now_total) == efc_money,
              f"3a totals ({label}): #sv-ans data-now-total {now_total} shows as {money_py(now_total)!r}, Expected Fiscal Cost tile shows {efc_money!r}")
    cards = {}
    for k in SCENARIOS:
        btn = page.locator(f'#sv-scen button[data-scen="{k}"]')
        if btn.count() == 0:
            fail(f"3a totals ({label}): scenario card '{k}' missing")
            continue
        cards[k] = btn.first
        if k == "none":
            continue
        v = num(btn.first.get_attribute("data-v"))
        if check(v is not None, f"3a totals ({label}/{k}): card has no numeric data-v"):
            want = rep.get(k)
            if want:
                check(money_py(v) == want, f"3a totals ({label}/{k}): card data-v {v} shows as {money_py(v)!r}, Report stressed cost shows {want!r}")

    # b. scenario cards
    n_cards = page.locator("#sv-scen button[data-scen]").count()
    check(n_cards == 8, f"3b cards ({label}): {n_cards} scenario cards, expected 8")
    shares, widths = {}, {}
    for k in SCENARIOS:
        if k not in cards:
            continue
        c = cards[k]
        v, sh = num(c.get_attribute("data-v")), num(c.get_attribute("data-share"))
        shares[k] = sh
        style = c.locator(".sv-card-bar > i").first.get_attribute("style") if c.locator(".sv-card-bar > i").count() else None
        m = re.search(r"width:\s*([\d.]+)\s*%", style or "")
        widths[k] = float(m.group(1)) if m else None
        if check(v is not None and sh is not None, f"3b cards ({label}/{k}): data-v {v} or data-share {sh} missing"):
            check(close(sh, v / GH, 1e-6), f"3b cards ({label}/{k}): data-share {sh} != data-v / GDP at horizon {v / GH}")
        t = norm(c.text_content())
        check("of GDP" not in t, f"3b cards ({label}/{k}): card text contains 'of GDP': {t!r}")
        check(not MONEY_RE.search(t), f"3b cards ({label}/{k}): card text contains a money amount: {t!r}")
        check(c.locator('[data-k="total"]').count() == 0, f"3b cards ({label}/{k}): a [data-k=total] element remains")
    # the bar shows what the shock ADDS on top of the no-shock cost, on one scale; the no-shock card has no bar
    if all(shares.get(k) is not None for k in cards) and "none" in shares:
        adds = {k: shares[k] - shares["none"] for k in cards if k != "none"}
        top = max([0.0] + list(adds.values()))
        check(cards["none"].locator(".sv-card-bar").count() == 0, f"3b cards ({label}): the no-shock card has a bar")
        for k in adds:
            exp = max(0.0, adds[k] / top * 100) if top > 0 else 0
            da = num(cards[k].get_attribute("data-add"))
            check(da is not None and close(da, adds[k], 1e-6) if abs(adds[k]) > 1e-15 else da is not None, f"3b cards ({label}/{k}): data-add {da} != share - no-shock share {adds[k]}")
            if check(widths[k] is not None, f"3b cards ({label}/{k}): no inline width on .sv-card-bar > i"):
                check(abs(widths[k] - exp) <= 0.6, f"3b cards ({label}/{k}): bar width {widths[k]} != added share / largest added share x 100 = {exp:.2f}")
        if top > 0:
            check(any(widths[k] is not None and abs(widths[k] - 100) <= 0.6 for k in adds), f"3b cards ({label}): no bar is at 100%")

    # d. rows (fx scenario)
    if pick(page, "fx"):
        before = row_count(page)
        check(before == min(n, 12), f"3d rows ({label}): {before} rows before 'show all', expected {min(n, 12)}")
        if n > 12:
            if not show_all(page):
                fail(f"3d rows ({label}): no 'Show all' toggle in #simple for {n} SOEs")
        check(wait_rows(page, n, 5000), f"3d rows ({label}): {row_count(page)} rows after 'show all', expected {n}")
        btns = page.locator("#sv-rows .sv-row button.sv-row-btn")
        fut = [num(x) for x in btns.evaluate_all("els => els.map(e => e.getAttribute('data-fut'))")]
        now = [num(x) for x in btns.evaluate_all("els => els.map(e => e.getAttribute('data-now'))")]
        fshare = [num(x) for x in page.locator('#sv-rows .sv-row [data-k="fut-share"]').evaluate_all("els => els.map(e => e.getAttribute('data-v'))")]
        if check(fut and None not in fut and None not in now and len(fshare) == len(fut) and None not in fshare,
                 f"3d rows ({label}): data-fut / data-now / fut-share missing on some of {len(fut)} rows"):
            check(all(a >= b for a, b in zip(fut, fut[1:])), f"3d rows ({label}): rows are not in descending data-fut order")
            check(all(close(s, f / GH, 1e-6) for s, f in zip(fshare, fut)), f"3d rows ({label}): a row's fut-share != data-fut / GDP at horizon")
            check(close(sum(fut), num(attr(page, "#sv-ans", "data-fut-total"))), f"3d rows ({label}): sum of data-fut {sum(fut)} != data-fut-total {attr(page, '#sv-ans', 'data-fut-total')}")
            check(close(sum(now), num(attr(page, "#sv-ans", "data-now-total"))), f"3d rows ({label}): sum of data-now {sum(now)} != data-now-total {attr(page, '#sv-ans', 'data-now-total')}")
    else:
        fail(f"3d rows ({label}): could not select the 'fx' card")

    # c, e, f. per scenario
    none_share = shares.get("none")
    for k in SCENARIOS:
        if not pick(page, k):
            fail(f"3c answer ({label}/{k}): scenario card missing or not pressed after a click")
            continue
        fut_total, now_total = num(attr(page, "#sv-ans", "data-fut-total")), num(attr(page, "#sv-ans", "data-now-total"))
        fs = num(attr(page, '#sv-big [data-k="fut-share"]', "data-v"))
        ns = num(attr(page, '#sv-big [data-k="now-share"]', "data-v"))
        if check(None not in (fut_total, now_total, fs, ns), f"3c answer ({label}/{k}): fut/now totals or shares missing ({fut_total}, {now_total}, {fs}, {ns})"):
            check(close(fs, fut_total / GH, 1e-6), f"3c answer ({label}/{k}): fut-share {fs} != data-fut-total / GDP at horizon {fut_total / GH}")
            check(close(ns, now_total / GDP, 1e-6), f"3c answer ({label}/{k}): now-share {ns} != data-now-total / GDP today {now_total / GDP}")
        check("of GDP" in norm(text(page, "#sv-big")), f"3c answer ({label}/{k}): #sv-big lacks 'of GDP': {norm(text(page, '#sv-big'))!r}")
        ser = series(page, "#sv-chart")
        if check(isinstance(ser, dict), f"3c chart ({label}/{k}): #sv-chart[data-series] missing or not JSON"):
            want_keys = {"labels", "none"} if k == "none" else {"labels", *LEVELS}
            check(set(ser) == want_keys, f"3c chart ({label}/{k}): series keys {sorted(ser)}, expected {sorted(want_keys)}")
            for name in want_keys:
                a = ser.get(name)
                check(isinstance(a, list) and len(a) == H + 1, f"3c chart ({label}/{k}/{name}): {len(a) if isinstance(a, list) else a!r} entries, expected {H + 1}")
            main = ser.get("none" if k == "none" else "standard")
            if isinstance(main, list) and len(main) == H + 1 and fs is not None and ns is not None:
                check(close(main[0], ns, 1e-6), f"3c chart ({label}/{k}): first point {main[0]} != now-share {ns}")
                check(close(main[-1], fs, 1e-6), f"3c chart ({label}/{k}): last point {main[-1]} != fut-share {fs}")
            nn = ser.get("none")
            if isinstance(nn, list) and nn and none_share is not None:
                check(close(nn[-1], none_share, 1e-6), f"3c chart ({label}/{k}): no-shock line ends at {nn[-1]}, the 'none' card says {none_share}")
        check(page.locator("#sv-chart svg").count() >= 1, f"3c chart ({label}/{k}): no <svg> inside #sv-chart")

        # e. no local currency (Assumptions fold closed)
        set_assume(page, False)
        vis = page.evaluate("document.querySelector('#simple').innerText")
        m = MONEY_RE.search(vis)
        check(not m, f"3e no currency ({label}/{k}): money amount in #simple: ...{vis[max(0, m.start() - 30):m.end() + 30] if m else ''}...".replace("\n", " "))

        # f. State's-share range (Assumptions fold open); as in round 1 the no-shock page has no range to test
        if k != "none":
            set_assume(page, True)
            lo = num(attr(page, '#sv-assume [data-k="state-lo"]', "data-v"))
            hi = num(attr(page, '#sv-assume [data-k="state-hi"]', "data-v"))
            if check(lo is not None and hi is not None and fs is not None, f"3f range ({label}/{k}): state-lo/hi ({lo}, {hi}) or fut-share missing"):
                check(0 < lo <= fs * (1 + 1e-6) and fs <= hi * (1 + 1e-6), f"3f range ({label}/{k}): fut-share {fs} outside the State's-share range [{lo}, {hi}]")
            set_assume(page, False)
    page.context.close()


def t3_all(browser):
    probe = new_page(browser)
    cfg = app_config(probe)
    probe.context.close()
    for key, chip in DATASETS:
        t3_dataset(browser, key, chip, cfg)


# ----------------------------------------------------------------------------------------------- 4, 5
def t45_snapshot_and_soe(browser):
    page = new_page(browser)
    if not present(page, "#sv-scen", "4 snapshot"):
        page.context.close()
        return
    cfg = app_config(page)
    H = int(cfg["MC_HORIZON_YEARS"])
    check(pick(page, "fx"), "4 snapshot: scenario card 'fx' missing or not pressed")
    rows = page.locator("#sv-rows .sv-row")
    if not check(rows.count() >= 2, f"cannot check 4 snapshot: #sv-rows has {rows.count()} rows"):
        page.context.close()
        return
    names = rows.evaluate_all("els => els.map(e => e.getAttribute('data-soe'))")
    btn0 = rows.nth(0).locator("button.sv-row-btn")
    cid0 = btn0.get_attribute("aria-controls")
    fut0 = num(btn0.get_attribute("data-fut"))
    fshare0 = num(rows.nth(0).locator('[data-k="fut-share"]').get_attribute("data-v"))
    check(btn0.get_attribute("aria-expanded") == "false", f"4 snapshot: first row aria-expanded is {btn0.get_attribute('aria-expanded')!r} before opening")
    if not check(bool(cid0), "4 snapshot: first row button has no aria-controls"):
        page.context.close()
        return
    panel0 = page.locator(f'[id="{cid0}"]')
    btn0.click()
    page.wait_for_timeout(300)
    check(btn0.get_attribute("aria-expanded") == "true", f"4 snapshot: aria-expanded is {btn0.get_attribute('aria-expanded')!r} after a click, expected 'true'")
    check(panel0.count() == 1 and is_visible(page, f'[id="{cid0}"]'), f"4 snapshot: panel #{cid0} is not shown after a click")
    check("sv-snap" in (panel0.first.get_attribute("class") or "").split(), f"4 snapshot: panel #{cid0} lacks class sv-snap")
    try:
        panel0.locator(".sv-snap-score svg").first.wait_for(state="attached", timeout=SHORT)
    except Exception:  # noqa: BLE001
        pass
    check(len(norm(panel0.locator(".sv-snap-why").first.text_content() if panel0.locator(".sv-snap-why").count() else "")) > 0,
          "4 snapshot: .sv-snap-why missing or empty")
    check(panel0.locator(".sv-snap-score svg").count() >= 1, "4 snapshot: no svg in .sv-snap-score")
    check(panel0.locator(".sv-snap-cost svg").count() >= 1, "4 snapshot: no svg in .sv-snap-cost")
    sc = panel0.locator(".sv-snap-score").first
    try:
        s = json.loads(sc.get_attribute("data-series") or "")
    except Exception:  # noqa: BLE001
        s = None
    if check(isinstance(s, dict), "4 snapshot: .sv-snap-score[data-series] missing or not JSON"):
        try:
            hy, hz, py, pz = s["hist"]["years"], s["hist"]["z"], s["proj"]["years"], s["proj"]["z"]
            check(all(a < b for a, b in zip(hy, hy[1:])) and len(hy) >= 1, f"4 snapshot: hist.years not ascending {hy}")
            check(py[0] == hy[-1], f"4 snapshot: proj.years[0] {py[0]} != last hist year {hy[-1]}")
            check(abs(pz[0] - hz[-1]) <= 1e-6, f"4 snapshot: proj.z[0] {pz[0]} != last hist.z {hz[-1]}")
            check(len(pz) == H + 1, f"4 snapshot: proj.z has {len(pz)} entries, expected {H + 1}")
            check(s.get("safe") == cfg["Z_SAFE_CUTOFF"], f"4 snapshot: safe {s.get('safe')} != Z_SAFE_CUTOFF {cfg['Z_SAFE_CUTOFF']}")
            check(s.get("distress") == cfg["Z_DISTRESS_CUTOFF"], f"4 snapshot: distress {s.get('distress')} != Z_DISTRESS_CUTOFF {cfg['Z_DISTRESS_CUTOFF']}")
        except Exception as e:  # noqa: BLE001
            fail(f"4 snapshot: score series has the wrong shape ({type(e).__name__}: {e}): {str(s)[:200]}")
    st = norm(sc.text_content())
    check("safe above" in st, f"4 snapshot: score chart lacks 'safe above': {st[:120]!r}")
    check("distress below" in st, f"4 snapshot: score chart lacks 'distress below': {st[:120]!r}")
    check("Altman Z-score" in norm(panel0.first.text_content()), "4 snapshot: the snapshot text lacks 'Altman Z-score'")
    try:
        c = json.loads(panel0.locator(".sv-snap-cost").first.get_attribute("data-series") or "")
        check(fshare0 is not None and close(c["standard"][-1], fshare0, 1e-6), f"4 snapshot: cost chart standard[-1] {c['standard'][-1]} != row fut-share {fshare0}")
    except Exception as e:  # noqa: BLE001
        fail(f"4 snapshot: .sv-snap-cost[data-series] missing or malformed ({type(e).__name__})")
    check(panel0.locator('[data-k="warn"]').count() >= 1, "4 snapshot: no [data-k=warn] in the snapshot")

    # second row opens too, the first stays open
    btn1 = rows.nth(1).locator("button.sv-row-btn")
    cid1 = btn1.get_attribute("aria-controls")
    btn1.click()
    page.wait_for_timeout(300)
    check(btn1.get_attribute("aria-expanded") == "true", "4 snapshot: the second row did not open")
    check(bool(cid1) and is_visible(page, f'[id="{cid1}"]'), "4 snapshot: the second row's panel is not shown")
    check(btn0.get_attribute("aria-expanded") == "true" and is_visible(page, f'[id="{cid0}"]'), "4 snapshot: opening the second row closed the first")
    # close the second again so that the first one is the only one open, then 5, then close the first
    btn1.click()
    page.wait_for_timeout(200)

    # ---- 5. one SOE page, from the open snapshot of the first row
    more = panel0.locator("a.sv-more")
    if check(more.count() >= 1, "5 one SOE: no a.sv-more in the open snapshot"):
        more.first.click()
        page.wait_for_timeout(300)
        if check(is_visible(page, "#soe"), "5 one SOE: a.sv-more did not show #soe"):
            check(not is_visible(page, "#simple"), "5 one SOE: #simple still visible with #soe open")
            check(names[0] in (text(page, "#soe-title") or ""), f"5 one SOE: #soe-title {text(page, '#soe-title')!r} lacks {names[0]!r}")
            cost = num(attr(page, '#soe-cost [data-scen="fx"]', "data-v"))
            check(cost is not None and close(cost, fut0), f"5 one SOE: #soe-cost fx data-v {cost} != row data-fut {fut0}")
            check(page.locator("#soe-cost-chart svg").count() >= 1, "5 one SOE: no svg in #soe-cost-chart")
            check(page.locator("#soe-score svg").count() >= 1, "5 one SOE: no svg in #soe-score")
            minis = page.locator("#soe-ratios .kpi-mini")
            check(minis.count() >= 1, "5 one SOE: no .kpi-mini in #soe-ratios")
            for i in range(minis.count()):
                m = minis.nth(i)
                if m.get_attribute("data-na") is None:
                    check(m.locator("svg").count() >= 1, f"5 one SOE: ratio {m.get_attribute('data-kpi')} has no svg")
            check(page.locator("#soe-ratios table").count() == 0, "5 one SOE: #soe-ratios contains a table")
            vis = page.evaluate("document.querySelector('#soe').innerText")
            mm = MONEY_RE.search(vis)
            check(not mm, f"5 one SOE: money amount in #soe: ...{vis[max(0, mm.start() - 30):mm.end() + 30] if mm else ''}...".replace("\n", " "))
            for sel in ("#soe-next", "#soe-prev", "#soe-back"):
                if page.locator(sel).count() == 0:
                    fail(f"cannot check 5 one SOE navigation: {sel} missing")
            if page.locator("#soe-next").count() and page.locator("#soe-prev").count():
                page.click("#soe-next")
                check(names[1] in (text(page, "#soe-title") or ""), f"5 one SOE: after Next, #soe-title {text(page, '#soe-title')!r} lacks {names[1]!r}")
                page.click("#soe-prev")
                check(names[0] in (text(page, "#soe-title") or ""), f"5 one SOE: after Next, Previous, #soe-title {text(page, '#soe-title')!r} lacks {names[0]!r}")
            if page.locator("#soe-back").count():
                page.click("#soe-back")
                check(is_visible(page, "#simple") and not is_visible(page, "#soe"), "5 one SOE: #soe-back did not return to #simple")

    # ---- 4 (end). the first row closes again
    if is_visible(page, "#simple"):
        btn0 = page.locator("#sv-rows .sv-row").nth(0).locator("button.sv-row-btn")
        if btn0.get_attribute("aria-expanded") != "true":   # a re-render on return may have reset it
            btn0.click()
            page.wait_for_timeout(200)
        btn0.click()
        page.wait_for_timeout(300)
        check(btn0.get_attribute("aria-expanded") == "false", f"4 snapshot: aria-expanded is {btn0.get_attribute('aria-expanded')!r} after closing, expected 'false'")
        check(not is_visible(page, f'[id="{cid0}"]'), "4 snapshot: the first row's panel is still shown after closing")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 6
def token_re(tok):
    flags = re.I if tok in CASE_INSENSITIVE else 0
    body = re.escape(tok) + ("s?" if tok == "percentile" else "")
    return re.compile(r"(?<![A-Za-z0-9])" + body + r"(?![A-Za-z0-9])", flags)


def t6_banned(browser):
    page = new_page(browser)
    if not present(page, "#sv-rows", "6 banned labels"):
        page.context.close()
        return
    pick(page, "fx")
    row = page.locator("#sv-rows .sv-row").first
    texts = {}
    if row.count() == 0:
        fail("cannot check 6 banned labels: no .sv-row to open")
    else:
        row.locator("button.sv-row-btn").click()
        page.wait_for_timeout(400)
        open_details(page, "#simple")          # includes the Assumptions fold
        set_assume(page, True)
        page.wait_for_timeout(300)
        texts["#simple"] = page.evaluate("document.querySelector('#simple').innerText")
        more = row.locator("a.sv-more")
        if more.count():
            more.first.click()
            page.wait_for_timeout(300)
            if is_visible(page, "#soe"):
                open_details(page, "#soe")
                page.wait_for_timeout(300)
                texts["#soe"] = page.evaluate("document.querySelector('#soe').innerText")
            else:
                fail("6 banned labels: a.sv-more did not show #soe")
        else:
            fail("6 banned labels: no a.sv-more in the open snapshot")
    for sel, t in texts.items():
        check(len(t.strip()) > 50, f"6 banned labels: {sel} has almost no text ({len(t.strip())} chars)")
        for tok in BANNED:
            m = token_re(tok).search(t)
            if m:
                ctx = t[max(0, m.start() - 30):m.end() + 30].replace("\n", " ")
                fail(f"6 banned labels: {tok!r} in visible text of {sel}: ...{ctx}...")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 7
def t7_modes(browser):
    page = new_page(browser)
    if not present(page, "#modeSwitch", "7 mode switch"):
        page.context.close()
        return
    check(not is_visible(page, "#tabs button[role=tab]"), "7 modes: tab buttons visible in Simple view")
    check(page.get_attribute('#modeSwitch [data-mode-target="simple"]', 'aria-pressed') == 'true' and page.get_attribute('#modeSwitch [data-mode-target="analyst"]', 'aria-pressed') == 'false', "7 modes: in Simple view the switch does not show 'Simple view' as selected")
    page.click('#modeSwitch [data-mode-target="analyst"]')
    check(page.evaluate("document.body.dataset.mode") == "analyst", "7 modes: body[data-mode] not 'analyst' after #modeSwitch")
    check(page.get_attribute('#modeSwitch [data-mode-target="analyst"]', 'aria-pressed') == 'true' and page.get_attribute('#modeSwitch [data-mode-target="simple"]', 'aria-pressed') == 'false', "7 modes: in Analyst view the switch does not show 'Analyst view' as selected")
    labels = page.locator("#tabs button[role=tab]").evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0).map(e => e.textContent.trim())")
    check(labels == TABS, f"7 modes: visible tabs {labels}, expected {TABS}")
    for lab in TABS:
        before = len(CTX["errors"])
        btn = page.locator("#tabs button[role=tab]").filter(has_text=re.compile(r"^\s*" + re.escape(lab) + r"\s*$"))
        if btn.count() == 0:
            fail(f"7 modes: tab '{lab}' missing")
            continue
        btn.first.click()
        page.wait_for_timeout(250)
        target = btn.first.get_attribute("aria-controls")
        body = page.evaluate("id => { const e = document.getElementById(id); return e && !e.hidden ? e.innerText.trim().length : -1; }", target)
        check(body > 20, f"7 modes: tab '{lab}' shows no content (page #{target}, text length {body})")
        check(len(CTX["errors"]) == before, f"7 modes: page error opening '{lab}': {CTX['errors'][before:]}")
    page.click('#modeSwitch [data-mode-target="simple"]')
    check(is_visible(page, "#simple") and page.evaluate("document.body.dataset.mode") == "simple",
          "7 modes: #modeSwitch from Analyst view did not return to #simple")
    page.context.close()
    page = new_page(browser, URL + "#view-efc")
    check(page.evaluate("document.body.dataset.mode") == "analyst", "7 modes: #view-efc did not open in analyst mode")
    check(is_visible(page, "#efc"), "7 modes: #view-efc did not show the Expected Fiscal Cost page")
    check(page.locator("#t-efc").get_attribute("aria-selected") == "true", "7 modes: #view-efc: tab 'Expected Fiscal Cost' not selected")
    if present(page, "#modeSwitch", "7 modes (deep link)"):
        page.click('#modeSwitch [data-mode-target="simple"]')
        check(is_visible(page, "#simple"), "7 modes: #modeSwitch after #view-efc did not return to #simple")
    page.context.close()


# ----------------------------------------------------------------------------------------------- 8
def make_csv(page, name, currency, country, n=2):
    """Two SOEs of the demo portfolio, the Currency column replaced, an optional Country column added."""
    d = app_data(page)["datasets"]["demo"]
    cols = d["cols"]
    ent, cur = cols.index("Entity"), cols.index("Currency")
    names = []
    for r in d["data"]:
        if r[ent] not in names:
            names.append(r[ent])
    rows = [r for r in d["data"] if r[ent] in names[:n]]
    tmp = Path(tempfile.mkdtemp(prefix="svtest_")) / f"{name}.csv"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols + (["Country"] if country else []))
        for r in rows:
            r = list(r)
            r[cur] = currency
            w.writerow(["" if v is None else v for v in r] + ([country] if country else []))
    return str(tmp), last_year(d), len(names[:n])


def upload(page, path):
    page.set_input_files("#sv-file", path)


def waitf(page, js, arg=None, timeout=15000):
    try:
        page.wait_for_function(js, arg=arg, timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def t8_uploads(browser):
    cfg_page = new_page(browser)
    cfg = app_config(cfg_page)
    H, g = int(cfg["MC_HORIZON_YEARS"]), float(cfg["DEFAULT_GDP_GROWTH"])
    cn = set(json.loads(WEO.read_text(encoding="utf-8")).get("CN", {}))
    cfg_page.context.close()
    by_country = "(c) => document.querySelector('#sv-gdp')?.getAttribute('data-country') === c"

    # a. a Country column with Ghana, currency GHS
    page = new_page(browser)
    if present(page, "#sv-file", "8a upload"):
        path, year, n = make_csv(page, "ghana", "GHS", "Ghana")
        upload(page, path)
        if check(waitf(page, by_country, "GHA"), f"8a upload: #sv-gdp data-country is {attr(page, '#sv-gdp', 'data-country')!r}, expected 'GHA'"):
            wait_rows(page, n, 8000)
            check(attr(page, "#sv-gdp", "data-src") == "weo", f"8a upload: data-src is {attr(page, '#sv-gdp', 'data-src')!r}, expected 'weo'")
            check(visible_count(page, "#sv-country") == 0, "8a upload: #sv-country is visible although the file names the country")
            check(row_count(page) == n, f"8a upload: {row_count(page)} rows after uploading {n} SOEs")
            GDP = num(attr(page, "#sv-gdp", "data-v"))
            fut = num(attr(page, "#sv-ans", "data-fut-total"))
            fs = num(attr(page, '#sv-big [data-k="fut-share"]', "data-v"))
            if check(None not in (GDP, fut, fs), f"8a upload: GDP {GDP}, fut-total {fut} or fut-share {fs} missing"):
                check(close(fs, fut / gdp_h(GDP, g, H), 1e-6), f"8a upload: fut-share {fs} != fut-total / GDP at horizon {fut / gdp_h(GDP, g, H)}")
    page.context.close()

    # b. no Country column, currency GHS: Ghana is inferred
    page = new_page(browser)
    if present(page, "#sv-file", "8b upload"):
        path, year, n = make_csv(page, "ghs_only", "GHS", None)
        upload(page, path)
        check(waitf(page, by_country, "GHA"), f"8b upload: no Country column, GHS: data-country is {attr(page, '#sv-gdp', 'data-country')!r}, expected 'GHA'")
    page.context.close()

    # c. no Country column, currency FCFA (several countries): the country is asked for
    page = new_page(browser)
    options = []
    if present(page, "#sv-file", "8c upload"):
        path, year, n = make_csv(page, "fcfa_only", "FCFA", None)
        upload(page, path)
        if check(waitf(page, "document.querySelector('#sv-ans')?.getAttribute('data-empty') === '1'"),
                 "8c upload: #sv-ans[data-empty=1] not reached after a FCFA file without Country"):
            check("Choose the country to see the results." in norm(text(page, "#sv-ans")), f"8c upload: #sv-ans text is {norm(text(page, '#sv-ans'))[:120]!r}")
            check(visible_count(page, "#sv-country") >= 1, "8c upload: #sv-country is not visible")
            check(row_count(page) == 0, f"8c upload: {row_count(page)} .sv-row shown without a country")
            options = page.locator("#sv-country option").evaluate_all("els => els.map(e => e.value).filter(v => v)")
            try:
                page.select_option("#sv-country", "SEN")
                wait_rows(page, n, 8000)
                check(row_count(page) >= 1, "8c upload: no rows after selecting Senegal")
                check(attr(page, "#sv-gdp", "data-country") == "SEN", f"8c upload: after choosing Senegal, data-country is {attr(page, '#sv-gdp', 'data-country')!r}")
            except Exception as e:  # noqa: BLE001
                fail(f"8c upload: selecting Senegal in #sv-country failed ({type(e).__name__}: {str(e).splitlines()[0][:120]})")
    page.context.close()

    # d. Eritrea: the table has no recent year
    page = new_page(browser)
    if present(page, "#sv-file", "8d upload"):
        path, year, n = make_csv(page, "eritrea", "ERN", "Eritrea")
        upload(page, path)
        if check(waitf(page, by_country, "ERI"), f"8d upload: data-country is {attr(page, '#sv-gdp', 'data-country')!r}, expected 'ERI'"):
            dy = num(attr(page, "#sv-gdp", "data-year"))
            check(dy is not None and dy < year, f"8d upload: data-year {dy} is not earlier than the latest accounts year {year}")
            check(attr(page, "#sv-gdp", "data-src") == "weo", f"8d upload: data-src is {attr(page, '#sv-gdp', 'data-src')!r}, expected 'weo'")
            check("The latest GDP available is for" in norm(text(page, "#sv-gdp")), f"8d upload: GDP line lacks 'The latest GDP available is for': {norm(text(page, '#sv-gdp'))!r}")
    page.context.close()

    # e. a country the drop-down offers but the table lacks: the typed-GDP box appears (network blocked)
    missing = [c for c in options if c not in cn]
    if not missing:
        print("8e skipped: every country in the drop-down is in the WEO table" if options else "8e skipped: the drop-down was not readable (see 8c)")
        return
    CTX["wb_ok"] = True
    try:
        page = new_page(browser)
        if present(page, "#sv-file", "8e upload"):
            path, year, n = make_csv(page, "nogdp", "", missing[0])
            upload(page, path)
            typed = "#sv-data input:not(#sv-file):not([type=hidden])"
            ok = waitf(page, "s => [...document.querySelectorAll(s)].some(e => e.getClientRects().length > 0)", typed, 10000)
            check(ok, f"8e upload: no typed-GDP box visible for {missing[0]} (not in the WEO table, network blocked); data-country={attr(page, '#sv-gdp', 'data-country')!r}")
        page.context.close()
    finally:
        CTX["wb_ok"] = False


# ----------------------------------------------------------------------------------------------- 9
def t9_kpi(browser):
    page = new_page(browser)
    if not present(page, "#modeSwitch", "9 KPI Dashboard"):
        page.context.close()
        return
    cfg = app_config(page)
    cats, order = cfg.get("KPI_CATEGORIES") or {}, cfg.get("CATEGORY_ORDER") or []
    explain, plain = cfg.get("CATEGORY_EXPLAIN"), cfg.get("KPI_PLAIN")
    check(isinstance(explain, dict) and bool(explain), "9 KPI: app-config has no CATEGORY_EXPLAIN")
    check(isinstance(plain, dict) and bool(plain), "9 KPI: app-config has no KPI_PLAIN")
    explain, plain = explain or {}, plain or {}
    page.click('#modeSwitch [data-mode-target="analyst"]')
    page.click("#t-kpi")
    if not present(page, "#kpi", "9 KPI Dashboard"):
        page.context.close()
        return
    page.wait_for_timeout(500)
    check(page.locator("#kpi .tile").count() == 0, f"9 KPI: {page.locator('#kpi .tile').count()} .tile on arrival, expected 0")
    ids = page.locator("#kpi select").evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0).map(e => e.id)")
    check(sorted(ids) == ["kpi-group", "kpi-soe"], f"9 KPI: visible selects in #kpi are {ids}, expected exactly kpi-soe and kpi-group")
    for group in order:
        keys = cats.get(group, [])
        try:
            page.select_option("#kpi-group", value=group)
        except Exception as e:  # noqa: BLE001
            fail(f"9 KPI ({group}): cannot select the group in #kpi-group ({type(e).__name__})")
            continue
        page.wait_for_timeout(400)
        minis = page.locator("#kpi-minis .kpi-mini")
        check(minis.count() == len(keys), f"9 KPI ({group}): {minis.count()} .kpi-mini, expected {len(keys)}")
        got = minis.evaluate_all("els => els.map(e => e.getAttribute('data-kpi'))")
        check(got == keys, f"9 KPI ({group}): data-kpi order {got}, expected {keys}")
        for i in range(minis.count()):
            m = minis.nth(i)
            k = m.get_attribute("data-kpi")
            if m.get_attribute("data-na") is None:
                check(m.locator("svg").count() >= 1, f"9 KPI ({group}/{k}): no svg in a .kpi-mini without data-na")
                pt = norm(m.locator("p.kpi-plain").first.text_content() if m.locator("p.kpi-plain").count() else "")
                check(k in plain and pt == norm(plain[k]), f"9 KPI ({group}/{k}): p.kpi-plain is {pt[:80]!r}, expected KPI_PLAIN text")
        q = (explain.get(group) or {}).get("question")
        check(bool(q) and norm(q) in norm(text(page, "#kpi-explain")), f"9 KPI ({group}): #kpi-explain lacks the group's question {q!r}")
        if "cost_recovery" in keys:
            check(page.locator('#kpi-minis .kpi-mini[data-kpi="cost_recovery"]').get_attribute("data-na") == "1",
                  "9 KPI: cost_recovery has no data-na='1' for the demo data")
    # views
    cmp_btn = page.locator("#kpi button").filter(has_text=re.compile(r"^\s*Compare across SOEs\s*$"))
    if check(cmp_btn.count() >= 1, "9 KPI: no 'Compare across SOEs' view button"):
        cmp_btn.first.click()
        page.wait_for_timeout(500)
        check(page.locator("#kpi .statstrip .tile").count() == 5, f"9 KPI: Compare view has {page.locator('#kpi .statstrip .tile').count()} tiles in .statstrip, expected 5")
    sc_btn = page.locator("#kpi button").filter(has_text=re.compile(r"^\s*Full scorecard\s*$"))
    if check(sc_btn.count() >= 1, "9 KPI: no 'Full scorecard' view button"):
        sc_btn.first.click()
        page.wait_for_timeout(500)
        check(is_visible(page, "#kpi table"), "9 KPI: Full scorecard shows no table in #kpi")
    page.click("#t-report")
    page.wait_for_timeout(800)
    check("KPI scorecard" in (text(page, "#report") or ""), "9 KPI: the Report tab lacks the text 'KPI scorecard'")
    page.context.close()


def main():
    if not HTML.exists():
        print(f"FAIL: {HTML} not found (python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html)")
        return 1
    if not WEO.exists():
        print(f"FAIL: {WEO} not found (python scripts/fetch_weo_gdp.py)")
        return 1
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for fn in (t1_landing, t2_gdp_default, t3_all, t45_snapshot_and_soe, t6_banned, t7_modes, t8_uploads, t9_kpi):
            try:
                fn(browser)
            except Exception as e:  # noqa: BLE001 - a broken test must not hide the others
                fail(f"{fn.__name__}: test aborted with {type(e).__name__}: {str(e).splitlines()[0][:200]}")
        browser.close()
    for e in CTX["errors"]:
        fail(f"0 page error: {e}")
    check(not CTX["wb"], f"0 network: {len(CTX['wb'])} request(s) to api.worldbank.org outside check 8e, e.g. {CTX['wb'][:2]}")
    if FAILS:
        print(f"FAIL: {len(FAILS)} of {CHECKS} checks failed")
        for f in FAILS:
            print("  -", f)
        return 1
    print(f"OK: {CHECKS} Simple-view checks passed (landing, GDP, totals, cards, answer, rows, snapshot, one SOE, banned labels, modes, uploads, KPI Dashboard)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
