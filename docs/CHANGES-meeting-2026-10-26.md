# Changes from the team meeting of 26 October 2026

The meeting reviewed the pilot from the point of view of its real users: country economists who are not specialists in company accounts. The tool has to be digestible ("clean, storytelling, key lessons"), with the technical detail kept behind it for the team's own due diligence. This release applies the decisions and feedback to the standalone HTML tool (`templates/` → `SOE-Fiscal-Risk-Final.html`) and fixes the arrears bug found during the screen-share.

Rebuild: `python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html`. The tracked snapshot in this release is that build.

## 1. Decisions and feedback → what changed

| Meeting point | Change in the tool |
|---|---|
| Built for country economists; make it digestible; two streams (friendly front, technical note behind) | New **How it works** tab for non-specialists (§2). Technical detail moved into folds marked "for analysts" and into **Technical notes** (the former Assumptions tab). |
| Report should come last | Tab order: Home · How it works · KPI Dashboard · Distress Indicator · Expected Fiscal Cost · Shock Scenarios · Early Warning · **Report**. |
| Government Support: investor's perspective, debt team may push back, PSO not mature — "we can hide that tab, it doesn't have to go" | Removed from the tab bar; the page and code are unchanged and open from `#view-gre`. A note on the page says why it is hidden and that nothing there feeds PD or EFC. |
| Hide the assumptions from users; "model guide" should be called something users understand, such as shock transmission | Assumptions renamed **Technical notes**, off the tab bar, linked from Home, How it works and the Report. The explainer is called **How it works**, with a **shock transmission** section linked from Shock Scenarios. |
| Call it a distress indicator; many users do not know what Altman Z is | Distress Indicator page heading and text rewritten in plain words; the shock page headline shows one **Distress indicator** tile (zone and the reason, e.g. "mainly because it is short of cash for this year's bills and past losses have eaten its savings"). |
| Expand on the home page what the tool does | Home: plain-language lead, a seven-step "How to use it" path, a **What the tool covers** box and "What the tool is not". |
| Financial-sector SOEs: different framework; we should be able to answer "why is this not including financial?" | Scope box on Home lists them as not covered, with a fold "Why are state banks and other financial SOEs not included?" (assets are others' liabilities, prudential and contagion stress tests, specialist teams). |
| One country, several SOEs for now; energy sector-wide (IPPs) belongs to the energy model; early warning stays general and flags SOEs for a deep dive | Scope box and toolkit note say so. Early Warning suggests the energy-sector model for flagged power utilities. |
| Toolkit: country analysis and global monitoring are one thing ("monitoring", not "global"); hidden subsidies; energy; PSO last | Home modules: **Early Warning Framework & Monitoring** (this tool) · Hidden Subsidies (in progress) · Energy Sector Fiscal Risk (model exists) · PSO Analysis (later). |
| PDF statement extraction is the one missing piece | "Coming next" note on the Load data card (not implemented). |
| Use "projection", not "forecasting" | Shock page and How it works say "projections from the model, not forecasts". |
| Shock page: too many sliders at once (fuel, tariffs, cash …); use a drop-down so only the selected shock shows | Step 3 **Shock**: `No shock` · `Standard stress` · `Custom shock`. Custom shows a **Select shock type** drop-down; only that shock's controls appear. Active shocks are listed as chips (click to edit, × to remove). |
| Keep fuel, FX, interest rates, revenue and arrears; horizon is not a shock (it affects every shock) | Shock types: Fuel price · Exchange rate · Interest rates (incl. refinancing spread) · Revenue fall (any cause) · Government arrears. Step 4 **Time horizon** is its own block. |
| Define the size of the shock first, then the structural factors (pass-through etc.) | Each shock shows **1 · Size of the shock**, then **2 · Structural factors: how exposed this SOE is**. |
| For each shock: what it is, which SOEs it hits (e.g. heavy fuel users), how it moves the results, a link to the technical note | An info box per shock (what it is, who it hits, which way is worse, effect on the health checks) with a link to the shock-transmission explanation. Texts live in `config.SHOCK_TYPES`. |
| Help with the size: typical changes (median, min, max over 3–5 years), or the user's own data | **Size guide** buttons (mild / standard / severe) per shock, with a note. Historical reference ranges are **not yet** in (placeholder, see §4). |
| Keep country-specific parameters (Senegal) but with a caveat: leave defaults without data, run sensitivity; send us data | Caveat above the structural factors, "Data that sharpens this" line per shock; Senegal oil preset and tariff options moved to "More fuel options" / "Country case (Senegal)". |
| Financing structure (FX vs domestic debt, cash gap funded short-term) matters for FX and interest-rate shocks | FX shock: share of debt in foreign currency is its first structural factor. Interest-rate shock: floating share, debt coming due, rate on new borrowing, cash gaps funded short-term. Other financing settings are in Advanced › How cash gaps are financed. |
| Revenue as a generalised shock block (e.g. tourism for small islands) | Revenue fall is set in **% of revenue** ("any cause"); the tool also shows it in standard deviations of the SOE's own revenue growth (DSA −1 s.d.). |
| PD × LGD × EAD sliders should be the first thing users see (LGD was far down) | Step 2 **Expected fiscal cost settings** sits right under the SOE choice, with the formula PD × EAD × LGD spelled out. GDP is in a fold. |
| "Scenario" box actually selects the SOE and year — be careful with the word | Renamed **SOE and base year**. |
| Fewer numbers, more graphs; waterfall | Single-SOE results: a **How the shock travels** strip (shock → operating profit → net income → cash gap → debt → distress score → expected fiscal cost, each against no shock), two **waterfall (bridge) charts** (what moved the distress score, by health check; what moved the expected fiscal cost, PD vs debt), the two paths. Tables are collapsed under "Background data". |
| Collapse background data like "Required and optional columns" | Tables, cash/State-compensation detail, payment-priority scenarios and the engine notes are all folds. |
| Zone migration (safe → grey → distress) | **Zone migration** tile ("Down 1 zone", from → to, compared with no shock). |
| Arrears shock moved an SOE from distress to safe; sign confusion | **Bug fixed** (§3). Arrears slider is now 0–50% of revenue a year, labelled "higher is worse". |
| "All SOEs" applied one SOE's shock settings to every SOE — "completely wrong" | View removed. |
| Replace it with one portfolio-wide macro shock (1–2 sliders, Monte Carlo), results as a **ranking** of which SOEs drive the cost; it also validates the model | New view **Portfolio macro shock**: revenue fall for every SOE and rise in borrowing costs, severity drawn 300 times (common draw, lognormal ±50% by default), each SOE's own exposures, smooth PD curve. Output: ranking by median rise in expected fiscal cost with 5–95% range, share of added cost, how often in the top three, zone drops; "check data" flag when a small SOE (under 5% of portfolio debt) ranks in the top three. Select an SOE to open it in One SOE with that shock. |
| Portfolio EFC belongs on the Expected Fiscal Cost tab (actual assessment, not a counterfactual) | Stated on the Expected Fiscal Cost tab and in the macro view. The Home stress tile no longer quotes a portfolio sum under stress. |
| Model validation, as management asks: actual path vs model with a shock in 2020 (COVID) | New view **Model check**: pick the year the shock hits (default 2020 when the data allow), the shock and its size; the projection starts from the year before and is drawn against the distress score in the accounts, with the average gap, same-zone years and direction, and the same check for every SOE. In-sample check, not a formal validation. |
| Early warning is great but needs specific trigger → action, grouped (debt, liquidity …), filterable, top part fixed, pick SOEs one after another | Rules grouped by issue (Overall health, Solvency & debt, Liquidity, Stress test, Trend, Fiscal dependency) with filter chips; each rule has specific follow-up steps. New rules: interest not covered (alert), liquidity squeeze (watch). **Action plan** per SOE with previous/next, most severe first; signal board cards select the SOE. Steps are illustrative until agreed with the Ministry and aligned with Bank, IMF and governance-team guidance. |
| The draft "how the model works / how a shock transmits" explainer "saves us a lot" | Built into the tool as **How it works** (§2). |

## 2. The How it works tab

Adapted from the draft explainer *How SOE Pilot Works* (`How_SOE_Pilot_Works.html`): the same look (transit-line rail, sticky picture, step cards on the right, Overpass and Atkinson Hyperlegible type, the same health / risk / shock colours) and the same scroll-driven effects, but native to the tool and computed live from whatever data is loaded. Every number is for one **example SOE** (picked in the opening section; any SOE in the data can be chosen) or for the loaded portfolio.

How it reads: the reader scrolls; the step text on the right changes, and the picture on the left redraws to match (bars grow, dots fall into place, lines draw themselves, numbers count up). A transit rail under the tab bar shows the eleven chapters, the current one and how far the reader has got; each station jumps to its chapter. On a phone the picture is pinned at the top and the text scrolls below it. Reduced-motion settings switch the animation off.

Chapters (66 steps):

1. **Why it matters** — lenders, the SOE and the treasury; how a company's debts become contingent liabilities of the budget; the three questions the tool answers.
2. **The website in one picture** — the seven tabs as stations on one line, each with the question it answers and a small live view of what it shows (Home → KPI Dashboard → Distress Indicator → Expected Fiscal Cost → Shock Scenarios → Early Warning → Report), then how the cycle repeats with next year's accounts. Each step links to its tab.
3. **Seven numbers from the accounts** — what the SOE owns, what it owes, equity, operating profit, retained earnings.
4. **Four health checks** — X1–X4 one at a time, then against the healthiest SOE in the data.
5. **One distress score, three zones** — the weights, the weighted checks added up as a waterfall, the score line with its zones, every SOE in the data, and a "try it" with four sliders.
6. **From score to rating to the chance of distress** — the 20-step ladder, indicative ratings, 1,000 dots for the PD, the PD staircase.
7. **Expected fiscal cost** — EAD × LGD × PD for the example, why it is an average, the portfolio total.
8. **How a shock travels** — pick fuel, exchange rate, interest rates, revenue, arrears or the standard stress on the picture; the shock lights up the accounts map step by step (income statement → profit and cash → balance sheet → health checks → result) with the example SOE's changes; then the paths with and without the shock and "shocks make each other worse" (one at a time vs all together). Opens the same shock in Shock Scenarios.
9. **Many possible futures** — one draw, 300 draws as a cloud, the cloud stacked into a histogram, P50 and P95, and what P95 is not.
10. **The whole portfolio under one shock, and checking the model** — the macro-shock ranking and its data flag, and the model check against past years with the gap explained.
11. **From numbers to action** — the rule groups, the signal board, an action plan, the report.

Then a **tool map** (every tab: the question it answers, what it shows, what to set, what to leave at its default, what is for analysts), **the whole chain in six lines**, **which number am I looking at?** (the four expected costs one SOE shows in different places, and why they differ), what the tool is not, and a searchable glossary (`config.HOW_GLOSSARY`).

Every other tab now carries a link under its title, "New to this tab? How to read it →", that opens the matching part of the guide; the shock buttons in Shock Scenarios open chapter 8 with that shock selected.

Code: `templates/explainer.js` (inlined into `app.js` at `/*__EXPLAINER_JS__*/` by `report.py`): a small stage kit (keyed SVG and HTML elements that animate between states), one `draw(stage, step)` per chapter, and a scroll controller. Styles in the `.hw` block of `templates/app.css`.

## 3. Bug fix: government-arrears write-down

The arrears shock writes off `arrears_pct_of_revenue × revenue` of current assets each shock year. With large values (the meeting tried +130%) the write-down exceeded the assets left, **total assets turned negative and the Z″ ratios changed sign**: SOE A went from −6.96 (Distress) to +171.8 (Safe). The write-down is now capped at the non-cash current assets left, in `shocks.py` and `templates/engine.js` alike. With the cap, SOE A at +130% ends at −27.4 (Distress).

New test `tests/check_arrears_cap.py` (19,320 checks on the demo portfolio with and without cash and on the long panel, arrears 0–130%): total assets stay positive, an arrears shock never leaves an SOE in a better zone than no arrears, and Python and JavaScript agree. On the previous engine it fails (1,252 checks, starting with SOE A Distress → Safe).

## 4. Not done yet (open items from the meeting)

- **Historical size guidance** for each shock (median, minimum, maximum change over 3–5 years, e.g. oil prices): the size guide uses illustrative mild / standard / severe values (`config.SHOCK_TYPES`, register status "placeholder").
- **PDF statement extraction** into the template.
- **Trigger actions** to be validated with the governance team and aligned with Bank / IMF guidance; the steps are illustrative.
- **PSO and hidden subsidies**: Government Support stays hidden until that work matures.
- **Financial-sector SOEs**: only the scope note; no framework.
- **Toolkit landing page** above this tool (links to the four frameworks, contacts): not part of this tool; the Home modules show the structure.
- The model check uses the demo data, which are invented; run it on real data (e.g. 2019–2024 accounts with the COVID shock in 2020) before showing it as evidence.

## 5. Files

- `templates/app.html` — tab order, How it works page, hidden tabs, the guide's two typefaces (Overpass, Atkinson Hyperlegible).
- `templates/app.js` — "How to read this tab" links on every tab, Home, Shock Scenarios (panel, single view, macro ranking, model check, bridge and ranking charts), Early Warning, wording.
- `templates/explainer.js` — new How it works tab (scroll-driven guide).
- `templates/app.css` — styles for the above.
- `templates/engine.js`, `shocks.py` — arrears write-down cap.
- `config.py` — `SHOCK_TYPES`, `SHOCK_SIZE_NOTE`, `HOW_GLOSSARY`, `TRIGGER_CATEGORIES`, trigger rule categories and steps, two new rules, two register rows.
- `report.py` — payload names, explainer inlining, docstring.
- `tests/check_arrears_cap.py` — new; `tests/check_balance_identity.py` — docstring.
- `README.md`, `Home.py`, `START_HERE_KO.md` — tab list and notes.
