/*
 * SOE Fiscal Risk Tool — calculation engine, JavaScript port.
 *
 * Mirrors, function for function, the Python modules the Streamlit app uses:
 *   calculations.py  (Z''-EM, KPIs, classify, PD/EFC, revenue volatility, notch change)
 *   shocks.py        (run_scenario, kpi_impact_table, gdp_path, Monte Carlo, percentile path)
 *   narrative.py     (single_soe_narrative, cross_soe_narrative)
 *   utils/summary.py (summarize_z_trend, summarize_zone_distribution)
 *   app_pages/strategic_soe.py (GRE support uplift)
 *   schema.py        (column matching: exact name, synonym, close spelling)
 * Every number it uses (coefficients, cutoffs, rating/PD table, sector tables,
 * shock defaults, GRE tables) comes from config.py via the CFG object that
 * report.py embeds, so recalibrating config.py needs no change here.
 * A change to a FORMULA in the Python modules must be copied here too;
 * tests/check_engine_parity.py compares the two implementations.
 */
(function (root) {
  "use strict";

  function create(CFG) {
    const INF = Infinity;
    const isNum = (v) => typeof v === "number" && Number.isFinite(v);
    const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : NaN); // _safe_div: inf -> NaN
    const lo = (v) => (v === null || v === undefined ? -INF : v);
    /** shocks._fuel_path: the per-year fuel price path (index 0 = projection year 1), or null for the step profile */
    const fuelPath = (p) => { const v = p.fuel_shock_path; return Array.isArray(v) && v.length ? v.map((x) => (isNum(x) ? x : 0)) : null; };
    const hi = (v) => (v === null || v === undefined ? INF : v);
    const ZCOMP = Object.keys(CFG.ZEM_COEFFICIENTS); // X1..X4 in config order
    const ZONES = CFG.ZONES.map(([n, a, b]) => [n, lo(a), hi(b)]);
    const RTABLE = CFG.Z_RATING_TABLE.map(([a, b, r, p]) => [lo(a), hi(b), r, p]);
    const PD_BY_RATING = Object.fromEntries(RTABLE.map((r) => [r[2], r[3]]));
    const K = {
      rev: "Revenues", texp: "Total Expense", opex: "Operating Expense", ebit: "Operating Profits (EBIT)",
      ni: "Net Income", ca: "Current Assets", ta: "Total Assets", cl: "Current Liabilities", tl: "Total Liabilities",
      eq: "Equity", re: "Retained Earnings", int: "Interest Expense", tax: "Tax Expense", ebitda: "EBITDA",
      grants: "Government Grants", dep: "Depreciation",
    };

    /* ---------------- calculations.py ---------------- */
    function classifyZone(z) {
      if (!isNum(z)) return "Unknown";
      for (const [name, a, b] of ZONES) if (a < z && z <= b) return name;
      return "Unknown";
    }
    function zRating(z) {
      if (!isNum(z)) return "—";
      for (const [a, b, r] of RTABLE) if ((a < z && z <= b) || (a === -INF && z <= b)) return r;
      return "—";
    }
    function zemFromValues(wc, ta, re, ebit, eq, tl) {
      const x1 = ta ? wc / ta : NaN, x2 = ta ? re / ta : NaN, x3 = ta ? ebit / ta : NaN, x4 = tl ? eq / tl : NaN;
      const c = CFG.ZEM_COEFFICIENTS;
      const z = c.X1 * x1 + c.X2 * x2 + c.X3 * x3 + c.X4 * x4 + CFG.ZEM_CONSTANT;
      return { X1: x1, X2: x2, X3: x3, X4: x4, Z_EM: z, Zone: classifyZone(z) };
    }
    /** compute_zem_components + compute_kpis on one row (returns a new object). */
    function enrichRow(r) {
      const o = Object.assign({}, r);
      o.X1 = div(r[K.ca] - r[K.cl], r[K.ta]);
      o.X2 = div(r[K.re], r[K.ta]);
      o.X3 = div(r[K.ebit], r[K.ta]);
      o.X4 = div(r[K.eq], r[K.tl]);
      let z = CFG.ZEM_CONSTANT;
      for (const c of ZCOMP) { o[c + "_contrib"] = o[c] * CFG.ZEM_COEFFICIENTS[c]; z += o[c + "_contrib"]; }
      o.Z_EM = z; o.Zone = classifyZone(z); o.Rating = zRating(z);
      const rev = r[K.rev], ebit = r[K.ebit], eq = r[K.eq], ebitda = r[K.ebitda];
      o.operating_margin = div(ebit, rev);
      // Exact cost recovery components only; missing inputs remain n/a, not zero.
      // Grants must already be part of reported revenue for this deduction to apply.
      const cogs = r["Cost of Goods Sold"], otherCosts = r["Other Operating Expenses"], grants = r[K.grants];
      const coveredCost = isNum(cogs) && isNum(otherCosts) ? cogs + otherCosts : NaN;
      o.cost_recovery = isNum(grants) && isNum(coveredCost) && coveredCost > 0 ? div(rev - grants, coveredCost) : NaN;
      o.net_margin = div(r[K.ni], rev);
      o.ebitda_margin = div(ebitda, rev);
      o.roa = div(r[K.ni], r[K.ta]);
      o.roe = eq > 0 ? div(r[K.ni], eq) : NaN;
      o.current_ratio = div(r[K.ca], r[K.cl]);
      o.working_capital_ratio = o.X1;
      o.debt_to_ebitda = ebitda > 0 ? div(r[K.tl], ebitda) : NaN;
      o.liabilities_to_assets = div(r[K.tl], r[K.ta]);
      o.interest_coverage = div(ebit, r[K.int]);
      o.debt_to_equity = eq > 0 ? div(r[K.tl], eq) : NaN;
      o.asset_turnover = div(rev, r[K.ta]);
      o.depreciation_to_ebitda = ebitda > 0 ? div(r[K.dep], ebitda) : NaN;
      o.grants_to_revenue = div(r[K.grants], rev);
      o.grants_to_expense = div(r[K.grants], r[K.texp]);
      o.effective_tax_rate = ebit > 0 ? div(r[K.tax], ebit) : NaN;
      o.negative_equity_flag = eq <= 0;
      o.negative_ebitda_flag = ebitda <= 0;
      return o;
    }
    const enrich = (rows) => rows.map(enrichRow);

    function availableKpis(rows, category) {
      const keys = category ? CFG.KPI_CATEGORIES[category] : Object.keys(CFG.KPI_THRESHOLDS);
      return keys.filter((k) => CFG.KPI_THRESHOLDS[k].requires.every((c) => rows.some((r) => isNum(r[c]))));
    }
    function classify(value, key) {
      if (!isNum(value)) return ["No data", "muted"];
      const s = CFG.KPI_THRESHOLDS[key];
      if (s.direction === "higher_is_better") {
        if (value < s.red_cut) return ["Red", "red"];
        if (value >= s.green_cut) return ["Green", "green"];
        return ["Amber", "amber"];
      }
      if (value > s.red_cut) return ["Red", "red"];
      if (value <= s.green_cut) return ["Green", "green"];
      return ["Amber", "amber"];
    }
    const pdByRating = (rating) => (rating in PD_BY_RATING ? PD_BY_RATING[rating] : NaN);
    function worstPdInZone(zone) {
      const z = ZONES.find((x) => x[0] === zone);
      if (!z) return NaN;
      const cands = RTABLE.filter(([a, b]) => b > z[1] && a < z[2]).map((r) => r[3]);
      return cands.length ? Math.max(...cands) : NaN;
    }
    const pctLabel = (v) => Math.round(v * 100) + "%";
    /** compute_efc for one row. basis "total_liabilities": EAD = share × total liabilities (proxy);
     *  "guaranteed_debt": observed Government Guaranteed Debt where reported, else the proxy. */
    function efcRow(r, lgdPct, eadShare = 1, basis = "total_liabilities") {
      const pd = pdByRating(r.Rating), lgd = lgdPct / 100, g = r["Government Guaranteed Debt"];
      let ead = r[K.tl] * eadShare, src = `Proxy: ${pctLabel(eadShare)} of total liabilities`;
      if (basis === "guaranteed_debt" && isNum(g)) { ead = g; src = "Observed: guaranteed debt"; }
      return { PD: pd, EAD: ead, LGD: lgd, EFC: pd * ead * lgd, EAD_source: src };
    }
    /** soe_exposures: bottom-up shock exposures for one SOE-year → {name: [value, source]} */
    function soeExposures(row) {
      const clip = (v) => Math.max(0, Math.min(1, v));
      const val = (c) => (c && isNum(row[c]) ? row[c] : null);
      const opex = val(K.opex), tl = val(K.tl), sector = row.Sector || "Other", out = {};
      const pick = (name, obs, amt, denom, lab) => {
        const v = obs ? val(obs) : null;
        if (v !== null) { out[name] = [clip(v), `Observed: ${obs}`]; return; }
        const a = amt ? val(amt) : null;
        if (a !== null && denom) { out[name] = [clip(a / denom), `Derived: ${lab}`]; return; }
        if (name === "fuel_cost_share") { out[name] = [CFG.SECTOR_FUEL_COST_SHARE[sector] ?? CFG.SECTOR_FUEL_COST_SHARE.Other, `Sector default (${sector})`]; return; }
        out[name] = [CFG.DEFAULT_EXPOSURES[name], "Default (placeholder)"];
      };
      pick("fuel_cost_share", "Fuel Cost Share", "Fuel Cost", opex, "Fuel Cost / Operating Expense");
      pick("fx_cost_share", "FX Cost Share");
      pick("fx_revenue_share", "FX Revenue Share");
      pick("fx_debt_share", "FX Debt Share", "FX Debt", tl, "FX Debt / Total Liabilities");
      pick("floating_debt_share", "Floating Rate Debt Share");
      pick("near_term_maturity_share", null, "Short Term Debt", tl, "Short Term Debt / Total Liabilities");
      for (const name of ["tariff_passthrough", "revenue_elasticity", "fuel_subsidy_share"]) out[name] = [CFG.DEFAULT_EXPOSURES[name], name === "fuel_subsidy_share" ? "User (off by default)" : "Default (placeholder)"];
      // cash and financing settings of the shock engine (policy, not observed)
      for (const [name, value] of Object.entries(CFG.DEFAULT_CASH_SETTINGS || {})) out[name] = [value, "Policy setting (default: original model, cash drawn first)"];
      return out;
    }
    function recoveryScenarios(sector) {
      const d = CFG.SECTOR_RECOVERY_DATA[sector] || CFG.SECTOR_RECOVERY_DATA.Other;
      const r4 = (v) => Math.round(v * 1e4) / 1e4;
      return [["Low Backstop Intensity", r4(d.p10)], ["25th Percentile", r4(d.p25)], ["Average Backstop Intensity", r4(d.average)], ["High Backstop Intensity", r4(d.p90)]];
    }
    const byYear = (rows) => rows.slice().sort((a, b) => a.Year - b.Year);
    function std(a) { const n = a.length; if (n < 2) return NaN; const m = a.reduce((s, v) => s + v, 0) / n; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)); }
    function revenueVolatility(rows, entity) {
      const rev = byYear(rows.filter((r) => r.Entity === entity)).map((r) => r[K.rev]).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
      if (rev.length < 3) return NaN;
      const g = [];
      for (let i = 1; i < rev.length; i++) g.push(rev[i] / rev[i - 1] - 1);
      if (g.length < 2 || g.some((v) => !isNum(v))) return NaN;
      return std(g);
    }
    const ratingIndex = (r) => { const i = CFG.RATING_SCALE_ASC.indexOf(r); return i < 0 ? null : i; };
    function notchChange(rows, entity) {
      const d = byYear(rows.filter((r) => r.Entity === entity && r.Rating !== undefined && r.Rating !== null));
      if (d.length < 2) return [null, null, null];
      const f = d[0].Rating, l = d[d.length - 1].Rating, fi = ratingIndex(f), li = ratingIndex(l);
      if (fi === null || li === null) return [f, l, null];
      return [f, l, li - fi];
    }
    function latestPerEntity(rows) {
      const m = new Map();
      for (const r of byYear(rows)) m.set(r.Entity, r);
      return [...m.values()];
    }

    /* ---------------- shocks.py ---------------- */
    function runScenario(base, p, H) {
      const num = (v, d) => (isNum(v) ? v : d);
      const dur = p.shock_duration_years;
      const fpath = fuelPath(p); // per-year fuel price path, or null for the step profile
      const cash0 = num(base["Cash and Equivalents"], NaN);
      const st = {
        EBIT: base[K.ebit], Interest: base[K.int], RE: base[K.re], Equity: base[K.eq], TL: base[K.tl], TA: base[K.ta],
        CA: base[K.ca], CL: base[K.cl], Revenue: base[K.rev], OpEx: base[K.opex],
        Recv: 0, VAT: 0, STDebt: 0, Payables: 0, LTDebt: 0, // stocks created by the shock
        // illiquid items already in the base-year current assets, where the file reports them (held flat)
        IlliquidOpen: num(base["Government Arrears Owed"], 0) + num(base["VAT Credits"], 0),
        // opening cash (0 when the file does not report it) and the drawdown not yet rebuilt
        Cash: isNum(cash0) ? cash0 : 0, CashDrawn: 0,
        Refinanced: 0, Support: 0,
        ArrIPP: 0, ArrFuel: 0, ArrDebt: 0, ArrOps: 0, Reserve: 0, // cash waterfall: arrears by priority tier and the reserve account
        ArrStat: 0, ArrFloor: 0, ArrJun: 0, StateShortfall: 0, CustArrears: 0,
        // snapshot rules: a year with debt service unpaid is rated D; share of the State receivable in current assets
        DefaultRule: num(p.default_on_missed_debt, 0) > 0,
        RecvCurrent: Math.min(1, Math.max(0, num(p.receivable_current_share, 1))),
      };
      const grants0 = num(base[K.grants], NaN);
      const out = [snap(base, 0, st, { rma: isNum(grants0) ? div(base[K.rev] - grants0, base[K.rev]) : NaN })];
      const sub = p.fuel_subsidy_share || 0, pt = p.tariff_passthrough || 0;
      const tariffUp = p.tariff_increase_pct || 0;
      const paidShare = num(p.comp_paid_share, 1), collectShare = num(p.comp_backlog_collected, 1), provShare = num(p.comp_provision_share, 0);
      const stShare = num(p.cash_gap_short_term_share, 0), rate = num(p.new_debt_interest_rate, 0);
      const apShare = num(p.cash_gap_payables_share, 0);
      const vatTrap = num(p.vat_rate, 0) * num(p.vat_trapped_share, 0);
      const kInt = 1 - stShare * apShare; // share of new funding that bears interest (unpaid supplier bills do not)
      const eps = num(p.fuel_oil_linkage, 1);                   // share of the fuel bill that moves with the oil price
      const exGrants = p.tariff_revenue_base === "revenue_ex_grants";
      const grants = num(base[K.grants], 0);                     // compensation already booked in revenue
      const buf = Math.min(1, Math.max(0, num(p.cash_buffer_share, 1)));
      const floor = num(p.cash_floor_opex_share, 0);
      const cashLive = isNum(cash0) && buf > 0 && !p.legacy_loss_assets;
      const legacy = !!p.legacy_loss_assets;
      // refinancing (separate assumption): in the start year, or the first year after it in which the previous year's rating meets the minimum
      let nts = p.near_term_maturity_share || 0;
      let refi = 0, saving = 0, refiDone = false;
      const refiShare = Math.max(0, num(p.refinance_share, 0));
      const refiStart = Math.max(1, Math.round(num(p.refinance_start_year, 1)));
      const refiMin = p.refinance_min_rating ? String(p.refinance_min_rating) : "";
      // cash waterfall: priority of payments
      const clamp01 = (v) => Math.min(1, Math.max(0, v));
      const wfOn = num(p.waterfall_on, 0) > 0 && !legacy;
      const ippShare = clamp01(num(p.ipp_cost_share, 0)), statShare = clamp01(num(p.statutory_cost_share, 0));
      const floorShare = clamp01(num(p.om_floor_share, 0)), junShare = clamp01(num(p.junior_share, 0));
      const reserveMonths = Math.max(0, num(p.reserve_months, 0));
      const ranks = waterfallRanks(p), rule = p.shortfall_rule ? String(p.shortfall_rule) : "soe";
      const wfStart = Math.max(1, Math.round(num(p.waterfall_start_year, 1))), wfRamp = Math.max(0, num(p.waterfall_rampup_months, 0));
      const wfShare = clamp01(num(p.waterfall_coverage, 1)) * clamp01(num(p.waterfall_compliance, 1));
      const rPri = num(p.late_rate_priority, 0), rDbt = num(p.late_rate_debt, 0), rOth = num(p.late_rate_other, 0);
      const disc0 = clamp01(num(p.priority_discount, 0)), uplift = Math.max(0, num(p.state_paid_uplift, 0));
      const dep = num(base[K.dep], 0), tax0 = Math.max(0, num(base["Tax Expense"], 0));
      const cap = num(p.borrowing_cap_debt_to_assets, 0);     // 0 = no cap
      const grantsKnown = isNum(grants0);
      // baseline: tariff gap, collections, demand
      const crr = Math.max(0, num(p.cost_recovery_ratio, 0)), gapState = clamp01(num(p.tariff_gap_state_share, 1));
      const seg = [[num(p.share_households, 0), num(p.collect_households, 1)], [num(p.share_large_private, 0), num(p.collect_large_private, 1)],
        [num(p.share_public, 0), num(p.collect_public, 1)]];
      const segW = seg.reduce((s, [w]) => s + Math.max(0, w), 0);
      const coll = segW > 0 ? seg.reduce((s, [w, c]) => s + Math.max(0, w) * clamp01(c), 0) / segW : 1;
      const custCollect = clamp01(num(p.customer_arrears_collected, 0.5));
      const growth = num(p.demand_growth, 0), losses = num(p.losses_change, 0);
      const rev0 = base[K.rev], opex0 = base[K.opex];

      for (let t = 1; t <= H; t++) {
        if (refiShare > 0 && !legacy && !refiDone && t >= refiStart && (!refiMin || ratingAtLeast(out[out.length - 1].Rating, refiMin))) {
          const std0 = num(base["Short Term Debt"], NaN);
          const stdBase = isNum(std0) ? std0 : nts * st.TL;    // reported short-term debt, else the near-term maturity proxy
          refi = Math.min(refiShare * Math.max(0, stdBase), Math.max(0, st.CL));
          const stRate = num(p.short_term_debt_rate, 0), ltRate = num(p.refinance_long_term_rate, 0);
          saving = refi * (stRate - ltRate);                   // interest saved on the refinanced debt, every year from now on
          if (st.TL) nts = Math.max(0, nts - refi / st.TL);    // refinanced debt no longer rolls over
          st.CL -= refi;                                       // moved to non-current: total liabilities unchanged
          st.Refinanced = refi;
          refiDone = true;
        }
        let gT = 1;
        if (growth) { gT = (1 + growth) ** t; st.Revenue = rev0 * gT; st.OpEx = opex0 * gT; } // demand growth scales sales and cash costs
        const alpha = wfOn && t >= wfStart ? wfShare * rampShare(t - wfStart, wfRamp) : 0; // share of this year's cash routed through the waterfall
        const active = t <= dur;
        let pFuel, fuelActive;
        if (fpath === null) { pFuel = p.fuel_shock_pct; fuelActive = active; }       // step: full magnitude while the shock is on
        else { pFuel = t <= fpath.length ? fpath[t - 1] : 0; fuelActive = pFuel !== 0; } // per-year path, zero beyond its end
        let custRev = st.Revenue - grants;                      // what customers are billed (revenue less compensation)
        let compGap = 0, dEbitCrr = 0;
        if (crr > 0) {                                          // cost-recovery ratio replaces the data's tariff level
          const dRc = crr * (st.OpEx + base[K.int]) - custRev;
          compGap = Math.max(-grants, -dRc * gapState);          // change in the State's tariff compensation
          dEbitCrr = dRc + compGap;                              // the part of the tariff change the State does not offset
          custRev = custRev + dRc;
        }
        let dFuel = 0, dFx = 0, dRev = 0, dInt = 0, dReval = 0, dArr = 0;
        let inc = 0, tariff = 0, cust = 0, comp = 0, vat = 0;
        if (fuelActive) {
          inc = p.fuel_cost_share * st.OpEx * eps * pFuel;      // fuel-cost change
          const tBase = exGrants ? (crr > 0 ? Math.max(0, custRev) : Math.max(0, st.Revenue - grants)) : st.Revenue;
          tariff = tariffUp * tBase;                            // Option B: end-user tariff increase
          const rem = inc - tariff;                             // what is left after the tariff increase
          if (tariff > 0 && rem < 0) {
            dFuel = -rem;                                       // tariff more than covers the fuel bill: SOE keeps the excess
          } else {
            cust = rem * pt;                                    // Case B: tariff pass-through
            comp = rem * sub;                                   // Case C: State compensation recognised (RMA gap)
            dFuel = -rem * Math.max(0, 1 - pt - sub);           // Case A: SOE absorbs the rest
          }
          vat = Math.max(0, inc) * vatTrap;                     // input VAT on the extra fuel bill that cannot be recovered
        }
        if (active) {
          dFx = -(p.fx_cost_share * st.OpEx - p.fx_revenue_share * st.Revenue) * p.fx_shock_pct;
          dRev = p.revenue_elasticity * (p.revenue_shock_pct || 0) * st.Revenue;
          const dRate = p.floating_debt_share * st.TL * (p.rate_shock_bps / 10000);
          const dRefi = nts * st.TL * ((p.refinancing_spread_bps || 0) / 10000);
          dInt = dRate + dRefi;
          dReval = -p.fx_debt_share * st.TL * p.fx_shock_pct;
          // the write-down cannot exceed the non-cash current assets left to write down (a larger value turned total
          // assets negative and flipped the ratios, so a distressed SOE jumped to "Safe")
          dArr = Math.max(-p.arrears_pct_of_revenue * st.Revenue, -Math.max(0, st.CA - Math.max(0, st.Cash)));
        }
        // State compensation (fuel, and any change in the tariff gap): recognised vs. paid in cash
        const pShare = uplift > 0 && alpha > 0 ? Math.min(1, paidShare + uplift * alpha) : paidShare;
        const compAll = comp + compGap;
        const paidNow = compAll > 0 ? compAll * pShare : compAll; // a saving (cheaper fuel) is settled at once
        const unpaid = compAll - paidNow;
        const provision = unpaid * provShare;                  // unpaid amount treated as a loss (method A)
        const collected = st.Recv * collectShare;              // earlier years' unpaid compensation arriving now
        const dRecv = unpaid - provision - collected;
        // customers' unpaid bills (collection rates by segment)
        const billed = custRev + tariff + cust;
        const dCust = billed * (1 - coll) - st.CustArrears * custCollect;
        // bills by tier (waterfall), and what priority creditors give back for their priority
        const opex = st.OpEx, fuelBase = p.fuel_cost_share * opex;
        const disc = wfOn ? disc0 * alpha : 0;
        let dExtra = 0;
        if (growth) dExtra += (gT - 1) * (rev0 - (opex0 - dep));  // margin before depreciation grows with demand
        if (losses) dExtra -= losses * custRev;                    // sales lost to higher losses at the same cost
        if (crr > 0) dExtra += dEbitCrr;
        if (disc > 0) dExtra += disc * (fuelBase + Math.max(0, inc) + ippShare * opex);
        const intLate = rPri * (st.ArrIPP + st.ArrFuel) + rDbt * st.ArrDebt + rOth * (st.ArrStat + st.ArrFloor + st.ArrOps + st.ArrJun);

        // net income before interest on this year's new borrowing
        const ebit = base[K.ebit] + dFuel + dFx + dRev + dExtra;
        const intOpen = rate * (st.STDebt + st.LTDebt);
        const ni0 = base[K.ni] + (dFuel + dFx + dRev) - dInt - provision - intOpen + saving + dExtra - intLate;

        // cash the SOE has to find this year (negative = surplus)
        const need0 = -ni0 + dRecv + vat + dCust;
        let fund = 0, intNew = 0, repay = 0, left = 0, draw = 0, rebuilt = 0, support = 0;
        const un = Object.fromEntries(TIER_KEYS.map((k) => [k, 0]));
        let rDraw = 0, topUp = 0, statePay = 0, bills = null, target = 0;
        if (wfOn) {                                            // the year's bills by tier
          const own = Math.max(0, opex - dep - ippShare * opex - fuelBase - statShare * opex);
          const junBill = junShare * own, soePart = own - junBill, floorBill = floorShare * soePart;
          bills = {
            ArrStat: tax0 + statShare * opex + rOth * st.ArrStat,
            ArrIPP: ippShare * opex * (1 - disc) + rPri * st.ArrIPP,
            ArrFuel: Math.max(0, fuelBase + inc) * (1 - disc) + rPri * st.ArrFuel,
            ArrDebt: Math.max(0, base[K.int] + dInt + intOpen - saving) + rDbt * st.ArrDebt,
            ArrFloor: floorBill + rOth * st.ArrFloor,
            ArrOps: soePart - floorBill + rOth * st.ArrOps,
            ArrJun: junBill + rOth * st.ArrJun,
          };
          target = (reserveMonths / 12) * (bills.ArrIPP + bills.ArrDebt);
        }
        const rankList = [...new Set(Object.values(ranks))].sort((a, b) => a - b);
        if (need0 > 0) {
          if (cashLive) draw = Math.min(need0, Math.max(0, st.Cash - floor * st.OpEx)) * buf; // cash first, down to the floor
          const gap = need0 - draw;
          let gapB;
          if (alpha > 0) {                                     // the routed share is not borrowed
            let gapW = gap * alpha;
            gapB = gap - gapW;
            for (const rk of rankList.slice().reverse()) {     // lowest priority first
              if (rk === ranks.reserve) { const d = Math.min(gapW, st.Reserve); rDraw += d; gapW -= d; } // the reserve protects the tiers at or above its rank
              if (rule === "state") continue;
              const grp = TIER_KEYS.filter((k) => ranks[TIER_RANK[k]] === rk);
              const tot = grp.reduce((s, k) => s + bills[k], 0);
              if (tot > 0 && gapW > 0) {
                const u = Math.min(gapW, tot);
                for (const k of grp) un[k] += u * (bills[k] / tot);
                gapW -= u;
              }
            }
            if (rule === "state") statePay = gapW;             // the State pays what the waterfall cannot
            else un.ArrOps += gapW;                            // anything beyond the year's bills stays with the SOE's own operations
          } else gapB = gap;
          if (gapB > 0) {                                      // the rest is borrowed, grossed up for half a year of interest
            fund = gapB / (1 - (kInt * rate) / 2);
            if (cap > 0) {                                     // borrowing stops at the debt-to-assets cap; the State injects the rest
              const taNew = st.TA + dRecv + vat + dArr - draw;
              const room = Math.max(0, cap * taNew - (st.TL - dReval));
              if (fund > room) { fund = room; support = gapB - fund * (1 - (kInt * rate) / 2); }
            }
            intNew = (rate * kInt * fund) / 2;
          }
        } else {                                               // surplus: arrears in priority order, then short-term debt
          let s = -need0;
          if (wfOn) {
            for (const rk of rankList) {                       // highest priority first
              const grp = TIER_KEYS.filter((k) => ranks[TIER_RANK[k]] === rk);
              const tot = grp.reduce((a, k) => a + st[k], 0);
              if (tot > 0 && s > 0) {
                const r = Math.min(s, tot);
                for (const k of grp) st[k] -= r * (st[k] / tot);
                s -= r; repay += r;
              }
              if (rk === ranks.reserve && alpha > 0) { topUp = Math.min(s, Math.max(0, target - st.Reserve)); s -= topUp; } // then the reserve, at its rank
            }
          }
          const rb = Math.min(s, st.STDebt); st.STDebt -= rb; s -= rb;
          const ra = Math.min(s, st.Payables); st.Payables -= ra; s -= ra;
          repay += rb + ra; left = s;
          if (cashLive) rebuilt = Math.min(left, st.CashDrawn); // rebuilds the cash drawn in earlier years, no further
        }
        const wfUnpaid = TIER_KEYS.reduce((a, k) => a + un[k], 0);
        const ni = ni0 - intNew;
        const fST = fund * stShare, fAP = fST * apShare, fBank = fST - fAP, fLT = fund - fST;

        st.STDebt += fBank; st.Payables += fAP; st.LTDebt += fLT;
        st.Recv += dRecv; st.VAT += vat; st.CustArrears += dCust;
        // the arrears write-down is a non-cash impairment of current assets: it hits equity and retained
        // earnings in the same year, but not EBIT, net income or the financing need
        st.RE += ni + dArr;
        st.Equity += ni + dArr + dReval + support + statePay;
        st.Support += support; st.StateShortfall += statePay;
        for (const k of TIER_KEYS) st[k] += un[k];
        st.Reserve += topUp - rDraw;
        st.CL += fST + wfUnpaid - repay;
        st.TL += fund + wfUnpaid - repay - dReval;
        st.CA += dRecv + vat + dArr + dCust;
        st.TA += dRecv + vat + dArr + left + topUp - rDraw + dCust;
        if (p.legacy_loss_assets && need0 > 0) st.TA += Math.min(0, ni); // optional: old rule, a borrowed loss also cuts total assets
        if (draw) { st.Cash -= draw; st.CashDrawn += draw; st.CA -= draw; st.TA -= draw; } // cash paid out
        if (rebuilt) { st.Cash += rebuilt; st.CashDrawn -= rebuilt; st.CA += rebuilt; }    // part of the surplus held as cash
        st.EBIT = ebit;
        st.Interest = base[K.int] + dInt + intOpen + intNew - saving + intLate;
        const rma = grantsKnown ? div(custRev + tariff + cust, st.Revenue + inc) : NaN; // customer share of the allowed revenue
        out.push(snap(base, t, st, { inc, tariff, cust, comp, paidNow, unpaid, collected, provision, vat, fund, draw, fST, intNew: intOpen + intNew, ni, support, saving, rma,
          wfUnpaid, uOps: un.ArrOps + un.ArrFloor, rDraw, topUp, statePay, late: intLate, alpha, compGap, dCust }));
      }
      return out;
    }
    // waterfall tiers: state key -> the WATERFALL_TIERS rank it takes ("residual" is split by the shortfall rule)
    const TIER_KEYS = ["ArrStat", "ArrIPP", "ArrFuel", "ArrDebt", "ArrFloor", "ArrOps", "ArrJun"];
    const TIER_RANK = { ArrStat: "statutory", ArrIPP: "ipp", ArrFuel: "fuel", ArrDebt: "debt", ArrFloor: "om_floor", ArrOps: "ops", ArrJun: "junior" };
    /** shocks.waterfall_ranks */
    function waterfallRanks(p) {
      const key = p.waterfall_order ? String(p.waterfall_order) : "senelec_note";
      const preset = CFG.WATERFALL_ORDERS[key] || CFG.WATERFALL_ORDERS.senelec_note;
      let base;
      if (!preset.ranks) {                                     // custom
        const dflt = CFG.WATERFALL_ORDERS.senelec_note.ranks;
        base = Object.fromEntries(CFG.WATERFALL_TIERS.map((k) => [k, isNum(p["rank_" + k]) ? p["rank_" + k] : dflt[k]]));
      } else base = Object.assign({}, preset.ranks);
      const rule = p.shortfall_rule ? String(p.shortfall_rule) : "soe", b = base.residual;
      let ops, jun;
      if (rule === "junior") { ops = b; jun = b + 0.5; } else if (rule === "pro_rata") { ops = jun = b; } else { ops = b + 0.5; jun = b; }
      return { statutory: base.statutory, ipp: base.ipp, fuel: base.fuel, debt: base.debt, reserve: base.reserve, om_floor: base.om_floor, ops, junior: jun };
    }
    /** shocks.ramp_share: average share in force during year k after the start under a linear phase-in */
    function rampShare(k, months) {
      if (months <= 0) return 1;
      const a = 12 * k, b = 12 * (k + 1);
      if (a >= months) return 1;
      const hi = Math.min(b, months);
      return ((hi * hi - a * a) / (2 * months) + (b - hi)) / 12;
    }
    const RATING_ORDER = CFG.Z_RATING_TABLE.map((r) => r[2]);
    const ratingAtLeast = (r, m) => RATING_ORDER.includes(r) && RATING_ORDER.includes(m) && RATING_ORDER.indexOf(r) <= RATING_ORDER.indexOf(m);
    // the D band: its upper Z bound and PD anchor the logistic tail
    const Z_D = CFG.Z_RATING_TABLE[CFG.Z_RATING_TABLE.length - 1][1], PD_D = CFG.Z_RATING_TABLE[CFG.Z_RATING_TABLE.length - 1][3];
    const logistic = (x) => (isNum(x) ? 1 / (1 + Math.exp(-x)) : NaN);
    // Logistic tail below the D threshold, the single definition shared by "rating_tail"
    // and "rating_smooth" (pd_curves.logistic_tail): logistic(logit(pdD) + b (z - zD)).
    const logisticTail = (z, b, zD, pdD) => logistic(Math.log(pdD / (1 - pdD)) + b * (z - zD));
    // C1 monotone cubic Hermite interpolation in log-odds (PCHIP) through the 20 rating
    // midpoint PDs (each an exact anchor), floored at the AAA PD at and above the AAA
    // anchor; below the D anchor the PD follows logisticTail with slope b.
    // This is the primary Monte Carlo PD curve (the single logistic is the sensitivity).
    const anchors = CFG.Z_RATING_TABLE.map(([lo,hi,r,pd]) => ({
      x: lo === null ? hi : hi === null ? lo : (lo+hi)/2,
      y: Math.log(pd/(1-pd))
    })).sort((a,b) => a.x-b.x);
    const hx = anchors.slice(1).map((a,i) => a.x-anchors[i].x);
    const delta = hx.map((h,i) => (anchors[i+1].y-anchors[i].y)/h);
    const endSlope = (h0,h1,d0,d1) => {
      let m=((2*h0+h1)*d0-h0*d1)/(h0+h1);
      if(m*d0<=0) return 0;
      if(d0*d1<0 && Math.abs(m)>3*Math.abs(d0)) return 3*d0;
      return m;
    };
    const derivatives = anchors.map((_,i) => {
      const k=anchors.length-1;
      if(i===0) return endSlope(hx[0],hx[1],delta[0],delta[1]);
      if(i===k) return endSlope(hx[k-1],hx[k-2],delta[k-1],delta[k-2]);
      if(delta[i-1]*delta[i]<=0) return 0;
      const w1=2*hx[i]+hx[i-1],w2=hx[i]+2*hx[i-1];
      return (w1+w2)/(w1/delta[i-1]+w2/delta[i]);
    });
    function ratingSmooth(z, b) {
      if(!isNum(z)) return NaN;
      if(!isNum(b)) b=CFG.DEFAULT_CASH_SETTINGS.pd_logit_b;
      const n=anchors.length-1;
      if(z<anchors[0].x) return logisticTail(z, b, anchors[0].x, logistic(anchors[0].y)); // below the D anchor: logistic tail
      if(z>=anchors[n].x) return logistic(anchors[n].y);     // AAA floor
      let i=0;while(i<n-1 && z>=anchors[i+1].x)i++;
      const h=hx[i],t=(z-anchors[i].x)/h;
      return logistic((2*t*t*t-3*t*t+1)*anchors[i].y+(t*t*t-2*t*t+t)*h*derivatives[i]
        +(-2*t*t*t+3*t*t)*anchors[i+1].y+(t*t*t-t*t)*h*derivatives[i+1]);
    }
    /** shocks.pd_value */
    function pdValue(z, rating, debtDefault, p) {
      p = p || {};
      if (debtDefault && p.pd_override_on_missed_service !== false) return isNum(p.pd_on_default) ? p.pd_on_default : 1;
      const method = p.pd_method ? String(p.pd_method) : "rating";
      if (method === "user") return Math.min(1, Math.max(0, isNum(p.pd_user) ? p.pd_user : 0.1));
      const b = isNum(p.pd_logit_b) ? p.pd_logit_b : -1.17;
      if (method === "logistic") return isNum(z) ? logistic((isNum(p.pd_logit_a) ? p.pd_logit_a : CFG.DEFAULT_CASH_SETTINGS.pd_logit_a) + b * z) : NaN;
      if (method === "rating_smooth") return ratingSmooth(z, b);
      if (method === "rating_tail" && isNum(z) && z < Z_D) return logisticTail(z, b, Z_D, PD_D);
      return pdByRating(rating);
    }
    /** shocks.cumulative_pd */
    const cumulativePd = (pds) => 1 - pds.reduce((q, v) => q * (isNum(v) ? 1 - Math.min(1, Math.max(0, v)) : 1), 1);
    function snap(base, t, st, f) {
      const ca = st.CA - (1 - st.RecvCurrent) * st.Recv;      // part of the State receivable may be non-current
      const z = zemFromValues(ca - st.CL, st.TA, st.RE, st.EBIT, st.Equity, st.TL);
      const illiquid = st.IlliquidOpen + st.Recv + st.VAT + st.CustArrears; // customer arrears are slow to collect too
      const dflt = !!(st.DefaultRule && st.ArrDebt > 0);      // debt service unpaid: rated D
      return {
        Entity: base.Entity, Sector: base.Sector, "Calendar Year": base.Year + t, "Projection Year": t,
        EBIT: st.EBIT, "Interest Expense": st.Interest, "Net Income": t === 0 ? base[K.ni] : f.ni,
        "Retained Earnings": st.RE, Equity: st.Equity,
        "Total Liabilities": st.TL, "Total Assets": st.TA, "Current Assets": ca, "Current Liabilities": st.CL,
        X1: z.X1, X2: z.X2, X3: z.X3, X4: z.X4, Z_EM: z.Z_EM, Zone: z.Zone, Rating: dflt ? "D" : zRating(z.Z_EM), "Debt Default": dflt ? 1 : 0,
        // same meaning as before: the government's recognised share (Case C)
        "Direct Fuel Subsidy": f.comp || 0,
        // new flows
        "Fuel Cost Change": f.inc || 0,
        "Tariff Increase Revenue": f.tariff || 0,
        "Tariff Pass-through": f.cust || 0,
        "State Compensation Paid": (f.paidNow || 0) + (f.collected || 0), // cash from the budget this year
        "Compensation Provision": f.provision || 0,
        "Trapped VAT": f.vat || 0,
        "Cash Funding Gap": f.fund || 0,                    // borrowed, after any cash drawn
        "Cash Drawdown": f.draw || 0,                       // paid out of the opening cash buffer
        "Interest on New Debt": f.intNew || 0,
        "Interest Saved": f.saving || 0,                    // refinancing: short-term debt at the long-term rate
        "Unpaid Under Waterfall": f.wfUnpaid || 0,          // the year's shortfall left unpaid, all tiers
        "Underfunded Operations": f.uOps || 0,              // of which the SOE's own operations (floor and above)
        "State Shortfall Payment": f.statePay || 0,         // the State pays the waterfall's shortfall (shortfall rule "state")
        "Late-payment Interest": f.late || 0,               // interest on arrears outstanding at the start of the year
        "Waterfall Routed Share": f.alpha || 0,             // share of the year's cash routed through the waterfall
        "Tariff Gap Compensation Change": f.compGap || 0,   // change in State compensation from the cost-recovery ratio
        "Customer Arrears Change": f.dCust || 0,
        "Reserve Draw": f.rDraw || 0,
        "Reserve Top-up": f.topUp || 0,
        "Emergency Support": f.support || 0,                // government injection above the borrowing cap
        "Tariff Share of RMA": isNum(f.rma) ? f.rma : NaN,  // revenue excl. grants / allowed revenue (revenue + fuel-cost change)
        // new stocks
        "State Compensation Receivable": st.Recv,
        "Trapped VAT Credits": st.VAT,
        "New Short-term Debt": st.STDebt,
        "Supplier Arrears": st.Payables,
        "New Long-term Debt": st.LTDebt,
        Cash: st.Cash,
        "Refinanced Debt": st.Refinanced,                   // short-term bank debt moved to long-term (refinancing)
        "Arrears to IPPs": st.ArrIPP,                       // cash waterfall: unpaid bills by priority tier
        "Arrears to Fuel Suppliers": st.ArrFuel,
        "Missed Debt Service": st.ArrDebt,
        "Arrears on Own Operations": st.ArrOps,               // above the O&M floor
        "Arrears on O&M Floor": st.ArrFloor,
        "Arrears to Junior Creditors": st.ArrJun,
        "Arrears to Statutory and Operator": st.ArrStat,
        "Customer Arrears": st.CustArrears,
        "Cumulative State Shortfall Payment": st.StateShortfall,
        "Reserve Account": st.Reserve,
        "Cumulative Emergency Support": st.Support,
        // liquidity and solvency
        "Current Ratio": div(ca, st.CL),
        "Adjusted Current Ratio": div(st.CA - illiquid, st.CL), // excludes State receivables, trapped VAT and customer arrears
        "Debt to Assets": div(st.TL, st.TA),
      };
    }
    /** adds PD, EAD (share × total liabilities), LGD, EFC (and EFC/GDP when a GDP path is given) to a scenario path */
    function costPath(path, lgdPct, gdpSeries, eadShare = 1, p = null) {
      return path.map((r, i) => {
        const pd = pdValue(r.Z_EM, r.Rating, r["Debt Default"] > 0, p), ead = r["Total Liabilities"] * eadShare, efc = pd * ead * (lgdPct / 100);
        return Object.assign({}, r, { PD: pd, EAD: ead, LGD: lgdPct / 100, EFC: efc, GDP: gdpSeries ? gdpSeries[i] : NaN, EFC_GDP: gdpSeries ? efc / gdpSeries[i] : NaN });
      });
    }
    function kpiImpact(path) {
      const b = path[0], f = path[path.length - 1];
      return ZCOMP.map((c) => ({ Component: CFG.ZEM_LABELS[c], key: c, base: b[c], final: f[c], change: f[c] - b[c], weighted: (f[c] - b[c]) * CFG.ZEM_COEFFICIENTS[c] }));
    }
    const gdpPath = (g0, g, H) => Array.from({ length: H + 1 }, (_, t) => g0 * (1 + g) ** t);
    const pyPlus0 = (v) => { const r = Math.round(v); return (r >= 0 && !Object.is(r, -0) ? "+" : "") + String(r).replace("-0", "0"); };
    function describeShocks(p) {
      const parts = [], fp = fuelPath(p);
      let fuelOn;
      if (fp) { parts.push(`Fuel path ${fp.map((v) => pyPlus0(v * 100)).join("/")}%`); fuelOn = fp.some((v) => v !== 0); }
      else { fuelOn = !!p.fuel_shock_pct; if (fuelOn) parts.push(`Fuel ${pyPlus0(p.fuel_shock_pct * 100)}%`); }
      const nFuel = parts.length;
      if (p.fx_shock_pct) parts.push(`FX ${pyPlus0(p.fx_shock_pct * 100)}%`);
      if (p.rate_shock_bps) parts.push(`Rate ${pyPlus0(p.rate_shock_bps)}bps`);
      if (p.revenue_shock_pct) {
        const s = p.revenue_shock_std_devs;
        parts.push(s ? `Revenue ${(s >= 0 ? "+" : "") + s.toFixed(1)}σ` : `Revenue ${pyPlus0(p.revenue_shock_pct * 100)}%`);
      }
      if (p.refinancing_spread_bps && (p.near_term_maturity_share || 0) > 0) parts.push(`Refi ${pyPlus0(p.refinancing_spread_bps)}bps`);
      if (p.arrears_pct_of_revenue) parts.push(`Arrears ${pyPlus0(p.arrears_pct_of_revenue * 100)}%/yr`);
      const stepOn = !fp || parts.length > nFuel; // a shock that runs for shock_duration_years
      if (p.tariff_increase_pct) parts.push(`Tariff ${pyPlus0(p.tariff_increase_pct * 100)}%`);
      if (p.fuel_subsidy_share && fuelOn) parts.push(`gov. absorbs ${Math.round(p.fuel_subsidy_share * 100)}% of fuel cost change`);
      if (p.fuel_subsidy_share && fuelOn && (p.comp_paid_share ?? 1) < 1) parts.push(`${Math.round((p.comp_paid_share ?? 1) * 100)}% paid in-year`);
      const pol = [];                                          // financing policies in force (not shocks)
      if ((isNum(p.waterfall_on) ? p.waterfall_on : 0) > 0 && !p.legacy_loss_assets) {
        const order = CFG.WATERFALL_ORDERS[p.waterfall_order ? String(p.waterfall_order) : "senelec_note"] || CFG.WATERFALL_ORDERS.senelec_note;
        const c01 = (v, d) => Math.min(1, Math.max(0, isNum(v) ? v : d));
        const extra = [order.short], share = c01(p.waterfall_coverage, 1) * c01(p.waterfall_compliance, 1);
        if (share < 1) extra.push(`${(share * 100).toFixed(0)}% of cash routed`);
        if ((p.shortfall_rule ? String(p.shortfall_rule) : "soe") === "state") extra.push("State covers the shortfall");
        pol.push("cash waterfall (" + extra.join(", ") + ")");
      }
      const crr = isNum(p.cost_recovery_ratio) ? p.cost_recovery_ratio : 0;
      if (crr > 0) pol.push(`cost recovery ${(crr * 100).toFixed(0)}%`);
      const refiSh = isNum(p.refinance_share) ? p.refinance_share : 0;
      if (refiSh > 0 && !p.legacy_loss_assets) pol.push(`${(refiSh * 100).toFixed(0)}% of short-term debt refinanced`);
      const cap = isNum(p.borrowing_cap_debt_to_assets) ? p.borrowing_cap_debt_to_assets : 0;
      if (cap > 0) pol.push(`borrowing cap ${cap.toFixed(2)} debt/assets`);
      const pdm = p.pd_method ? String(p.pd_method) : "rating";
      if (pdm !== "rating") pol.push({ rating_tail: "PD: rating bands with a logistic tail", logistic: "PD: logistic in Z-EM", user: "PD: user-specified" }[pdm] || "PD: " + pdm);
      const sfx = pol.length ? " · " + pol.join(", ") : "";
      if (!parts.length) return "No shock applied (baseline)" + sfx;
      return parts.join(", ") + (p.shock_duration_years && stepOn ? ` — active ${p.shock_duration_years}yr` : "") + sfx;
    }
    // Seeded generator (mulberry32) + Box–Muller, so identical settings reproduce identical draws.
    function rng(seed) {
      let a = seed >>> 0, spare = null;
      const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      return () => {
        if (spare !== null) { const s = spare; spare = null; return s; }
        let x = 0, y = 0;
        while (x === 0) x = u();
        y = u();
        const m = Math.sqrt(-2 * Math.log(x));
        spare = m * Math.sin(2 * Math.PI * y);
        return m * Math.cos(2 * Math.PI * y);
      };
    }
    /** Jacobi eigen-decomposition of a small symmetric matrix → {values, vectors (columns)} */
    function symEig(M0) {
      const n = M0.length, A = M0.map((r) => r.slice()), V = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
      for (let sweep = 0; sweep < 100; sweep++) {
        let off = 0;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
        if (off < 1e-24) break;
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-300) continue;
          const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (let k = 0; k < n; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = c * a - s * b; A[k][q] = s * a + c * b; }
          for (let k = 0; k < n; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = c * a - s * b; A[q][k] = s * a + c * b; }
          for (let k = 0; k < n; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
        }
      }
      return { values: A.map((r, i) => r[i]), vectors: V };
    }
    const MC_VARIABLES = ["fuel", "fx", "rate", "revenue"];
    const corrOf = (corrs, a, b) => (corrs[`${a}|${b}`] ?? corrs[`${b}|${a}`] ?? 0);
    /** mc_covariance's check + a factor F with F·Fᵀ = covariance (eigen-based, so a semi-definite matrix works).
     *  Throws when the correlations are inconsistent (matrix not positive semi-definite). */
    function mcFactor(names, sds, corrs) {
      const k = names.length, R = names.map((a, i) => names.map((b, j) => (i === j ? 1 : corrOf(corrs, a, b))));
      const { values, vectors } = symEig(R);
      if (Math.min(...values) < -1e-10) throw new Error("The shock correlations are inconsistent (the correlation matrix is not positive semi-definite). Lower some of them.");
      return names.map((a, i) => values.map((lam, j) => sds[a] * vectors[i][j] * Math.sqrt(Math.max(0, lam))));
    }
    /** run_monte_carlo. Fuel and FX are always drawn around the slider values (with a fuel price path, fuel is drawn
     *  around the path's peak and each draw rescales the whole path); the interest-rate shock (bps) and
     *  the revenue shock (standard deviations of own revenue growth) are drawn too when their std. dev. is > 0.
     *  o: {n, fuelSd, fxSd, rho, rateSd, revSd, correlations, H, lgd, gdp, seed, eadShare}. With only fuel and FX
     *  drawn, the draws are the same as the original two-variable version for the same seed. */
    function monteCarlo(base, p, o) {
      // The principal Monte Carlo PD is the rating-anchored curve (rating_smooth);
      // the single logistic is evaluated on the same draws as a sensitivity.
      const mcMethod=p.mc_pd_method ? String(p.mc_pd_method) : "rating_smooth";
      if (mcMethod !== "logistic" && mcMethod !== "rating_smooth") throw new Error("mc_pd_method must be logistic or rating_smooth");
      const mcP = Object.assign({}, p, { pd_method: mcMethod, pd_override_on_missed_service: false });
      const g = rng(o.seed ?? 42), sims = [], n = o.n, H = o.H;
      const corrs = Object.assign({}, o.correlations || {});
      if (!("fuel|fx" in corrs)) corrs["fuel|fx"] = o.rho ?? 0;
      const names = ["fuel", "fx"].concat((o.rateSd || 0) > 0 ? ["rate"] : [], (o.revSd || 0) > 0 ? ["revenue"] : []);
      const fp = fuelPath(p); // with a path, fuel draws centre on its peak (first largest |value|) and rescale its shape
      const peak = fp ? fp.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), fp[0]) : null;
      const means = { fuel: fp ? peak : p.fuel_shock_pct, fx: p.fx_shock_pct, rate: p.rate_shock_bps || 0, revenue: p.revenue_shock_std_devs || 0 };
      const sds = { fuel: o.fuelSd, fx: o.fxSd, rate: o.rateSd || 0, revenue: o.revSd || 0 };
      let draw;
      if (names.length === 2) {
        const rho = corrs["fuel|fx"], c = Math.sqrt(Math.max(0, 1 - rho * rho));
        draw = () => { const z1 = g(), z2 = g(); return [means.fuel + sds.fuel * z1, means.fx + sds.fx * (rho * z1 + c * z2)]; };
      } else {
        const F = mcFactor(names, sds, corrs);
        draw = () => { const z = names.map(() => g()); return names.map((nm, i) => means[nm] + F[i].reduce((s, f, j) => s + f * z[j], 0)); };
      }
      let sigma = p.revenue_sigma ?? null;
      if (sigma === null && p.revenue_shock_std_devs) sigma = (p.revenue_shock_pct || 0) / p.revenue_shock_std_devs;
      if (names.includes("revenue") && sigma === null) throw new Error("revenue_sigma is needed to draw revenue shocks");
      for (let i = 0; i < n; i++) {
        const d = Object.fromEntries(names.map((nm, k) => [nm, 0])), v = draw();
        names.forEach((nm, k) => { d[nm] = v[k]; });
        const sp = Object.assign({}, p, { fuel_shock_pct: d.fuel, fx_shock_pct: d.fx });
        if (fp) sp.fuel_shock_path = peak ? fp.map((v) => d.fuel * (v / peak)) : fp.slice();
        if ("rate" in d) sp.rate_shock_bps = d.rate;
        if ("revenue" in d) { sp.revenue_shock_std_devs = d.revenue; sp.revenue_shock_pct = d.revenue * sigma; }
        const path = costPath(runScenario(base, sp, H), o.lgd, o.gdp || null, o.eadShare ?? 1, mcP);
        for(const row of path) {
          row.PD_Full_Logistic=pdValue(row.Z_EM,row.Rating,false,{...mcP,pd_method:"logistic"});
          row.PD_Rating_Anchored=pdValue(row.Z_EM,row.Rating,false,{...mcP,pd_method:"rating_smooth"});
          row.EFC_Full_Logistic=row.PD_Full_Logistic*row.EAD*row.LGD;
          row.EFC_Rating_Anchored=row.PD_Rating_Anchored*row.EAD*row.LGD;
          row.MC_PD_Model=mcMethod;
        }
        sims.push({ fuel: d.fuel, fx: d.fx, draw: d, path });
      }
      sims.names = names;
      return sims;
    }
    /** pandas/numpy default (linear) quantile */
    function quantile(values, q) {
      const a = values.filter(isNum).sort((x, y) => x - y);
      if (!a.length) return NaN;
      const pos = (a.length - 1) * q, i = Math.floor(pos), f = pos - i;
      return i + 1 < a.length ? a[i] + f * (a[i + 1] - a[i]) : a[i];
    }
    function percentilePath(sims, key, qs = [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const H = sims[0].path.length;
      return Array.from({ length: H }, (_, t) => {
        const vals = sims.map((s) => s.path[t][key]);
        const o = { t, year: sims[0].path[t]["Calendar Year"] };
        qs.forEach((q) => { o["p" + Math.round(q * 100)] = quantile(vals, q); });
        return o;
      });
    }

    /* ---------------- narrative.py ---------------- */
    function bucket(comp, v) {
      if (!isNum(v)) return "weak_positive";
      if (v < 0) return "negative";
      return v >= CFG.ZEM_COMPONENT_STRONG_THRESHOLD[comp] ? "strong_positive" : "weak_positive";
    }
    const describe = (comp, v) => CFG.ZEM_DESCRIPTORS[comp][bucket(comp, v)];
    const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const f2 = (v) => (isNum(v) ? v.toFixed(2) : "nan");
    function ranked(row) {
      return ZCOMP.map((c) => [c, row[c + "_contrib"]]).sort((a, b) => a[1] - b[1]);
    }
    function singleNarrative(row) {
      const entity = row.Entity || "This SOE", zone = row.Zone;
      const rk = ranked(row), totalAbs = rk.reduce((s, kv) => s + Math.abs(kv[1]), 0);
      const [negC, negV] = rk[0], [posC, posV] = rk[rk.length - 1];
      const out = [`**${entity} sits in the ${zone} zone (Z-EM = ${f2(row.Z_EM)}).**`];
      if (posV > 0) {
        const share = totalAbs ? Math.abs(posV) / totalAbs : 0, d = describe(posC, row[posC]);
        out.push(share >= CFG.SINGLE_DRIVER_SHARE_THRESHOLD
          ? `The classification is driven almost entirely by ${d} (${CFG.ZEM_LABELS[posC]} = ${f2(row[posC])}).`
          : `${capitalize(d)} (${CFG.ZEM_LABELS[posC]} = ${f2(row[posC])}) is the largest positive contributor.`);
      }
      if (negV < 0) out.push(`The main drag is ${describe(negC, row[negC])} (${CFG.ZEM_LABELS[negC]} = ${f2(row[negC])}).`);
      const nNeg = ZCOMP.filter((c) => row[c] < 0).length;
      if (nNeg >= 3 && zone !== "Distress") out.push(`Three or more components are negative even though the headline classification is ${zone} — worth flagging as a fragile score carried by a narrow base.`);
      else if (nNeg <= 1 && zone === "Distress") out.push("Most components are positive despite the Distress classification — the score is being pulled down by a concentrated weakness rather than broad-based deterioration.");
      else if (nNeg === 4) out.push("This is broad-based distress, not a single-metric problem.");
      return out.join(" ");
    }
    function crossNarrative(rows) {
      if (!rows.length) return { paragraph: "No data available for this selection.", table: [] };
      const table = rows.map((row) => {
        const rk = ranked(row), totalAbs = rk.reduce((s, kv) => s + Math.abs(kv[1]), 0);
        const [posC, posV] = rk[rk.length - 1];
        const share = totalAbs ? Math.abs(posV) / totalAbs : 0;
        let flag = "";
        if (share >= CFG.SINGLE_DRIVER_SHARE_THRESHOLD) {
          const nNeg = ZCOMP.filter((c) => row[c] < 0).length;
          flag = nNeg >= 2 ? `Single-driver classification — weak on ${nNeg} of 4 components` : "Single-driver classification";
        }
        return { Entity: row.Entity || "", Sector: row.Sector || "", Z_EM: row.Z_EM, Zone: row.Zone, "Primary driver": CFG.ZEM_LABELS[posC], Flag: flag };
      }).sort((a, b) => b.Z_EM - a.Z_EM);
      const cnt = (z) => table.filter((r) => r.Zone === z).length;
      const nSingle = table.filter((r) => r.Flag).length;
      const parts = [`Of ${table.length} SOEs assessed, ${cnt("Safe")} sit in Safe, ${cnt("Grey")} in Grey, and ${cnt("Distress")} in Distress.`];
      if (nSingle > 0) parts.push(`${nSingle} SOE${nSingle !== 1 ? "s" : ""} ${nSingle !== 1 ? "have" : "has"} a classification driven primarily by a single component rather than a broad financial position — worth monitoring for fragility.`);
      const sectors = [...new Set(table.map((r) => r.Sector))];
      if (sectors.length > 1) {
        const means = sectors.sort().map((s) => { const v = table.filter((r) => r.Sector === s).map((r) => r.Z_EM); return [s, v.reduce((a, b) => a + b, 0) / v.length]; }).sort((a, b) => a[1] - b[1]);
        const [w, wm] = means[0], [s, sm] = means[means.length - 1];
        if (wm < sm) parts.push(`${w} SOEs show systematically weaker Z-EM scores (mean ${f2(wm)}) than ${s} SOEs (mean ${f2(sm)}) in this sample — flagged as a sector-level pattern rather than a firm-specific one, though the sample size here is small.`);
      }
      return { paragraph: parts.join(" "), table };
    }

    /* ---------------- utils/summary.py ---------------- */
    function zTrendSummary(rows, name) {
      const d = byYear(rows.filter((r) => isNum(r.Z_EM)));
      if (d.length < 2) return `Not enough time points to describe a trend for ${name}.`;
      const a = d[0].Z_EM, b = d[d.length - 1].Z_EM, ch = b - a;
      const dir = ch > 0 ? "improved" : ch < 0 ? "declined" : "held steady";
      return `${name}'s Z-EM score ${dir} from ${f2(a)} in ${d[0].Year} to ${f2(b)} in ${d[d.length - 1].Year}, ending in the ${String(d[d.length - 1].Zone).toLowerCase()} zone.`;
    }
    function zoneSummary(rows) {
      if (!rows.length) return "No data available for this selection.";
      const n = rows.length, c = (z) => rows.filter((r) => r.Zone === z).length;
      const parts = [`${c("Distress")} of ${n} SOEs are in the distress zone (Z-EM ≤ ${CFG.Z_DISTRESS_CUTOFF})`];
      if (c("Grey")) parts.push(`${c("Grey")} in the grey zone`);
      if (c("Safe")) parts.push(`${c("Safe")} in the safe zone`);
      let s = parts.join(", ") + ".";
      if (c("Distress") > 0) {
        const m = new Map();
        rows.filter((r) => r.Zone === "Distress").forEach((r) => m.set(r.Sector, (m.get(r.Sector) || 0) + 1));
        const worst = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);
        if (worst.length) s += ` Distress is concentrated in ${worst.join(", ")}.`;
      }
      return s;
    }

    /* ---------------- strategic_soe.py (GRE uplift) ---------------- */
    function gre(rows, entity, role, link, sovereign, outlook) {
      const d = byYear(rows.filter((r) => r.Entity === entity));
      const sacp = d[d.length - 1].Rating, sIdx = ratingIndex(sacp), vIdx = ratingIndex(sovereign);
      const tier = CFG.ROLE_LINK_TO_TIER[String((CFG.ROLE_SCORE[role] || 1) + (CFG.LINK_SCORE[link] || 1))] || "Low";
      const [fr, lr, nc] = notchChange(rows, entity);
      const triggers = [];
      if (nc !== null && nc <= -CFG.DYNAMIC_CAP_TRIGGER_NOTCHES) triggers.push(`rating fell ${Math.abs(nc)} notches (${fr} → ${lr})`);
      if (outlook === "Negative") triggers.push("sovereign outlook is Negative");
      const order = CFG.LIKELIHOOD_TIERS_ASC;
      const capped = triggers.length && order.indexOf(tier) > order.indexOf(CFG.DYNAMIC_CAP_TIER) ? CFG.DYNAMIC_CAP_TIER : tier;
      const spec = CFG.LIKELIHOOD_UPLIFT[capped], m = spec.max_notches, g = spec.min_gap_to_sovereign;
      let uIdx, ceiling = null;
      if (sIdx === null || vIdx === null || m === 0) uIdx = sIdx;
      else { ceiling = vIdx - (g || 0); const target = m !== null ? sIdx + m : ceiling; uIdx = Math.max(sIdx, Math.min(target, ceiling)); }
      const uplifted = uIdx !== null ? CFG.RATING_SCALE_ASC[uIdx] : sacp;
      return {
        entity, sacp, role, link, tier, capped, capApplied: triggers.length > 0, triggers, uplifted,
        notches: sIdx !== null && uIdx !== null ? uIdx - sIdx : 0,
        gap: vIdx !== null && uIdx !== null ? vIdx - uIdx : null, ceilingIdx: ceiling, sIdx, uIdx, vIdx,
      };
    }

    /* ---------------- schema.py (column matching) ---------------- */
    const SCH = CFG.SCHEMA || { variables: [], fuzzy_cutoff: 0.88 };
    const BY_COLUMN = Object.fromEntries(SCH.variables.map((v) => [v.column, v]));
    function normalizeLabel(label) {
      let s = String(label).trim().toLowerCase().replace(/&/g, " and ");
      s = s.replace(/[^a-z0-9]+/g, " ");
      return s.replace(/\s+/g, " ").trim();
    }
    const LOOKUP = new Map();
    for (const v of SCH.variables) {
      for (const [name, how] of [[v.key, "exact"], [v.column, "exact"], ...v.synonyms.map((x) => [x, "synonym"])]) {
        const n = normalizeLabel(name);
        if (n && !LOOKUP.has(n)) LOOKUP.set(n, [v.column, how]);
      }
    }
    /** difflib.SequenceMatcher(None, a, b).ratio() (no junk; labels are far below the 200-character autojunk size) */
    function seqRatio(a, b) {
      const la = a.length, lb = b.length;
      if (!la && !lb) return 1;
      const b2j = new Map();
      for (let j = 0; j < lb; j++) { if (!b2j.has(b[j])) b2j.set(b[j], []); b2j.get(b[j]).push(j); }
      const longest = (alo, ahi, blo, bhi) => {
        let bi = alo, bj = blo, bs = 0, j2len = new Map();
        for (let i = alo; i < ahi; i++) {
          const nj = new Map();
          for (const j of b2j.get(a[i]) || []) {
            if (j < blo) continue;
            if (j >= bhi) break;
            const k = (j2len.get(j - 1) || 0) + 1;
            nj.set(j, k);
            if (k > bs) { bi = i - k + 1; bj = j - k + 1; bs = k; }
          }
          j2len = nj;
        }
        while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) { bi--; bj--; bs++; }
        while (bi + bs < ahi && bj + bs < bhi && a[bi + bs] === b[bj + bs]) bs++;
        return [bi, bj, bs];
      };
      let m = 0;
      const q = [[0, la, 0, lb]];
      while (q.length) {
        const [alo, ahi, blo, bhi] = q.pop(), [i, j, k] = longest(alo, ahi, blo, bhi);
        if (k) { m += k; if (alo < i && blo < j) q.push([alo, i, blo, j]); if (i + k < ahi && j + k < bhi) q.push([i + k, ahi, j + k, bhi]); }
      }
      return (2 * m) / (la + lb);
    }
    /** match_column → [column, "exact"|"synonym"|"spelling"|"unmatched", score] */
    function matchColumn(label) {
      const n = normalizeLabel(label);
      if (LOOKUP.has(n)) { const [col, how] = LOOKUP.get(n); return [col, how, 1]; }
      let best = null, bestScore = -1;
      for (const cand of LOOKUP.keys()) {
        const r = seqRatio(cand, n); // get_close_matches: seq1 = candidate, seq2 = word
        if (r >= SCH.fuzzy_cutoff && (r > bestScore || (r === bestScore && cand > best))) { best = cand; bestScore = r; }
      }
      if (best !== null) return [LOOKUP.get(best)[0], "spelling", Math.round(seqRatio(n, best) * 1000) / 1000];
      return [null, "unmatched", 0];
    }
    /* ---------------- data_loader.py (units and currency of an upload) ---------------- */
    const UNIT_WORDS = new Map(Object.entries({ billion: 1e9, billions: 1e9, bn: 1e9, bln: 1e9,
      million: 1e6, millions: 1e6, mn: 1e6, mln: 1e6, mio: 1e6, m: 1e6,
      thousand: 1e3, thousands: 1e3, k: 1e3, "'000": 1e3, "000": 1e3, "000s": 1e3, "'000s": 1e3 }));
    const blankCell = (v) => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
    /** data_loader.unit_scale_of: whole tokens only ('LCU millions' -> 1e6, 'Amount' -> 1); blank/unknown -> 1 */
    function unitScale(label) {
      if (blankCell(label)) return 1;
      for (const t of String(label).toLowerCase().match(/'?\d+s?|[a-z]+/g) || []) if (UNIT_WORDS.has(t)) return UNIT_WORDS.get(t);
      return 1;
    }
    /** data_loader.harmonize_units: rescale amount columns to the main unit (most rows; tie -> larger), rewrite Units. -> {rows, note} */
    function harmonizeUnits(rows) {
      const labels = rows.map((r) => (blankCell(r.Units) ? "" : String(r.Units).trim()));
      const scales = labels.map((l) => (l ? unitScale(l) : null));
      const counts = new Map();
      for (const s of scales) if (s !== null) counts.set(s, (counts.get(s) || 0) + 1);
      if (counts.size < 2) return { rows, note: "" };
      let canon = null;
      for (const [s, n] of counts) if (canon === null || n > counts.get(canon) || (n === counts.get(canon) && s > canon)) canon = s;
      const names = new Map();
      labels.forEach((l, i) => { if (scales[i] === canon) names.set(l, (names.get(l) || 0) + 1); });
      let label = null;
      for (const [l, n] of names) if (label === null || n > names.get(label)) label = l;
      const amt = SCH.variables.filter((v) => v.kind === "amount").map((v) => v.column);
      const src = new Map();
      const out = rows.map((r, i) => {
        const o = Object.assign({}, r), f = scales[i] === null ? 1 : scales[i] / canon;
        for (const c of amt) if (typeof o[c] === "number") o[c] = o[c] * f;
        o.Units = label;
        if (scales[i] !== null && scales[i] !== canon) src.set(labels[i], (src.get(labels[i]) || 0) + 1);
        return o;
      });
      const n = [...src.values()].reduce((a, b) => a + b, 0);
      const frm = [...src.keys()].sort((a, b) => src.get(b) - src.get(a)).join(", ");
      return { rows: out, note: `Units harmonised: ${n} row${n === 1 ? "" : "s"} converted from ${frm} to ${label}.` };
    }
    /** data_loader.currency_mix: '' for at most one currency, else a message grouping entities by currency */
    function currencyMix(rows) {
      const cur = new Map();
      for (const r of rows) {
        const c = blankCell(r.Currency) ? "" : String(r.Currency).trim().toUpperCase();
        if (c) { if (!cur.has(c)) cur.set(c, new Set()); cur.get(c).add(String(r.Entity)); }
      }
      if (cur.size < 2) return "";
      const names = (s) => { s = [...s].sort(); return s.slice(0, 5).join(", ") + (s.length > 5 ? `, +${s.length - 5} more` : ""); };
      const groups = [...cur.keys()].sort().map((c) => `${c}: ${names(cur.get(c))}`).join("; ");
      return `The file mixes currencies (${groups}). Amounts in different currencies cannot be added up — split the file by currency or convert to one currency, then upload again.`;
    }
    const CONFIDENCE = { exact: "HIGH", synonym: "MEDIUM", spelling: "LOW", unmatched: "—", duplicate: "—" };
    /** standardize_columns on a list of headers → {rename: {uploaded: internal}, report: [...]}.
     *  Exact matches claim their target first, then synonyms, then spelling matches; a header whose target
     *  is already taken keeps its name and is reported as a duplicate. */
    function standardizeColumns(headers) {
      const m = Object.fromEntries(headers.map((h) => [h, matchColumn(h)]));
      const pri = { exact: 0, synonym: 1, spelling: 2, unmatched: 3 };
      const taken = new Set(), fin = {};
      headers.slice().sort((a, b) => pri[m[a][1]] - pri[m[b][1]]).forEach((h) => {
        const [t, how, sc] = m[h];
        if (t === null) fin[h] = [null, "unmatched", 0];
        else if (taken.has(t)) fin[h] = [null, "duplicate", 0];
        else { taken.add(t); fin[h] = [t, how, sc]; }
      });
      const rename = {}, report = [];
      headers.forEach((h) => {
        const [t, how, sc] = fin[h];
        if (t && t !== h) rename[h] = t;
        report.push({ "Uploaded column": h, "Mapped to": t || "", "Schema key": t ? BY_COLUMN[t].key : "", Method: how === "spelling" ? `spelling (${sc.toFixed(2)})` : how, Confidence: CONFIDENCE[how] });
      });
      return { rename, report };
    }

    /** schema.find_header_row: skip title or note rows above the table */
    function findHeaderRow(rows) {
      let best = 0, bestN = (SCH.header_min_matches ?? 3) - 1;
      rows.slice(0, SCH.header_scan_rows ?? 15).forEach((row, i) => {
        const cols = new Set();
        (row || []).forEach((cell) => { if (typeof cell === "string" && cell.trim()) { const c = matchColumn(cell)[0]; if (c) cols.add(c); } });
        if (cols.size > bestN) { best = i; bestN = cols.size; }
      });
      return best;
    }

    /* ---------------- data_loader.py (reading uploads) ---------------- */
    const NA_TOKENS = new Set(["", "-", "--", "—", "–", "n/a", "na", "nan", "none", "null", "...", "…"]);
    const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/, THOUS = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/, DEC_COMMA = /^[+-]?\d+,\d+$/;
    /** parse_number: spreadsheet-formatted numbers — 1,234,567 · (1,234) · 35% · 1234,5 · 1 234 · 1'234 · Unicode minus */
    function parseNumber(v) {
      if (v === null || v === undefined || typeof v === "boolean") return NaN;
      if (typeof v === "number") return v;
      let t = String(v).trim().replace(/−/g, "-").replace(/[   ']/g, "");
      if (NA_TOKENS.has(t.toLowerCase())) return NaN;
      const neg = t.startsWith("(") && t.endsWith(")");
      if (neg) t = t.slice(1, -1);
      const pct = t.endsWith("%");
      if (pct) t = t.slice(0, -1);
      if (THOUS.test(t)) t = t.replace(/,/g, "");
      else if (DEC_COMMA.test(t)) t = t.replace(",", ".");
      if (!PLAIN.test(t)) return NaN;
      let x = Number(t);
      if (pct) x /= 100;
      return neg ? -x : x;
    }
    /** parse_year: 2023, "2023", "FY2023", "2023/24" → 2023 */
    function parseYear(v) {
      const x = parseNumber(v);
      if (Number.isFinite(x)) return Math.trunc(x);
      const m = v === null || v === undefined ? null : String(v).match(/(19|20)\d{2}/);
      return m ? Number(m[0]) : NaN;
    }
    function countOutsideQuotes(line, d) { let n = 0, q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; }
    /** detect_delimiter: comma, semicolon, tab or pipe — highest median count per line over the first 20 lines */
    function detectDelimiter(text) {
      const lines = String(text).split(/\r\n|\r|\n/).filter((l) => l.trim()).slice(0, 20);
      let best = ",", bestScore = 0;
      for (const d of [",", ";", "\t", "|"]) {
        if (!lines.length) break;
        const c = lines.map((l) => countOutsideQuotes(l, d)).sort((a, b) => a - b), sc = c[Math.floor(c.length / 2)];
        if (sc > bestScore) { best = d; bestScore = sc; }
      }
      return best;
    }
    /** delimited text → rows of cells (double-quote quoting, "" escapes) */
    function parseDelimited(text, d) {
      const rows = []; let row = [], f = "", q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
        else if (c === '"') q = true;
        else if (c === d) { row.push(f); f = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
        else f += c;
      }
      if (f !== "" || row.length) { row.push(f); rows.push(row); }
      return rows;
    }
    /** frame_from_rows: header from findHeaderRow, one object per non-empty row below it */
    function frameFromRows(rows) {
      if (!rows.length) return { records: [], header: 0 };
      const h = findHeaderRow(rows), width = Math.max(...rows.map((r) => r.length));
      const head = Array.from({ length: width }, (_, i) => { const c = rows[h][i]; const t = c === null || c === undefined ? "" : String(c).trim(); return t || `Unnamed: ${i}`; });
      const empty = (c) => c === null || c === undefined || (typeof c === "number" && Number.isNaN(c)) || (typeof c === "string" && !c.trim());
      const records = rows.slice(h + 1).filter((r) => r.some((c) => !empty(c))).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
      return { records, header: h };
    }

    return {
      isNum, div, classifyZone, zRating, enrich, enrichRow, availableKpis, classify, pdByRating, worstPdInZone, efcRow,
      recoveryScenarios, revenueVolatility, ratingIndex, notchChange, latestPerEntity, runScenario, costPath, kpiImpact,
      gdpPath, describeShocks, monteCarlo, pdValue, cumulativePd, waterfallRanks, rampShare, ratingAtLeast, quantile, percentilePath, singleNarrative, crossNarrative, zTrendSummary,
      zoneSummary, gre, ZCOMP, K, soeExposures, symEig, mcFactor, MC_VARIABLES, normalizeLabel, seqRatio, matchColumn,
      unitScale, harmonizeUnits, currencyMix, standardizeColumns, BY_COLUMN, findHeaderRow, parseNumber, parseYear, detectDelimiter, parseDelimited, frameFromRows,
    };
  }

  const api = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SOEEngine = api;
})(typeof window !== "undefined" ? window : this);
