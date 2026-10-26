# John follow-up: full-logistic Monte Carlo for EFC only (20 October 2026)

## Decisions

1. Monte Carlo uses full logistic `PD(Z) = sigmoid(a + b × Z)` at **every** simulated year and path, with default calibrated coefficients `a = -1.92665108`, `b = -0.88741214`. Rating PDs remain a *calibration target*, not a table lookup during Monte Carlo.
2. Monte Carlo **does not simulate default occurrence**. It does not use Bernoulli random draws, calculate a default year, calculate realised government losses, or report a default materialisation card. Monte Carlo calculates **Expected Fiscal Cost only**: `EFC = PD × (ead_share × total_liabilities) × (LGD% / 100)`.
3. The cash waterfall's missed debt service still affects liabilities, the Z-EM score, and its model diagnostics. In Monte Carlo, `pd_on_default` does **not** override the continuous logistic PD. The deterministic single-scenario view retains the existing D-rating and optional PD override.
4. The existing deterministic EFC tab, shock single-scenario PD selector, cash waterfall, refinancing and SOE accounting are not changed.
5. Monte Carlo CSV contains `PD`, `EAD`, `LGD`, `EFC` (Python longitudinal CSV) and `PD_final`, `EAD_final`, `EFC_final` (HTML final-year CSV), **not** `Default Year` / `Realised Cost`.

## Reason and limitation

The existing band PD table has discrete jumps and a 40% cap. Full logistic is continuous, increasing as Z-EM deteriorates and able to exceed 40%. Coefficients have been fitted to indicative rating PDs, not to observed SOE default outcomes; check `PD_CALIBRATION.md` and `PD_RATING_VS_LOGISTIC.csv` for errors before policy use. Neither the annual mean/p95 EFC nor the EFC distribution is a simulated realised transfer or default frequency.

## Files

- `shocks.py`: Monte Carlo `pd_method='logistic'`, missed-payment override disabled, actual default sampling removed.
- `templates/engine.js`: same Monte Carlo contract; no default draws or realised-loss fields.
- `app_pages/shock_scenarios.py`, `templates/app.js`: default materialisation display removed; EFC distributions retained.
- `config.py`: removed the obsolete `mc_default_draws` parameter and updated the assumptions statement.
- `tests/check_logistic_mc.py`, `tests/check_waterfall_v2.py`: tests assert this contract in Python and JavaScript.
