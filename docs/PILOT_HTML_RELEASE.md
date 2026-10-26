# SOE Fiscal Risk Dashboard — Pilot HTML Release

Published interactive snapshot: `SOE-Fiscal-Risk-Final.html` (header restored to original navy `#002244`).

## What is published

- Six-stage model journey and redesigned Monte Carlo cards / output layout.
- Rating-anchored PD (monotone curve through the 20 rating PDs, floored at 0.02% above Z-EM 4.9, with a rising logistic tail from 40% below Z-EM -1.5) as the default Monte Carlo expected-fiscal-cost calculation; deterministic tabs keep the rating band PD.
- Single logistic PD provided as a same-draw sensitivity.
- Cash-flow waterfall, correlated fuel / FX and optional interest / revenue shocks.
- EFC = PD × EAD × LGD. No Bernoulli default events or realised loss draws.
- Collapsible Monte Carlo controls and extended calibration information.
- Illustrative uncapped minimax logistic calibration for the sensitivity (a -2.02276962, b -0.89133626; max reference-rating PD error 6.50 pp).
- Existing navigation, upload functionality, KPI, Z-EM, EFC and reporting views retained in the standalone UI.
- No person-specific names in page copy.

## Streamlit deployment

`Home.py` reads the tracked standalone HTML snapshot if present, and passes it to `components.html`.
It retains `report.build_app_data()/render_html()` as a fallback if that file is absent.
The deployed pilot UI therefore uses this exact reviewed HTML snapshot rather than
silently rebuilding it at run time.

**Maintenance rule:** `templates/` and `config.py` are synchronised with the published
snapshot, which is a build product. Edit `templates/` or `config.py`, rebuild with the
release command below, and commit the regenerated HTML together with the source change.
Never hand-edit `SOE-Fiscal-Risk-Final.html`.

Release command (run from the repository root):

```
python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html
```

`tests/check_snapshot_sync.py` rebuilds the page in memory with these settings and fails if
it differs from the tracked file (only `meta.generated`, the build date, is ignored).

## Checks

- Snapshot integrity: run `python tests/check_snapshot_sync.py` (rebuild equals the tracked HTML, apart from the build date).
- Inline executable JavaScript passed `node --check`; JSON data scripts excluded from JS syntax checking.
- The navy title/header and expected-fiscal-cost-only simulation controls were inspected.
- Actual Streamlit Cloud deployment status and numerical model validation are separate checks.

## Interpretation

The reference rating PDs, and the logistic calibration to them, are illustrative, **not** estimated
from observed SOE defaults. The displayed P95 EFC is the 95th percentile across simulated
*expected* costs, **not** an observed government payout or a quantile of realised losses.

## Monte Carlo, GDP lookup and compact controls (2026-10-20)

- Monte Carlo results use a six-card, two-column arrangement (percentile path and zones; EFC and Z-EM distributions; PD comparison and percentile summary).
- Cash waterfall and missed-debt-service switches now give conditional effect explanations. The latter is a single-scenario sensitivity and does not override the Monte Carlo PD.
- Compact On/Off controls no longer stretch to the entire column; the Monte Carlo disclosure is also slimmer.
- GDP reference lookup: user chooses country and base year, and the browser queries World Bank WDI `NY.GDP.MKTP.CN` (GDP, current local currency, source=2) live. It never invents missing years or an FX conversion.
- GDP unit selector supports financial-statement units, full LCU, thousands, millions and billions. Results are divided by the uploaded statement unit multiplier before entering the shared GDP state, retaining consistent EFC/GDP ratios.
- Apply GDP is an explicit action. Country currency mismatches and reference-year mismatches prevent auto-apply; unknown currency matches require explicit confirmation; the manually entered GDP field remains available.
- The browser needs internet access for the optional World Bank reference lookup. Offline / API failures show an explanation and leave manual GDP entry accessible.
- Tested in Chromium with mocked World Bank responses: country and year lookup, billions display, apply conversion, incompatible-currency rejection, compact switches and six Monte Carlo result panels; no page JavaScript exceptions.


## Compact framework layout and percentile-path axis (2026-10-20)

- Model Framework blue heading now uses a one-line title grouping with compact 8px vertical padding (approximately 40px total at desktop width).
- All six framework cards use content-driven heights instead of fixed min-height. Both six-column Home and three-column/two-row Monte Carlo layouts are compact; tablet and mobile breakpoints also remove excessive min-height.
- Monte Carlo EFC percentile path uses an automatically scaled Y axis rather than forcing zero, avoiding a nearly-flat line around high EFC values; the chart subtitle explicitly states the axis need not begin at zero.
- Histogram Y axes continue showing counts, not monetary values, and are unchanged.
- Tested in isolated Chromium layout at 1460px: Home 148px, compact Monte Carlo 212px, title band 40px in both. Inline JavaScript passed Node syntax checks. Full runtime Monte Carlo E2E test was inconclusive due browser timeout.


## Report export restoration (2026-10-20)

- Corrected the embedded, tracked standalone HTML metadata from `allow_download:false` to `allow_download:true`, restoring conditional export actions within the Streamlit iframe.
- Restored and clarified the Report tab action as **Print / save full report as PDF**. It invokes the browser print dialog for all five Report sections: Executive Summary, Financial Performance, Distress and Fiscal Risk, Stress Tests, and Policy Implications. The user chooses **Save as PDF**; this is browser printing rather than an automatically generated/downloaded binary PDF.
- The same permission flag also restores CSV export controls where provided by the UI.
- No model formulas, PD calibration, chart layouts, source data or header palette were modified.
- All inline JavaScript blocks passed `node --check`. UI smoke testing inside this environment's Chromium was blocked/time-limited, so success of browser print dialogs in Streamlit Cloud must be confirmed on the deployed site.


## Meeting release (2026-10-26)

- Applies the decisions of the 26 October team meeting; the full decision → change table and the open items are in `docs/CHANGES-meeting-2026-10-26.md`.
- New **How it works** tab for non-specialists, in the design of the draft explainer *How SOE Pilot Works* (scroll-driven: a transit rail of eleven chapters, a sticky picture that redraws at each step). It walks through the website tab by tab, then follows one example SOE through every step of the calculation with live numbers (accounts → health checks → score → rating and chance of distress → expected cost → shocks → many futures → portfolio and model check → early warning and report), ending with a tool map and a glossary. Every other tab links to the matching part of the guide.
- Tab order: Home · How it works · KPI Dashboard · Distress Indicator · Expected Fiscal Cost · Shock Scenarios · Early Warning · Report. Government Support and Technical notes (assumptions & sources) are built but kept off the tab bar.
- Shock Scenarios: PD × EAD × LGD first; No shock / Standard stress / Custom shock with a shock-type drop-down (size first, then structural factors); time horizon separate; analyst settings folded; waterfall (bridge) charts; "All SOEs" replaced by **Portfolio macro shock** (Monte Carlo ranking) and **Model check** (in-sample back-test).
- Early Warning grouped by issue with specific follow-up steps and an action plan per SOE; two new rules (interest not covered, liquidity squeeze).
- Engine fix in both Python and JavaScript: the government-arrears write-down is capped at the non-cash current assets left (`tests/check_arrears_cap.py`).
- Checks: all `tests/*.py` pass (engine parity 58,677 checks; arrears cap 19,320 checks); browser smoke test of every tab and view at 1440 px and 390 px with the demo, example and long-panel datasets, and every one of the 66 How it works steps in light and dark mode, no JavaScript errors.
