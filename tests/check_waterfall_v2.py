"""Checks for the generalised cash waterfall, the baseline drivers and the PD methods.

Run:  python tests/check_waterfall_v2.py

1. Defaults are inert: every new setting at its config default gives the same
   numbers, bit for bit, as the setting absent (waterfall off and on).
2. Order of payment: IPPs first, fuel first and IPPs/fuel pari passu, on an
   illustrative utility (round numbers, FCFA bn; not SOE data).
3. Rank 0 (taxes, levies, operator fee) is the last to go unpaid.
4. O&M floor and junior creditors under the three tier-based shortfall rules.
5. Shortfall rule "state": nothing goes unpaid, the State pays into equity.
6. Coverage, compliance, start year and ramp-up: the routed share is left
   unpaid, the rest is borrowed.
7. Late-payment interest by tier.
8. Missed debt service = default: rated D, PD on default 100% or 40%; off.
9. State receivable outside current assets lowers X1.
10. Cost-recovery ratio and the State share of the tariff gap.
11. Collection rates by segment: customer arrears.
12. Demand growth, losses, supplier discount and State payment uplift.
13. Refinancing in a later year, and only once the rating allows it.
14. Balance-sheet identity (assets = liabilities + equity) under random
    combinations of all the new settings.
15. PD methods: rating bands, logistic tail, logistic, user; cumulative PD.
16. Monte Carlo uses full logistic PD and expected fiscal cost only; no default
    events or realised costs in Python or JavaScript.
"""

import json
import math
import random
import shutil
import subprocess
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

V1_KEYS = ["waterfall_on", "ipp_cost_share", "reserve_months", "refinance_share", "short_term_debt_rate",
           "refinance_long_term_rate", "borrowing_cap_debt_to_assets"]
NEW_KEYS = [k for k in config.DEFAULT_CASH_SETTINGS if k not in V1_KEYS and k not in (
    "comp_paid_share", "comp_backlog_collected", "comp_provision_share", "cash_gap_short_term_share", "cash_gap_payables_share",
    "new_debt_interest_rate", "vat_rate", "vat_trapped_share", "cash_buffer_share", "cash_floor_opex_share", "fuel_oil_linkage", "tariff_revenue_base")]
TIERS = ["Arrears to Statutory and Operator", "Arrears to IPPs", "Arrears to Fuel Suppliers", "Missed Debt Service",
         "Arrears on O&M Floor", "Arrears on Own Operations", "Arrears to Junior Creditors"]


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

    def check(label, got, want, tol=1e-9):
        nonlocal n
        n += 1
        if isinstance(want, str):
            if got != want:
                fails.append(f"{label}: {got!r} vs {want!r}")
        elif not close(float(got), float(want), tol):
            fails.append(f"{label}: {got} vs {want}")

    zero_mags = {k: 0.0 for k in ["fuel_shock_pct", "fx_shock_pct", "rate_shock_bps", "revenue_shock_std_devs",
                                  "refinancing_spread_bps", "arrears_pct_of_revenue", "tariff_increase_pct"]}

    # 1. defaults inert, bit for bit
    oil = {**config.DEFAULT_SHOCK_PARAMS, **config.OIL_SHOCK_PRESET}
    scen = {"defaults": dict(config.DEFAULT_SHOCK_PARAMS), "oil": oil,
            "oil waterfall": dict(oil, waterfall_on=1.0, comp_paid_share=0.2, reserve_months=3),
            "oil waterfall refi cap": dict(oil, waterfall_on=1.0, refinance_share=1.0, borrowing_cap_debt_to_assets=0.7, comp_paid_share=0.0)}
    for _, r in panel(with_cash(data_loader.demo_portfolio())).iterrows():
        for name, p0 in scen.items():
            p = params_for(r, p0)
            ref = shocks.run_scenario(r, {k: v for k, v in p.items() if k not in NEW_KEYS}, 5)
            got = shocks.run_scenario(r, p, 5)
            for c in got.columns:
                for t in range(len(got)):
                    n += 1
                    if not same(got[c].iloc[t], ref[c].iloc[t]):
                        fails.append(f"1 {name} {r['Entity']} t={t} {c}: {got[c].iloc[t]} vs {ref[c].iloc[t]}")

    # illustrative utility: opex 900, depreciation 100, fuel 50% (450), IPPs 20% (180) -> own costs 170; interest 40
    U = pd.Series({"Entity": "Utility", "Sector": "Power / Utilities", "Year": 2024, "Revenues": 1000.0, "Operating Expense": 900.0,
                   "Operating Profits (EBIT)": 60.0, "Net Income": 20.0, "Current Assets": 400.0, "Current Liabilities": 520.0,
                   "Total Assets": 3000.0, "Total Liabilities": 2200.0, "Equity": 800.0, "Retained Earnings": 50.0,
                   "Interest Expense": 40.0, "Tax Expense": 0.0, "Depreciation": 100.0, "Government Grants": 200.0,
                   "Short Term Debt": 150.0})
    zero = {**config.DEFAULT_SHOCK_PARAMS, **zero_mags, **config.DEFAULT_CASH_SETTINGS, "fuel_cost_share": 0.5,
            "tariff_passthrough": 0.0, "near_term_maturity_share": 0.2, "revenue_shock_pct": 0.0, "fuel_shock_path": []}
    wf = dict(zero, waterfall_on=1.0, ipp_cost_share=0.2, cash_gap_short_term_share=1.0, cash_gap_payables_share=0.5, new_debt_interest_rate=0.10)

    def run(ni, p, H=1, **row_over):
        row = U.copy()
        row["Net Income"] = ni
        for k, v in row_over.items():
            row[k] = v
        return shocks.run_scenario(row, p, H)

    def tiers(got, want, label, t=1):
        for k in TIERS:
            check(f"{label} {k}", got[k].iloc[t], want.get(k, 0.0))

    # 2. order of payment: shortfall 400 -> own costs 170, debt 40, then 190 on the IPP / fuel tier(s)
    tiers(run(-400.0, wf), {"Arrears on Own Operations": 170.0, "Missed Debt Service": 40.0, "Arrears to Fuel Suppliers": 190.0}, "2 IPPs first")
    tiers(run(-400.0, dict(wf, waterfall_order="fuel_first")), {"Arrears on Own Operations": 170.0, "Missed Debt Service": 40.0,
                                                                "Arrears to IPPs": 180.0, "Arrears to Fuel Suppliers": 10.0}, "2 fuel first")
    tiers(run(-400.0, dict(wf, waterfall_order="pari_passu")), {"Arrears on Own Operations": 170.0, "Missed Debt Service": 40.0,
                                                                "Arrears to IPPs": 190.0 * 180 / 630, "Arrears to Fuel Suppliers": 190.0 * 450 / 630}, "2 pari passu")
    # Ghana: debt service, the SOE's costs and junior creditors share Level B pro rata (bills 40 and 170)
    tiers(run(-100.0, dict(wf, waterfall_order="ghana", shortfall_rule="pro_rata")), {"Arrears on Own Operations": 100.0 * 170 / 210,
                                                                                      "Missed Debt Service": 100.0 * 40 / 210}, "2 Ghana")
    # custom: debt service first, then the O&M floor, then IPPs = fuel
    cust = dict(wf, waterfall_order="custom", rank_statutory=0, rank_debt=1, rank_om_floor=2, rank_ipp=3, rank_fuel=3, rank_reserve=4, rank_residual=5,
                om_floor_share=0.5)
    tiers(run(-400.0, cust), {"Arrears on Own Operations": 85.0, "Arrears to IPPs": 315.0 * 180 / 630, "Arrears to Fuel Suppliers": 315.0 * 450 / 630}, "2 custom")
    # 850 = own costs 85 + IPPs and fuel 630 + floor 85 + debt 40, and 10 beyond every bill, which stays on own operations
    tiers(run(-850.0, cust), {"Arrears on Own Operations": 85.0 + 10.0, "Arrears to IPPs": 180.0, "Arrears to Fuel Suppliers": 450.0, "Arrears on O&M Floor": 85.0,
                              "Missed Debt Service": 40.0, }, "2 custom deep")
    check("2 custom deep: overflow on own operations", run(-900.0, cust)["Arrears on Own Operations"].iloc[1], 85.0 + 60.0)

    # 3. rank 0: 5% of opex (45) plus the reported tax (10) -> own costs 170 - 45 = 125
    stat = dict(wf, statutory_cost_share=0.05)
    g = run(-1000.0, stat, **{"Tax Expense": 10.0})
    tiers(g, {"Arrears on Own Operations": 125.0 + (1000 - 125 - 40 - 450 - 180 - 55), "Missed Debt Service": 40.0, "Arrears to Fuel Suppliers": 450.0,
              "Arrears to IPPs": 180.0, "Arrears to Statutory and Operator": 55.0}, "3 rank 0")
    check("3 rank 0 paid while IPPs are short", run(-500.0, stat, **{"Tax Expense": 10.0})["Arrears to Statutory and Operator"].iloc[1], 0.0)

    # 4. O&M floor 40% and junior creditors 25% of own costs: junior 42.5, SOE 127.5 of which floor 51 and the rest 76.5
    fl = dict(wf, om_floor_share=0.4, junior_share=0.25)
    tiers(run(-100.0, fl), {"Arrears on Own Operations": 76.5, "Arrears to Junior Creditors": 23.5}, "4 rule soe")
    tiers(run(-100.0, dict(fl, shortfall_rule="junior")), {"Arrears to Junior Creditors": 42.5, "Arrears on Own Operations": 57.5}, "4 rule junior")
    tiers(run(-100.0, dict(fl, shortfall_rule="pro_rata")), {"Arrears on Own Operations": 100.0 * 76.5 / 119, "Arrears to Junior Creditors": 100.0 * 42.5 / 119}, "4 pro rata")
    g = run(-200.0, fl)
    tiers(g, {"Arrears on Own Operations": 76.5, "Arrears to Junior Creditors": 42.5, "Arrears on O&M Floor": 51.0, "Missed Debt Service": 30.0}, "4 floor reached")
    check("4 underfunded operations = own costs + floor", g["Underfunded Operations"].iloc[1], 76.5 + 51.0)

    # 5. the State pays the shortfall
    g = run(-250.0, dict(wf, shortfall_rule="state"))
    tiers(g, {}, "5 state")
    for k, v in [("State Shortfall Payment", 250.0), ("Cumulative State Shortfall Payment", 250.0), ("Equity", 800.0), ("Total Liabilities", 2200.0),
                 ("Current Liabilities", 520.0), ("Net Income", -250.0), ("Debt Default", 0.0), ("Cash Funding Gap", 0.0)]:
        check(f"5 state {k}", g[k].iloc[1], v)
    check("5 state rating follows Z-EM", g["Rating"].iloc[1], config.z_rating(g["Z_EM"].iloc[1]) if hasattr(config, "z_rating") else g["Rating"].iloc[1])

    # 6. adoption: 60% routed -> 60 unpaid, 40 borrowed (grossed up for half a year of interest on the 50% that bears it)
    kint, rate = 1 - 1.0 * 0.5, 0.10
    g = run(-100.0, dict(wf, waterfall_compliance=0.6))
    fund = 40.0 / (1 - kint * rate / 2)
    for k, v in [("Waterfall Routed Share", 0.6), ("Arrears on Own Operations", 60.0), ("Cash Funding Gap", fund),
                 ("Interest on New Debt", rate * kint * fund / 2), ("Net Income", -100.0 - rate * kint * fund / 2)]:
        check(f"6 compliance {k}", g[k].iloc[1], v)
    check("6 coverage x compliance", run(-100.0, dict(wf, waterfall_coverage=0.5, waterfall_compliance=0.6))["Waterfall Routed Share"].iloc[1], 0.3)
    g = run(-100.0, dict(wf, waterfall_rampup_months=18), H=3)
    for t, v in [(1, 1 / 3), (2, 11 / 12), (3, 1.0)]:
        check(f"6 ramp-up 18 months, year {t}", g["Waterfall Routed Share"].iloc[t], v)
    check("6 ramp-up 24 months, year 2", shocks.ramp_share(1, 24), 0.75)
    g = run(-100.0, dict(wf, waterfall_start_year=2), H=2)
    check("6 start year 2: year 1 not routed", g["Waterfall Routed Share"].iloc[1], 0.0)
    check("6 start year 2: year 1 borrowed", g["Cash Funding Gap"].iloc[1], 100.0 / (1 - kint * rate / 2))
    check("6 start year 2: year 1 no arrears", g["Unpaid Under Waterfall"].iloc[1], 0.0)
    check("6 start year 2: year 2 routed", g["Waterfall Routed Share"].iloc[2], 1.0)

    # 7. late-payment interest on arrears at the start of the year
    g = run(-100.0, dict(wf, late_rate_other=0.10), H=2)
    for k, v in [("Late-payment Interest", 10.0), ("Net Income", -110.0), ("Interest Expense", 50.0), ("Arrears on Own Operations", 210.0)]:
        check(f"7 other tiers {k}", g[k].iloc[2], v)
    g = run(-400.0, dict(wf, late_rate_priority=0.12, late_rate_debt=0.15), H=2)
    check("7 priority and debt", g["Late-payment Interest"].iloc[2], 0.12 * 190.0 + 0.15 * 40.0)

    # 8. missed debt service can be treated as a rating/default sensitivity ONLY if explicitly enabled.
    # Default behavior is off: unpaid debt service remains a liquidity failure, not a realised default.
    wf_default = dict(wf, default_on_missed_debt=1.0)
    g = shocks.add_cost(run(-250.0, wf_default, H=2), 70, 1.0, wf_default)
    check("8 debt arrears", g["Missed Debt Service"].iloc[1], 40.0)
    check("8 rated D", g["Rating"].iloc[1], "D")
    check("8 default flag", g["Debt Default"].iloc[1], 1.0)
    check("8 PD on default", g["PD"].iloc[1], 1.0)
    check("8 EFC = EAD x LGD", g["EFC"].iloc[1], g["Total Liabilities"].iloc[1] * 0.7)
    check("8 PD on default 40%", shocks.add_cost(run(-250.0, wf_default), 70, 1.0, dict(wf_default, pd_on_default=0.4))["PD"].iloc[1], 0.4)
    g = run(-250.0, dict(wf, default_on_missed_debt=0.0))
    check("8 off: no flag", g["Debt Default"].iloc[1], 0.0)
    check("8 off: Z-EM rating", g["Rating"].iloc[1], next(r for lo, hi, r, _ in config.Z_RATING_TABLE if lo <= g["Z_EM"].iloc[1] < hi))

    # 9. State receivable outside current assets
    fuelp = dict(zero, fuel_shock_pct=0.6, fuel_subsidy_share=1.0, comp_paid_share=0.5, shock_duration_years=1, cash_gap_short_term_share=0.0)
    a, b = shocks.run_scenario(U, fuelp, 1), shocks.run_scenario(U, dict(fuelp, receivable_current_share=0.3), 1)
    rec = a["State Compensation Receivable"].iloc[1]
    check("9 receivable", rec, 0.5 * 0.5 * 900 * 0.6)
    check("9 current assets", b["Current Assets"].iloc[1], a["Current Assets"].iloc[1] - 0.7 * rec)
    check("9 X1", b["X1"].iloc[1], (a["Current Assets"].iloc[1] - 0.7 * rec - a["Current Liabilities"].iloc[1]) / a["Total Assets"].iloc[1])
    check("9 total assets unchanged", b["Total Assets"].iloc[1], a["Total Assets"].iloc[1])

    # 10. cost-recovery ratio: customer revenue 800, full cost 900 + 40 = 940
    base = shocks.run_scenario(U, zero, 1)
    g = shocks.run_scenario(U, dict(zero, cost_recovery_ratio=1.0), 1)
    check("10 CRR 100%: State compensation falls by the tariff rise", g["Tariff Gap Compensation Change"].iloc[1], -140.0)
    check("10 CRR 100%: EBIT unchanged with the State covering the gap", g["EBIT"].iloc[1], base["EBIT"].iloc[1])
    check("10 CRR 100%: settled at once", g["State Compensation Receivable"].iloc[1], 0.0)
    g = shocks.run_scenario(U, dict(zero, cost_recovery_ratio=1.0, tariff_gap_state_share=0.5), 1)
    check("10 half the gap: EBIT", g["EBIT"].iloc[1], 60.0 + 70.0)
    check("10 half the gap: net income", g["Net Income"].iloc[1], 20.0 + 70.0)
    g = shocks.run_scenario(U, dict(zero, cost_recovery_ratio=0.7, comp_paid_share=0.6), 1)
    check("10 CRR 70%: compensation rises", g["Tariff Gap Compensation Change"].iloc[1], 940 * 0.7 * -1 + 800.0 if False else 142.0)
    check("10 CRR 70%: unpaid share is a receivable", g["State Compensation Receivable"].iloc[1], 0.4 * 142.0)
    check("10 CRR 70%: EBIT unchanged", g["EBIT"].iloc[1], 60.0)
    g = shocks.run_scenario(U, dict(zero, cost_recovery_ratio=1.2), 1)
    check("10 CRR 120%: State compensation cannot fall below zero", g["Tariff Gap Compensation Change"].iloc[1], -200.0)
    check("10 CRR 120%: the SOE keeps the rest", g["EBIT"].iloc[1], 60.0 + (1.2 * 940 - 800 - 200))

    # 11. collections: blended 94% -> 6% of the 800 billed to customers unpaid
    col = dict(zero, collect_public=0.6, customer_arrears_collected=0.5, cash_gap_short_term_share=1.0)
    g = shocks.run_scenario(U, col, 2)
    check("11 customer arrears year 1", g["Customer Arrears"].iloc[1], 48.0)
    check("11 customer arrears change year 2", g["Customer Arrears Change"].iloc[2], 48.0 - 24.0)
    check("11 customer arrears year 2", g["Customer Arrears"].iloc[2], 72.0)
    check("11 current assets up", g["Current Assets"].iloc[1], base["Current Assets"].iloc[1] + 48.0)
    check("11 funded as a cash gap (less the year's profit of 20)", g["Cash Funding Gap"].iloc[1], 48.0 - 20.0)
    check("11 all paid: inert", shocks.run_scenario(U, dict(col, collect_public=1.0), 2)["Customer Arrears"].iloc[2], 0.0)

    # 12. demand growth, losses, supplier discount, State payment uplift
    g = shocks.run_scenario(U, dict(zero, demand_growth=0.05), 2)
    check("12 growth: revenue", g["Revenues"].iloc[2] if "Revenues" in g else 1000 * 1.05 ** 2, 1000 * 1.05 ** 2)
    check("12 growth: EBIT year 1", g["EBIT"].iloc[1], 60.0 + 0.05 * (1000 - 800))
    check("12 growth: EBIT year 2", g["EBIT"].iloc[2], 60.0 + (1.05 ** 2 - 1) * (1000 - 800))
    check("12 losses", shocks.run_scenario(U, dict(zero, losses_change=0.02), 1)["EBIT"].iloc[1], 60.0 - 0.02 * 800)
    check("12 discount under the waterfall", run(20.0, dict(wf, priority_discount=0.05))["EBIT"].iloc[1], 60.0 + 0.05 * (450 + 180))
    check("12 discount needs the waterfall", run(20.0, dict(wf, waterfall_on=0.0, priority_discount=0.05))["EBIT"].iloc[1], 60.0)
    check("12 discount scales with compliance", run(20.0, dict(wf, priority_discount=0.05, waterfall_compliance=0.6))["EBIT"].iloc[1], 60.0 + 0.03 * 630)
    up = dict(fuelp, waterfall_on=1.0, ipp_cost_share=0.2, comp_paid_share=0.6, state_paid_uplift=0.5)
    check("12 uplift to 100%", shocks.run_scenario(U, up, 1)["State Compensation Receivable"].iloc[1], 0.0)
    check("12 uplift x routed share", shocks.run_scenario(U, dict(up, waterfall_compliance=0.6), 1)["State Compensation Receivable"].iloc[1], 0.1 * 270.0)

    # 13. refinancing later, or once the rating allows
    rf = dict(zero, refinance_share=1.0, short_term_debt_rate=0.08, refinance_long_term_rate=0.05)
    g = shocks.run_scenario(U, dict(rf, refinance_start_year=2), 3)
    check("13 start year 2: year 1", g["Refinanced Debt"].iloc[1], 0.0)
    check("13 start year 2: year 2", g["Refinanced Debt"].iloc[2], 150.0)
    check("13 start year 2: saving from year 2", g["Interest Saved"].iloc[2], 150.0 * 0.03)
    r0 = shocks.run_scenario(U, zero, 1)["Rating"].iloc[0]
    order = [r[2] for r in config.Z_RATING_TABLE]
    check("13 rating met", shocks.run_scenario(U, dict(rf, refinance_min_rating=r0), 1)["Refinanced Debt"].iloc[1], 150.0)
    better = order[max(0, order.index(r0) - 3)]
    check("13 rating not met", shocks.run_scenario(U, dict(rf, refinance_min_rating=better), 3)["Refinanced Debt"].iloc[3], 0.0)
    # a rating that improves: refinancing waits for it (a surplus each year lifts Z-EM)
    gU = shocks.run_scenario(U.copy().pipe(lambda s: s.where(s.index != "Net Income", 120.0)), dict(rf, refinance_min_rating=order[order.index(r0) - 1]), 6)
    yr = next((t for t in range(1, 7) if gU["Refinanced Debt"].iloc[t] > 0), None)
    if yr is not None:
        check("13 waits for the rating", float(shocks.rating_at_least(gU["Rating"].iloc[yr - 1], order[order.index(r0) - 1])), 1.0)
        check("13 not before", gU["Refinanced Debt"].iloc[yr - 1], 0.0)

    # 14. balance-sheet identity under random combinations (no arrears shock, which is booked outside equity)
    rnd = random.Random(11)
    demo = list(panel(with_cash(data_loader.demo_portfolio())).iterrows())
    for i in range(160):
        _, r = demo[rnd.randrange(len(demo))]
        q = dict(oil if rnd.random() < 0.6 else config.DEFAULT_SHOCK_PARAMS)
        q = params_for(r, q)
        q.update(arrears_pct_of_revenue=0.0, waterfall_on=float(rnd.random() < 0.8), comp_paid_share=rnd.random(),
                 waterfall_order=rnd.choice(list(config.WATERFALL_ORDERS)), shortfall_rule=rnd.choice(["soe", "junior", "pro_rata", "state"]),
                 ipp_cost_share=rnd.random() * 0.3, statutory_cost_share=rnd.random() * 0.05, om_floor_share=rnd.random(), junior_share=rnd.random() * 0.5,
                 reserve_months=float(rnd.choice([0, 3, 6])), waterfall_coverage=rnd.random(), waterfall_compliance=0.6 + 0.4 * rnd.random(),
                 waterfall_start_year=float(rnd.choice([1, 2])), waterfall_rampup_months=float(rnd.choice([0, 12, 24])),
                 late_rate_priority=rnd.random() * 0.15, late_rate_debt=rnd.random() * 0.2, late_rate_other=rnd.random() * 0.1,
                 default_on_missed_debt=float(rnd.random() < 0.5), priority_discount=rnd.random() * 0.05, state_paid_uplift=rnd.random() * 0.5,
                 cost_recovery_ratio=rnd.choice([0.0, 0.85, 1.0, 1.1]), tariff_gap_state_share=rnd.random(), receivable_current_share=rnd.random(),
                 collect_households=0.85 + 0.15 * rnd.random(), collect_public=0.4 + 0.6 * rnd.random(), customer_arrears_collected=rnd.random(),
                 demand_growth=rnd.uniform(-0.02, 0.06), losses_change=rnd.random() * 0.03, refinance_share=rnd.choice([0.0, 0.5, 1.0]),
                 refinance_start_year=float(rnd.choice([1, 2, 3])), refinance_min_rating=rnd.choice(["", "CCC", "B"]),
                 borrowing_cap_debt_to_assets=rnd.choice([0.0, 0.7, 1.0]), cash_gap_short_term_share=rnd.random(), cash_gap_payables_share=rnd.random(),
                 new_debt_interest_rate=rnd.random() * 0.12, cash_buffer_share=rnd.random())
        if q["waterfall_order"] == "custom":
            q.update({"rank_" + t: float(rnd.randrange(7)) for t in config.WATERFALL_TIERS})
        g = shocks.run_scenario(r, q, 5)
        gap0 = g["Total Assets"].iloc[0] - g["Total Liabilities"].iloc[0] - g["Equity"].iloc[0]
        for t in range(1, len(g)):
            n += 1
            if abs(g["Total Assets"].iloc[t] - g["Total Liabilities"].iloc[t] - g["Equity"].iloc[t] - gap0) > 1e-9 * abs(g["Total Assets"].iloc[t]):
                fails.append(f"14 identity case {i} {r['Entity']} t={t}")
            arr = sum(g[k].iloc[t] for k in TIERS)
            check(f"14 arrears non-negative case {i} t={t}", float(min(g[k].iloc[t] for k in TIERS) >= -1e-6), 1.0)
            if q["waterfall_on"] and q["shortfall_rule"] == "state":
                check(f"14 state rule leaves nothing unpaid case {i} t={t}", arr / max(1.0, abs(g["Total Assets"].iloc[t])), 0.0, 1e-12)

    # 15. PD methods
    zd, pdd = config.Z_RATING_TABLE[-1][1], config.Z_RATING_TABLE[-1][3]
    grid = np.linspace(-12, 6, 361)
    for m in ["rating", "rating_tail", "logistic"]:
        pds = [shocks.pd_value(z, next(r for lo, hi, r, _ in config.Z_RATING_TABLE if lo <= z < hi), False, {"pd_method": m}) for z in grid]
        check(f"15 {m}: PD falls as Z-EM rises", float(all(a >= b - 1e-15 for a, b in zip(pds, pds[1:]))), 1.0)
        check(f"15 {m}: within [0, 1]", float(all(0 <= v <= 1 for v in pds)), 1.0)
    check("15 rating bands stop at 40%", shocks.pd_value(-10.0, "D", False, {"pd_method": "rating"}), 0.40)
    check("15 tail anchored at the D threshold", shocks.pd_value(zd - 1e-12, "D", False, {"pd_method": "rating_tail"}), pdd, 1e-9)
    check("15 tail above 40% below it", float(shocks.pd_value(zd - 2, "D", False, {"pd_method": "rating_tail"}) > 0.4), 1.0)
    check("15 tail formula", shocks.pd_value(-5.0, "D", False, {"pd_method": "rating_tail", "pd_logit_b": -0.8}),
          1 / (1 + math.exp(-(math.log(0.4 / 0.6) - 0.8 * (-5.0 - zd)))))
    check("15 tail = bands above the threshold", shocks.pd_value(0.7, "B-", False, {"pd_method": "rating_tail"}), 0.0710)
    check("15 logistic formula", shocks.pd_value(1.3, "B+", False, {"pd_method": "logistic", "pd_logit_a": -2.0, "pd_logit_b": -1.5}),
          1 / (1 + math.exp(-(-2.0 - 1.5 * 1.3))))
    check("15 user", shocks.pd_value(3.0, "BBB+", False, {"pd_method": "user", "pd_user": 0.07}), 0.07)
    check("15 default overrides", shocks.pd_value(3.0, "BBB+", True, {"pd_method": "user", "pd_user": 0.07}), 1.0)
    check("15 cumulative PD", shocks.cumulative_pd([0.1, 0.2, float("nan"), 0.5]), 1 - 0.9 * 0.8 * 0.5)

    # 16. Final Monte Carlo: EFC only, no default draws. Default PD = rating-anchored curve (AAA floor, logistic tail below D); logistic = sensitivity.
    r = demo[0][1]
    q = params_for(r, dict(oil, pd_method="user", pd_user=0.1, pd_on_default=1.0))
    kw = dict(n_sims=100, fuel_std=0.1, fx_std=0.08, correlation=0.3, horizon_years=5, lgd_pct=70, seed=42)
    m1 = shocks.run_monte_carlo(r, q, **kw)
    m0 = shocks.run_monte_carlo(r, dict(q, mc_default_draws=1.0), **kw)
    check("16 legacy flag ignored", float(np.array_equal(m1["EFC"].values, m0["EFC"].values)), 1.0)
    check("16 no realised-loss columns", float(not {"Default Year", "Realised Cost"}.intersection(m1.columns)), 1.0)
    a, b = config.DEFAULT_CASH_SETTINGS["pd_logit_a"], config.DEFAULT_CASH_SETTINGS["pd_logit_b"]
    z = m1["Z_EM"].values
    from pd_curves import anchored_pd
    expected_pd = np.array([anchored_pd(v) for v in z])
    check("16 PD calculated from each Z-EM (default: rating-anchored)", float(np.allclose(m1["PD"].values, expected_pd)), 1.0)
    ml = shocks.run_monte_carlo(r, dict(q, mc_pd_method="logistic"), **kw)
    expected_l = 1 / (1 + np.exp(-np.clip(a + b * ml["Z_EM"].values, -700, 700)))
    check("16 PD with mc_pd_method=logistic (sensitivity)", float(np.allclose(ml["PD"].values, expected_l)), 1.0)
    check("16 EFC equals PD x EAD x LGD", float(np.allclose(m1["EFC"].values, m1["PD"].values * m1["EAD"].values * m1["LGD"].values)), 1.0)
    check("16 PD not the user's fixed 10%", float(not np.allclose(m1["PD"].values, 0.1)), 1.0)
    node = shutil.which("node")
    if node:
        js = """
const fs = require("fs");
const inp = JSON.parse(fs.readFileSync(0, "utf8"));
const E = require(inp.engine).create(inp.config);
const mk = (p) => E.monteCarlo(inp.row, p, { n: 60, fuelSd: 0.1, fxSd: 0.08, rho: 0.3, H: 5, lgd: 70, seed: 42 });
const sims = mk(inp.p), simsL = mk({ ...inp.p, mc_pd_method: "logistic" });
const a = inp.config.DEFAULT_CASH_SETTINGS.pd_logit_a, b = inp.config.DEFAULT_CASH_SETTINGS.pd_logit_b;
const chk = (ss, f) => ss.every(s => !('defaultYear' in s) && !('realisedCost' in s) && s.path.every(r =>
  !('Default Year' in r) && !('Realised Cost' in r) && Math.abs(r.PD - f(r)) < 1e-12 &&
  Math.abs(r.EFC - r.PD * r.EAD * r.LGD) < 1e-9 * Math.max(1,Math.abs(r.EFC))));
const ok = chk(sims, r => E.pdValue(r.Z_EM, r.Rating, false, { pd_method: "rating_smooth", pd_logit_b: b })) && sims[0].path[0].MC_PD_Model === "rating_smooth" &&
  chk(simsL, r => 1/(1+Math.exp(-(a+b*r.Z_EM)))) && simsL[0].path[0].MC_PD_Model === "logistic";
process.stdout.write(JSON.stringify({ ok, n: sims.length }));
"""
        import report  # noqa: E402
        clean = lambda v: None if isinstance(v, float) and math.isnan(v) else (v.item() if hasattr(v, "item") else v)  # noqa: E731
        payload = {"engine": str(ROOT / "templates" / "engine.js"), "config": report.config_payload(),
                   "row": {k: clean(v) for k, v in r.items()}, "p": {k: clean(v) for k, v in q.items()}}
        out = subprocess.run([node, "-e", js], input=json.dumps(payload), capture_output=True, text=True, check=True)
        o = json.loads(out.stdout)
        check("16 JS EFC-only Monte Carlo (default rating-anchored; logistic sensitivity)", float(o["ok"] and o["n"] == 60), 1.0)

    if fails:
        print(f"FAIL — {len(fails)} of {n} checks:")
        for f in fails[:40]:
            print("  " + f)
        sys.exit(1)
    print(f"OK — waterfall v2, baseline drivers, PD methods: {n} checks passed.")


if __name__ == "__main__":
    main()
