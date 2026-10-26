# Logistic PD sensitivity: calibration · revised 21 October 2026

**Role:** the single logistic is the Monte Carlo *sensitivity* (`mc_pd_method = "logistic"`), not the default. The default is the rating-anchored curve (AAA floor, logistic tail below the D threshold) (`docs/PD_FINAL_DECISION.md`).

**Specification:** `PD(Z)=sigmoid(a+bZ)`, **a = -2.02276962**, **b = -0.89133626**. This is an illustrative *minimax* fitting rule for the 20 reference rating PDs, not an empirically validated default model. Refit with `python scripts/calibrate_pd.py --refit` (`scipy` required).

## Reproducible objective

Take each rating's finite Z-EM band midpoint; AAA=4.90, D=-1.50. Find parameters a,b,t minimizing **t**, such that `abs(sigmoid(a+b*z_i)-PD_i) <= t` for every one of the 20 ratings and `b <= -0.01`. There are **no caps** on individual ratings. Solve with SLSQP bounded optimization and check the constraints.

| Metric at the 20 reference points | Capped fit (`--refit --caps`) | **Uncapped minimax (current)** |
|---|---:|---:|
| a, b | -2.18031828, -1.10613960 | **-2.02276962, -0.89133626** |
| Mean absolute difference | 1.378 percentage points | **1.74 pp** |
| Maximum absolute difference | 8.173 pp | **6.50 pp** (CCC+, CCC-, D) |
| AAA reference = 0.020% | 0.050% | **0.168%** |
| BBB reference = 0.250% | 0.508% | **1.079%** |
| CCC+ reference = 16.270% | 8.097% | **9.768%** |
| CCC- reference = 20.000% | 28.173% | **26.502%** |
| D reference = 40.000% | 37.259% | **33.498%** |

The capped fit (`python scripts/calibrate_pd.py --refit --caps`) additionally forces the AAA and BBB logistic PDs to be at most 2.5 times their reference PD; 2.5 is an illustrative judgment call. It lowers the AAA/BBB overestimate at the price of a larger worst-case error. Per-rating values for both fits are in `docs/PD_RATING_VS_LOGISTIC.csv`.

**Interpretation:** no two-parameter sigmoid can interpolate all 20 reference levels; it underestimates CCC+ and overestimates CCC- and the high-PD end, and overstates the low-PD ratings by a factor of up to about 8 (AAA). Changing the fitting loss or constraints changes the coefficients.

## Rating-anchored curve (Monte Carlo default)

`pd_curves.py` and `templates/engine.js` implement monotone cubic Hermite interpolation of logit(PD), floored at the AAA PD (0.02%) at and above the AAA anchor 4.9; below the D anchor (-1.5) PD follows the logistic tail from 40% with slope b = `pd_logit_b`, the same tail as `rating_tail`. It matches every reference PD **at the defined representative score** (zero in-sample error), is monotone, continuous in Z-EM, and C1 at the 18 interior anchors; PD is at least 0.02% and rises above 40% below Z-EM -1.5 (98.9% at -7). It is not a two-parameter logistic.

Both models calculate `EFC = PD*EAD*LGD` on **the same simulated financial paths**; no Bernoulli default or realised loss draw. A missed debt service marker does not override MC PD. The final-year P95 is a percentile of expected costs across shock paths, not an actual budget payment tail-risk measure. Neither model is validated against SOE default observations.

See `docs/PD_FINAL_DECISION.md` for usage and methods.
