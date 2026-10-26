# Cash waterfall (priority of payments), refinancing, emergency government support and RMA coverage

> **Superseded in part by `CHANGES-waterfall-v2.md`** (20 Oct 2026, evening): country orders with pari passu tiers, a rank-0 tier for taxes and the operator fee, an O&M floor, shortfall rules, coverage / compliance / ramp-up, late-payment interest, missed debt service = default, tariffs and collections, and the PD methods. With the new settings at their defaults and the default rule off, the numbers below are unchanged.

This builds on `fuel-path-cash-first`. It covers the items from the SENELEC oil-shock note that the tool did not yet model:

- the cash waterfall, with IPPs paid first;
- the refinancing of overdrafts into long-term loans;
- the "need for emergency government support" at the end of the financing order;
- Option A's "customer collections cover only 65–68% of the shocked RMA".

The framework is unchanged: Z″ → rating → PD → EFC = PD × EAD × LGD. The Python engine (`shocks.py`) and the JavaScript engine (`templates/engine.js`) stay in parity.

**Default behaviour.** Everything new is off by default (`waterfall_on = 0`, `refinance_share = 0`, `borrowing_cap_debt_to_assets = 0`). With the shipped settings, the engine gives the previous numbers bit for bit on every existing output column; the new columns are additions only.

## What changed in this version (20 Oct 2026, afternoon)

The first version of the waterfall (20 Oct, morning) was a reduced-form assumption: it refinanced the overdrafts and set the supplier-arrears share to zero, but it had no order of payment. The task team's comment was that a waterfall prioritizes payment but does not create cash; it needs tariffs and arrears to be addressed, and priority to IPPs can leave the SOE underfunded. This version models that:

- **The waterfall is now a priority of payments.** Each year's cash pays the tiers in order, and a shortfall is left unpaid from the bottom tier up. Nothing is borrowed while it is on.
- **Refinancing is now a separate assumption** (`refinance_share`, off by default). It depends on lenders, not on the payment order, so the two effects can be seen apart.
- **Renamed settings.** `waterfall_refinance_share` → `refinance_share`, `waterfall_long_term_rate` → `refinance_long_term_rate`. New: `ipp_cost_share`, `reserve_months`.
- **The previous results can still be reproduced.** The morning version's "waterfall" equals refinancing with no supplier arrears: `refinance_share` with `cash_gap_payables_share = 0` gives exactly the same numbers (checked on 88,704 values: demo portfolio, defaults, oil preset and 40 random cash settings). With every new setting off, the engine also matches the morning version on the same 88,704 values.

## Changes

### A. Cash waterfall: priority of payments (`waterfall_on`, `ipp_cost_share`, `reserve_months`)

- **The tiers, in order of payment**, each sized for the year:
  1. **IPPs:** `ipp_cost_share` × operating expense.
  2. **Fuel:** `fuel_cost_share` × operating expense, plus the fuel-cost change of the year.
  3. **Debt service:** the year's interest expense.
  4. **Reserve account:** topped up to `reserve_months` / 12 × (tier 1 + tier 3).
  5. **The SOE's own operations and other suppliers:** operating expense − depreciation − tiers 1 and 2 (not below zero).
- **When cash runs short.** The SOE's own cash is drawn first, as before (cash-first rule). What is left is **not borrowed**. It is left unpaid from the bottom up:
  - tier 5 first (reported as `Underfunded Operations`);
  - then the reserve is drawn;
  - then debt service, fuel and IPPs, each up to the year's bill;
  - anything beyond all of the year's bills stays in tier 5.
- **Accounting.** Unpaid bills are current liabilities without interest (they also raise total liabilities). A reserve draw lowers total assets. TA − TL − Equity is unchanged from the borrowed path.
- **When there is a surplus.** It pays the arrears in priority order (IPPs, fuel, debt service), then tops up the reserve, then pays the tier-5 arrears, then any older short-term debt; the rest rebuilds the cash drawn. The reserve is held outside current assets.
- **What does not apply.** The borrowing split, the rate on new borrowing and the borrowing cap are not used while the waterfall is on.
- **What it shows.** Under an unpaid shock, the waterfall moves the shortfall between creditors rather than closing it, so Z-EM and EFC barely change; only tariffs or State payments close the gap.
  - Illustrative utility in the tests, fuel shock unpaid: Z-EM 0.34 without the waterfall, 0.34 with it, 0.66 with refinancing.
  - Where the two paths do differ, it is mostly interest: the borrowed path pays interest, while unpaid bills carry none in the model. Late-payment penalties under PPAs are not modelled.
- **`ipp_cost_share` for SENELEC.** The oil preset uses 17%: purchased electricity in 2022 ≈ COGS 647.4 bn − fuel 494.9 bn = 152.5 bn, over operating expense of 888.5 bn. It includes OMVS and imports, so it is an upper bound for IPPs alone; set it from the accounts. The generic default is 0.
- **Front end.**
  - **Cash & financing tab:** an Off/On switch, the order of payment, the IPP share and the reserve target. The "+ Cash waterfall" button in the oil preset row toggles it on top of any scenario (`config.WATERFALL_PRESET`).
  - **Liquidity card tiles:** bills left unpaid, the SOE's own operations left underfunded, priority creditors unpaid, the reserve account, and Z-EM with vs without the waterfall.
  - **Liquidity card tables:** arrears by tier (end of year), and the same scenario with and without the waterfall (Z-EM, rating, current liabilities, current ratio, EFC or EFC/GDP).
  - **Comparisons:** the no-shock path uses the same setting, so "vs no shock" still isolates the shock.
  - **Caption:** the chart caption ends with "· cash waterfall".
- **Legacy mode.** `legacy_loss_assets = True` ignores the waterfall.

### B. Refinancing (`refinance_share`, `short_term_debt_rate`, `refinance_long_term_rate`)

- **At the start of projection year 1.** R = `refinance_share` × short-term bank debt, capped at current liabilities.
  - Short-term bank debt is the optional `Short Term Debt` column. Without it, the proxy is `near_term_maturity_share` × total liabilities.
  - Current liabilities fall by R and total liabilities do not change, so working capital and X1 rise.
- **Every year.** R × (`short_term_debt_rate` − `refinance_long_term_rate`) is saved. It is negative if the long-term rate is higher.
  - The reported interest expense is assumed to include the overdraft at `short_term_debt_rate`.
  - The refinanced debt also leaves the base of the refinancing-spread shock: the near-term maturity share falls by R / total liabilities.
- **Defaults.** `refinance_share` is 0 (off). `short_term_debt_rate` is 8.0%, the mid-point of the note's 7.5–8.5%. `refinance_long_term_rate` is 5.0%, a placeholder to be set from the refinancing terms.
- **Combining.** It works with or without the waterfall. The caption adds "· N% of short-term debt refinanced".

### C. Emergency government support (`borrowing_cap_debt_to_assets`)

- **What it does.**
  - New borrowing stops where total liabilities / total assets at year end would pass the cap.
  - The rest of the cash gap is a government capital injection, which goes into equity, not into retained earnings.
  - Interest is paid only on what is borrowed, and TA = TL + Equity still holds.
  - This is the last step of the IMF SOE Stress Test Tool's financing order (User Guide 2023, Section VIII): cash, then borrowing, then injection.
- **Outputs.** `Emergency Support` (the year's injection) and `Cumulative Emergency Support`. The Liquidity card shows a tile, with the amount as a share of year-1 GDP when GDP is entered.
- **Default.** 0 = no cap. Not used under the waterfall, which borrows nothing.

### D. RMA coverage (`Tariff Share of RMA`)

- **Formula.** (Revenue − Government Grants + tariff increase + tariff pass-through) / (Revenue + fuel-cost change). This is what customers pay as a share of the regulator's allowed revenue after the shock; the State covers the rest.
- **When it is NaN.** When the data have no `Government Grants`.

### E. Other

- **Scenario CSV.** It gains:
  - `Refinanced Debt`, `Interest Saved`;
  - `Emergency Support`, `Cumulative Emergency Support`;
  - `Tariff Share of RMA`;
  - `Unpaid Under Waterfall`, `Underfunded Operations`, `Arrears to IPPs`, `Arrears to Fuel Suppliers`, `Missed Debt Service`, `Arrears on Own Operations`;
  - `Reserve Account`, `Reserve Draw`, `Reserve Top-up`.
- **Assumptions page.** `PARAMETER_REGISTER` rows for the waterfall, the IPP share, the reserve target, refinancing and its two rates, and the borrowing cap.
- **Glossary.** Cash waterfall, Underfunded operations, Refinancing, Emergency support and RMA coverage.
- **Classic version.** The classic Streamlit page (`app_pages/shock_scenarios.py`) has the same controls and outputs.

## SENELEC, 2024 base

The refinancing results of the morning version still hold, now under `refinance_share = 100%`. Settings: the oil preset (+60% in 2026, +30% in 2027; 60% of compensation paid in-year), cash 56.3 bn (Trésorerie-actif), short-term bank debt 134.5 bn (Trésorerie-passif, `Short Term Debt`), LGD and EAD 100%, GDP 19,618 bn growing 2.5% a year.

| 2026 | No refinancing | Refinancing 100% |
|---|---|---|
| Z-EM (rating) | 0.15 (CCC+) | 0.57 (B−) |
| Current liabilities | 1,126.6 bn | 988.0 bn |
| Current ratio | 0.81 | 0.93 |
| Interest saved | — | 4.0 bn a year (134.5 × 3%) |
| EFC (% of GDP) | 254.6 bn (1.24%) | 110.8 bn (0.54%) |

- **This gain comes from refinancing, not from the waterfall.** It rests on lenders agreeing to the refinancing, and on a single rating step: Z crosses 0.5, the CCC+/B− boundary, and the PD falls from 16.27% to 7.1%.
- **Distress zone.** Z stays below 1.1, so SENELEC remains in the distress zone.

### The waterfall for SENELEC (tester file, 2024 base, same settings, IPP share 17%)

| 2026 | Z″ (rating) | EFC ÷ GDP | Borrowed | Own costs unpaid |
|---|---|---|---|---|
| Oil shock, gap borrowed | 0.15 (CCC+) | 1.24% | 30.3 bn | — |
| + waterfall | 0.15 (CCC+) | 1.23% | 0 | 29.8 bn |
| + waterfall, State pays 18% in the year | 0.13 (CCC+) | 1.33% | 0 | 156.7 bn |
| + waterfall, tariff +15% | 0.16 (CCC+) | 1.21% | 0 | 0 |
| + waterfall, State pays in full in the year | 0.06 (CCC+) | 1.21% | 0 | 0 |
| Oil shock + refinancing 100% | 0.57 (B−) | 0.54% | 26.2 bn | — |

- **The waterfall alone moves the shortfall, it does not close it.** SENELEC uses all of its 56.3 bn of cash, and 29.8 bn of its own bills (tier 5) is left unpaid in 2026 and paid in 2027 when the State's backlog arrives. IPPs (172.9 bn), fuel (861.6 bn) and interest (14.6 bn) are paid in full in every scenario.
- **With a 300-day lag** (18% paid in the year), 156.7 bn is left unpaid: 82% of SENELEC's own-cost bill of 190.7 bn. Tier 5 includes 89.0 bn of personnel, so in practice staff, SAR or maintenance would carry part of it.
- **Tariffs or State payments** remove the shortfall. **Refinancing** is the only change that moves the rating, with or without the waterfall (with it: Z″ 0.57, 25.8 bn of own costs unpaid in 2026).

## Tests

- `tests/check_cash_waterfall.py` (rewritten, 16,876 checks):
  - off by default, bit-exact, and the other settings inert;
  - refinancing: the arithmetic, the cap at current liabilities, the proxy, a costlier long-term rate, and the smaller refinancing-shock base;
  - waterfall allocation from the bottom tier up, nothing borrowed, unpaid bills in current liabilities;
  - waterfall over time: the reserve is topped up, then drawn before the priority tiers; a later surplus pays arrears in priority order;
  - the waterfall creates no cash on the demo portfolio (oil preset, with and without State payments, with a reserve);
  - the borrowing cap: a cap that does not bind changes nothing, and the cap is inert under the waterfall;
  - RMA coverage, legacy mode and the caption;
  - Z-EM barely moves with the waterfall alone, and rises with refinancing.
- `tests/check_engine_parity.py`:
  - scenarios `waterfall`, `waterfall_reserve`, `waterfall_stress`, `waterfall_custom`, `refinance`, `waterfall_refi`, `cap`, `cap_waterfall` and `waterfall_legacy`;
  - nine more compared columns;
  - 31,933 checks.
- The existing checks pass unchanged: `check_cash_channel.py`, `check_fuel_path_cash.py` and `check_cost_recovery.py`.
- **Smoke runs.**
  - The HTML dashboard (headless Chromium): oil preset, waterfall, refinancing and reserve.
  - The classic Streamlit page (`streamlit.testing`): the same settings, no exceptions.
