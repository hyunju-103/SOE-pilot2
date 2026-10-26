# Final PD and financial engine checks — 20 October 2026

## Completed checks

- `python tests/check_pd_model_final.py` — PASS: all 20 reference PD anchors, 25,001 monotone-curve samples, numeric C1 knot derivative check, 321 Python–JavaScript PD comparisons, and identical-shock Monte Carlo switching and paired EFC output checks for Python and JavaScript.
- `python tests/check_logistic_efc_scope.py` — PASS: 32 Python and 32 JavaScript observations, default rating-anchored (AAA floor, logistic tail) and logistic-sensitivity EFC only, and no realised default draws/PD override.
- `python tests/check_logistic_mc.py` — PASS: existing logistic monotonicity, >40% distress tail, rating fallback and deterministic missed-service checks.
- `python tests/check_waterfall_v2.py` — PASS: 14,228 Waterfall, baseline and PD checks.
- `python tests/check_cash_waterfall.py` — PASS: 20,177 cash Waterfall, refinancing and borrowing cap checks.
- `python tests/check_fuel_path_cash.py` — PASS: 19,346 checks; cross-commit bit-exact check omitted because Git was unavailable in the isolated environment.
- `python tests/check_cash_channel.py` — PASS: 3,536 checks.
- `python tests/check_cost_recovery.py` — PASS: Python formula/mapping/missing input and JS–Python valid/invalid/missing parity.
- Python compile (`compileall`) and JavaScript syntax (`node --check` on app and engine) — PASS.
- Static HTML regenerated with `python report.py --demo --out SOE-Fiscal-Risk-Final.html` — PASS.

## Open limits

- `python tests/check_engine_parity.py` exceeded this environment's long-run execution budget; its full broad coverage is **not claimed complete**. Focused PD parity and existing financial regression tests completed.
- Headless Chromium visual smoke test did not finish within the sandbox browser limit, so all browser UI interactions have **not been independently verified**.
- All PD curves are illustrative score mappings; neither model has statistical out-of-sample accuracy validation against observed SOE defaults or externally checked fiscal payment history.
- Sample data in standalone HTML are invented illustrative SOEs, not SENELEC's 2022–2024 official financial statements.

## Model invariants

- Primary PD model: rating-anchored curve (AAA floor, logistic tail below the D threshold) for every Monte Carlo year and draw (`tests/check_pd_rating_smooth.py`).
- Anchors: exact PD at all 20 rating representative scores, monotone, continuous, floored at 0.02% at or above Z-EM 4.9; below -1.5 a logistic tail rises from 40% (same as rating_tail).
- Logistic: sensitivity only (`mc_pd_method = "logistic"`).
- Both outputs share shocks, financial trajectories, EAD and LGD (do not add the two EFC outputs).
- `Debt Default` indicates debt-service unpaid; MC PD never forcibly becomes 100% because of this flag.
- No realised-default draws or realised-loss series. P95 reports path distribution of **expected** fiscal costs.
