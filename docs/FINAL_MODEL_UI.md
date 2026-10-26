# Final PD model + interface · revised 21 October 2026

- **Rating-anchored PD is the MC default** (`mc_pd_method = "rating_smooth"`): a C1 monotone PCHIP curve of logit PD that matches all 20 rating PD anchors exactly and is floored at 0.02% above Z-EM 4.9 and, below Z-EM -1.5 (the D threshold), keeps rising along a logistic tail from 40% with slope b (the `rating_tail` tail; 71.7% at -3, 98.9% at -7). Headline P50/P95 EFC and charts use it. Deterministic tabs keep the rating band PD.
- **Single logistic** (a=-2.02276962, b=-0.89133626, uncapped minimax; max error 6.50 pp) is a labelled *model-risk sensitivity* on the same draws, not a core model.
- Both engines' MC pages show a **same-draw comparison** of median and P95 final-year expected fiscal cost (rating-anchored first, logistic as sensitivity), with a one-line note on how the MC PD is built. Exports include both alternative costs, not cumulative/additive costs.
- Single-scenario PD controls, static EFC tab and cash Waterfall mechanics are retained; MC does not override PD to 100% on a missed debt-service flag; actual default/loss simulation is outside scope.
- The MC results display P95 *expected fiscal cost*, not P95 actual government outlays, and no claims are made of out-of-sample or historical validation.
- All core pages, shock controls, waterfall options, SENELEC presets, and original tabs are retained.
- Calibration specification: `docs/PD_CALIBRATION.md`; tests: `tests/check_pd_model_final.py`.
