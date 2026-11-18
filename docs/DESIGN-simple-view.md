# Simple view: design and contract

Round 2, 18 November 2026. Base: `origin/main` `1de6f6a`. Branch `feature/simple-view`. Round 1 (17 November) built the two screens; round 2 makes them lead with charts and state every cost as a share of GDP.

## Why

The tool's user is a country economist with little finance background. Round 1 cut the choices to five but still showed about 60 figures on arrival, all in local currency. The feedback on it:

1. Do not throw numbers up front; users are easily overwhelmed. Costs are always shares of GDP. GDP comes from the IMF World Economic Outlook automatically, without asking the user.
2. Visuals talk more than numbers. Show the distress score (Altman Z-score) as a chart with its thresholds. The answer is one line per SOE; selecting a line opens a snapshot with two charts. In the Analyst view, the KPI Dashboard opens with two filters, an explanation and charts, and no figures up front.

## Hard rules

1. No formula, calibration, cut-off or default changes. `templates/engine.js`, `shocks.py`, `calculations.py` are not edited. `config.py` gains text only (`CATEGORY_EXPLAIN`, `KPI_HOW_TO_READ`, `KPI_PLAIN`).
2. In the Analyst view only two things change: the KPI Dashboard's default view (section "KPI Dashboard"), and the GDP source (a saved WEO table first, the World Bank request as fallback, with a truthful source label). The other six tabs are not edited.
3. Simple-view numbers come from the same functions and state as Home, Report and Early Warning: `standardStress`, `CHANNELS()`, `evalTriggers`, `E.efcRow`, and `S.efc.lgd`, `S.efc.ead`, `S.efc.basis`, `S.gdp`, `S.growth`. Shares of GDP divide each year's cost by that year's GDP on the tool's own path (`E.gdpPath(S.gdp, S.growth, H)`, the `GDP` field of every path row), so they equal the Analyst tabs' shares.
4. **No local-currency amount appears in the Simple view**, except the GDP row inside the closed Assumptions fold and the CSV download. Costs are shown with `pctS(x) + " of GDP"` (or `pctS(x)` where the unit is in the heading).
5. Figures on arrival are limited to: the answer sentence (two), one per SOE row, the chart axes, and the size lines of the scenario cards. Scenario cards carry no cost figure.
6. Simple view contains no `input[type=range]`, no method choice, no sector-specific panel.
7. These labels never appear in Simple-view text: `PD`, `LGD`, `EAD`, `EFC`, `Z″`, `Z-EM`, `X1`–`X4`, `bps`, `s.d.`, `std. dev.`, `Monte Carlo`, `P5`/`P95`, `percentile`. "Altman Z-score" is allowed (the score chart's title).
8. Open team decisions are not settled here: zone cut-offs, the definition of the default probability, the term "distress score", the loss-share convention, the growth of GDP in later years. Values and names come from config as they stand.
9. Never hand-edit `SOE-Fiscal-Risk-Final.html`; rebuild it with `python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html`.

## Plumbing (unchanged from round 1 unless noted)

- `report.py` inlines `templates/simple.js` at `/*__SIMPLE_JS__*/` in `app.js` and `templates/simple.css` at `/*__SIMPLE_CSS__*/`. It also embeds `assets/weo_gdp.json` as `DATA.gdp` (round 2).
- Mode: `body[data-mode="simple"|"analyst"]`; `#modeSwitch` is a two-option control (`[data-mode-target="simple"]`, `[data-mode-target="analyst"]`, `aria-pressed` on the selected one); `S.lastAnalyst`; start page `simple` unless the URL hash names a page.
- `initPageState()` sets `S.simple = { scen: "none", soe: null, all: false, open: {} }` (`open` holds fold states). The Simple view adds `S.simple.snap`, the SOEs whose snapshot is open.

## GDP (round 2)

- `scripts/fetch_weo_gdp.py` writes `assets/weo_gdp.json`: nominal GDP in local currency (`CN`, WEO `NGDP`) and in US dollars (`CD`, WEO `NGDPD`), 2000–2031, keyed by the ISO3 codes of `GDP_COUNTRIES`, with the vintage. Rerun it after each WEO release.
- `gdpTable(series, country, year)` reads the table (exact year, else the nearest earlier year). `gdpFetch` answers from the table when it has the exact year and only otherwise asks the World Bank. `S.gdpSrc.kind` is `"weo"`, `"wb"` or `"manual"`; `gdpSourceName(src)` gives the label.
- Simple view, country in this order: the file's `Country` column; the statements' currency when it belongs to one country only; Senegal for the built-in examples (said on screen); otherwise one drop-down. GDP year: the latest accounts year, or the latest earlier year the table has (said on screen).
- Without GDP (country not known, or no figure for it) the Simple view shows no result: the answer area says "Choose the country to see the results." The typed-GDP box appears only when the table and the World Bank have no figure, or the currencies differ.

## Data layer (`templates/simple.js`, section A, written by the main session)

```
SV.scenarios()   -> [{ key, mags, name, size }]          // "none" + the seven CHANNELS() entries
SV.run(key)      -> { key, name, size, mags, H, D, year, gdpH, items: [{ r, name, now, fut, zoneNow, zoneFut, drop, x }],
                      nowTotal, futTotal, nowGdp, futGdp }
SV.totals()      -> { key: futTotal }
SV.paths(key)    -> { key, none, name, labels: [x-axis label per projection year], year, gdp: [GDP per year],
                      series: [{ level: 'none'|'mild'|'standard'|'severe', label, size,
                                 total: [cost per year, internal units], share: [fraction of GDP per year, null without GDP],
                                 by: { entity: { efc: [...], share: [...] } } }] }
SV.score(name, key) -> { hist: [{ year, z, zone }], proj: [{ year, z, zone }] }   // proj[0] is the latest accounts year
SV.stateRange(key), SV.assumptions(), SV.changed(), SV.warnings()                  // as in round 1
```

- `SV.paths`: for `none`, `series` holds the no-shock path only. Otherwise four series in the order none, mild, standard, severe. `standard` is `SV.run(key)`'s own paths (`x.str`), `none` is `SV.run("none")`'s, `mild` and `severe` are `standardStress(allRows(), SV.magsAt(mags, level))`. Index 0 is the latest accounts year: `total[0]` equals `nowTotal` and `last(standard.total)` equals `futTotal` (checked on the three built-in datasets at the default settings). `SV.sizes` and `svSizeBars` of round 1 are removed.
- Refinancing has no size guide; it takes the interest-rate guide's proportions (half and twice its standard size). No likelihood is attached to a size.

## DOM contract (tests rely on it)

`data-v` holds the raw number: shares as fractions of GDP, costs in the tool's internal units (the value round 1 passed to `money()`). `data-series` holds JSON with the plotted numbers, so a test can read a chart without parsing SVG.

Overview, `section#simple`:

| Element | Selector and attributes |
|---|---|
| Data strip | `#sv-data`; file input `#sv-file`; summary `#sv-summary`; country select `#sv-country` (hidden when the country is known); `#sv-gdp-change` (button "change"); GDP line `#sv-gdp` with `data-v` (GDP in full currency units, or empty), `data-country` (ISO3), `data-year`, `data-src` (`weo`, `wb`, `manual` or empty) |
| Scenario cards | `#sv-scen button[data-scen]`, `aria-pressed`, `data-v` (portfolio cost at the horizon), `data-share` (fraction of GDP, empty without GDP), `data-add` (share added on top of the no-shock share; empty on the no-shock card); bar `.sv-card-bar > i` with `style="width: N%"`, N = added share ÷ largest added share × 100 (0 when the shock adds nothing). The no-shock card has no bar, only the words "the starting point". The card's text holds no cost figure |
| Answer | `#sv-ans` with `data-now-total`, `data-fut-total` (internal units) and `data-empty="1"` when there is no GDP; sentence `#sv-big` containing `[data-k="fut-share"][data-v]` and `[data-k="now-share"][data-v]` |
| Portfolio chart | `#sv-chart.chart` with `data-series` = `{"labels": [...], "none": [...], "mild": [...], "standard": [...], "severe": [...]}` (shares; only `none` when no shock is chosen) and a child `<svg>` |
| SOE rows | `#sv-rows`; each `.sv-row[data-soe]` holds `button.sv-row-btn[aria-expanded][aria-controls]` with `data-now`, `data-fut` (internal units), children `[data-k="zone"]` and `[data-k="fut-share"][data-v]`, and a bar `.sv-row-bar > i`. The 12-row limit and "show all" toggle of round 1 apply |
| Snapshot | `.sv-snap` (the element named by `aria-controls`; `hidden` when closed) with `.sv-snap-why`, `.chart.sv-snap-score[data-series]` = `{"hist": {"years": [], "z": []}, "proj": {"years": [], "z": []}, "safe": n, "distress": n}`, `.chart.sv-snap-cost[data-series]` (same shape as `#sv-chart`, for this SOE), `[data-k="warn"]` (`data-v` = number of rules), `a.sv-more[data-soe]` |
| Assumptions | `details#sv-assume`; chip `#sv-changed`; `[data-k="state-lo"][data-v]`, `[data-k="state-hi"][data-v]` (fractions of GDP) |

One SOE, `section#soe`: `#soe-title`, `#soe-back`, `#soe-prev`, `#soe-next`; blocks `#soe-verdict`; `#soe-health` (the four bars and `#soe-score.chart[data-series]`, same shape as the snapshot's); `#soe-ratios` (one `.kpi-mini[data-kpi]` per ratio); `#soe-cost` (`#soe-cost-chart.chart[data-series]`, `[data-k="now-share"][data-v]`, scenario rows `[data-scen][data-v][data-share]`); `#soe-state` (`[data-k="state-lo"]`, `[data-k="state-hi"]`, fractions of GDP); `#soe-actions`; `#soe-links`.

KPI Dashboard, `section#kpi`, default view: selects `#kpi-soe` and `#kpi-group`; `#kpi-explain`; `#kpi-minis` holding one `.kpi-mini[data-kpi]` per ratio of the group (`data-na="1"` when the data cannot give it); no `.tile` inside `#kpi`. Compare view: `.statstrip` with five `.tile`.

`.kpi-mini` (shared, built by `kpiMini()` in `app.js`): a head with the ratio's label and a status chip in words (Good / Watch / Alert for the latest year, or the reason it is not shown); `.chart` with one line over the years and the two cut-off lines labelled "good" and "alert"; `p.kpi-plain` with `CFG.KPI_PLAIN[key]`. Values appear on hover and on the axis only.

## Screens

### Overview

1. **Your data.** One line: dataset label, number of SOEs, years. Button "Upload your file", link "Download the template", closed fold "Try example data". GDP line (no amount), drop-down only when the country is not known.
2. **Scenario.** Eight cards: name, size line, one bar. The bar shows what the shock adds to the cost at the horizon, on top of the no-shock cost: most of every total is there with no shock at all, so bars of the totals would all look alike. All bars share one scale, so the cards show by eye which shock matters. The no-shock card is the starting point and has no bar. Default `none`. Without GDP the bars use the added cost itself.
3. **Answer.**
   - One sentence with the share of GDP by the horizon year, and a second, smaller one with the share today.
   - The portfolio chart: cost to the budget in % of GDP, from the latest accounts to the horizon, one line each for no shock, milder, as assumed, more severe. "As assumed" is the heavy line and carries the only end label. With no shock chosen, one line.
   - One caption under the chart with the three sizes in words and the two caveats.
   - SOE rows, largest cost first: name and sector, zone chip, bar, share of GDP by the horizon year. Selecting a row opens its snapshot below it; several can be open; the charts are drawn on first open.
   - Snapshot: the reason in one sentence; the distress score chart (history solid, the path under the chosen scenario dashed, zones shaded, both threshold lines labelled); the cost chart for this SOE (same four lines); the warning level and count; "More about {SOE}".
   - CSV download: one row per SOE with zone, cost today and at the horizon, each as share of GDP and in local currency, and the number of warnings.
4. **Assumptions behind these numbers.** Closed fold, read-only. Amounts as shares of GDP. A GDP row gives the figure, year, country and source. Chip with the number of settings changed in the Analyst view.
5. Links: "How this works", "Analyst view".

### One SOE ("More about")

Previous / Next (row order) and Back. No other picker.

1. Verdict sentence.
2. Four health checks (bars) and the distress score chart, as in the snapshot but larger.
3. Health ratios: the reading note, then one `.kpi-mini` per ratio of `CFG.REPORT_HEADLINE_KPIS` the data allow. No table of values.
4. What it could cost the budget: the share today in a sentence; the four-line chart; the eight scenarios as bars with the share by the horizon year, the selected one marked (selecting one changes the scenario); the State's-share sentence.
5. What to do: the rules this SOE fires, with the follow-up steps.
6. Look closer in Analyst view.

### KPI Dashboard (Analyst view)

- View switch: "One SOE" (state key `trend`, the default), "Compare across SOEs", "Full scorecard".
- One SOE: two selects (SOE, Group). Then the group's name, its question, its explanation and the reading note; then one `.kpi-mini` per ratio of the group, in `KPI_CATEGORIES` order. A ratio the data cannot give keeps its place and shows the existing `missingKpiMessage`. One CSV button for the group. No tiles, no Years pair, no ratio drop-downs.
- Compare across SOEs: the five summary tiles first, then the view as it was.
- Full scorecard: as it was.
- `S.kpi` keeps `view`, `soe`, `from`, `to` (the tariff-support card of `support_additions.js` reads them) and gains `group`. `catKpis` and `missingKpiMessage` keep their exact source text (`tests/check_cost_recovery.py` pins it).

## Copy

Sizes in `{}` are read from config and formatted; nothing is typed.

Scenario names and size lines: as in round 1 (`SV.COPY`).

Overview:

- Page title: "What could your SOEs cost the budget?" Lead: "Load the accounts, pick a scenario, read the answer. A first screen, not a forecast."
- Section titles: "Your data", "Scenario", "Answer", "Assumptions behind these numbers".
- Scenario lead: "Pick what could go wrong. The bar on each card shows how much that shock adds to what your SOEs could cost the budget." Under the cards: "Each shock lasts {D} years. The bars compare the added cost in {year}, {H} years after the latest accounts." No-shock card: "the starting point". Card tooltip and `aria-label`: "{name}, {size}: {x}% of GDP by {year}; the shock adds {a}% of GDP" (or ", about the same as with no shock", or "; {a}% of GDP less than with no shock").
- GDP line: "Shares of GDP use the GDP of {country} for {year} ({source})." · examples: "Example data: shares of GDP use the GDP of Senegal for {year}, for illustration ({source})." · earlier year: " The latest GDP available is for {year}; your accounts end in {year}." · typed: "Shares of GDP use the GDP you typed." · no country: "Choose the country to see the results."
- Answer sentence: "Under “{scenario}”, your {n} SOEs could cost the budget **{x}% of GDP** by {year}." With no shock: "With no shock, your {n} SOEs could cost the budget **{x}% of GDP** by {year}." Second sentence: "From the latest accounts, the cost today is {y}% of GDP."
- Portfolio chart title: "Cost to the budget, % of GDP". Legend: "No shock", "Milder", "As assumed", "More severe". Caption: "Milder: {size}. As assumed: {size}. More severe: {size}. These are the tool's own guide sizes for this shock; they show how much the answer depends on the size of the shock, not how likely each size is. The cost moves in steps: it rises when a shock pushes an SOE down a rating step." With no shock chosen the caption is: "Pick a scenario above to see how a shock, and its size, changes this line."
- Rows. Hint: "Largest first. Select an SOE to see why." Heads: "SOE", "Health now", "Cost to the budget by {year}".
- Snapshot. Reason: "{SOE} is in the {zone} zone, {why}." Score chart title: "Distress score (Altman Z-score)"; sub: "Solid: past years. Dashed: under “{scenario}”." (with no shock: "Dashed: the years ahead with no shock."); threshold labels "safe above", "distress below". Cost chart title: "Cost to the budget, % of GDP". Foot: "{n} warnings" / "1 warning" / "no warnings"; link "More about {SOE} →".
- No GDP: "Choose the country to see the results."
- Assumptions: rows as in round 1, plus "GDP: {amount} in {year}, {country} ({source})". State's share: "If the State bore the low or the high share for each SOE's sector (from past defaults on public loans), the cost by {year} would be between {x}% and {y}% of GDP." and, when it applies, "For {n} of {m} SOEs the low figure for their sector is above the {70}% assumed." Closing line and chip as in round 1.

One SOE:

- Block titles: "Four health checks", "Health ratios", "What it could cost the budget", "What to do", "Look closer in Analyst view".
- Cost block: "From the latest accounts, the cost today is {x}% of GDP." · chart title "Cost to the budget, % of GDP" · "By {year}, under each scenario" above the bars · State's share: "If the State bore the low or the high share for {sector} SOEs (from past defaults on public loans), the cost by {year} would be between {x}% and {y}% of GDP."

KPI Dashboard:

- Page head: "Profitability, liquidity, solvency and fiscal-dependency ratios, one group at a time. Pick an SOE and a group. Thresholds are illustrative, pending recalibration."
- View labels: "One SOE", "Compare across SOEs", "Full scorecard". Select labels: "SOE", "Group".
- Explanation: `CFG.CATEGORY_LABELS[g]`, then `CFG.CATEGORY_EXPLAIN[g].question`, `.text`, then `CFG.KPI_HOW_TO_READ`.
- Cut-off line labels: "good", "alert".
- How-it-works guide line for this tab: "View, SOE and group".

## Tests

`tests/check_simple_view.py` (Playwright against the built HTML; exits 0 with a "skipped" line when Playwright is not installed) and `tests/check_gdp_table.py`. The checks are listed in the plan of 18 November (`tasks/todo.md`, "Verification").

## Not in this build

Findings for the repository owner, reported in `NOTE_for_Hyunju.md`, not changed here: loss share and exposure stored twice (`S.efc.*`, `S.sh.*`); Monte Carlo uses a different curve from every headline; default loss share below every sector average in the reference table; utility panels shown for every sector; Government Support and `classic.py` unreachable from the live site; Portfolio macro shock has no fuel or currency shock; GDP in later years grows 3% a year where the WEO has its own projections.
