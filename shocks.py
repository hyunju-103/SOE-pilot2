"""
Shock transmission engine. Shocks hit specific balance-sheet and income-
statement lines (not the Z-EM score directly) and are then rolled forward
through a simplified law of motion so effects compound across years. Every
simplifying assumption is documented inline and surfaced in the UI —
this is a policy-triage tool, not a precise multi-year forecast.

Transmission channels (see SOE_shock_framework.pdf, Section 3, extended
to FX/rate/revenue/arrears/refinancing per the boss-commissioned brief):
  - Fuel:      the fuel-cost increase phi * OpEx * fuel_oil_linkage * fuel_shock is first
               reduced by any end-user tariff increase (tariff_increase_pct * Revenue, or
               * max(0, Revenue - Government Grants) when tariff_revenue_base is
               "revenue_ex_grants" — policy Option B; 0 = Option A, tariff freeze).
               fuel_shock is fuel_shock_pct for shock_duration_years (step), or the
               year's value of fuel_shock_path when a per-year path is given (index 0 =
               projection year 1; zero beyond its end); the tariff increase applies in
               the fuel-shock years. What remains is split three ways:
               tariff_passthrough to customers (Case B), fuel_subsidy_share to the
               government (Case C — State compensation, reported as "Direct Fuel
               Subsidy"), and the rest absorbed by the SOE (Case A):
               ΔEBIT = -(phi * OpEx * fuel_shock - tariff increase) * (1 - tariff_passthrough - fuel_subsidy_share)
               With no tariff increase and fuel_subsidy_share = 0 this is the original formula.
  - Cash:      State compensation is recognised (it never hits EBIT), but only
               comp_paid_share of it arrives as cash in the year; the rest is a State
               compensation receivable, collected at comp_backlog_collected a year
               (comp_provision_share of it can be written off as a loss instead).
               Input VAT on the extra fuel bill that cannot be recovered
               (vat_rate * vat_trapped_share) is another cash outflow.
               Cash funding gap = -Net Income + Δreceivable + trapped VAT. Cash first:
               cash_buffer_share of it (capped at the opening "Cash and Equivalents"
               above a floor of cash_floor_opex_share * OpEx) is drawn from cash; the
               rest is borrowed: cash_gap_short_term_share in current liabilities (bank, or
               unpaid supplier bills for cash_gap_payables_share), the rest long-term.
               New bank and long-term debt carries new_debt_interest_rate (half a
               year on the year's draw). A cash surplus repays the short-term debt
               first, then rebuilds the cash drawn in earlier years. Defaults
               (config.DEFAULT_CASH_SETTINGS) reproduce the original model (everything
               paid in-year, gap funded long-term, no interest) except that an SOE
               reporting cash draws it down before borrowing; cash_buffer_share = 0
               restores borrow-everything.
  - Cash waterfall (priority of payments, off by default: waterfall_on = 0): the
               SOE's cash is paid out in a fixed order — (1) IPP purchases,
               ipp_cost_share * OpEx; (2) fuel, fuel_cost_share * OpEx plus the fuel-cost
               change; (3) debt service (the year's interest); (4) a reserve account,
               topped up to reserve_months / 12 of tiers 1 and 3; (5) the SOE's own
               operations and other suppliers, OpEx - Depreciation - tiers 1 and 2. The
               waterfall decides who is paid; it does not create cash. A shortfall (the
               cash gap left after the SOE's own cash) is not borrowed: it is left unpaid
               from the bottom up — own operations first ("Underfunded Operations"), then
               the reserve is drawn, then debt service, fuel and IPPs, each up to the
               year's bill — and the unpaid amounts are current liabilities without
               interest. A later surplus pays arrears in priority order (IPPs, fuel, debt
               service), then tops up the reserve (an asset outside current assets), then
               pays the own-operations arrears. The borrowing split, rate and cap do not
               apply while the waterfall is on.
  - Refinancing (separate assumption, off by default: refinance_share = 0): in
               projection year 1, refinance_share of the short-term bank debt ("Short
               Term Debt" in the data, else near_term_maturity_share * Total Liabilities
               as a proxy) is refinanced into long-term loans: current liabilities fall by
               that amount (X1 rises), total liabilities do not change, and the SOE saves
               (short_term_debt_rate - refinance_long_term_rate) on it every year; the
               refinanced debt no longer rolls over at the refinancing-shock spread.
  - Emergency support (off by default: borrowing_cap_debt_to_assets = 0): new
               borrowing stops where total liabilities / total assets would pass the
               cap; the rest of the cash gap is a government capital injection
               ("Emergency Support"), a direct budget cost that raises equity. This is
               the last step of the IMF SOE stress-test hierarchy: cash, then
               borrowing, then injection.
  - FX (opex): ΔEBIT = -(fx_cost_share*OpEx - fx_revenue_share*Revenue) * fx_shock
  - Revenue:   ΔEBIT = revenue_elasticity * revenue_shock_pct * Revenue, where
               revenue_shock_pct = revenue_shock_std_devs * the SOE's own
               historical revenue-growth volatility (sector fallback if the
               SOE has under 3 years of data) — the standard DSA/DSF
               convention (default -1 std dev), not a flat percentage.
  - Rate:      ΔInterest = floating_debt_share * TotalLiabilities * rate_shock_bps/10000
  - Refinancing: ΔInterest += near_term_maturity_share * TotalLiabilities *
               refinancing_spread_bps/10000 — a maturity-wall shock, distinct
               from the floating-rate shock: this is rollover risk (the cost
               of refinancing debt coming due soon at a stressed spread), not
               the repricing of already-floating debt.
  - FX (debt): ΔEquity = -fx_debt_share * TotalLiabilities * fx_shock (revaluation)
  - Arrears:   ΔCurrentAssets = -arrears_pct_of_revenue * Revenue (receivables write-down proxy),
               capped at the non-cash current assets left, so total assets never turn negative

All shock magnitudes (fuel_shock_pct, fx_shock_pct, rate_shock_bps,
arrears_pct_of_revenue, refinancing_spread_bps) can be negative — a
favorable shock (cheaper fuel, currency appreciation, a rate cut, arrears
clearing) runs the same formulas in reverse. Slider ranges enforcing this
live on the Shock Scenarios page.

Simplifications flagged for future calibration:
  - Tax Expense held flat across the horizon; Current Liabilities move only
    through the short-term share of the cash funding gap (flat by default) or,
    under the cash waterfall, through the bills left unpaid.
  - Net Income carries the reported figure plus the shock's incremental effect.
  - A cash shortfall is met from the opening cash buffer first (when the data
    report "Cash and Equivalents"), then borrowed. A loss that is borrowed leaves
    total assets unchanged and one paid from cash lowers them by the draw, so
    TA = TL + Equity holds; legacy_loss_assets=True restores the original rule,
    in which the loss also reduced total assets and no cash is drawn.
  - The model is annual; a payment delay is expressed as the share paid
    within the year (about 1 - delay_days / 365 for delays under a year).
  - Shocks apply at full magnitude for `shock_duration_years`, then EBIT/
    Interest revert to unshocked levels — but balance-sheet levels
    (debt, retained earnings, equity) that built up during the shock
    persist forward, which is what makes this "dynamic" rather than a
    one-off recomputation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import config
from pd_curves import anchored_pd, logistic_tail
from calculations import classify_zem_from_values, compute_pd, compute_pd_from_rating


def run_scenario(base_row: pd.Series, params: dict, horizon_years: int) -> pd.DataFrame:
    """Project one SOE forward under a deterministic shock scenario.
    base_row: a row from the ingested data (post compute_zem_components),
    for a single SOE-year — the starting point for the projection.
    params: dict matching config.DEFAULT_SHOCK_PARAMS keys.
    Returns a DataFrame with one row per projection year (0 = base year,
    unshocked, through horizon_years), including recomputed Z-EM.
    """
    duration = params["shock_duration_years"]
    fpath = _fuel_path(params)  # per-year fuel price path, or None for the step profile
    cash0 = _num(base_row.get("Cash and Equivalents"), float("nan"))

    # Mutable state carried year to year
    state = {
        "EBIT": base_row["Operating Profits (EBIT)"],
        "Interest": base_row["Interest Expense"],
        "Tax": base_row["Tax Expense"],
        "RetainedEarnings": base_row["Retained Earnings"],
        "Equity": base_row["Equity"],
        "TotalLiabilities": base_row["Total Liabilities"],
        "TotalAssets": base_row["Total Assets"],
        "CurrentAssets": base_row["Current Assets"],
        "CurrentLiabilities": base_row["Current Liabilities"],
        "Depreciation": base_row["Depreciation"],
        "Revenue": base_row["Revenues"],
        "OpEx": base_row["Operating Expense"],
        # stocks created by the shock
        "Receivable": 0.0, "TrappedVAT": 0.0, "ShortTermDebt": 0.0, "SupplierArrears": 0.0, "LongTermDebt": 0.0,
        # illiquid items already in base-year current assets, where reported (held flat)
        "IlliquidOpen": _num(base_row.get("Government Arrears Owed"), 0.0) + _num(base_row.get("VAT Credits"), 0.0),
        # opening cash (0 when the data do not report it) and the drawdown not yet rebuilt
        "Cash": cash0 if np.isfinite(cash0) else 0.0, "CashDrawn": 0.0,
        "Refinanced": 0.0, "Support": 0.0,
        # cash waterfall: arrears by priority tier and the reserve account
        "ArrIPP": 0.0, "ArrFuel": 0.0, "ArrDebt": 0.0, "ArrOps": 0.0, "Reserve": 0.0,
        "ArrStat": 0.0, "ArrFloor": 0.0, "ArrJun": 0.0, "StateShortfall": 0.0, "CustArrears": 0.0,
        # snapshot rules: a year with debt service unpaid is rated D; share of the State receivable in current assets
        "DefaultRule": _num(params.get("default_on_missed_debt"), 0.0) > 0,
        "RecvCurrent": min(1.0, max(0.0, _num(params.get("receivable_current_share"), 1.0))),
    }

    rows = []
    # Year 0: unshocked baseline
    grants0 = _num(base_row.get("Government Grants"), float("nan"))
    rev0 = base_row["Revenues"]
    rows.append(_snapshot(base_row["Entity"], base_row.get("Sector", ""), int(base_row["Year"]), 0, state,
                          {"ni": base_row["Net Income"],
                           "rma_share": _ratio(rev0 - grants0, rev0) if np.isfinite(grants0) else float("nan")}))

    subsidy_share = params.get("fuel_subsidy_share", 0.0) or 0.0
    passthrough = params.get("tariff_passthrough", 0.0) or 0.0
    tariff_up = params.get("tariff_increase_pct", 0.0) or 0.0
    paid_share = _num(params.get("comp_paid_share"), 1.0)
    collect_share = _num(params.get("comp_backlog_collected"), 1.0)
    provision_share = _num(params.get("comp_provision_share"), 0.0)
    st_share = _num(params.get("cash_gap_short_term_share"), 0.0)
    ap_share = _num(params.get("cash_gap_payables_share"), 0.0)
    rate = _num(params.get("new_debt_interest_rate"), 0.0)
    vat_trap = _num(params.get("vat_rate"), 0.0) * _num(params.get("vat_trapped_share"), 0.0)
    k_int = 1 - st_share * ap_share  # share of new funding that bears interest (supplier arrears do not)
    eps = _num(params.get("fuel_oil_linkage"), 1.0)                 # share of the fuel bill that moves with the oil price
    ex_grants = params.get("tariff_revenue_base") == "revenue_ex_grants"
    grants = _num(base_row.get("Government Grants"), 0.0)           # compensation already booked in revenue
    buf = min(1.0, max(0.0, _num(params.get("cash_buffer_share"), 1.0)))
    floor = _num(params.get("cash_floor_opex_share"), 0.0)
    cash_live = bool(np.isfinite(cash0)) and buf > 0 and not params.get("legacy_loss_assets")
    legacy = bool(params.get("legacy_loss_assets"))
    # refinancing (separate assumption): short-term bank debt moved to long-term, in the start
    # year or the first year after it in which the previous year's rating meets the minimum
    nts = params.get("near_term_maturity_share", 0.0)
    refi = saving = 0.0
    refi_share = max(0.0, _num(params.get("refinance_share"), 0.0))
    refi_start = max(1, int(round(_num(params.get("refinance_start_year"), 1.0))))
    refi_min = str(params.get("refinance_min_rating") or "")
    refi_done = False
    # cash waterfall: priority of payments
    wf_on = _num(params.get("waterfall_on"), 0.0) > 0 and not legacy
    ipp_share = min(1.0, max(0.0, _num(params.get("ipp_cost_share"), 0.0)))
    stat_share = min(1.0, max(0.0, _num(params.get("statutory_cost_share"), 0.0)))
    floor_share = min(1.0, max(0.0, _num(params.get("om_floor_share"), 0.0)))
    jun_share = min(1.0, max(0.0, _num(params.get("junior_share"), 0.0)))
    reserve_months = max(0.0, _num(params.get("reserve_months"), 0.0))
    ranks = waterfall_ranks(params)
    rule = str(params.get("shortfall_rule") or "soe")
    wf_start = max(1, int(round(_num(params.get("waterfall_start_year"), 1.0))))
    wf_ramp = max(0.0, _num(params.get("waterfall_rampup_months"), 0.0))
    wf_share = (min(1.0, max(0.0, _num(params.get("waterfall_coverage"), 1.0)))
                * min(1.0, max(0.0, _num(params.get("waterfall_compliance"), 1.0))))
    r_pri = _num(params.get("late_rate_priority"), 0.0)
    r_dbt = _num(params.get("late_rate_debt"), 0.0)
    r_oth = _num(params.get("late_rate_other"), 0.0)
    disc0 = min(1.0, max(0.0, _num(params.get("priority_discount"), 0.0)))
    uplift = max(0.0, _num(params.get("state_paid_uplift"), 0.0))
    dep = _num(base_row.get("Depreciation"), 0.0)
    tax0 = max(0.0, _num(base_row.get("Tax Expense"), 0.0))
    cap = _num(params.get("borrowing_cap_debt_to_assets"), 0.0)  # 0 = no cap
    grants_known = bool(np.isfinite(_num(base_row.get("Government Grants"), float("nan"))))
    # baseline: tariff gap, collections, demand
    crr = max(0.0, _num(params.get("cost_recovery_ratio"), 0.0))
    gap_state = min(1.0, max(0.0, _num(params.get("tariff_gap_state_share"), 1.0)))
    seg = [(_num(params.get("share_households"), 0.0), _num(params.get("collect_households"), 1.0)),
           (_num(params.get("share_large_private"), 0.0), _num(params.get("collect_large_private"), 1.0)),
           (_num(params.get("share_public"), 0.0), _num(params.get("collect_public"), 1.0))]
    seg_w = sum(max(0.0, w) for w, _ in seg)
    coll = sum(max(0.0, w) * min(1.0, max(0.0, c)) for w, c in seg) / seg_w if seg_w > 0 else 1.0
    cust_collect = min(1.0, max(0.0, _num(params.get("customer_arrears_collected"), 0.5)))
    growth = _num(params.get("demand_growth"), 0.0)
    losses = _num(params.get("losses_change"), 0.0)
    rev0, opex0 = base_row["Revenues"], base_row["Operating Expense"]

    for t in range(1, horizon_years + 1):
        if refi_share > 0 and not legacy and not refi_done and t >= refi_start and (not refi_min or rating_at_least(rows[-1]["Rating"], refi_min)):
            std0 = _num(base_row.get("Short Term Debt"), float("nan"))
            std_base = std0 if np.isfinite(std0) else _num(nts, 0.0) * state["TotalLiabilities"]
            refi = min(refi_share * max(0.0, std_base), max(0.0, state["CurrentLiabilities"]))
            st_rate = _num(params.get("short_term_debt_rate"), 0.0)
            lt_rate = _num(params.get("refinance_long_term_rate"), 0.0)
            saving = refi * (st_rate - lt_rate)                 # interest saved on the refinanced debt, every year from now on
            if state["TotalLiabilities"]:
                nts = max(0.0, _num(nts, 0.0) - refi / state["TotalLiabilities"])  # refinanced debt no longer rolls over
            state["CurrentLiabilities"] -= refi                 # moved to non-current: total liabilities unchanged
            state["Refinanced"] = refi
            refi_done = True
        if growth:                                              # demand growth scales sales and cash operating costs
            g_t = (1.0 + growth) ** t
            state["Revenue"], state["OpEx"] = rev0 * g_t, opex0 * g_t
        # share of this year's cash routed through the waterfall (0 before it starts)
        alpha = wf_share * ramp_share(t - wf_start, wf_ramp) if (wf_on and t >= wf_start) else 0.0
        active = t <= duration
        if fpath is None:                                                 # step: full magnitude while the shock is on
            p_fuel, fuel_active = params["fuel_shock_pct"], active
        else:                                                             # per-year path, zero beyond its end
            p_fuel = fpath[t - 1] if t <= len(fpath) else 0.0
            fuel_active = p_fuel != 0

        cust_rev = state["Revenue"] - grants                              # what customers are billed (revenue less compensation)
        comp_gap = d_ebit_crr = 0.0
        if crr > 0:                                                       # cost-recovery ratio replaces the data's tariff level
            d_rc = crr * (state["OpEx"] + base_row["Interest Expense"]) - cust_rev
            comp_gap = max(-grants, -d_rc * gap_state)                    # change in the State's tariff compensation
            d_ebit_crr = d_rc + comp_gap                                  # the part of the tariff change the State does not offset
            cust_rev = cust_rev + d_rc
        fuel_cost_increase = tariff_revenue = customer_share = compensation = trapped_vat = d_ebit_fuel = 0.0
        if fuel_active:
            fuel_cost_increase = params["fuel_cost_share"] * state["OpEx"] * eps * p_fuel
            tariff_base = (max(0.0, cust_rev) if crr > 0 else max(0.0, state["Revenue"] - grants)) if ex_grants else state["Revenue"]
            tariff_revenue = tariff_up * tariff_base                      # Option B: end-user tariff increase
            remaining = fuel_cost_increase - tariff_revenue               # left after the tariff increase
            if tariff_revenue > 0 and remaining < 0:
                d_ebit_fuel = -remaining                                  # tariff more than covers it: SOE keeps the excess
            else:
                customer_share = remaining * passthrough                 # Case B
                compensation = remaining * subsidy_share                 # Case C: State compensation recognised
                d_ebit_fuel = -remaining * max(0.0, 1 - passthrough - subsidy_share)  # Case A
            trapped_vat = max(0.0, fuel_cost_increase) * vat_trap
        if active:
            d_ebit_fx = -(params["fx_cost_share"] * state["OpEx"] - params["fx_revenue_share"] * state["Revenue"]) * params["fx_shock_pct"]
            d_ebit_revenue = params["revenue_elasticity"] * params.get("revenue_shock_pct", 0.0) * state["Revenue"]
            d_interest_rate = params["floating_debt_share"] * state["TotalLiabilities"] * (params["rate_shock_bps"] / 10000.0)
            d_interest_refi = nts * state["TotalLiabilities"] * (params.get("refinancing_spread_bps", 0.0) / 10000.0)
            d_interest = d_interest_rate + d_interest_refi
            d_equity_fx_reval = -params["fx_debt_share"] * state["TotalLiabilities"] * params["fx_shock_pct"]
            # the write-down cannot exceed the non-cash current assets left to write down (a larger value
            # turned total assets negative and flipped the ratios, so a distressed SOE jumped to "Safe")
            d_current_assets_arrears = max(-params["arrears_pct_of_revenue"] * state["Revenue"],
                                           -max(0.0, state["CurrentAssets"] - max(0.0, state["Cash"])))
        else:
            d_ebit_fx = d_ebit_revenue = 0.0
            d_interest = d_equity_fx_reval = d_current_assets_arrears = 0.0

        # State compensation (fuel, and any change in the tariff gap): recognised vs. paid in cash
        p_share = min(1.0, paid_share + uplift * alpha) if (uplift > 0 and alpha > 0) else paid_share
        comp_all = compensation + comp_gap
        paid_now = comp_all * p_share if comp_all > 0 else comp_all  # a saving is settled at once
        unpaid = comp_all - paid_now
        provision = unpaid * provision_share                     # unpaid amount written off as a loss
        collected = state["Receivable"] * collect_share          # earlier years' unpaid compensation arriving now
        d_receivable = unpaid - provision - collected
        # customers' unpaid bills (collection rates by segment)
        billed = cust_rev + tariff_revenue + customer_share
        d_cust = billed * (1.0 - coll) - state["CustArrears"] * cust_collect

        # bills by tier (waterfall), and what the priority creditors give back for their priority
        opex = state["OpEx"]
        fuel_base = params["fuel_cost_share"] * opex
        disc = disc0 * alpha if wf_on else 0.0
        d_ebit_extra = 0.0
        if growth:
            d_ebit_extra += (g_t - 1.0) * (rev0 - (opex0 - dep))         # margin before depreciation grows with demand
        if losses:
            d_ebit_extra -= losses * cust_rev                             # sales lost to higher losses at the same cost
        if crr > 0:
            d_ebit_extra += d_ebit_crr
        if disc > 0:
            d_ebit_extra += disc * (fuel_base + max(0.0, fuel_cost_increase) + ipp_share * opex)
        interest_late = (r_pri * (state["ArrIPP"] + state["ArrFuel"]) + r_dbt * state["ArrDebt"]
                         + r_oth * (state["ArrStat"] + state["ArrFloor"] + state["ArrOps"] + state["ArrJun"]))

        ebit_t = base_row["Operating Profits (EBIT)"] + d_ebit_fuel + d_ebit_fx + d_ebit_revenue + d_ebit_extra
        # NI carries forward the SOE's ACTUAL reported Net Income, plus only
        # the shock's incremental effect — not a recomputation from
        # EBIT-Interest-Tax, which ignores other income/expense/tax-timing
        # items real statements have and drifted under zero shock as a
        # result. Under true zero shock (all deltas 0), NI_t = actual base
        # Net Income exactly, every year.
        d_ebit_total = d_ebit_fuel + d_ebit_fx + d_ebit_revenue
        interest_open = rate * (state["ShortTermDebt"] + state["LongTermDebt"])
        ni_before_new = base_row["Net Income"] + d_ebit_total - d_interest - provision - interest_open + saving + d_ebit_extra - interest_late

        # cash the SOE has to find this year (negative = surplus)
        need = -ni_before_new + d_receivable + trapped_vat + d_cust
        funding = interest_new = repaid = left_over = draw = rebuilt = support = 0.0
        unpaid_t = dict.fromkeys(_TIER_KEYS, 0.0)
        r_draw = top_up = state_pay = 0.0
        if wf_on:                                                # the year's bills by tier
            own = max(0.0, opex - dep - ipp_share * opex - fuel_base - stat_share * opex)
            jun_bill = jun_share * own
            soe_part = own - jun_bill
            floor_bill = floor_share * soe_part
            bills = {"ArrStat": tax0 + stat_share * opex + r_oth * state["ArrStat"],
                     "ArrIPP": ipp_share * opex * (1.0 - disc) + r_pri * state["ArrIPP"],
                     "ArrFuel": max(0.0, fuel_base + fuel_cost_increase) * (1.0 - disc) + r_pri * state["ArrFuel"],
                     "ArrDebt": max(0.0, base_row["Interest Expense"] + d_interest + interest_open - saving) + r_dbt * state["ArrDebt"],
                     "ArrFloor": floor_bill + r_oth * state["ArrFloor"],
                     "ArrOps": soe_part - floor_bill + r_oth * state["ArrOps"],
                     "ArrJun": jun_bill + r_oth * state["ArrJun"]}
            target = reserve_months / 12.0 * (bills["ArrIPP"] + bills["ArrDebt"])
        if need > 0:
            if cash_live:                                        # cash first, down to the floor
                draw = min(need, max(0.0, state["Cash"] - floor * state["OpEx"])) * buf
            gap = need - draw
            if alpha > 0:                                        # the routed share is not borrowed
                gap_w = gap * alpha
                gap_b = gap - gap_w
                for rk in sorted(set(ranks.values()), reverse=True):        # lowest priority first
                    if rk == ranks["reserve"]:                   # the reserve protects the tiers at or above its rank
                        d = min(gap_w, state["Reserve"]); r_draw += d; gap_w -= d
                    if rule == "state":
                        continue
                    grp = [k for k in _TIER_KEYS if ranks[_TIER_RANK[k]] == rk]
                    tot = sum(bills[k] for k in grp)
                    if tot > 0 and gap_w > 0:
                        u = min(gap_w, tot)
                        for k in grp:
                            unpaid_t[k] += u * (bills[k] / tot)
                        gap_w -= u
                if rule == "state":                              # the State pays what the waterfall cannot
                    state_pay = gap_w
                else:
                    unpaid_t["ArrOps"] += gap_w                  # anything beyond the year's bills stays with the SOE's own operations
            else:
                gap_b = gap
            if gap_b > 0:                                        # the rest is borrowed, grossed up for half a year of interest
                funding = gap_b / (1 - (k_int * rate) / 2)
                if cap > 0:                                      # borrowing stops at the debt-to-assets cap; the State injects the rest
                    ta_new = state["TotalAssets"] + d_receivable + trapped_vat + d_current_assets_arrears - draw
                    room = max(0.0, cap * ta_new - (state["TotalLiabilities"] - d_equity_fx_reval))
                    if funding > room:
                        funding = room
                        support = gap_b - funding * (1 - (k_int * rate) / 2)
                interest_new = (rate * k_int * funding) / 2
        else:                                                    # surplus: arrears in priority order, then short-term debt
            surplus = -need
            if wf_on:
                for rk in sorted(set(ranks.values())):           # highest priority first
                    grp = [k for k in _TIER_KEYS if ranks[_TIER_RANK[k]] == rk]
                    tot = sum(state[k] for k in grp)
                    if tot > 0 and surplus > 0:
                        r = min(surplus, tot)
                        for k in grp:
                            state[k] -= r * (state[k] / tot)
                        surplus -= r; repaid += r
                    if rk == ranks["reserve"] and alpha > 0:     # then the reserve, at its rank
                        top_up = min(surplus, max(0.0, target - state["Reserve"])); surplus -= top_up
            r_bank = min(surplus, state["ShortTermDebt"]); state["ShortTermDebt"] -= r_bank; surplus -= r_bank
            r_ap = min(surplus, state["SupplierArrears"]); state["SupplierArrears"] -= r_ap; surplus -= r_ap
            repaid += r_bank + r_ap
            left_over = surplus
            if cash_live:                                        # rebuilds the cash drawn in earlier years, no further
                rebuilt = min(left_over, state["CashDrawn"])
        wf_unpaid = sum(unpaid_t.values())
        net_income_t = ni_before_new - interest_new
        f_short = funding * st_share
        f_ap = f_short * ap_share
        f_bank = f_short - f_ap
        f_long = funding - f_short

        state["ShortTermDebt"] += f_bank
        state["SupplierArrears"] += f_ap
        state["LongTermDebt"] += f_long
        state["Receivable"] += d_receivable
        state["TrappedVAT"] += trapped_vat
        state["CustArrears"] += d_cust
        # the arrears write-down is a non-cash impairment of current assets: it hits equity and retained
        # earnings in the same year, but not EBIT, net income or the financing need
        state["RetainedEarnings"] = state["RetainedEarnings"] + net_income_t + d_current_assets_arrears
        state["Equity"] = state["Equity"] + net_income_t + d_current_assets_arrears + d_equity_fx_reval + support + state_pay
        state["Support"] += support
        state["StateShortfall"] += state_pay
        for k in _TIER_KEYS:
            state[k] += unpaid_t[k]
        state["Reserve"] += top_up - r_draw
        state["CurrentLiabilities"] = state["CurrentLiabilities"] + (f_short + wf_unpaid - repaid)
        state["TotalLiabilities"] = state["TotalLiabilities"] + (funding + wf_unpaid - repaid - d_equity_fx_reval)
        state["CurrentAssets"] = state["CurrentAssets"] + (d_receivable + trapped_vat + d_current_assets_arrears) + d_cust
        state["TotalAssets"] = state["TotalAssets"] + (d_receivable + trapped_vat + d_current_assets_arrears + left_over + top_up - r_draw) + d_cust
        if params.get("legacy_loss_assets") and need > 0:
            state["TotalAssets"] += min(0.0, net_income_t)       # original rule: a borrowed loss also cuts total assets
        if draw:                                                 # cash paid out leaves current and total assets
            state["Cash"] -= draw; state["CashDrawn"] += draw
            state["CurrentAssets"] -= draw; state["TotalAssets"] -= draw
        if rebuilt:                                              # part of the surplus (already in total assets) held as cash
            state["Cash"] += rebuilt; state["CashDrawn"] -= rebuilt
            state["CurrentAssets"] += rebuilt
        state["EBIT"] = ebit_t
        state["Interest"] = base_row["Interest Expense"] + d_interest + interest_open + interest_new - saving + interest_late

        flows = {"inc": fuel_cost_increase, "tariff": tariff_revenue, "cust": customer_share, "comp": compensation,
                 "paid": paid_now + collected, "provision": provision, "vat": trapped_vat, "fund": funding, "draw": draw,
                 "interest_new": interest_open + interest_new, "ni": net_income_t, "support": support, "saving": saving,
                 "wf_unpaid": wf_unpaid, "u_ops": unpaid_t["ArrOps"] + unpaid_t["ArrFloor"], "r_draw": r_draw, "top_up": top_up,
                 "state_pay": state_pay, "late": interest_late, "alpha": alpha, "comp_gap": comp_gap, "d_cust": d_cust,
                 "rma_share": _ratio(cust_rev + tariff_revenue + customer_share, state["Revenue"] + fuel_cost_increase) if grants_known else float("nan")}
        rows.append(_snapshot(base_row["Entity"], base_row.get("Sector", ""), int(base_row["Year"]) + t, t, state, flows))

    return pd.DataFrame(rows)


def _num(v, default):
    """A finite number, or `default` (missing columns, NaN, None)."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return v if np.isfinite(v) else default


def _clamp01(v):
    return min(1.0, max(0.0, v))


# waterfall tiers: state key -> the WATERFALL_TIERS rank it takes ("residual" is split by the shortfall rule)
_TIER_KEYS = ["ArrStat", "ArrIPP", "ArrFuel", "ArrDebt", "ArrFloor", "ArrOps", "ArrJun"]
_TIER_RANK = {"ArrStat": "statutory", "ArrIPP": "ipp", "ArrFuel": "fuel", "ArrDebt": "debt", "ArrFloor": "om_floor",
              "ArrOps": "ops", "ArrJun": "junior"}


def waterfall_ranks(params) -> dict:
    """Rank of each tier (lower = paid first, equal = pari passu) for the order in
    params["waterfall_order"] (config.WATERFALL_ORDERS; "custom" reads the rank_*
    settings). The SOE's own operations above the floor ("ops") and the junior
    creditors share the residual rank; the shortfall rule puts one of them half a
    rank lower (it absorbs a shortfall first) or keeps them together (pro rata)."""
    key = str(params.get("waterfall_order") or "senelec_note")
    preset = config.WATERFALL_ORDERS.get(key) or config.WATERFALL_ORDERS["senelec_note"]
    if preset.get("ranks") is None:                              # custom
        dflt = config.WATERFALL_ORDERS["senelec_note"]["ranks"]
        base = {k: _num(params.get("rank_" + k), float(dflt[k])) for k in config.WATERFALL_TIERS}
    else:
        base = {k: float(v) for k, v in preset["ranks"].items()}
    rule = str(params.get("shortfall_rule") or "soe")
    b = base["residual"]
    if rule == "junior":
        ops, jun = b, b + 0.5
    elif rule == "pro_rata":
        ops = jun = b
    else:                                                        # "soe" and "state"
        ops, jun = b + 0.5, b
    out = {k: base[k] for k in ["statutory", "ipp", "fuel", "debt", "reserve", "om_floor"]}
    out.update(ops=ops, junior=jun)
    return out


def ramp_share(k, months):
    """Average share of the waterfall in force during year k after its start
    (k = 0 is the start year) under a linear phase-in over `months`."""
    if months <= 0:
        return 1.0
    a, b = 12.0 * k, 12.0 * (k + 1)
    if a >= months:
        return 1.0
    hi = min(b, months)                                          # integral of m / months over [a, hi], then 1 over [hi, b]
    return ((hi * hi - a * a) / (2.0 * months) + (b - hi)) / 12.0


# the D band: its upper Z bound and PD anchor the logistic tail
_Z_D = config.Z_RATING_TABLE[-1][1]
_PD_D = config.Z_RATING_TABLE[-1][3]


def _logistic(x):
    return 1.0 / (1.0 + np.exp(-x)) if np.isfinite(x) else float("nan")


def pd_value(z, rating, debt_default, params=None) -> float:
    """PD for one projection year under params["pd_method"]: "rating" (the band
    PD, as before), "rating_tail" (band PDs, and below the D threshold a logistic
    tail that starts at the D band's PD and rises towards 100% with slope
    pd_logit_b), "rating_smooth" (the monotone curve through the 20 rating PDs,
    floored at the AAA PD, with the same logistic tail below the D threshold),
    "logistic" (1 / (1 + exp(-(a + b Z))) for every Z) or "user" (a
    fixed annual PD). A year with debt service unpaid takes pd_on_default
    unless pd_override_on_missed_service=False (used by Monte Carlo)."""
    p = params or {}
    if debt_default and p.get("pd_override_on_missed_service", True):
        return _num(p.get("pd_on_default"), 1.0)
    method = str(p.get("pd_method") or "rating")
    if method == "user":
        return min(1.0, max(0.0, _num(p.get("pd_user"), 0.10)))
    b = _num(p.get("pd_logit_b"), -1.17)
    if method == "logistic":
        return _logistic(_num(p.get("pd_logit_a"), config.DEFAULT_CASH_SETTINGS["pd_logit_a"]) + b * z) if np.isfinite(z) else float("nan")
    if method == "rating_smooth":
        return anchored_pd(z, b)
    if method == "rating_tail" and np.isfinite(z) and z < _Z_D:
        return logistic_tail(z, b, _Z_D, _PD_D)
    return compute_pd_from_rating(rating)


def add_cost(path: pd.DataFrame, lgd_pct: float, ead_share: float = 1.0, params=None, gdp_series=None) -> pd.DataFrame:
    """PD (pd_value), EAD = ead_share x total liabilities, LGD, EFC = PD x EAD x LGD,
    and EFC / GDP when a GDP path is given."""
    path = path.copy()
    dd = path["Debt Default"] if "Debt Default" in path.columns else pd.Series(0.0, index=path.index)
    path["PD"] = [pd_value(z, r, d > 0, params) for z, r, d in zip(path["Z_EM"], path["Rating"], dd)]
    path["EAD"] = path["Total Liabilities"] * ead_share
    path["LGD"] = lgd_pct / 100.0
    path["EFC"] = path["PD"] * path["EAD"] * path["LGD"]
    if gdp_series is not None:
        path["EFC_GDP"] = path["EFC"] / pd.Series(list(gdp_series)[: len(path)], index=path.index)
    return path


def cumulative_pd(pds) -> float:
    """Probability of at least one default over the projection years: 1 - prod(1 - PD_t)."""
    q = 1.0
    for v in pds:
        q *= 1.0 - min(1.0, max(0.0, v)) if v == v else 1.0
    return 1.0 - q


def rating_at_least(rating, minimum) -> bool:
    """True when `rating` is at or above `minimum` on the Z-EM rating scale."""
    order = [r for _lo, _hi, r, _pd in config.Z_RATING_TABLE]
    return rating in order and minimum in order and order.index(rating) <= order.index(minimum)


def _fuel_path(params):
    """The per-year fuel price path (list of floats, index 0 = projection year
    1), or None for the step profile: missing, empty, or a scalar (the
    zero-shock dicts put 0.0 in every magnitude)."""
    v = params.get("fuel_shock_path")
    if v is None or np.isscalar(v):
        return None
    v = [_num(x, 0.0) for x in v]
    return v or None


def _ratio(a, b):
    return a / b if b and np.isfinite(a) and np.isfinite(b) else float("nan")


def _snapshot(entity, sector, calendar_year, t, state, flows) -> dict:
    ca = state["CurrentAssets"] - (1.0 - state["RecvCurrent"]) * state["Receivable"]  # part of the State receivable may be non-current
    working_capital = ca - state["CurrentLiabilities"]
    x1, x2, x3, x4, z, zone = classify_zem_from_values(
        working_capital=working_capital,
        total_assets=state["TotalAssets"],
        retained_earnings=state["RetainedEarnings"],
        ebit=state["EBIT"],
        equity=state["Equity"],
        total_liabilities=state["TotalLiabilities"],
    )
    illiquid = state["IlliquidOpen"] + state["Receivable"] + state["TrappedVAT"] + state["CustArrears"]   # customer arrears are slow to collect too
    f = lambda k: flows.get(k, 0.0)
    default = bool(state["DefaultRule"] and state["ArrDebt"] > 0)   # debt service unpaid: rated D
    return {
        "Entity": entity,
        "Sector": sector,
        "Calendar Year": calendar_year,
        "Projection Year": t,
        "EBIT": state["EBIT"],
        "Interest Expense": state["Interest"],
        "Net Income": flows["ni"],
        "Retained Earnings": state["RetainedEarnings"],
        "Equity": state["Equity"],
        "Total Liabilities": state["TotalLiabilities"],
        "Total Assets": state["TotalAssets"],
        "Current Assets": ca,
        "Current Liabilities": state["CurrentLiabilities"],
        "X1": x1, "X2": x2, "X3": x3, "X4": x4,
        "Z_EM": z, "Zone": zone, "Rating": "D" if default else config.z_rating(z),
        "Debt Default": 1.0 if default else 0.0,
        # the government's recognised share of the fuel-cost change (Case C)
        "Direct Fuel Subsidy": f("comp"),
        # flows of the year
        "Fuel Cost Change": f("inc"),
        "Tariff Increase Revenue": f("tariff"),
        "Tariff Pass-through": f("cust"),
        "State Compensation Paid": f("paid"),          # cash from the budget this year
        "Compensation Provision": f("provision"),
        "Trapped VAT": f("vat"),
        "Cash Funding Gap": f("fund"),                 # borrowed, after any cash drawn
        "Cash Drawdown": f("draw"),                    # paid out of the opening cash buffer
        "Interest on New Debt": f("interest_new"),
        "Interest Saved": f("saving"),                  # refinancing: short-term debt at the long-term rate
        "Unpaid Under Waterfall": f("wf_unpaid"),       # the year's shortfall left unpaid, all tiers
        "Underfunded Operations": f("u_ops"),           # of which the SOE's own operations (floor and above)
        "State Shortfall Payment": f("state_pay"),      # the State pays the waterfall's shortfall (shortfall rule "state")
        "Late-payment Interest": f("late"),             # interest on arrears outstanding at the start of the year
        "Waterfall Routed Share": f("alpha"),           # share of the year's cash routed through the waterfall
        "Tariff Gap Compensation Change": f("comp_gap"),  # change in State compensation from the cost-recovery ratio
        "Customer Arrears Change": f("d_cust"),
        "Reserve Draw": f("r_draw"),
        "Reserve Top-up": f("top_up"),
        "Emergency Support": f("support"),              # government injection above the borrowing cap
        "Tariff Share of RMA": flows.get("rma_share", float("nan")),  # revenue excl. grants / allowed revenue (revenue + fuel-cost change)
        # stocks at year end
        "State Compensation Receivable": state["Receivable"],
        "Trapped VAT Credits": state["TrappedVAT"],
        "New Short-term Debt": state["ShortTermDebt"],
        "Supplier Arrears": state["SupplierArrears"],
        "New Long-term Debt": state["LongTermDebt"],
        "Cash": state["Cash"],
        "Refinanced Debt": state["Refinanced"],         # short-term bank debt moved to long-term (refinancing)
        "Arrears to IPPs": state["ArrIPP"],             # cash waterfall: unpaid bills by priority tier
        "Arrears to Fuel Suppliers": state["ArrFuel"],
        "Missed Debt Service": state["ArrDebt"],
        "Arrears on Own Operations": state["ArrOps"],     # above the O&M floor
        "Arrears on O&M Floor": state["ArrFloor"],
        "Arrears to Junior Creditors": state["ArrJun"],
        "Arrears to Statutory and Operator": state["ArrStat"],
        "Customer Arrears": state["CustArrears"],
        "Cumulative State Shortfall Payment": state["StateShortfall"],
        "Reserve Account": state["Reserve"],
        "Cumulative Emergency Support": state["Support"],
        # liquidity and solvency
        "Current Ratio": _ratio(ca, state["CurrentLiabilities"]),
        "Adjusted Current Ratio": _ratio(state["CurrentAssets"] - illiquid, state["CurrentLiabilities"]),
        "Debt to Assets": _ratio(state["TotalLiabilities"], state["TotalAssets"]),
    }


def kpi_impact_table(scenario_df: pd.DataFrame) -> pd.DataFrame:
    """Year-0 vs final-year comparison of Z-EM components, for the
    shock x KPI heatmap / tornado chart."""
    base = scenario_df.iloc[0]
    final = scenario_df.iloc[-1]
    rows = []
    for comp in config.ZEM_COEFFICIENTS:
        rows.append({
            "Component": config.ZEM_LABELS[comp],
            "Base value": base[comp],
            "Final value": final[comp],
            "Change": final[comp] - base[comp],
            "Weighted contribution to ΔZ": (final[comp] - base[comp]) * config.ZEM_COEFFICIENTS[comp],
        })
    return pd.DataFrame(rows)


def gdp_path(base_gdp: float, growth_rate: float, horizon_years: int) -> list:
    """Simple compounding GDP projection for the EFC/GDP path chart."""
    return [base_gdp * ((1 + growth_rate) ** t) for t in range(horizon_years + 1)]


MC_VARIABLES = ["fuel", "fx", "rate", "revenue"]


def mc_covariance(names, sds, correlations):
    """Covariance matrix for the drawn variables. correlations: dict keyed
    "a|b" (either order). Raises ValueError if the implied correlation
    matrix is not positive semi-definite."""
    k = len(names)
    corr = np.eye(k)
    for i in range(k):
        for j in range(i + 1, k):
            key1, key2 = f"{names[i]}|{names[j]}", f"{names[j]}|{names[i]}"
            corr[i, j] = corr[j, i] = correlations.get(key1, correlations.get(key2, 0.0))
    if np.linalg.eigvalsh(corr).min() < -1e-10:
        raise ValueError("The shock correlations are inconsistent (the correlation matrix is not positive semi-definite). Lower some of them.")
    sd = np.array([sds[n] for n in names])
    return corr * np.outer(sd, sd)


def run_monte_carlo(base_row: pd.Series, params: dict, n_sims: int, fuel_std: float,
                     fx_std: float, correlation: float, horizon_years: int,
                     lgd_pct: float, seed: int = 42, rate_std_bps: float = 0.0,
                     revenue_std_sd: float = 0.0, correlations: dict | None = None,
                     ead_share: float = 1.0) -> pd.DataFrame:
    """Draw correlated shock magnitudes and run the scenario for each draw.
    Fuel and FX are always drawn (centred on the slider values; with a fuel
    price path, fuel is centred on the path's peak and each draw rescales the
    whole path, keeping its shape). Interest-rate
    (bps) and revenue (standard deviations of own revenue growth) shocks are
    drawn too when their standard deviation is > 0; params["revenue_sigma"]
    converts revenue draws into a share of revenue. `correlations` holds the
    pairwise correlations keyed "a|b"; if omitted only fuel–FX = `correlation`.
    With only fuel and FX drawn, the draws are identical to the original
    two-variable version for the same seed.
    Returns a LONG-format DataFrame — one row per (simulation, year),
    containing expected costs only (no random default events or realised losses)."""
    # Comparison on identical Monte Carlo shocks. The rating-anchored curve
    # (rating_smooth) is the default and matches the rating PDs at every band
    # centre; the single logistic is available as a labelled sensitivity.
    mc_method = str(params.get("mc_pd_method") or "rating_smooth")
    if mc_method not in ("logistic", "rating_smooth"):
        raise ValueError("mc_pd_method must be logistic or rating_smooth")
    params = dict(params, pd_method=mc_method, pd_override_on_missed_service=False)
    rng = np.random.default_rng(seed)
    corrs = dict(correlations) if correlations else {}
    corrs.setdefault("fuel|fx", correlation)
    names = ["fuel", "fx"] + (["rate"] if rate_std_bps > 0 else []) + (["revenue"] if revenue_std_sd > 0 else [])
    fpath = _fuel_path(params)                   # with a path, fuel draws centre on its peak and rescale its shape
    peak = max(fpath, key=abs) if fpath else None
    means = {"fuel": params["fuel_shock_pct"] if fpath is None else peak, "fx": params["fx_shock_pct"],
             "rate": params.get("rate_shock_bps", 0.0), "revenue": params.get("revenue_shock_std_devs", 0.0)}
    sds = {"fuel": fuel_std, "fx": fx_std, "rate": rate_std_bps, "revenue": revenue_std_sd}
    if names == ["fuel", "fx"]:
        c = corrs["fuel|fx"]
        cov = [[fuel_std ** 2, c * fuel_std * fx_std], [c * fuel_std * fx_std, fx_std ** 2]]
        draws = rng.multivariate_normal([means["fuel"], means["fx"]], cov, size=n_sims)
    else:
        cov = mc_covariance(names, sds, corrs)
        draws = rng.multivariate_normal([means[n] for n in names], cov, size=n_sims)

    sigma = params.get("revenue_sigma")
    if sigma is None and params.get("revenue_shock_std_devs"):
        sigma = params.get("revenue_shock_pct", 0.0) / params["revenue_shock_std_devs"]
    all_rows = []
    for i in range(n_sims):
        sim_params = dict(params)
        drawn = dict(zip(names, draws[i]))
        sim_params["fuel_shock_pct"] = drawn["fuel"]
        if fpath is not None:
            sim_params["fuel_shock_path"] = [drawn["fuel"] * (v / peak) for v in fpath] if peak else list(fpath)
        sim_params["fx_shock_pct"] = drawn["fx"]
        if "rate" in drawn:
            sim_params["rate_shock_bps"] = drawn["rate"]
        if "revenue" in drawn:
            if sigma is None:
                raise ValueError("params['revenue_sigma'] is needed to draw revenue shocks")
            sim_params["revenue_shock_std_devs"] = drawn["revenue"]
            sim_params["revenue_shock_pct"] = drawn["revenue"] * sigma

        scenario = run_scenario(base_row, sim_params, horizon_years)
        scenario["sim"] = i
        for n in names:
            scenario[{"fuel": "fuel_shock_pct", "fx": "fx_shock_pct", "rate": "rate_shock_bps", "revenue": "revenue_shock_std_devs"}[n]] = drawn[n]
        scenario = add_cost(scenario, lgd_pct, ead_share, params)
        # Same shock, balance sheet, EAD and LGD; alternate cost has no extra random draw.
        scenario["PD_Full_Logistic"] = [pd_value(z, r, False, dict(params, pd_method="logistic")) for z,r in zip(scenario["Z_EM"],scenario["Rating"])]
        scenario["PD_Rating_Anchored"] = [pd_value(z, r, False, dict(params, pd_method="rating_smooth")) for z, r in zip(scenario["Z_EM"], scenario["Rating"])]
        scenario["EFC_Full_Logistic"] = scenario["PD_Full_Logistic"] * scenario["EAD"] * scenario["LGD"]
        scenario["EFC_Rating_Anchored"] = scenario["PD_Rating_Anchored"] * scenario["EAD"] * scenario["LGD"]
        scenario["MC_PD_Model"] = mc_method
        all_rows.append(scenario)

    return pd.concat(all_rows, ignore_index=True)


def mc_percentile_path(mc_long: pd.DataFrame, value_col: str,
                        percentiles=(0.05, 0.25, 0.50, 0.75, 0.95)) -> pd.DataFrame:
    """Collapse a long-format Monte Carlo DataFrame (from run_monte_carlo)
    into a per-year percentile path for the given value column."""
    grouped = mc_long.groupby("Projection Year")[value_col]
    out = grouped.quantile(list(percentiles)).unstack()
    out.columns = [f"p{int(p*100)}" for p in percentiles]
    out = out.reset_index()
    # attach calendar year for x-axis labeling
    cal_years = mc_long.groupby("Projection Year")["Calendar Year"].first()
    out["Calendar Year"] = out["Projection Year"].map(cal_years)
    return out


def describe_active_shocks(params: dict) -> str:
    """Compact, human-readable summary of only the non-zero shock
    magnitude channels in `params` — for annotating charts so a saved or
    downloaded chart is interpretable on its own, and so runs (fuel alone
    vs FX alone vs combined) are distinguishable when compared side by
    side. Exposure/structural parameters (fuel cost share, tariff
    pass-through, FX shares, etc.) are not shock magnitudes and are left
    out — only the channels that actually move something show up here."""
    parts = []
    fpath = _fuel_path(params)
    if fpath is not None:
        parts.append("Fuel path " + "/".join(f"{v*100:+.0f}" for v in fpath) + "%")
        fuel_on = any(v != 0 for v in fpath)
    else:
        fuel_on = params.get("fuel_shock_pct", 0) != 0
        if fuel_on:
            parts.append(f"Fuel {params['fuel_shock_pct']*100:+.0f}%")
    n_fuel = len(parts)
    if params.get("fx_shock_pct", 0) != 0:
        parts.append(f"FX {params['fx_shock_pct']*100:+.0f}%")
    if params.get("rate_shock_bps", 0) != 0:
        parts.append(f"Rate {params['rate_shock_bps']:+.0f}bps")
    if params.get("revenue_shock_pct", 0) != 0:
        std_devs = params.get("revenue_shock_std_devs")
        if std_devs is not None and std_devs != 0:
            parts.append(f"Revenue {std_devs:+.1f}\u03c3")
        else:
            parts.append(f"Revenue {params['revenue_shock_pct']*100:+.0f}%")
    if params.get("refinancing_spread_bps", 0) != 0 and params.get("near_term_maturity_share", 0) > 0:
        parts.append(f"Refi {params['refinancing_spread_bps']:+.0f}bps")
    if params.get("arrears_pct_of_revenue", 0) != 0:
        parts.append(f"Arrears {params['arrears_pct_of_revenue']*100:+.0f}%/yr")
    step_on = fpath is None or len(parts) > n_fuel        # a shock that runs for shock_duration_years
    if params.get("tariff_increase_pct", 0):
        parts.append(f"Tariff {params['tariff_increase_pct']*100:+.0f}%")
    if params.get("fuel_subsidy_share", 0) and fuel_on:
        parts.append(f"gov. absorbs {params['fuel_subsidy_share']*100:.0f}% of fuel cost change")
        paid = params.get("comp_paid_share")
        paid = 1.0 if paid is None else paid
        if paid < 1:
            parts.append(f"{paid*100:.0f}% paid in-year")

    if not parts:
        return "No shock applied (baseline)" + _policy_suffix(params)

    duration = params.get("shock_duration_years")
    summary = ", ".join(parts)
    if duration and step_on:
        summary += f" — active {duration}yr"
    return summary + _policy_suffix(params)


def _policy_suffix(params):
    """Financing policies in force (not shocks): the cash waterfall, refinancing and the borrowing cap."""
    pol = []
    legacy = params.get("legacy_loss_assets")
    if _num(params.get("waterfall_on"), 0.0) > 0 and not legacy:
        order = config.WATERFALL_ORDERS.get(str(params.get("waterfall_order") or "senelec_note"), config.WATERFALL_ORDERS["senelec_note"])
        extra = [order["short"]]
        share = _clamp01(_num(params.get("waterfall_coverage"), 1.0)) * _clamp01(_num(params.get("waterfall_compliance"), 1.0))
        if share < 1:
            extra.append(f"{share * 100:.0f}% of cash routed")
        if str(params.get("shortfall_rule") or "soe") == "state":
            extra.append("State covers the shortfall")
        pol.append("cash waterfall (" + ", ".join(extra) + ")")
    crr = _num(params.get("cost_recovery_ratio"), 0.0)
    if crr > 0:
        pol.append(f"cost recovery {crr * 100:.0f}%")
    refi = _num(params.get("refinance_share"), 0.0)
    if refi > 0 and not legacy:
        pol.append(f"{refi:.0%} of short-term debt refinanced")
    cap = _num(params.get("borrowing_cap_debt_to_assets"), 0.0)
    if cap > 0:
        pol.append(f"borrowing cap {cap:.2f} debt/assets")
    method = str(params.get("pd_method") or "rating")
    if method != "rating":
        pol.append({"rating_tail": "PD: rating bands with a logistic tail", "logistic": "PD: logistic in Z-EM", "user": "PD: user-specified"}.get(method, "PD: " + method))
    return (" · " + ", ".join(pol)) if pol else ""
