# SOE Monte Carlo PD: final modeling decision (revised 21 October 2026)

## Decision

**Primary Monte Carlo PD: rating-anchored curve (floored at the AAA PD, rising logistic tail below the D threshold).** `PD(Z)` is a monotone piecewise cubic Hermite interpolation (PCHIP, Fritsch-Butland slopes) **of logit(PD)** through the 20 rating anchors. Anchors are the finite-band midpoints of `config.Z_RATING_TABLE`, with AAA at Z-EM 4.90 and D at -1.50. Between the D anchor (-1.5) and the AAA anchor (4.9) PD is the interpolation; at and above 4.9 it is **floored at the AAA PD, 0.02%**. **Below -1.5 (the D threshold) PD follows the logistic tail** `PD = logistic(logit(0.40) + b * (z + 1.5))` with `b = pd_logit_b` (config -0.89133626): 40% at -1.5, 55.4% at -2.2, 71.7% at -3, 98.9% at -7, rising towards 100%. This is the very tail used by the deterministic `pd_method = "rating_tail"`; both call one definition (`pd_curves.logistic_tail`; `logisticTail` in `templates/engine.js`). The anchors and thresholds are read from the anchor table, not hard-coded. Python (`pd_curves.anchored_pd(z, b)`) and JavaScript (`ratingSmooth(z, b)` in `templates/engine.js`) are the same function; the slope b passed to `pd_value`/`pdValue` moves both alike; NaN in gives NaN out.

Why:
- **Continuous.** No jumps at rating boundaries; the largest PD change between Z-EM grid points 0.001 apart is 0.08 pp.
- **Exact at the 20 rating PDs.** PD equals the reference rating PD at every band centre (error 0 by construction).
- **Distress keeps costing more.** A stress that pushes Z-EM below the D threshold raises PD further instead of being capped at 40%; the AAA end stays floored at 0.02%. The tail below -1.5 is the illustrative logistic slope b, not an observed default frequency.

Deterministic tabs (single scenario, EFC tab) keep the rating band PD (`pd_method = "rating"`) and are unchanged.

## Sensitivity: single logistic

`PD = sigmoid(a + b * Z-EM)` with uncapped minimax coefficients `a = -2.02276962`, `b = -0.89133626` (`docs/PD_CALIBRATION.md`). Mean absolute error 1.74 pp, maximum 6.50 pp (at CCC+ and CCC-; D is also off by 6.50 pp). It cannot fit all 20 anchors. The earlier fit with AAA/BBB caps (`a = -2.18031828`, `b = -1.10613960`) is available as `python scripts/calibrate_pd.py --refit --caps`.

Select it with `mc_pd_method = "logistic"` (Python `run_monte_carlo`, JavaScript `monteCarlo`). The default is `"rating_smooth"`; any other value raises an error.

## Consistent comparison

Both PDs are evaluated on **exactly the same random shock paths, balance sheet, EAD and LGD**, varying only the PD curve. Exports include `MC_PD_Model`, `PD_Rating_Anchored`, `EFC_Rating_Anchored`, `PD_Full_Logistic` and `EFC_Full_Logistic`. The headline P50/P95 EFC and charts use the selected method (default: rating-anchored); the comparison card shows the other as a sensitivity.

`Debt Default` is a **missed-debt-service flag**, not an observed realised default event. It is never used to override the Monte Carlo PD. The simulation estimates `EFC = PD x EAD x LGD` only, **without Bernoulli default draws or realised government payouts**. The P95 is the 95th percentile across paths **of expected costs**, not of realised fiscal payments.

## Limitations

- The 20 anchor PDs are an **illustrative table**, not observed SOE default frequencies. Zero anchor error is **not** proof of better out-of-sample prediction.
- CCC+ and CCC share the same PD (16.27%), so the curve is flat between their centres (Z-EM -0.4 to 0.225).
- The B to B- step (2.07% to 7.10%) makes the curve steep between Z-EM 1.075 and 0.7.
- The curve is continuous but has a kink in slope at -1.5 (left slope is the logistic tail, b x 0.24 per unit of Z-EM; right slope is the PCHIP end slope) and at 4.9 (floor). Below -1.5 PD depends on b, an uncalibrated slope: the P95 EFC of a deeply stressed SOE moves with b.
- Never add `EFC_Rating_Anchored` and `EFC_Full_Logistic`; they are alternative model assumptions on identical exposures, not additive risk channels.
- Source code and static HTML must be regenerated together: `python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html` (see `docs/PILOT_HTML_RELEASE.md`).
