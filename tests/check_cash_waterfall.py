"""
Checks for the cash waterfall (priority of payments), refinancing, the borrowing
cap (emergency government support) and the RMA coverage ratio in
shocks.run_scenario.

    python tests/check_cash_waterfall.py

1. Off by default: with waterfall_on = 0, refinance_share = 0 and
   borrowing_cap_debt_to_assets = 0 the engine gives exactly the same numbers as
   with the new settings left out of the parameters altogether, and the other
   waterfall and refinancing settings are inert (demo portfolio with a partial
   cash column, several scenarios, bit-exact).
2. Refinancing arithmetic on an illustrative utility (round numbers, not SOE
   data), with the waterfall off: reported short-term debt is refinanced in
   year 1, capped at current liabilities; current liabilities fall and total
   liabilities do not; the interest saving lifts net income and lowers
   interest every year. Without a "Short Term Debt" column the near-term
   maturity share is the proxy. The refinanced debt leaves the base of the
   refinancing shock.
3. Waterfall allocation: a shortfall is left unpaid from the bottom tier up
   (own operations, then the reserve, debt service, fuel, IPPs), each tier up
   to the year's bill; nothing is borrowed; unpaid bills are current
   liabilities without interest.
4. Waterfall over time: a surplus year tops up the reserve to its target; a
   shortfall year draws it before the priority tiers go unpaid; a later
   surplus pays arrears in priority order, tops the reserve back up, then pays
   the own-operations arrears.
5. The waterfall creates no cash: on the demo portfolio under the oil preset
   (with and without State payments), nothing is borrowed, TA - TL - Equity is
   the same as without the waterfall, and current liabilities move by the bills
   left unpaid less those paid.
6. Borrowing cap: borrowing stops at the debt-to-assets cap and the State
   injects the rest (equity, not retained earnings); TA = TL + Equity still
   holds; a cap that does not bind changes nothing; the cap is inert under the
   waterfall.
7. RMA coverage = (revenue - grants + tariff increase + pass-through) /
   (revenue + fuel-cost change); NaN when grants are not reported.
8. Legacy mode ignores the waterfall and refinancing; the chart caption names
   the policies.
"""

import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

import config  # noqa: E402
import data_loader  # noqa: E402
import shocks  # noqa: E402
from check_fuel_path_cash import panel, params_for, with_cash  # noqa: E402

NEW_KEYS = ["waterfall_on", "ipp_cost_share", "reserve_months", "refinance_share", "short_term_debt_rate",
            "refinance_long_term_rate", "borrowing_cap_debt_to_assets"]
TIERS = ["Arrears to IPPs", "Arrears to Fuel Suppliers", "Missed Debt Service", "Arrears on Own Operations"]


def close(a, b, tol=1e-9):
    if isinstance(a, float) and isinstance(b, float) and math.isnan(a) and math.isnan(b):
        return True
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def same(a, b):
    if isinstance(a, str) or isinstance(b, str):
        return a == b
    a, b = float(a), float(b)
    return a == b or (math.isnan(a) and math.isnan(b))


def main():
    fails, n = [], 0

    def check(label, got, want):
        nonlocal n
        n += 1
        if not close(float(got), float(want)):
            fails.append(f"{label}: {got} vs {want}")

    zero_mags = {k: 0.0 for k in ["fuel_shock_pct", "fx_shock_pct", "rate_shock_bps", "revenue_shock_std_devs",
                                  "refinancing_spread_bps", "arrears_pct_of_revenue", "tariff_increase_pct"]}

    # 1. off by default: bit-exact with the settings absent, and the other settings inert
    oil = {**config.DEFAULT_SHOCK_PARAMS, **config.OIL_SHOCK_PRESET}
    scen = {"defaults": dict(config.DEFAULT_SHOCK_PARAMS), "oil": oil,
            "oil policy": dict(oil, tariff_increase_pct=0.1, comp_provision_share=0.3, cash_gap_payables_share=0.4,
                               vat_trapped_share=0.5, refinancing_spread_bps=300, arrears_pct_of_revenue=0.1)}
    for _, r in panel(with_cash(data_loader.demo_portfolio())).iterrows():
        for name, p0 in scen.items():
            p = params_for(r, p0)
            ref = shocks.run_scenario(r, {k: v for k, v in p.items() if k not in NEW_KEYS}, 5)
            for tag, q in [("defaults", p), ("inert", dict(p, ipp_cost_share=0.4, reserve_months=6, short_term_debt_rate=0.2,
                                                            refinance_long_term_rate=0.01))]:
                got = shocks.run_scenario(r, q, 5)
                for c in got.columns:
                    for t in range(len(got)):
                        n += 1
                        if not same(got[c].iloc[t], ref[c].iloc[t]):
                            fails.append(f"1 {tag} {name} {r['Entity']} t={t} {c}: {got[c].iloc[t]} vs {ref[c].iloc[t]}")

    # 2. refinancing arithmetic on an illustrative utility (round numbers, FCFA bn; not SOE data)
    U = pd.Series({"Entity": "Utility", "Sector": "Power / Utilities", "Year": 2024, "Revenues": 1000.0, "Operating Expense": 900.0,
                   "Operating Profits (EBIT)": 60.0, "Net Income": 20.0, "Current Assets": 400.0, "Current Liabilities": 520.0,
                   "Total Assets": 3000.0, "Total Liabilities": 2200.0, "Equity": 800.0, "Retained Earnings": 50.0,
                   "Interest Expense": 40.0, "Tax Expense": 0.0, "Depreciation": 0.0, "Government Grants": 200.0,
                   "Short Term Debt": 150.0})
    zero = {**config.DEFAULT_SHOCK_PARAMS, **zero_mags, **config.DEFAULT_CASH_SETTINGS, "fuel_cost_share": 0.5,
            "tariff_passthrough": 0.0, "near_term_maturity_share": 0.2, "revenue_shock_pct": 0.0, "fuel_shock_path": []}
    rf = dict(zero, refinance_share=1.0, short_term_debt_rate=0.08, refinance_long_term_rate=0.05)
    pw = shocks.run_scenario(U, rf, 3)
    sav = 150.0 * 0.03
    exp = {0: {"Current Liabilities": 520.0, "Refinanced Debt": 0.0, "Total Liabilities": 2200.0, "Interest Expense": 40.0},
           1: {"Current Liabilities": 370.0, "Refinanced Debt": 150.0, "Total Liabilities": 2200.0, "Interest Expense": 40.0 - sav,
               "Interest Saved": sav, "Net Income": 20.0 + sav, "Total Assets": 3000.0 + 20.0 + sav, "Equity": 820.0 + sav,
               "Retained Earnings": 70.0 + sav},
           2: {"Current Liabilities": 370.0, "Interest Saved": sav, "Net Income": 20.0 + sav, "Total Assets": 3000.0 + 2 * (20.0 + sav)}}
    for t, d in exp.items():
        for k, v in d.items():
            check(f"2 t={t} {k}", pw[k].iloc[t], v)
    for label, row, p, refi in [("capped at current liabilities", U.copy().pipe(lambda s: s.where(s.index != "Short Term Debt", 600.0)), rf, 520.0),
                                ("proxy: near-term maturity share", U.drop("Short Term Debt"), rf, 0.2 * 2200.0),
                                ("half refinanced", U, dict(rf, refinance_share=0.5), 75.0),
                                ("costlier long-term debt", U, dict(rf, refinance_long_term_rate=0.10), 150.0)]:
        got = shocks.run_scenario(row, p, 2)
        check(f"2 {label}: refinanced", got["Refinanced Debt"].iloc[1], refi)
        check(f"2 {label}: saving", got["Interest Saved"].iloc[1], refi * (0.08 - p["refinance_long_term_rate"]))
    refi_shock = dict(zero, refinancing_spread_bps=200, shock_duration_years=2)
    check("2 refinancing shock, no refinancing", shocks.run_scenario(U, refi_shock, 2)["Interest Expense"].iloc[1], 40.0 + 0.2 * 2200.0 * 0.02)
    check("2 refinancing shock, refinanced", shocks.run_scenario(U, dict(refi_shock, refinance_share=1.0, short_term_debt_rate=0.08,
                                                                         refinance_long_term_rate=0.05), 2)["Interest Expense"].iloc[1],
          40.0 + (0.2 * 2200.0 - 150.0) * 0.02 - sav)

    # 3. waterfall allocation: opex 900, depreciation 100, fuel 50% (450), IPPs 20% (180) -> own operations 170; interest 40
    W = U.copy()
    W["Depreciation"] = 100.0
    wf = dict(zero, waterfall_on=1.0, ipp_cost_share=0.2, cash_gap_short_term_share=1.0, cash_gap_payables_share=0.5, new_debt_interest_rate=0.10)
    for ni, want in [(-100.0, {"Arrears on Own Operations": 100.0}),
                     (-250.0, {"Arrears on Own Operations": 170.0, "Missed Debt Service": 40.0, "Arrears to Fuel Suppliers": 40.0}),
                     (-1000.0, {"Arrears on Own Operations": 170.0 + 160.0, "Missed Debt Service": 40.0, "Arrears to Fuel Suppliers": 450.0,
                                "Arrears to IPPs": 180.0})]:
        row = W.copy()
        row["Net Income"] = ni
        got = shocks.run_scenario(row, wf, 1)
        unpaid = -ni
        for k in TIERS:
            check(f"3 NI {ni:.0f} {k}", got[k].iloc[1], want.get(k, 0.0))
        for k, v in [("Unpaid Under Waterfall", unpaid), ("Underfunded Operations", want["Arrears on Own Operations"]),
                     ("Cash Funding Gap", 0.0), ("New Short-term Debt", 0.0), ("New Long-term Debt", 0.0), ("Supplier Arrears", 0.0),
                     ("Interest on New Debt", 0.0), ("Interest Expense", 40.0), ("Net Income", ni),
                     ("Current Liabilities", 520.0 + unpaid), ("Total Liabilities", 2200.0 + unpaid),
                     ("Total Assets", 3000.0), ("Equity", 800.0 + ni)]:
            check(f"3 NI {ni:.0f} {k}", got[k].iloc[1], v)
    # IPP share 0 and fuel above own costs: tier 5 floors at zero, the rest goes up the order
    row = W.copy()
    row["Net Income"] = -100.0
    got = shocks.run_scenario(row, dict(wf, ipp_cost_share=0.0, fuel_cost_share=0.95), 1)
    check("3 no own-operations bill: debt service", got["Missed Debt Service"].iloc[1], 40.0)
    check("3 no own-operations bill: fuel", got["Arrears to Fuel Suppliers"].iloc[1], 60.0)

    # 4. waterfall over time: surplus, then a shortfall, then a surplus
    # year 1 no fuel shock (surplus 20 -> reserve), year 2 fuel +60% fully compensated but unpaid
    # (shortfall 270 - 20 = 250), year 3 the receivable is collected (surplus 20 + 270 = 290)
    seq = dict(wf, reserve_months=3, fuel_shock_path=[0.0, 0.6, 0.0], fuel_subsidy_share=1.0, comp_paid_share=0.0, comp_backlog_collected=1.0)
    got = shocks.run_scenario(W, seq, 3)
    target = 0.25 * (180.0 + 40.0)
    for t, d in {1: {"Reserve Account": 20.0, "Reserve Top-up": 20.0, "Unpaid Under Waterfall": 0.0},
                 2: {"Reserve Draw": 20.0, "Reserve Account": 0.0, "Arrears on Own Operations": 170.0, "Missed Debt Service": 40.0,
                     "Arrears to Fuel Suppliers": 20.0, "Arrears to IPPs": 0.0, "Unpaid Under Waterfall": 230.0, "Underfunded Operations": 170.0,
                     "Current Liabilities": 520.0 + 230.0},
                 3: {"Reserve Account": target, "Reserve Top-up": target, "Arrears on Own Operations": 0.0, "Missed Debt Service": 0.0,
                     "Arrears to Fuel Suppliers": 0.0, "Current Liabilities": 520.0}}.items():
        for k, v in d.items():
            check(f"4 t={t} {k}", got[k].iloc[t], v)
    for t in range(len(got)):
        check(f"4 t={t} TA = TL + Equity", got["Total Assets"].iloc[t], got["Total Liabilities"].iloc[t] + got["Equity"].iloc[t])
    # a surplus too small for everything pays IPPs, fuel and debt service before the reserve and own operations
    small = dict(seq, comp_backlog_collected=0.1)       # year 3 surplus: 20 + 27 = 47
    g2 = shocks.run_scenario(W, small, 3)
    check("4 small surplus: fuel paid", g2["Arrears to Fuel Suppliers"].iloc[3], 0.0)
    check("4 small surplus: debt service paid", g2["Missed Debt Service"].iloc[3], 40.0 - (47.0 - 20.0))
    check("4 small surplus: no reserve top-up", g2["Reserve Top-up"].iloc[3], 0.0)
    check("4 small surplus: own operations still unpaid", g2["Arrears on Own Operations"].iloc[3], 170.0)

    # 5. the waterfall creates no cash: demo portfolio, oil preset, with and without State payments
    n_short = 0
    for _, r in panel(with_cash(data_loader.demo_portfolio())).iterrows():
        for tag, p0 in [("oil", oil), ("State pays nothing", dict(oil, comp_paid_share=0.0, comp_backlog_collected=0.0)),
                        ("reserve", dict(oil, reserve_months=4, ipp_cost_share=0.25))]:
            p = dict(params_for(r, p0), waterfall_on=1.0)
            g = shocks.run_scenario(r, p, 5)
            g0 = shocks.run_scenario(r, dict(p, waterfall_on=0.0), 5)   # same scenario, borrowed
            for t in range(1, len(g)):
                for k in ["Cash Funding Gap", "New Short-term Debt", "New Long-term Debt", "Interest on New Debt", "Emergency Support"]:
                    check(f"5 {tag} {r['Entity']} t={t} {k}", g[k].iloc[t], 0.0)
                # the balance-sheet gap (non-zero only where the demo data or other shocks already break the identity) is unchanged
                # (compared on the scale of total assets: the gap is now ~0, so a relative test would only measure float noise)
                n += 1
                d_wf = g["Total Assets"].iloc[t] - g["Total Liabilities"].iloc[t] - g["Equity"].iloc[t]
                d_no = g0["Total Assets"].iloc[t] - g0["Total Liabilities"].iloc[t] - g0["Equity"].iloc[t]
                if abs(d_wf - d_no) > 1e-9 * abs(r["Total Assets"]):
                    fails.append(f"5 {tag} {r['Entity']} t={t} TA - TL - Equity as without the waterfall: {d_wf} vs {d_no}")
                arr = sum(g[k].iloc[t] for k in TIERS)
                arr0 = sum(g[k].iloc[t - 1] for k in TIERS)
                check(f"5 {tag} {r['Entity']} t={t} current liabilities move with arrears",
                      g["Current Liabilities"].iloc[t] - g["Current Liabilities"].iloc[t - 1], arr - arr0)
                n_short += g["Unpaid Under Waterfall"].iloc[t] > 0

    # 6. borrowing cap: TL/TA 0.733 at the start, cap 0.75 -> 50 of borrowing room in year 1
    L = U.copy()
    L["Net Income"] = -100.0
    capp = dict(zero, new_debt_interest_rate=0.10, borrowing_cap_debt_to_assets=0.75)
    pc = shocks.run_scenario(L.drop("Short Term Debt"), capp, 3)
    s1 = 100.0 - 50.0 * (1 - 0.05)
    for t, k, v in [(1, "Cash Funding Gap", 50.0), (1, "Emergency Support", s1), (1, "Interest on New Debt", 2.5),
                    (1, "Net Income", -102.5), (1, "Equity", 750.0), (1, "Retained Earnings", -52.5), (1, "Total Liabilities", 2250.0),
                    (1, "Debt to Assets", 0.75), (2, "Cash Funding Gap", 0.0), (2, "Emergency Support", 105.0),
                    (2, "Cumulative Emergency Support", s1 + 105.0), (2, "Debt to Assets", 0.75)]:
        check(f"6 cap t={t} {k}", pc[k].iloc[t], v)
    for t in range(len(pc)):
        check(f"6 cap t={t} TA = TL + Equity", pc["Total Assets"].iloc[t], pc["Total Liabilities"].iloc[t] + pc["Equity"].iloc[t])
    for label, a, b in [("a cap that does not bind", dict(capp, borrowing_cap_debt_to_assets=0.95), dict(capp, borrowing_cap_debt_to_assets=0.0)),
                        ("the cap under the waterfall", dict(wf, borrowing_cap_debt_to_assets=0.75), dict(wf, borrowing_cap_debt_to_assets=0.0))]:
        ga, gb = shocks.run_scenario(L.drop("Short Term Debt"), a, 3), shocks.run_scenario(L.drop("Short Term Debt"), b, 3)
        for c in gb.columns:
            for t in range(len(gb)):
                n += 1
                if not same(ga[c].iloc[t], gb[c].iloc[t]):
                    fails.append(f"6 {label} changes {c} at t={t}")

    # 7. RMA coverage
    fuel = dict(zero, fuel_shock_pct=0.6, shock_duration_years=1, fuel_subsidy_share=1.0)
    inc = 0.5 * 900.0 * 0.6
    for label, row, p, t, v in [("base year", U, fuel, 0, 0.8), ("Option A", U, fuel, 1, 800.0 / (1000.0 + inc)),
                                ("Option B +15% on revenue less grants", U, dict(fuel, tariff_increase_pct=0.15, tariff_revenue_base="revenue_ex_grants"), 1,
                                 (800.0 + 120.0) / (1000.0 + inc)),
                                ("pass-through 50%", U, dict(fuel, tariff_passthrough=0.5, fuel_subsidy_share=0.5), 1, (800.0 + 0.5 * inc) / (1000.0 + inc)),
                                ("after the shock", U, fuel, 2, 0.8),
                                ("grants missing", U.drop("Government Grants"), fuel, 1, float("nan")),
                                ("grants missing, base year", U.drop("Government Grants"), fuel, 0, float("nan"))]:
        check(f"7 RMA coverage {label}", shocks.run_scenario(row, p, 2)["Tariff Share of RMA"].iloc[t], v)

    # 8. legacy mode ignores the waterfall and refinancing; caption
    leg = dict(zero, cash_gap_short_term_share=1.0, new_debt_interest_rate=0.10, legacy_loss_assets=True)
    a, b = shocks.run_scenario(L, leg, 3), shocks.run_scenario(L, dict(leg, waterfall_on=1.0, refinance_share=1.0, reserve_months=3), 3)
    for c in a.columns:
        for t in range(len(a)):
            n += 1
            if not same(a[c].iloc[t], b[c].iloc[t]):
                fails.append(f"8 legacy: the waterfall or refinancing changed {c} at t={t}")
    wf0 = dict(zero, waterfall_on=1.0)
    for p, want in [(zero, "No shock applied (baseline)"), (wf0, "No shock applied (baseline) · cash waterfall (IPPs first)"),
                    (dict(zero, refinance_share=0.5), "No shock applied (baseline) · 50% of short-term debt refinanced"),
                    (dict(wf0, refinance_share=1.0, borrowing_cap_debt_to_assets=0.8),
                     "No shock applied (baseline) · cash waterfall (IPPs first), 100% of short-term debt refinanced, borrowing cap 0.80 debt/assets"),
                    (dict(fuel, waterfall_on=1.0), "Fuel +60%, gov. absorbs 100% of fuel cost change — active 1yr · cash waterfall (IPPs first)"),
                    (dict(wf0, waterfall_order="ghana", waterfall_compliance=0.6, shortfall_rule="state", cost_recovery_ratio=0.85, pd_method="logistic"),
                     "No shock applied (baseline) · cash waterfall (Ghana order, 60% of cash routed, State covers the shortfall), cost recovery 85%, PD: logistic in Z-EM")]:
        n += 1
        if shocks.describe_active_shocks(p) != want:
            fails.append(f"8 caption: {shocks.describe_active_shocks(p)!r} vs {want!r}")

    # the waterfall alone barely moves Z-EM under an unpaid fuel shock (it moves the shortfall, it does not close it)
    shock = dict(zero, fuel_shock_pct=0.6, shock_duration_years=1, fuel_subsidy_share=1.0, comp_paid_share=0.0,
                 cash_gap_short_term_share=1.0, ipp_cost_share=0.2)
    z_off = shocks.run_scenario(W, shock, 1)["Z_EM"].iloc[1]
    z_on = shocks.run_scenario(W, dict(shock, waterfall_on=1.0), 1)["Z_EM"].iloc[1]
    z_refi = shocks.run_scenario(W, dict(shock, refinance_share=1.0), 1)["Z_EM"].iloc[1]
    n += 2
    if not abs(z_on - z_off) < 0.05:
        fails.append(f"Z-EM with the waterfall {z_on:.3f} vs without {z_off:.3f}: should barely move")
    if not z_refi > z_off + 0.2:
        fails.append(f"Z-EM with refinancing {z_refi:.3f} vs without {z_off:.3f}: should rise (X1)")

    if fails:
        print(f"FAIL — {len(fails)} of {n} checks:")
        for f in fails[:40]:
            print("  " + f)
        return 1
    print(f"OK — cash waterfall, refinancing, borrowing cap, RMA coverage: {n} checks passed "
          f"({n_short} demo SOE-years with a shortfall under the waterfall; illustrative utility, fuel shock unpaid: "
          f"Z-EM {z_off:.2f} without the waterfall, {z_on:.2f} with it, {z_refi:.2f} with refinancing).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
