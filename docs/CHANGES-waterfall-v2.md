> **Superseded for Monte Carlo (20 Oct 2026):** the default materialisation design documented below was subsequently excluded from the final scope. The current Monte Carlo reports only logistic-based expected fiscal cost and does not simulate actual defaults. See `CHANGES-Full-Logistic-EFC-Only.md`. All other historical changes remain documented below.

# Cash waterfall v2: country orders, baseline drivers and a PD that keeps rising

This builds on `CHANGES-cash-waterfall.md` (the priority-of-payments waterfall of 20 Oct 2026, afternoon). It adds what the task team's review asked for (the "baseline", "waterfall design", "behavioural and institutional" and "scenarios" lists, and the suggested ordering for Ghana and Côte d'Ivoire), the two rules proposed after "the settings do not change the numbers" (late-payment interest by tier; missed debt service = default), and H. Hiro's comment on the PD cap (a PD that can pass 40% and a shock that can materialise).

The framework is unchanged: Z″ → rating → PD → EFC = PD × EAD × LGD. The Python engine (`shocks.py`) and the JavaScript engine (`templates/engine.js`) stay in parity.

**Default behaviour.**

- With every new setting at its default, the numbers are those of the previous version, bit for bit. Checked on 157,728 values: demo portfolio, defaults, oil preset and 60 random cash and waterfall settings, against the afternoon version.
- One rule is on by default: **missed debt service counts as default**. It only bites where the waterfall leaves debt service unpaid, which the previous version allowed without consequence. Turn it off (`default_on_missed_debt = 0`) to reproduce the previous ratings exactly.

## A. The waterfall, generalised

### Tiers and ranks

Seven tiers, each sized for the year. Tiers with the same rank are **pari passu**: they share the cash pro rata to their bills.

| Tier | Bill for the year | Setting |
|---|---|---|
| Taxes, levies, operator or collection fee | `statutory_cost_share` × opex + reported tax expense | rank 0 in every preset |
| IPPs | `ipp_cost_share` × opex | |
| Fuel and gas | `fuel_cost_share` × opex + the fuel-cost change | |
| Senior debt service | the year's interest expense | |
| Reserve account | topped up to `reserve_months` / 12 × (IPP bill + debt service) | |
| SOE O&M floor | `om_floor_share` × the SOE's own costs | protected at its rank |
| SOE's other own costs; junior creditors (other suppliers, regulators, capex) | the rest of the own costs; `junior_share` of them is junior | split by the shortfall rule |

The SOE's own costs are operating expense less depreciation, IPPs, fuel and the statutory tier.

### Country orders (`waterfall_order`)

Same number = pari passu.

| Preset | Taxes, operator | IPPs | Fuel | Debt | Reserve | O&M floor | Residual | Shortfall rule | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| `senelec_note` | 0 | 1 | 2 | 3 | 4 | 5 | 6 | SOE | SENELEC note: IPPs first; debt and reserve ranks assumed |
| `pari_passu` (suggested base) | 0 | 1 | 1 | 2 | 3 | 4 | 5 | SOE | review: IPPs and fuel are one top tier |
| `fuel_first` (sensitivity) | 0 | 2 | 1 | 3 | 4 | 5 | 6 | SOE | review: test both orders |
| `ghana` | 0 | 1 | 1 | 2 | 3 | 2 | 2 | pro rata | PURC May 2025: Level A, statutory deductions, Level B pro rata; debt and reserve placed in Level B as an assumption |
| `cote_divoire` | 0 | 1 | 1 | 2 | 3 | 4 | 5 | SOE | review: operator (CIE) first, then IPPs and gas pari passu (not verified); put the operator fee in rank 0 |
| `custom` | `rank_*` settings | | | | | | | any | the panel shows a rank selector per tier |

The ranks of debt service and the reserve are not confirmed for Ghana or Côte d'Ivoire. The register flags them as assumptions.

### Shortfall rule (`shortfall_rule`)

- **`soe`:** the SOE's costs above the floor go unpaid first, then junior creditors, then the floor and the ranks above.
- **`junior`:** junior creditors go unpaid first.
- **`pro_rata`:** the SOE and junior creditors share the shortfall.
- **`state`:** a budget transfer pays it. No tier goes unpaid. The transfer is booked into equity, like emergency support, and reported as `State Shortfall Payment` and `Cumulative State Shortfall Payment`. It is a direct fiscal cost, shown apart from EFC.

### Adoption

- **Routed share:** `waterfall_coverage` × `waterfall_compliance` × the ramp-up. It is shown as `Waterfall Routed Share`.
- **Ramp-up:** linear over `waterfall_rampup_months`, starting at the start of `waterfall_start_year`. The share is averaged over each year; 18 months gives 1/3, 11/12, then 1.
- **The routed share** of a shortfall is left unpaid by rank, or paid by the State.
- **The rest** is handled as without the waterfall: cash first, then borrowing, subject to the borrowing cap.

### Cost of arrears

- **Late-payment interest** applies to arrears outstanding at the start of each year:
  - `late_rate_priority` on IPPs and fuel;
  - `late_rate_debt` on missed debt service;
  - `late_rate_other` on the other tiers.
- **Where it goes:** the interest is added to the tier's bill and to interest expense, so who is left unpaid now changes net income.
- **Shown as:** `Late-payment Interest`.
- **Defaults are 0.** They are placeholders; set them from the PPAs, fuel contracts and loan documents.

### Missed debt service = default

With `default_on_missed_debt = 1` (default), a year that ends with debt service unpaid:

- is rated **D** and flagged in `Debt Default`;
- has a PD of `pd_on_default`: 100% by default, with 40% (the D-band PD) as the alternative.

### Behaviour

Both are scenario parameters, not observed values. Moral hazard is not modelled directly; test it with lower compliance and a smaller O&M floor.

- **Supplier response (`priority_discount`):** priority creditors give back this share of the IPP and fuel bills, scaled by the routed share.
- **State response (`state_paid_uplift`):** the in-year paid share of State compensation rises by this much, times the routed share.

### Lender response

- **Start year (`refinance_start_year`):** refinancing waits until this year.
- **Minimum rating (`refinance_min_rating`):** refinancing also waits for the first year whose previous-year rating meets this minimum.

### Borrowing cap

The cap now also applies under the waterfall, to the cash outside it.

## B. Baseline drivers (Tariffs & collections tab)

- **Cost-recovery ratio (`cost_recovery_ratio`).** Average tariff / full cost, where full cost = operating expense (incl. depreciation) + interest.
  - When set, customer revenue becomes this ratio × full cost.
  - The State compensates `tariff_gap_state_share` of the change. Its compensation cannot fall below zero.
  - The compensation is recognised in revenue and paid in cash at the in-year paid share.
  - Shown as `Tariff Gap Compensation Change`.
  - 0 = the data's tariff level. The review suggests running it from 85% to 110%.
- **State receivable in current assets (`receivable_current_share`).**
  - The share of the unpaid State compensation counted in current assets (X1 and the current ratio).
  - The rest is non-current.
  - Total assets do not change.
- **Collection rates by segment.**
  - The segments are households, large private customers and public administrations: `share_*` weights and `collect_*` rates.
  - Unpaid bills become `Customer Arrears`, a current asset the SOE funds like any other cash gap.
  - `customer_arrears_collected` of the stock is collected the next year.
  - The adjusted current ratio now leaves customer arrears out, as it does the State receivable and trapped VAT.
- **Demand growth and losses.**
  - `demand_growth` scales sales and cash costs together; the margin before depreciation grows with them.
  - `losses_change` cuts customer revenue at the same cost.

## C. Probability of default and materialisation

| `pd_method` | PD |
|---|---|
| `rating` (default) | rating bands, at most 40% (D) |
| `rating_tail` (recommended) | rating bands; below the D threshold (Z-EM −1.5) a logistic tail anchored at 40%: logit(PD) = logit(0.40) + b × (Z − (−1.5)) |
| `logistic` | PD = 1 / (1 + e^−(a + b·Z)) for every Z (a = −2.18, b = −1.17: PD ≈ 10% at Z = 0, 40% at Z ≈ −1.5) |
| `user` | `pd_user` in every year |

- **Calibration.** `a` and `b` are placeholders until calibrated.
- **Cumulative PD over the horizon:** 1 − Π(1 − PDₜ).
- **Where the methods apply:** the Shock Scenarios page (single scenario, Monte Carlo, all SOEs). The EFC and Early Warning pages keep the rating bands.

**Monte Carlo default draws (`mc_default_draws`, on).**

- **When a simulation defaults:** in the first year a uniform draw falls below that year's PD, or debt service goes unpaid.
- **Realised cost:** EAD × LGD in that year, and 0 without a default.
- **Separate random stream.** The draws use their own stream (seed + 1), so the shock draws and every earlier Monte Carlo output are unchanged.
- **Outputs:** `shocks.mc_default_summary` and the "Default materialisation" card report the share defaulting within the horizon and by year, and the realised cost's mean, 95th and 99th percentiles, in currency and as a share of GDP.

## D. Front end

- **Panel.** The Cash & financing tab has the country order, shortfall rule, tiers, adoption, cost of arrears, default rule, behaviour and lender response. The new Tariffs & collections tab has the baseline drivers. The PD settings sit under LGD and EAD.
- **Liquidity card.** It shows arrears by tier, numbered as in the order of payment, and tiles for:
  - the State's shortfall payment;
  - missed debt service;
  - the routed share;
  - late-payment interest;
  - customer arrears;
  - the tariff-gap compensation.
- **Waterfall scenarios and sensitivity card.** It holds:
  - the review's four scenarios on the same baseline, with "Load into the panel" buttons;
  - cost-recovery ratio (85–110%) × compliance (60/80/100%);
  - the collection rate of public administrations (40–100%).
- **Strip.** It adds the default probability over the horizon.
- **Monte Carlo.** It adds the default materialisation card, and the CSV carries `Default_Year` and `Realised_Cost`.
- **Python version.** The classic Shock Scenarios page has the same core settings and outputs.
- **Assumptions page.** The register has a row for each new setting, with its source or its placeholder status.

## SENELEC, 2024 base (tester file)

Settings for every run:

- the oil preset's exposures;
- State compensation paid 60% in-year;
- IPP share 17%;
- cash 56.3 bn and short-term bank debt 134.5 bn (2024 annual report);
- LGD 100% and EAD = total liabilities;
- GDP 19,618 bn growing 2.5% a year.

Amounts are in FCFA bn. The cost-recovery ratio in the data is 77.6%: revenue less 214.7 bn of RMA compensation, over operating expense plus interest.

### The four scenarios (same results for every order, except Ghana in scenario 4)

| Scenario | Z-EM 2026 | Z-EM 2029 | X1 2026 | Unpaid 2026 | of which SENELEC | Debt default | Cumulative PD 2025–29 | EFC / GDP 2026 |
|---|---|---|---|---|---|---|---|---|
| 1 No waterfall | 0.06 CCC+ | 0.29 | −0.109 | 0 | 0 | — | 58.8% | 1.21% |
| 2 Full cost recovery (100%), good compliance | 0.18 CCC+ | 0.51 B− | −0.107 | 0 | 0 | — | 54.3% | 1.21% |
| 3 Tariff gap (85%), compliance 60% | 0.06 CCC+ | 0.29 | −0.109 | 0 | 0 | — | 58.8% | 1.21% |
| 4 Fuel price shock (+60% / +30%) | 0.15 CCC+ | 0.29 | −0.092 | 29.8 | 29.8 | — | 58.8% | 1.23% |
| 4 under the Ghana order | 0.15 **D** | 0.29 | −0.092 | 29.8 | 27.7 | **2026** (2.1 bn) | 100% | 7.59% |

How to read it:

- **Scenarios 1 to 3: the waterfall has nothing to do.** Without a shock SENELEC has no cash shortfall.
- **Scenario 3 is the same as scenario 1.** A cost-recovery ratio of 85% is above SENELEC's 77.6%, and the State covers the gap, so the ratio moves money between customers and the State, not SENELEC's profit.
- **Scenario 2 differs** because above about 98% the RMA compensation is used up and the rest goes to SENELEC's margin.
- **Scenario 4: the shortfall stays on SENELEC's own costs** under every order, because 29.8 bn never gets past them.
  - Ghana is the exception: debt service sits in Level B with the SOE, pro rata, so 2.1 bn of debt service goes unpaid. That is a payment default: rated D, and EFC/GDP 7.6% in 2026.
  - With debt service ranked senior to Level B, the same Ghana run has no default.
  - The result turns on where debt service sits, which the review could not source. Treat it as an assumption to confirm.
- **Why Z-EM rises from scenario 1 to 4.** The State receivable is a current asset and SENELEC's current ratio is below 1, so adding it lifts X1. This is the same mechanism as before; see the receivable sensitivity below.

### Sensitivities (fuel price shock, IPPs and fuel pari passu)

**Cost-recovery ratio.** Z-EM 2026 is the same with and without the waterfall at every compliance level:

| CRR | 85% | 90% | 95% | 100% | 105% | 110% |
|---|---|---|---|---|---|---|
| Z-EM 2026 | 0.16 | 0.16 | 0.16 | 0.28 | 0.65 | 0.99 |

- From 85% the State pays less compensation, so less is tied up in the receivable (90 bn in 2026 at 85%, 49 bn at 95%). The shortfall then fits within SENELEC's 56.3 bn of opening cash.
  - Without that cash (the tester file alone, as in the dashboard), the 2026 shortfall falls from 86.1 bn to 55.5, 34.8 and 14.2 bn at 85, 90 and 95%, and to zero at 100%.
  - Z-EM still moves by at most 0.01.
- Above about 98% the RMA compensation is used up and the margin rises.
- The waterfall changes little at any ratio: it decides who carries the shortfall, and closing the shortfall takes tariffs. With a small gap there is little left to allocate.

**Compliance.** Z-EM 2026 is 0.15 in every case.

| Compliance | Unpaid | Borrowed |
|---|---|---|
| 60% | 17.9 bn | 12.1 bn |
| 80% | 23.8 bn | 6.1 bn |
| 100% | 29.8 bn | 0 |

**Public administrations' collection rate.**

| Collection rate | Arrears in 2026 | Customer arrears in 2029 |
|---|---|---|
| 100% | 29.8 bn | 0 |
| 80% | 41.8 bn | 46.5 bn |
| 60% | 67.1 bn | 93.1 bn |
| 40% | 103.1 bn | 139.6 bn |

Z-EM 2026 rises a little, from 0.15 to 0.24, because the customer arrears are current assets with a current ratio below 1. The adjusted current ratio leaves them out and shows the squeeze.

**State receivable counted in current assets.** This is the review's point: it moves X1 more than the waterfall does.

| Share in current assets | X1 2026 | Z-EM 2026 |
|---|---|---|
| 100% | −0.093 | 0.15 |
| 50% | −0.119 | −0.02 |
| 0% | −0.145 | −0.20 |

**Behaviour.**

| Response | Z-EM 2026 | Z-EM 2029 | Unpaid |
|---|---|---|---|
| None | 0.15 | 0.29 | 29.8 bn |
| Suppliers cut prices 2% for priority | 0.35 | 0.51 | 9.1 bn |
| State pays 30 points more in-year | 0.15 | 0.29 | 0 |
| Both | 0.29 | 0.51 | 0 |

**Late-payment interest at 10%** on every tier costs 3.0 bn over the horizon and leaves Z-EM unchanged at this size of arrears.

**Deep shortfall (State pays nothing in-year).**

- 211.1 bn is unpaid in 2026:
  - SENELEC's own costs, 133.6 bn;
  - junior creditors, 57.2 bn;
  - debt service, 14.6 bn;
  - fuel, 4.8 bn;
  - IPPs, 1.0 bn.
- That is a default in 2026.
- The O&M floor (50% of own costs) protects nothing here, because the shortfall is larger than every tier below debt service.

### PD methods

| | Rating bands | Logistic (a −2.18, b −1.17) |
|---|---|---|
| PD 2025–2029, oil shock under the waterfall | 16.3% every year (CCC+) | 11.4, 10.4, 8.6, 7.3, 8.1, 7.4% |
| Cumulative PD | 58.8% | 35.4% |
| Monte Carlo, default within 5 years (2,000 draws) | 59.4% | 36.1% |
| Realised cost: mean / p95 / p99, % of GDP | 4.4 / 8.0 / 8.4 | 2.7 / 7.9 / 8.3 |
| Deep shortfall: default within 5 years | 82.9% (56.4% in 2026) | 73.7% |
| Deep shortfall: realised cost p99, % of GDP | 10.0 | 10.0 |

- **The logistic tail** (`rating_tail`) gives the same numbers as the bands for SENELEC, because Z-EM stays above −1.5.
- **Demo SOE A** (Z-EM −7 to −12) shows the tail: PD about 99.8% instead of 40%.

## Tests

```bash
python tests/check_waterfall_v2.py      # orders, pari passu, rank 0, floor and shortfall rules, State rule, adoption, late interest,
                                        # default, receivable, cost recovery, collections, growth, losses, behaviour, refinancing
                                        # timing, balance-sheet identity (160 random cases), PD methods, Monte Carlo default draws (Python and JS)
python tests/check_engine_parity.py     # adds ten v2 scenarios and the PD column (58,717 checks)
python tests/check_cash_waterfall.py    # caption updated for the order name
```
