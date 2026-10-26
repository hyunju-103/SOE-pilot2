# Monte Carlo UI update

- Monte Carlo settings are an accessible, collapsed-by-default disclosure in the standalone HTML: click **Monte Carlo settings** to reveal simulations, shock standard deviations, correlations and shock-centre note.
- The PD model selector is shown separately and stays visible, as do all simulation results and model comparison tables. Default: rating-anchored PD (AAA floor, logistic tail below the D threshold); the single logistic is the labelled sensitivity (21 October 2026).
- Scope badges are given explicit spacing below the selector; duplicate 'default' badge removed (the badge now reads 'Rating-anchored · default').
- Invalid correlations automatically expand the settings panel and display the validation message in the visible page.
- Streamlit uses a collapsed-by-default `st.expander` for the matching Monte Carlo settings. The PD model selector and outputs remain outside the expander.
- No Monte Carlo paths, seeds or waterfall functionality changed. (21 October 2026: the Monte Carlo PD curve itself changed, see `docs/PD_FINAL_DECISION.md`.)
