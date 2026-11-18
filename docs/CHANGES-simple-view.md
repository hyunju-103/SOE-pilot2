# Simple view in front of the existing tabs (November 2026)

Base: `1de6f6a`. Design and contract: `docs/DESIGN-simple-view.md`.

## Problem

The tool's user is a country economist with little finance background. On `1de6f6a` the tool has 8 tabs and 9 sub-views, about 73 controls visible on arrival and about 125 one click away (about 80 of them in Shock Scenarios). The tabs follow the method (ratios, score, cost, shocks, warnings), and each asks the user to set that method's parameters. The economist's question is about the country: which SOEs are in trouble, what could they cost the budget, what if a shock hits, what needs action.

A first version of the Simple view (17 November) cut the choices but still showed about 74 figures on arrival, 26 of them amounts in local currency. The feedback on it set two rules for this version: do not throw numbers up front, and let charts carry the comparison; state every cost as a share of GDP, with GDP filled in automatically.

## Change

The tool opens in a **Simple view** with two screens. The existing tabs are one click away behind **Analyst view** (header button). No formula, calibration, cut-off or default changed; `templates/engine.js`, `shocks.py` and `calculations.py` are untouched, and `config.py` gained text only.

**Overview** (`pages.simple`): three numbered steps.

1. *Your data.* Upload (same reader and messages as Home), template, built-in examples in a fold. One line says whose GDP the shares use and where it comes from. The country is taken from the file's `Country` column, or from the currency when it belongs to one country; the built-in examples use Senegal's GDP and say so; otherwise one drop-down asks.
2. *Scenario.* Eight cards: no shock, the six standard shocks one at a time, and all six together. Sizes are the standard-stress sizes in `config.DEFAULT_SHOCK_PARAMS`. Each card has a bar and no figure. The bar shows what the shock adds to the cost on top of the no-shock cost, on one scale, so the cards show which shock matters.
3. *Answer.* One sentence with the portfolio cost at the horizon as a share of GDP, and the share today. Then a chart of the cost in % of GDP from the latest accounts to the horizon, with one line each for no shock and for the chosen shock at the milder size, the size assumed and the more severe size of the tool's own guide (`SHOCK_TYPES[].guide`). Then one row per SOE: health now, a bar, and the cost as a share of GDP. Selecting a row opens a snapshot under it: the reason in one sentence, the distress score (Altman Z-score) over the years with the safe and distress lines and its path under the scenario, the same cost chart for that SOE, the warnings, and a link to the One-SOE screen.

Under them, a read-only fold lists the assumptions behind the numbers, the GDP used, and how many settings were changed in the Analyst view. The doubt about the State's share of the loss sits there.

**One SOE** (`pages.soe`): the verdict in one sentence; the four health checks as bars and the distress score chart; the headline ratios as small charts with their cut-off lines and one plain sentence each; the cost chart, the eight scenarios as bars and the State's-share range, all in % of GDP; the warnings that fire with their follow-up steps; links into the Analyst tabs for that SOE.

The Simple view has no slider and no method choice, and shows no local-currency amount outside the assumptions fold and the CSV download. On the demo data the arrival screen holds 10 cost figures (two in the sentence, one per SOE) and no amount in local currency.

**KPI Dashboard** (Analyst view). The default view, now called "One SOE", opens with two selects (SOE, group) and no figures: the group's name, the question it answers, a plain explanation and a note on how to read the charts, then one small chart per ratio of the group with its "good" and "alert" lines and one plain sentence. Values show on hover and on the axis. The five summary tiles moved to the top of "Compare across SOEs"; the Years pair shows in "Compare across SOEs" and "Full scorecard" only. Those two views, the scorecard and the Report are otherwise as they were.

**GDP.** `assets/weo_gdp.json` holds nominal GDP in local currency and US dollars for 197 economies, 2000–2031, from the IMF World Economic Outlook (October 2026; fetched with `scripts/fetch_weo_gdp.py` from the IMF's SDMX API). `report.py` embeds it in the page. `gdpFetch` answers from this table and asks the World Bank only for a country or year the table lacks (21 territories in the country list have no WEO figure). The Analyst GDP field names the source it used.

## Where the numbers come from

The Simple view calls what the Analyst view already uses, so the two cannot disagree:

| Figure | Source |
|---|---|
| Cost today | `E.efcRow` with `S.efc.*`: equals the Expected Fiscal Cost tab |
| Cost at the horizon, by scenario | `standardStress(allRows(), mags)` with the `CHANNELS()` magnitudes: equals Report › Stress by channel |
| Cost year by year | the same paths, every year of them (`SV.paths`). The first year equals the cost today, the last the cost at the horizon |
| Share of GDP | each year's cost divided by that year's GDP on the tool's own path (`E.gdpPath(S.gdp, S.growth, H)`): equals the Analyst tabs' shares |
| Smaller or bigger shock | `standardStress` again with the scenario's shocks at the guide's `mild` and `severe` sizes (refinancing, which has no guide, at half and twice its standard size, the interest-rate guide's proportions) |
| Distress score | the accounts (`Z_EM` by year) and the scenario path |
| Warnings | `evalTriggers` with the standard stress: equals Early Warning |
| State's share, low to high | each SOE's cost scaled to the low and high figures of `E.recoveryScenarios(sector)` |

The three sizes carry no likelihood. Because the cost is read from rating steps, some lines barely move; the chart's caption says so, so that a flat line is not read as a harmless shock.

## Files

- New: `templates/simple.js` (data layer `SV`, the two pages, the two charts), `templates/simple.css`, `scripts/fetch_weo_gdp.py`, `assets/weo_gdp.json`, `tests/check_simple_view.py`, `tests/check_gdp_table.py`, `docs/DESIGN-simple-view.md`.
- `report.py`: inlines the two new templates; embeds the GDP table; exposes the three new text constants.
- `config.py`: `CATEGORY_EXPLAIN`, `KPI_HOW_TO_READ`, `KPI_PLAIN` (plain-language text for the ratio groups and ratios). Nothing else.
- `templates/app.js`: start page is `simple`; `showTab()` sets `body[data-mode]`; `#modeSwitch`; `S.simple`; the GDP request moved into `gdpFetch()`, which reads the saved table first (`gdpTable`, `gdpSourceName`, `countryFromCurrency`); the KPI Dashboard's default view and the shared `kpiMini()` chart.
- `templates/app.html`: two sections and the mode button. `templates/app.css`: the marker line and the styles of the KPI default view. `templates/explainer.js`: one phrase in the KPI guide.
- `SOE-Fiscal-Risk-Final.html` rebuilt with `python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html`.

Deep links are unchanged: `#view-efc` and the other tab links open the Analyst view.

## Checks

- `tests/check_simple_view.py` (Playwright; prints SKIPPED and exits 0 without it): 838 checks, run with every network request blocked. Landing state; GDP from the saved table; local-currency totals equal to the Expected Fiscal Cost tile and to Report › Stress by channel for the three built-in datasets; shares, card bars, charts (first point = today, last point = the sentence or the row) and rows for every dataset and scenario; no local-currency amount and no technical label in Simple-view text; the snapshot and the One-SOE screen; the eight tabs open with no page error; uploads with a `Country` column, with a one-country currency, with an ambiguous currency, and for a country with no recent GDP; the KPI Dashboard's default view, Compare and scorecard.
- `tests/check_gdp_table.py`: the saved table is sane and equal to what the page embeds.
- The 15 existing `tests/check_*.py` pass, including parity (64,173 checks) and the snapshot check.
- Analyst view, demo data, 1440 px, opened by link: Home, Distress Indicator, Shock Scenarios, Early Warning and Report are pixel-identical to `1de6f6a`. Expected Fiscal Cost differs only beside the GDP field (its series label now reads "GDP series"). The KPI Dashboard is redesigned as described.
- Figures on the Simple view's arrival screen (demo): 42 numbers in all, none in local currency; 10 are costs, 10 are chart axis labels, the rest are years, step numbers and shock sizes. The first version showed 74, 26 of them local-currency amounts.

## Not verified

- The page inside the Streamlit frame on the deployed site.
- A screen reader. Controls are native buttons, selects and `<details>`; each chart has a text label with its end values.
- An Excel upload and drag-and-drop in the Simple view (CSV uploads are tested).
- The World Bank fallback for the 21 territories the WEO does not cover (the tests block the network and check that the typed-GDP box appears).

## Consequences to know

- When the Simple view has filled GDP (always, for the examples), the Analyst cost tabs show their share-of-GDP figures from the start. Opened by a direct link first, they start blank as before.
- The examples' shares use Senegal's GDP. They are illustrations: the SOEs are invented.

## Merged with `main` of 17 November

The first Simple view was merged as pull request #2, and four commits followed on `main` (`d0c8acf` to `99c7f1e`): the two-option Simple / Analyst switch, the tab order with Shock Scenarios last, the "How the shock travels" fold, the Distress Indicator chart order, styling, and a "GDP year" drop-down in the Simple view in place of the typed-GDP box. This branch merges all of them except the last. The Simple view takes GDP for the latest accounts year from the saved WEO table without asking, so the year drop-down is left out of it; the typed-GDP box stays as the fallback for a country the table and the World Bank cannot give. The GDP year can still be chosen in the Analyst GDP field. `templates/simple.js` is this branch's version; the tests follow the new switch and tab order.

## Left as they are (for the owner to decide)

1. Loss share and exposure are stored twice (`S.efc.*` and `S.sh.*`), so the Expected Fiscal Cost and Shock tabs can show different costs for the same SOE. Simple view reads `S.efc.*`, as Home, Report and Early Warning do.
2. Monte Carlo uses a different curve from every headline figure. On the four built-in datasets and eight scenarios its 5th–95th percentile range never contains the single-run cost; the middle of that range is 1.5 to 2.4 times it. The single-run figures move in rating steps (see above); the smooth curve would move at every size but would roughly double every headline.
3. The default loss share (70%) is below every sector average in `SECTOR_RECOVERY_DATA` (80–93%); for Transport and Industry it is below the low figure (81%). Simple view says so with the assumptions.
4. The payment-priority, power-producer and tariff panels show for every sector.
5. GDP in later years grows 3% a year (`DEFAULT_GDP_GROWTH`). The WEO has its own projections to 2031 for 190 economies (not Senegal, which stops at 2025). For Kenya, WEO GDP rises 33% from 2024 to 2027 and the 3% rule gives 9%, so a 2027 cost comes out about 21% higher as a share of GDP under the 3% rule. The saved table already holds the projections.
6. Government Support cannot be reached inside the Streamlit frame; `classic.py` is not served.
7. Portfolio macro shock has no fuel or currency shock.
