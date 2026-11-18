  /* =====================================================================
     SIMPLE VIEW — the default, plain-language view (overview + one SOE)
     Inlined into app.js at the SIMPLE_JS marker, INSIDE the app's closure: it uses the helpers
     defined above (el, pageHead, stressAll, CHANNELS, E, CFG, S, showTab ...). No IIFE, no imports.
     See docs/DESIGN-simple-view.md for the rules and the DOM contract.
     ===================================================================== */

  /* ===== SIMPLE VIEW · A · data layer ===== */
  // Every figure in the Simple view comes from the functions and state the Analyst view already uses
  // (standardStress, CHANNELS, evalTriggers, E.efcRow, S.efc.*, S.gdp, S.growth), so it cannot disagree with
  // Home, Report or Early Warning. Nothing is typed in here: shock sizes and spreads are read from CFG.
  const SV = {};
  SV.H = () => CFG.MC_HORIZON_YEARS;
  SV.D = () => CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years;
  const svPts = (bps) => fmt(bps / 100, Number.isInteger(bps / 10) ? 1 : 2); // basis points → percentage points
  /** plain name and size line of each scenario; sizes are formatted from the magnitudes, never typed */
  SV.COPY = {
    none: ["No shock", () => `the accounts rolled forward ${SV.H()} years, nothing going wrong`],
    combined: ["All six at once", () => "the standard stress: every shock below, together"],
    fuel: ["Fuel price rises", (m) => `by ${fmt(m.fuel_shock_pct * 100, 0)}%`],
    fx: ["Currency falls", (m) => `by ${fmt(m.fx_shock_pct * 100, 0)}%`],
    rate: ["Interest rates rise", (m) => `by ${svPts(m.rate_shock_bps)} percentage points`],
    revenue: ["Revenue falls", (m) => { const k = Math.abs(m.revenue_shock_std_devs), y = "a bad year of each SOE's own record"; return k === 1 ? `as in ${y}` : k === 0.5 ? `half as much as in ${y}` : k === 2 ? `twice as much as in ${y}` : `${fmt(k, 1)} times as much as in ${y}`; }],
    refi: ["Refinancing costs more", (m) => `${svPts(m.refinancing_spread_bps)} percentage points more on debt coming due`],
    arrears: ["The State pays late", (m) => `unpaid bills worth ${fmt(m.arrears_pct_of_revenue * 100, 0)}% of revenue a year`],
  };
  /** "none" plus the Report's stress channels (CHANNELS), in the Report's order */
  SV.scenarios = () => [["none", "No shock", ZERO_MAG], ...CHANNELS()].map(([key, label, mags]) => {
    const c = SV.COPY[key] || [label, () => ""];
    return { key, mags, name: c[0], size: c[1](mags) };
  });
  /** the settings the results depend on; when one changes, cached runs and ranges are dropped */
  SV.sig = () => [S.efc.lgd, S.efc.ead, S.efc.basis, S.efc.mode, JSON.stringify(S.efc.per || {}), S.gdp || "", S.growth].join("|");
  SV.cache = () => { const c = S.simple; if (c.sig !== SV.sig()) { c.sig = SV.sig(); c.runs = {}; c.paths = {}; c.warn = null; } return c; };
  /** loss share behind "cost now": as the Expected Fiscal Cost tab and the Report apply it */
  SV.lgdNow = (r) => (S.efc.mode === "per" ? S.efc.per[r.Entity] ?? S.efc.lgd : S.efc.lgd);
  /** every SOE under one scenario: cost now (latest accounts) and cost at the horizon, largest first */
  SV.run = (key) => {
    const c = SV.cache();
    if (c.runs[key]) return c.runs[key];
    const all = SV.scenarios(), sc = all.find((s) => s.key === key) || all[0];
    const res = standardStress(allRows(), sc.mags); // the same call as Home, Report and Early Warning
    const items = res.map((x) => {
      const f = last(x.str);
      return { r: x.row, name: x.row.Entity, now: E.efcRow(x.row, SV.lgdNow(x.row), S.efc.ead, S.efc.basis).EFC, fut: f.EFC,
        zoneNow: x.row.Zone, zoneFut: f.Zone, drop: x.drop, x };
    }).sort((a, b) => (b.fut || 0) - (a.fut || 0) || String(a.name).localeCompare(String(b.name)));
    const years = uniq(res.map((x) => last(x.str)["Calendar Year"])), f0 = res.length ? last(res[0].str) : null;
    const out = { key: sc.key, name: sc.name, size: sc.size, mags: sc.mags, H: SV.H(), D: SV.D(), items,
      year: years.length === 1 ? years[0] : null, // SOEs whose latest accounts differ end in different years
      gdpH: f0 && ok(f0.GDP) ? f0.GDP : null,
      nowTotal: sum(items.map((i) => i.now)), futTotal: sum(items.map((i) => i.fut)) };
    out.nowGdp = S.gdp ? out.nowTotal / S.gdp : null;
    out.futGdp = out.gdpH ? out.futTotal / out.gdpH : null;
    return (c.runs[key] = out);
  };
  /** portfolio cost at the horizon under each scenario, for the scenario cards */
  SV.totals = () => Object.fromEntries(SV.scenarios().map((s) => [s.key, SV.run(s.key).futTotal]));
  /** the tool's own size guide for each shock (config.SHOCK_TYPES[].guide: mild / standard / severe), by magnitude key.
      Refinancing has no guide of its own; in the Analyst view it sits under "Interest rates", so it takes that
      guide's proportions around its standard size. */
  SV.guide = () => {
    const g = {};
    (CFG.SHOCK_TYPES || []).forEach((t) => { if (t.guide && t.key) g[t.key] = t.guide; });
    const r = g.rate_shock_bps, s = STD_MAG.refinancing_spread_bps;
    if (r && r.standard && ok(s) && !g.refinancing_spread_bps) g.refinancing_spread_bps = { mild: (s * r.mild) / r.standard, standard: s, severe: (s * r.severe) / r.standard };
    return g;
  };
  SV.LEVELS = [["mild", "Milder"], ["standard", "As assumed"], ["severe", "More severe"]];
  /** a scenario's magnitudes at another level of the size guide: every shock the scenario switches on moves to that level */
  SV.magsAt = (mags, level) => {
    const g = SV.guide(), out = Object.assign({}, mags);
    Object.keys(g).forEach((k) => { if (mags[k] && ok(g[k][level])) out[k] = g[k][level]; });
    return out;
  };
  SV.sizeText = (key, mags, level) => (key === "combined"
    ? { mild: "every shock at its milder size", standard: "every shock at the size assumed", severe: "every shock at its more severe size" }[level]
    : (SV.COPY[key] || [key, () => ""])[1](mags));
  /** The cost year by year, from the latest accounts (index 0) to the horizon: with no shock, and under the chosen
      scenario at the milder size, the size assumed and the more severe size of the tool's guide. Same call as every
      other figure (standardStress); no likelihoods. For each series: total = all SOEs, in the tool's units;
      share = total as a fraction of that year's GDP on the tool's own path (the GDP field of every path row; null
      without GDP); by = each SOE's cost (efc) and share. For "none" there is one series. */
  SV.paths = (key) => {
    const c = SV.cache();
    if (c.paths[key]) return c.paths[key];
    const run = SV.run(key), b = SV.run("none"), H = run.H, p0 = run.items.length ? run.items[0].x.str : [];
    const gdp = Array.from({ length: H + 1 }, (_, t) => (p0[t] && ok(p0[t].GDP) ? p0[t].GDP : null));
    const labels = Array.from({ length: H + 1 }, (_, t) => (run.year && p0[t] ? String(p0[t]["Calendar Year"]) : t ? `+${t} ${t === 1 ? "year" : "years"}` : "latest accounts"));
    const ser = (level, label, size, pairs) => { // pairs: [SOE name, its path]
      const by = Object.fromEntries(pairs.map(([name, path]) => [name, { efc: path.map((q) => q.EFC), share: path.map((q) => (ok(q.EFC_GDP) ? q.EFC_GDP : null)) }]));
      const total = Array.from({ length: H + 1 }, (_, t) => sum(pairs.map(([, path]) => path[t].EFC)));
      return { level, label, size, by, total, share: total.map((v, t) => (gdp[t] ? v / gdp[t] : null)) };
    };
    const series = [ser("none", "No shock", SV.COPY.none[1](ZERO_MAG), b.items.map((i) => [i.name, i.x.str]))];
    if (run.key !== "none") SV.LEVELS.forEach(([level, label]) => {
      const mags = level === "standard" ? run.mags : SV.magsAt(run.mags, level);
      const pairs = level === "standard" ? run.items.map((i) => [i.name, i.x.str]) : standardStress(allRows(), mags).map((x) => [x.row.Entity, x.str]);
      series.push(ser(level, label, SV.sizeText(run.key, mags, level), pairs));
    });
    return (c.paths[key] = { key: run.key, none: run.key === "none", name: run.name, labels, year: run.year, gdp, series });
  };
  /** the distress score of one SOE: by year in its accounts (hist), and year by year under a scenario (proj, whose
      first point is the latest accounts year) */
  SV.score = (name, key) => {
    const it = SV.run(key).items.find((i) => i.name === name);
    return { hist: byYearAsc(allRows().filter((q) => q.Entity === name)).map((q) => ({ year: q.Year, z: q.Z_EM, zone: q.Zone })),
      proj: it ? it.x.str.map((q) => ({ year: q["Calendar Year"], z: q.Z_EM, zone: q.Zone })) : [] };
  };
  /** low and high share of the loss the State bears for a sector: the ends of the reference table the
      Expected Fiscal Cost tab shows (E.recoveryScenarios) */
  SV.stateShare = (sector) => { const sc = E.recoveryScenarios(sector); return [sc[0][1], sc[sc.length - 1][1]]; };
  /** the cost at the horizon if the State bore the low or the high share for each SOE's sector, not the share assumed.
      above = SOEs whose sector's low figure is higher than the share assumed (their own range starts above their cost). */
  SV.stateRange = (key) => {
    const run = SV.run(key), k = S.efc.lgd / 100, by = {};
    run.items.forEach((it) => { const [lo, hi] = SV.stateShare(it.r.Sector); by[it.name] = { lo: (it.fut * lo) / k, hi: (it.fut * hi) / k, share: [lo, hi] }; });
    const lo = sum(run.items.map((it) => by[it.name].lo)), hi = sum(run.items.map((it) => by[it.name].hi));
    return { key: run.key, share: k, lo, hi, loGdp: run.gdpH ? lo / run.gdpH : null, hiGdp: run.gdpH ? hi / run.gdpH : null, gdpH: run.gdpH, by,
      above: run.items.filter((it) => by[it.name].share[0] > k).map((it) => it.name) };
  };
  /** warnings as the Early Warning tab evaluates them: latest accounts, with the standard stress for the stress rule */
  SV.warnings = () => {
    const c = SV.cache();
    if (c.warn) return c.warn;
    const rows = latestOf(allRows()), stress = Object.fromEntries(SV.run("combined").items.map((i) => [i.name, i.x]));
    return (c.warn = evalTriggers(rows, stress));
  };
  /** SOEs for which at least one exposure share is a default, not a figure from their own file */
  SV.exposureDefaults = () => {
    const names = ["fuel_cost_share", "fx_cost_share", "fx_revenue_share", "fx_debt_share", "floating_debt_share", "near_term_maturity_share"];
    const rows = latestOf(allRows());
    return { n: rows.length, k: rows.filter((r) => { const e = E.soeExposures(r); return names.some((nm) => e[nm] && !/^(Observed|Derived)/.test(e[nm][1])); }).length };
  };
  SV.defaults = () => ({ lgd: M.lgd_pct ?? CFG.LGD_SLIDER_DEFAULT, ead: CFG.EAD_SHARE_DEFAULT, basis: "total_liabilities", mode: "single", growth: M.gdp_growth ?? CFG.DEFAULT_GDP_GROWTH });
  /** the read-only list under "Assumptions behind these numbers"; changed = differs from the tool's default */
  SV.assumptions = () => {
    const d = SV.defaults(), m = STD_MAG, ex = SV.exposureDefaults(), pc = (v) => fmt(v * 100, 0) + "%";
    return [
      { label: "Share of the loss the State bears", changed: S.efc.lgd !== d.lgd || S.efc.mode !== d.mode,
        value: S.efc.mode === "per" ? `set SOE by SOE for the cost now; ${fmt(S.efc.lgd, 0)}% for the scenarios` : `${fmt(S.efc.lgd, 0)}%, the same for every SOE` },
      { label: "Debt at stake", changed: S.efc.ead !== d.ead || S.efc.basis !== d.basis,
        value: `${pc(S.efc.ead)} of total liabilities` + (S.efc.basis === "guaranteed_debt" ? "; for the cost now, government-guaranteed debt where the file reports it" : "") },
      { label: "Years projected ahead", changed: false, value: `${SV.H()}; each shock lasts ${SV.D()} years` },
      { label: "Chance of distress", changed: false, value: "read from the indicative rating that goes with the distress score" },
      { label: "Shock sizes", changed: false, value: ["fuel", "fx", "rate", "refi", "revenue", "arrears"].map((k) => `${SV.COPY[k][0]} (${SV.COPY[k][1](m)})`).join("; ") },
      { label: "Exposure to each shock", changed: false, value: `from the SOE's own file where it has the figures, otherwise a default (${ex.k} of ${ex.n} SOEs use at least one default)` },
      { label: "Growth of GDP", changed: S.growth !== d.growth, value: `${fmt(S.growth * 100, 1)}% a year, for the share of GDP in later years` },
    ];
  };
  SV.changed = () => SV.assumptions().filter((a) => a.changed).length;

  /* ===== SIMPLE VIEW · B · overview page ===== */
  // Reads top to bottom: your data → pick a scenario → the answer (sentence, chart, one row per SOE) → the assumptions.
  // No local-currency amount outside the Assumptions fold and the CSV: costs are shares of GDP. Every figure comes from SV
  // (section A). GDP reuses the Analyst routine (gdpFetch, gdpCurrencyStatus) and is stored in S.gdp / S.gdpSrc exactly
  // as the Analyst GDP field stores it, so both views show the same GDP.
  const svCountry = (c) => GDP_COUNTRIES.find((x) => x[0] === c) || [c, c, null];
  const svBy = (run) => (run.year ? `by ${run.year}` : `in ${run.H} years`);
  const svNum = (v) => v !== null && v !== undefined && ok(v);
  /** the World Bank series in the statements' currency, as the Analyst GDP field picks it by default */
  const svSeries = () => (stmtCurrency() === "USD" ? "CD" : "CN");
  const svGdpYear = () => String(last(S.years));
  /** a section heading with its step number */
  const svHead = (n, id, title, sub) => el("div", { class: "sv-head" },
    n ? el("span", { class: "sv-n num", "aria-hidden": "true" }, String(n)) : null,
    el("div", {}, el("h3", { id }, title), sub ? el("p", { class: "sv-sub" }, sub) : null));
  /** opens the Analyst view where the reader left it, as the header's mode button does */
  const svAnalyst = (label) => el("a", { href: "#view-home", onclick: (e) => { e.preventDefault(); showTab(S.lastAnalyst || "home"); window.scrollTo({ top: 0 }); } }, label);

  const SV_STATE_ROW = "Share of the loss the State bears"; // the row of SV.assumptions() the State's-share doubt sits under

  pages.simple = {
    build(root) {
      const U = (this.U = {});
      // 1. your data
      U.file = el("input", { type: "file", id: "sv-file", accept: ".csv,.xlsx,.xls,.txt", hidden: true, "aria-label": "Upload SOE financial statements, CSV or Excel" });
      U.msg = el("div", { class: "lp-msg sv-msg" });
      U.file.addEventListener("change", () => { const f = U.file.files[0]; if (f) readUpload(f, U.msg); U.file.value = ""; });
      const tplLabel = canDownload ? "Download the template" : "Copy the template";
      const tpl = el("button", { type: "button", class: "sv-link" }, tplLabel);
      tpl.addEventListener("click", async () => { // the same CSV as Home's "Template (CSV)"
        if (canDownload) { download("soe_tool_template.csv", templateCSV()); return; }
        try { await navigator.clipboard.writeText(templateCSV()); tpl.textContent = "Copied"; setTimeout(() => (tpl.textContent = tplLabel), 1500); } catch (e) { showTab("about"); }
      });
      U.summary = el("p", { id: "sv-summary", class: "sv-summary" });
      U.gdpSel = el("div", { class: "sv-gdp-sel" });
      U.gdp = el("div", { class: "sv-gdp-box" });
      U.typed = el("input", { type: "text", inputmode: "decimal", id: "sv-gdp-typed", autocomplete: "off" });
      U.typedErr = el("small", { class: "sv-gdp-err", role: "alert" });
      U.typed.addEventListener("change", () => this.typedGdp());
      U.typedLbl = el("label", { for: "sv-gdp-typed" });
      U.gdpLine = el("div", { class: "sv-gdp-line" });
      U.typedBox = el("div", { class: "fld sv-gdp-typed", hidden: true }, U.typedLbl, U.typed, U.typedErr); // kept in place so it keeps focus
      U.gdp.append(U.gdpLine, U.typedBox);
      U.loaded = el("div", { class: "sv-loaded" });
      U.examples = el("div");
      const data = el("section", { id: "sv-data", class: "card sv-sec sv-data", "aria-labelledby": "sv-h-data" },
        el("div", { class: "sv-data-top" },
          el("div", { class: "sv-data-what" }, svHead(1, "sv-h-data", "Your data"), U.summary),
          el("div", { class: "sv-data-act" }, el("button", { type: "button", class: "btn primary", onclick: () => U.file.click() }, "Upload your file"), tpl, U.file)),
        el("div", { class: "sv-gdp-row" }, U.gdpSel, U.gdp),
        U.loaded, U.msg, U.examples);
      data.addEventListener("dragover", (e) => { e.preventDefault(); data.classList.add("over"); });
      data.addEventListener("dragleave", (e) => { if (!data.contains(e.relatedTarget)) data.classList.remove("over"); });
      data.addEventListener("drop", (e) => { e.preventDefault(); data.classList.remove("over"); if (e.dataTransfer.files[0]) readUpload(e.dataTransfer.files[0], U.msg); });
      // 2. scenario
      U.scen = el("div", { id: "sv-scen", class: "sv-cards", role: "group", "aria-label": "Scenario" });
      U.scenLine = el("p", { class: "sv-line" });
      const scen = el("section", { class: "sv-sec sv-scen", "aria-labelledby": "sv-h-scen" },
        svHead(2, "sv-h-scen", "Scenario", "Pick what could go wrong. The bar on each card shows how much that shock adds to what your SOEs could cost the budget."), U.scen, U.scenLine);
      // 3. answer: the sentence, the portfolio chart, one row per SOE (each opens a snapshot below it), the tools
      U.big = el("div", { id: "sv-big", class: "sv-answer", "aria-live": "polite" });
      U.chart = el("div", { id: "sv-chart", class: "chart sv-chart" });
      U.cap = el("p", { class: "sv-cap" });
      U.fig = el("figure", { class: "sv-pfig" }, el("figcaption", { class: "sv-fig-t" }, "Cost to the budget, % of GDP"), U.chart, U.cap);
      U.hint = el("p", { class: "sv-hint" });
      U.rows = el("div", { id: "sv-rows", class: "sv-rows" });
      U.tools = el("div", { class: "btn-row sv-tools" });
      U.ans = el("section", { id: "sv-ans", class: "card sv-sec sv-ans", "aria-labelledby": "sv-h-ans" }, svHead(3, "sv-h-ans", "Answer"), U.big, U.fig, U.hint, U.rows, U.tools);
      // 4. assumptions, 5. links
      U.assume = el("div");
      const links = el("nav", { class: "sv-links", "aria-label": "More" }, go("how", "How this works"), svAnalyst("Analyst view"));
      root.replaceChildren(el("div", { class: "sv" },
        pageHead("Simple view", "What could your SOEs cost the budget?", "Load the accounts, pick a scenario, read the answer. A first screen, not a forecast."),
        data, scen, U.ans, U.assume, links));
    },
    render() {
      this.renderData();
      this.renderScen();
      this.renderAnswer();
      this.renderAssume();
    },

    /* ---------- 1. your data ---------- */
    renderData() {
      const U = this.U, yrs = S.years.length > 1 ? `${S.years[0]}–${last(S.years)}` : String(S.years[0] ?? "");
      put(U.summary, el("b", {}, S.label || "Loaded data"), el("span", { class: "sv-facts" }, [pl(S.names.length, "SOE"), yrs].filter(Boolean).join(" · ")));
      // after an upload: Home's confirmation line and its column-mapping fold
      put(U.loaded, S.key === "upload" && S.uploadNote ? el("p", { class: "lp-loaded" }, S.uploadNote) : null, S.mapping ? mappingDetails(S.mapping) : null);
      // the built-in datasets, under the labels Home uses
      const copyOf = DATASETS.report ? ["sample", "demo", "long"].find((k) => DATASETS[k] && DATASETS[k].label === DATASETS.report.label) : null;
      const active = S.key === "report" && copyOf ? copyOf : S.key;
      const ds = (key, label, sub) => DATASETS[key] ? el("button", { type: "button", class: "chip sv-ds", "aria-pressed": String(active === key),
        onclick: () => loadDataset(DATASETS[key].rows, DATASETS[key].label, DATASETS[key].example, key) }, label, el("small", {}, sub)) : null;
      put(U.examples, fold(S.simple.open, "examples", "Try example data", [el("div", { class: "sv-ex" },
        DATASETS.report && !copyOf ? ds("report", "Report data", DATASETS.report.label) : null,
        ds("sample", "Example", "SOE A and B, 2020–2024"), ds("demo", "Demo portfolio", "8 SOEs in 7 sectors"), ds("long", "Long panel", "30 SOEs, 20 years"))]));
      this.renderCountry();
      this.renderGdp();
    },
    /** the country for the share of GDP, without asking: the file's Country column, the one country of the accounts'
        currency, or Senegal for the built-in example data (flagged as assumed); else the drop-down */
    autoCountry() {
      const dc = dataCountry();
      if (dc) return { country: dc, how: "file" };
      const cc = countryFromCurrency();
      if (cc) return { country: cc, how: "currency" };
      const copyOf = S.key === "report" && DATASETS.report ? ["sample", "demo", "long"].find((k) => DATASETS[k] && DATASETS[k].label === DATASETS.report.label) : null;
      if (["sample", "demo", "long"].includes(copyOf || S.key)) return { country: "SEN", how: "assumed" };
      return { country: "", how: "choose" };
    },
    /** the country is set from the auto rule (drop-down hidden behind "change"), unless the reader chose one */
    renderCountry() {
      const U = this.U, st = S.simple, auto = this.autoCountry();
      const manual = !!(st.gdpManual || (S.gdpCountry && S.gdpCountry !== auto.country));
      if (auto.country && !manual && S.gdpCountry !== auto.country) {
        if (S.gdpSrc && S.gdpSrc.kind !== "manual") { S.gdp = null; S.gdpSrc = null; }
        S.gdpCountry = auto.country;
      }
      st.gdpAssumed = !!auto.country && !manual && auto.how === "assumed";
      const show = !auto.country || st.gdpChange || manual;
      U.gdpSel.hidden = !show;
      if (!show) { put(U.gdpSel); return; }
      const opts = [["", "Select a country…"], ...GDP_COUNTRIES.slice().sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => [c, n])];
      put(U.gdpSel, fSelect("Country (for the share of GDP)", opts, S.gdpCountry || "", (v) => this.pickCountry(v), { id: "sv-country" }));
    },
    pickCountry(v) {
      S.simple.gdpManual = true;
      S.gdpCountry = v;
      if (S.gdpSrc && S.gdpSrc.kind !== "manual" && S.gdpSrc.country !== v) { S.gdp = null; S.gdpSrc = null; }
      if (v) this.lookup(true);
      this.gdpChanged();
    },
    /** GDP for the latest year in the data, in the statements' currency, stored as the Analyst field stores it: from the
        saved IMF table at once (the nearest earlier year when the latest is missing), else from the World Bank, asynchronously */
    lookup(force) {
      const st = S.simple, country = S.gdpCountry, year = svGdpYear(), series = svSeries();
      if (!country) return;
      const key = gdpKey(series, country, year);
      st.gdpTry = st.gdpTry || {};
      if (!force && (S.gdp || st.gdpTry[key])) return;
      st.gdpKey = key;
      const cur = series === "CD" ? "USD" : svCountry(country)[2] || null;
      const take = (o) => {
        st.gdpTry[key] = o;
        if (o.s === "ok") { const r = o.res; S.gdp = r.value / SC; S.gdpSrc = r; S.gdpCountry = r.country; S.gdpYear = r.year; S.gdpSeries = r.series; }
        else if (S.gdpSrc && S.gdpSrc.kind !== "manual") { S.gdp = null; S.gdpSrc = null; }
      };
      const tab = gdpTable(series, country, year);
      if (tab) {
        const res = { kind: "weo", series, country, year: tab.year, value: tab.value, cur };
        take(gdpCurrencyStatus(cur) === "mismatch" ? { s: "mismatch", res } : { s: "ok", res });
        return;
      }
      st.gdpTry[key] = { s: "busy" };
      const done = (o) => {
        if (S.simple !== st) return; // the data changed meanwhile
        st.gdpTry[key] = o;
        if (st.gdpKey !== key) return; // another country was chosen meanwhile
        take(o);
        if (S.tab === "simple") this.gdpChanged();
      };
      gdpFetch(series, country, year).then((value) => {
        if (!(value > 0)) { done({ s: "none" }); return; }
        const res = { kind: "wb", series, country, year, value, cur };
        done(gdpCurrencyStatus(res.cur) === "mismatch" ? { s: "mismatch", res } : { s: "ok", res });
      }, () => done({ s: "fail" }));
    },
    typedGdp() {
      const U = this.U, t = U.typed.value.trim(), v = E.parseNumber(t);
      U.typedErr.textContent = "";
      if (!t) { if (S.gdpSrc && S.gdpSrc.kind === "manual") { S.gdp = null; S.gdpSrc = null; this.gdpChanged(); } return; }
      if (!(Number.isFinite(v) && v > 0)) { U.typedErr.textContent = "Type GDP as a positive number."; return; }
      S.gdp = (v * gdpUnitSize("billion")) / SC; S.gdpSrc = { kind: "manual" }; // as the Analyst field stores a typed GDP in billions
      this.gdpChanged();
    },
    gdpChanged() { this.renderGdp(); this.renderScen(); this.renderAnswer(); this.renderAssume(); },
    /** the GDP line (#sv-gdp) and, when the lookup cannot give a usable figure, one typed-GDP box. It never prints the amount. */
    renderGdp() {
      const U = this.U, st = S.simple, year = svGdpYear(), country = S.gdpCountry;
      this.lookup(false);
      const src = S.gdpSrc; // read after the lookup, which fills it from the saved table at once
      const tr = country ? (st.gdpTry || {})[gdpKey(svSeries(), country, year)] : null;
      const cname = svCountry(country)[1];
      const line = el("p", { id: "sv-gdp", class: "sv-gdp", "data-v": S.gdp ? S.gdp * SC : "", "data-country": S.gdp ? country || "" : "",
        "data-year": S.gdp && src && src.year ? String(src.year) : "", "data-src": S.gdp && src ? src.kind : "" });
      const lbl = el("span", { class: "sv-gdp-lbl" }, "GDP");
      const change = this.autoCountry().country && !st.gdpChange && !st.gdpManual && country === this.autoCountry().country
        ? [" ", el("button", { type: "button", class: "sv-link", id: "sv-gdp-change", onclick: () => { st.gdpChange = true; this.renderCountry(); } }, "change")] : [];
      let typed = false;
      if (S.gdp && src && (src.kind === "wb" || src.kind === "weo")) {
        const same = gdpCurrencyStatus(src.cur) === "match", sn = svCountry(src.country)[1], yr = String(src.year), ya = last(S.years), sname = gdpSourceName(src);
        put(line, st.gdpAssumed ? `Example data: shares of GDP use the GDP of ${sn} for ${yr}, for illustration (${sname}).` : `Shares of GDP use the GDP of ${sn} for ${yr} (${sname}).`,
          Number(yr) < ya ? ` The latest GDP available is for ${yr}; your accounts end in ${ya}.` : null,
          same || st.gdpAssumed ? null : src.forced ? ` In ${gdpCurName(src.cur)}, not in the accounts' currency.` : ` Check that your accounts are in ${gdpCurName(src.cur)}.`, ...change);
      } else if (S.gdp) {
        put(line, "Shares of GDP use the GDP you typed.");
        typed = true;
      } else if (!country) {
        put(line, "Choose the country to see the results.");
      } else if (!tr || tr.s === "busy") {
        put(line, lbl, " ", el("span", { class: "muted" }, `Looking up ${cname}, ${year}…`), ...change);
      } else {
        const r = tr.res;
        put(line, lbl, " ",
          tr.s === "none" ? `The World Bank has no GDP for ${cname} in ${year}. Type it below to see the share of GDP.`
            : tr.s === "mismatch" ? `The GDP of ${cname} is in ${gdpCurName(r.cur)}, your accounts are in ${CUR}. Type GDP in ${CUR} below.`
            : "Couldn't reach the World Bank (no internet, or the site is down). Type GDP below to see the share of GDP.", ...change);
        typed = true;
      }
      if (typed && document.activeElement !== U.typed) U.typed.value = src && src.kind === "manual" && S.gdp ? gdpNumber((S.gdp * SC) / gdpUnitSize("billion")) : "";
      put(U.gdpLine, line);
      U.typedLbl.textContent = `GDP in ${year}, in billions of ${CUR || "the accounts' currency"}`;
      U.typedBox.hidden = !typed;
    },
    /** what to do to see the share of GDP */
    gdpHint() {
      const tr = S.gdpCountry ? (S.simple.gdpTry || {})[gdpKey(svSeries(), S.gdpCountry, svGdpYear())] : null;
      if (tr && tr.s === "busy") return "looking up GDP to show the share of GDP";
      return tr || dataCountry() ? "type GDP above to see the share of GDP" : "choose a country to see the share of GDP";
    },

    /* ---------- 2. scenario ---------- */
    /** eight cards: name, size line and one bar. All bars share one scale (the largest share of GDP = 100%), so the
        cards compare by eye; without GDP the bars use the cost itself. The figure is in the tooltip only. */
    /** One card per scenario: name, size, and a bar for what the shock ADDS to the cost at the horizon, on top of the
        no-shock cost (most of every total is there with no shock at all, so bars of the totals would all look alike).
        All bars share one scale; the no-shock card is the starting point and has no bar. No figure in the card text. */
    renderScen() {
      const U = this.U, run0 = SV.run("none"), by = svBy(run0), hasGdp = svNum(run0.futGdp), scs = SV.scenarios();
      const runs = scs.map((s) => SV.run(s.key)), m = runs.map((r) => (hasGdp ? r.futGdp : r.futTotal));
      const base = hasGdp ? run0.futGdp : run0.futTotal, add = m.map((v) => (ok(v) && ok(base) ? v - base : null));
      const top = Math.max(0, ...add.filter(ok));
      put(U.scen, scs.map((s, j) => {
        const r = runs[j], none = s.key === "none", a = add[j], w = !none && top > 0 && ok(a) ? Math.max(0, (a / top) * 100) : 0;
        const same = ok(a) && ok(base) && Math.abs(a) < Math.abs(base) * 0.0005;
        const say = `${s.name}, ${s.size}` + (!hasGdp ? "" : `: ${pctS(r.futGdp)} of GDP ${by}` +
          (none ? "" : same ? ", about the same as with no shock" : a > 0 ? `; the shock adds ${pctS(a)} of GDP` : `; ${pctS(-a)} of GDP less than with no shock`));
        return el("button", { type: "button", class: "sv-card", "data-scen": s.key, "data-v": r.futTotal, "data-share": hasGdp ? r.futGdp : "",
          "data-add": none || !ok(a) ? "" : a, title: say, "aria-label": say, "aria-pressed": String(s.key === S.simple.scen), onclick: () => this.pick(s.key) },
          el("span", { class: "sv-card-name" }, s.name),
          el("span", { class: "sv-card-size" }, s.size),
          none ? el("span", { class: "sv-card-base" }, "the starting point")
            : el("span", { class: "sv-card-bar", "aria-hidden": "true" }, el("i", { style: `width:${w.toFixed(2)}%` })));
      }));
      U.scenLine.textContent = `Each shock lasts ${SV.D()} years. The bars compare the added cost ${run0.year ? `in ${run0.year}, ` : ""}${SV.H()} years after the latest accounts.`;
    },
    pick(key) {
      S.simple.scen = key;
      this.U.scen.querySelectorAll("button[data-scen]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scen === key)));
      this.renderAnswer();
      this.renderAssume(); // the State's-share sentence follows the scenario
    },

    /* ---------- 3. answer ---------- */
    /** the sentence (shares of GDP only), the portfolio chart and its caption, one row per SOE, the tools. Without GDP
        there is no result: the answer area asks for the country. */
    renderAnswer() {
      const U = this.U, st = S.simple, run = SV.run(st.scen), n = run.items.length, by = svBy(run);
      const hasGdp = svNum(run.futGdp) && svNum(run.nowGdp);
      st.snap = st.snap || {}; // SOEs whose snapshot is open (S.simple.open holds fold states)
      U.ans.setAttribute("data-scen", run.key);
      U.ans.setAttribute("data-now-total", run.nowTotal);
      U.ans.setAttribute("data-fut-total", run.futTotal);
      [U.fig, U.hint, U.rows, U.tools].forEach((e) => (e.hidden = !hasGdp));
      if (!hasGdp) {
        U.ans.setAttribute("data-empty", "1");
        put(U.big, el("p", { class: "sv-big sv-empty" }, "Choose the country to see the results."));
        put(U.chart); U.chart.removeAttribute("data-series"); put(U.rows); put(U.tools);
        return;
      }
      U.ans.removeAttribute("data-empty");
      const lead = run.key === "none" ? "With no shock" : `Under “${run.name}”`;
      put(U.big,
        el("p", { class: "sv-big" }, `${lead}, your ${pl(n, "SOE")} could cost the budget `,
          el("b", { class: "num", "data-k": "fut-share", "data-v": run.futGdp }, `${pctS(run.futGdp)} of GDP`), ` ${by}.`),
        el("p", { class: "sv-big-sub" }, "From the latest accounts, the cost today is ",
          el("span", { class: "num", "data-k": "now-share", "data-v": run.nowGdp }, `${pctS(run.nowGdp)} of GDP`), "."));
      // the portfolio chart (fig is visible now, so the chart helper can measure its width)
      const p = SV.paths(run.key), size = (lv) => (p.series.find((s) => s.level === lv) || {}).size || "";
      svCostChart(U.chart, p, null);
      U.cap.textContent = p.none ? "Pick a scenario above to see how a shock, and its size, changes this line."
        : `Milder: ${size("mild")}. As assumed: ${size("standard")}. More severe: ${size("severe")}. These are the tool's own guide sizes for this shock; they show how much the answer depends on the size of the shock, not how likely each size is. The cost moves in steps: it rises when a shock pushes an SOE down a rating step.`;
      // one row per SOE, largest first; the bar shares one scale across all rows
      U.hint.textContent = "Largest first. Select an SOE to see why.";
      const w = SV.warnings(), top = Math.max(0, ...run.items.map((i) => (ok(i.fut) ? i.fut : 0)));
      const draws = [];
      const rows = clipRows(run.items, st.all).map((it, i) => {
        const id = `sv-snap-${i}`, open = !!st.snap[it.name], share = it.fut / run.gdpH;
        const panel = el("div", { class: "sv-snap", id, role: "region", "aria-label": `${it.name}, snapshot`, hidden: open ? null : true });
        const btn = el("button", { type: "button", class: "sv-row-btn", "aria-expanded": String(open), "aria-controls": id, "data-now": it.now, "data-fut": it.fut },
          el("span", { class: "sv-row-car", "aria-hidden": "true" }),
          el("span", { class: "sv-row-name" }, el("b", {}, it.name), el("small", {}, it.r.Sector)),
          el("span", { class: "sv-row-zone", "data-k": "zone", "data-v": it.zoneNow }, zoneChip(it.zoneNow)),
          el("span", { class: "sv-row-bar", "aria-hidden": "true" }, el("i", { style: `width:${top > 0 && ok(it.fut) ? ((it.fut / top) * 100).toFixed(2) : 0}%` })),
          el("span", { class: "sv-row-val num", "data-k": "fut-share", "data-v": share }, `${pctS(share)} of GDP`));
        btn.addEventListener("click", () => {
          const on = btn.getAttribute("aria-expanded") !== "true";
          if (on) st.snap[it.name] = true; else delete st.snap[it.name];
          btn.setAttribute("aria-expanded", String(on));
          panel.hidden = !on;
          if (on) this.fillSnap(panel, it, run, w); // drawn when shown: the chart helper measures the box
        });
        if (open) draws.push(() => this.fillSnap(panel, it, run, w));
        return el("div", { class: "sv-row", "data-soe": it.name }, btn, panel);
      });
      put(U.rows, el("div", { class: "sv-rows-head" }, el("span", {}, "SOE"), el("span", {}, "Health now"), el("span", {}, `Cost to the budget ${by}`)), rows);
      draws.forEach((f) => f()); // open snapshots stay open and follow the scenario
      // CSV: both units (share of GDP and local currency); the one place besides the Assumptions fold with amounts
      const pc = (v) => (svNum(v) ? +(v * 100).toPrecision(6) : ""), lc = (v) => (ok(v) ? Math.round(v * SC) : "");
      const cur = CUR || "local currency", yr = run.year || `+${run.H} years`;
      const csv = () => toCSV(["SOE", "Sector", "Health now", "Scenario", "Cost today (% of GDP)", `Cost by ${yr} (% of GDP)`, `Cost today (${cur})`, `Cost by ${yr} (${cur})`, "Warnings"],
        run.items.map((it) => { const wv = w.by[it.name] || { level: "ok", rules: [] };
          return [it.name, it.r.Sector, ZLABEL[zk(it.zoneNow)] || it.zoneNow, run.name, pc(it.now / S.gdp), pc(it.fut / run.gdpH), lc(it.now), lc(it.fut), wv.rules.filter((r) => r !== "routine").length]; }));
      put(U.tools, moreToggle(n, st.all, (v) => { st.all = v; this.renderAnswer(); }, `Show the ${LIMIT} largest only`), dataButtons(csv, `soe_cost_${run.key}.csv`));
    },
    /** the snapshot under a row: the reason in one sentence, the distress score chart, this SOE's cost chart, warnings */
    fillSnap(panel, it, run, w) {
      const r = it.r, name = it.name, wv = w.by[name] || { level: "ok", rules: [] }, nr = wv.rules.filter((id) => id !== "routine").length;
      const zl = String(ZLABEL[zk(r.Zone)] || r.Zone).toLowerCase().replace(/ zone$/, ""), why = distressWhy(r);
      const score = el("div", { class: "chart sv-snap-score" }), cost = el("div", { class: "chart sv-snap-cost" });
      put(panel,
        el("p", { class: "sv-snap-why" }, ok(r.Z_EM) ? `${name} is in the ${zl} zone${why ? ", " + why : ""}.` : `${name}: the accounts do not have enough figures to work out a distress score.`),
        el("div", { class: "sv-snap-figs" },
          el("figure", { class: "sv-snap-fig" }, el("figcaption", {}, el("span", { class: "sv-fig-t" }, "Distress score (Altman Z-score)"),
            el("span", { class: "sv-fig-sub" }, run.key === "none" ? "Solid: past years. Dashed: the years ahead with no shock." : `Solid: past years. Dashed: under “${run.name}”.`)), score),
          el("figure", { class: "sv-snap-fig" }, el("figcaption", {}, el("span", { class: "sv-fig-t" }, "Cost to the budget, % of GDP")), cost)),
        el("div", { class: "sv-snap-foot" },
          el("span", { class: "sv-snap-warn", "data-k": "warn", "data-v": nr, "data-level": wv.level }, stChip(wv.level), el("span", {}, nr ? pl(nr, "warning") : "no warnings")),
          el("a", { class: "sv-more", href: "#view-soe", "data-soe": name, onclick: (e) => { e.preventDefault(); S.simple.soe = name; showTab("soe"); window.scrollTo({ top: 0 }); } }, `More about ${name} →`)));
      svScoreChart(score, SV.score(name, run.key), run);
      svCostChart(cost, SV.paths(run.key), name);
    },

    /* ---------- 4. assumptions ---------- */
    /** the doubt about the share of the loss the State bears, shown under that assumption (it is not doubt about the scenario) */
    stateLines() {
      const g = SV.stateRange(S.simple.scen), run = SV.run(S.simple.scen), m = Object.keys(g.by).length, has = svNum(g.loGdp) && svNum(g.hiGdp);
      return el("div", { class: "sv-asm-state" },
        has ? el("p", {}, `If the State bore the low or the high share for each SOE's sector (from past defaults on public loans), the cost ${svBy(run)} would be between `,
          el("b", { class: "num", "data-k": "state-lo", "data-v": g.loGdp }, pctS(g.loGdp)), " and ", el("b", { class: "num", "data-k": "state-hi", "data-v": g.hiGdp }, `${pctS(g.hiGdp)} of GDP`), ".")
          : el("p", {}, "Choose the country to see the results."),
        g.above.length ? el("p", { class: "sv-above" }, `For ${g.above.length} of ${m} SOEs the low figure for their sector is above the ${fmt(g.share * 100, 0)}% assumed.`) : null);
    },
    /** the GDP behind every share: the one local-currency amount on this page, inside the closed fold */
    gdpRow() {
      const src = S.gdpSrc;
      if (!S.gdp) return { label: "GDP", changed: false, value: "Choose the country to see the results." };
      if (!src || src.kind === "manual") return { label: "GDP", changed: false, value: `${money(S.gdp, true)} in ${svGdpYear()}, typed in` };
      return { label: "GDP", changed: false, value: `${money(S.gdp, true)} in ${src.year}, ${svCountry(src.country)[1]} (${gdpSourceName(src)})` + (S.simple.gdpAssumed ? ", for illustration" : "") };
    },
    renderAssume() {
      const st = S.simple, n = SV.changed();
      const d = el("details", { id: "sv-assume", class: "card sv-assume", open: st.open.assume ? true : null },
        el("summary", {}, el("span", { class: "sv-assume-t" }, "Assumptions behind these numbers"),
          el("span", { id: "sv-changed", class: "st watch", hidden: n ? null : true }, `${n} changed in Analyst view`)),
        el("dl", { class: "sv-asm" }, [...SV.assumptions(), this.gdpRow()].map((a) => el("div", { class: "sv-asm-row" + (a.changed ? " changed" : "") },
          el("dt", {}, a.label), el("dd", {}, a.value, a.changed ? el("span", { class: "sv-tag" }, "changed") : null,
            a.label === SV_STATE_ROW ? this.stateLines() : null)))),
        el("p", { class: "note" }, "These can be changed in the Analyst view. Changes made there show here. ", svAnalyst("Open the Analyst view")));
      d.addEventListener("toggle", () => { st.open.assume = d.open; });
      put(this.U.assume, d);
    },
  };

  /* ===== SIMPLE VIEW · charts shared by the Overview and the One-SOE page ===== */
  /** y-axis label for a share of GDP (a fraction): as many decimals as the tick step needs, so neighbouring ticks
      always differ (per-SOE shares can be millionths of a percent, the portfolio about half a percent) */
  function svPctTick(t, step) {
    if (!ok(t)) return "—";
    if (!(step > 0)) return svPctTip(t);
    if (t === 0 || Math.abs(t) < step / 1e6) return "0%";
    const s = step * 100; // the step in percentage points; nice() steps are 1, 2, 2.5 or 5 times a power of ten
    let d = 0;
    while (d < 12 && Math.abs(Math.round(s * 10 ** d) - s * 10 ** d) > 1e-6 * Math.max(1, s * 10 ** d)) d++;
    return fmt(t * 100, d) + "%";
  }
  /** a share for a tooltip: as pctS, but tiny shares get two significant digits instead of "< 0.01%" */
  function svPctTip(v) {
    if (!ok(v)) return "—";
    const a = Math.abs(v * 100);
    if (a === 0 || a >= 0.01) return pctS(v);
    return fmt(v * 100, Math.min(12, Math.ceil(-Math.log10(a)) + 1)) + "%";
  }
  /** lines(), drawn again with a wider left margin when the y-axis labels need it (long labels for tiny shares) */
  function svLines(box, xs, series, opt) {
    lines(box, xs, series, opt);
    const L = opt.L || 50, svg = box.querySelector("svg");
    let wd = 0;
    if (svg) svg.querySelectorAll('text[text-anchor="end"]').forEach((t) => { if (+t.getAttribute("x") === L - 6) wd = Math.max(wd, t.getComputedTextLength()); });
    if (wd > L - 10) lines(box, xs, series, Object.assign({}, opt, { L: Math.ceil(wd) + 12 }));
  }
  /** two right-hand labels of lines() (threshold lines) pushed apart when the cut-offs sit close on the axis */
  function svSpread(box, upper, lower, gap = 13) {
    const ts = [...box.querySelectorAll("svg text")], a = ts.find((t) => t.textContent === upper), b = ts.find((t) => t.textContent === lower);
    if (!a || !b) return;
    const ya = +a.getAttribute("y"), yb = +b.getAttribute("y");
    if (yb - ya >= gap) return;
    const mid = (ya + yb) / 2;
    a.setAttribute("y", mid - gap / 2); b.setAttribute("y", mid + gap / 2);
  }
  /** line style and legend label of each level of the size guide; "As assumed" is the heavy line */
  const SV_LN = { none: ["sv-ln-none", "No shock", "with no shock"], mild: ["sv-ln-mild", "Milder", "milder"],
    standard: ["sv-ln-std", "As assumed", "as assumed"], severe: ["sv-ln-sev", "More severe", "more severe"] };
  const svLg = (cls) => `<svg width="28" height="10" aria-hidden="true"><line x1="2" y1="5" x2="26" y2="5" class="${cls}"/></svg>`;
  /** Cost to the budget as a share of GDP, year by year from the latest accounts to the horizon: no shock and, when a
      scenario is chosen, its milder, assumed and more severe size. p = SV.paths(key); name = an SOE, or null for the
      portfolio. The assumed size is the heavy line, drawn last (on top where lines overlap) and the only one with an
      end label; with no shock chosen, the no-shock line takes that role. A legend goes just before the box. */
  function svCostChart(box, p, name) {
    const of = (s) => (name ? (s.by[name] || {}).share || [] : s.share || []).map((v) => (ok(v) ? v : null));
    const ser = p.series.map((s) => ({ level: s.level, vals: of(s) })), data = { labels: p.labels };
    ser.forEach((s) => (data[s.level] = s.vals));
    box.dataset.series = JSON.stringify(data);
    const main = ser.find((s) => s.level === "standard") || ser[0], cls = (s) => (s === main ? "sv-ln-std" : SV_LN[s.level][0]);
    const end = (s) => { const v = s.vals.filter(ok); return v.length ? last(v) : null; };
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", `${name ? `${name}: cost` : "Cost"} to the budget as a share of GDP, ${p.labels[0]} to ${last(p.labels)}: ` + ser.map((s) => `${SV_LN[s.level][2]} ${pctS(end(s))}`).join(", "));
    const lg = legendRow(ser.map((s) => legendItem(svLg(cls(s)), SV_LN[s.level][1])), "top sv-lg"), prev = box.previousElementSibling;
    if (prev && prev.classList.contains("sv-lg")) prev.replaceWith(lg); else if (box.parentNode) box.before(lg);
    if (!ser.some((s) => s.vals.some((v) => v > 0))) { put(box, el("p", { class: "sv-wait" }, ser.some((s) => s.vals.some(ok)) ? "No cost to the budget on these lines." : "Choose the country to see the results.")); return; }
    const order = ser.filter((s) => s !== main).concat(main), W = widthOf(box);
    svLines(box, p.labels, order.map((s) => ({ vals: s.vals, cls: cls(s), dot: s === main ? "now" : null, label: SV_LN[s.level][1] })), {
      h: name ? 200 : W < 520 ? 220 : 270, R: name ? 60 : 66, zeroFloor: true, maxDots: 1, yFmt: svPctTick, // maxDots 1: dot the last point only
      xLab: (i) => (p.year ? p.labels[i] : i ? `+${i}` : "latest"),
      tipTitle: (i) => (name ? `${name} · ${p.labels[i]}` : String(p.labels[i])),
      tip: (i) => ser.map((s) => [svPctTip(s.vals[i]), SV_LN[s.level][1]]),
      endLabel: { series: order.length - 1, fmt: pctS } });
  }
  /** the distress score of one SOE on one x-axis: past years solid, the path under the scenario dashed from the latest
      accounts on, zones shaded, both cut-offs labelled. sc = SV.score(name, key), run = SV.run(key). */
  const svZone = (z) => ({ Safe: "safe zone", Grey: "grey zone", Distress: "distress zone" })[z] || "no zone";
  function svScoreChart(box, sc, run) {
    const zv = (q) => (q && ok(q.z) ? q.z : null);
    box.dataset.series = JSON.stringify({ hist: { years: sc.hist.map((q) => q.year), z: sc.hist.map(zv) }, proj: { years: sc.proj.map((q) => q.year), z: sc.proj.map(zv) },
      safe: CFG.Z_SAFE_CUTOFF, distress: CFG.Z_DISTRESS_CUTOFF });
    const years = uniq([...sc.hist, ...sc.proj].map((q) => q.year)).sort((a, b) => a - b);
    const at = (arr) => { const m = new Map(arr.map((q) => [q.year, q])); return years.map((y) => m.get(y)); };
    const Hq = at(sc.hist), Pq = at(sc.proj), hv = Hq.map(zv), pv = Pq.map(zv);
    const under = run.key === "none" ? "with no shock" : `under “${run.name}”`;
    const lh = sc.hist.filter((q) => ok(q.z)), lp = sc.proj.filter((q) => ok(q.z));
    const cut = `Safe above ${fmt(CFG.Z_SAFE_CUTOFF, 2)}, distress below ${fmt(CFG.Z_DISTRESS_CUTOFF, 2)}.`;
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", `Distress score (Altman Z-score), ${years[0]} to ${last(years)}: ` +
      [lh.length ? `${fmt(last(lh).z, 2)} in ${last(lh).year} (${svZone(last(lh).zone)})` : "no score in the accounts",
        lp.length > 1 ? `${fmt(last(lp).z, 2)} in ${last(lp).year} ${under} (${svZone(last(lp).zone)})` : null].filter(Boolean).join(", ") + ". " + cut);
    if (![...hv, ...pv].some(ok)) { put(box, el("p", { class: "sv-wait" }, "No distress score could be worked out for this SOE.")); return; }
    const W = widthOf(box);
    // the dashed path first, so the solid line's dot at the latest accounts stays on top
    lines(box, years, [{ vals: pv, cls: "sv-z-proj", dot: "prev", label: "Ahead" }, { vals: hv, cls: "sv-z-hist", dot: "now", label: "Past years" }], {
      h: 200, R: 94, zones: true, maxDots: 1, // R leaves room for "distress below"
      hlines: [{ y: CFG.Z_SAFE_CUTOFF, cls: "thr-warn sv-faint", label: "safe above", include: true }, { y: CFG.Z_DISTRESS_CUTOFF, cls: "thr-crit sv-faint", label: "distress below", include: true }],
      tipTitle: (i) => String(years[i]) + (Pq[i] && !Hq[i] ? ` · ${under}` : ""),
      tip: (i) => { const q = Hq[i] || Pq[i]; return q && ok(q.z) ? [[fmt(q.z, 2), "distress score"], [svZone(q.zone), ""]] : [["—", "no score"]]; } });
    svSpread(box, "safe above", "distress below");
  }

  /* ===== SIMPLE VIEW · C · one-SOE page ===== */
  // Reads top to bottom: what state is this SOE in → why (health checks, ratios) → what it could cost → what to do.
  // Every figure is read from the same places as the Overview (SV.run, SV.paths, SV.score, SV.warnings) and the Analyst tabs
  // (enriched rows, HEALTH/WHY/STRONG, kpiStatus, RULE_BY); nothing is typed in.
  const SV_SEV = { alert: 0, watch: 1, ok: 2 };
  /** the app's own texts, with the one technical label that a rule's follow-up text can carry put in plain words */
  const svPlain = (t) => String(t).replace(/Z″(-EM)?/g, "distress score");
  pages.soe = {
    build(root) {
      const U = (this.U = {});
      const back = () => { showTab("simple"); window.scrollTo({ top: 0 }); };
      U.back = el("button", { type: "button", class: "btn", id: "soe-back", onclick: back }, "← Back to all SOEs");
      U.prev = el("button", { type: "button", class: "btn", id: "soe-prev", onclick: () => this.step(-1) }, "← Previous");
      U.next = el("button", { type: "button", class: "btn", id: "soe-next", onclick: () => this.step(1) }, "Next →");
      U.pos = el("span", { class: "sv-pos", id: "soe-pos", "aria-live": "polite" });
      U.title = el("h2", { id: "soe-title" });
      U.sub = el("p", { id: "soe-sub" });
      const sec = (id, hid, title, sub) => { const body = el("div", { class: "sv-soe-body" }); return { body, root: el("section", { id, class: "card sv-sec", "aria-labelledby": hid }, svHead(null, hid, title, sub), body) }; };
      U.verdict = el("section", { id: "soe-verdict", class: "card sv-sec sv-verdict", "aria-label": "Verdict" });
      U.health = sec("soe-health", "soe-h-health", "Four health checks", "Each bar shows how much one check adds to (right) or takes from (left) the distress score. The longer the bar, the bigger the effect.");
      U.ratios = sec("soe-ratios", "soe-h-ratios", "Health ratios", "The latest accounts, read against the cut-offs the tool uses.");
      U.cost = sec("soe-cost", "soe-h-cost", "What it could cost the budget");
      U.actions = sec("soe-actions", "soe-h-actions", "What to do", "The follow-up the tool calls for, from this SOE's latest accounts.");
      U.links = sec("soe-links", "soe-h-links", "Look closer in Analyst view");
      U.links.root.classList.add("sv-soe-links");
      root.replaceChildren(el("div", { class: "sv sv-soe" },
        el("nav", { class: "sv-soe-nav", "aria-label": "SOE pages" }, U.back, el("div", { class: "sv-soe-step" }, U.prev, U.pos, U.next)),
        el("div", { class: "page-head" }, el("div", {}, el("div", { class: "eyebrow" }, "One SOE"), U.title, U.sub)),
        U.verdict, U.health.root, U.ratios.root, U.cost.root, U.actions.root, U.links.root));
    },
    /** the SOE shown: the reader's choice, else the one with the largest cost; order = the Overview table's */
    items() { return SV.run(S.simple.scen).items; },
    index() {
      const items = this.items(), st = S.simple;
      let i = items.findIndex((x) => x.name === st.soe);
      if (i < 0) { i = 0; st.soe = items[0] ? items[0].name : null; }
      return i;
    },
    step(d) {
      const items = this.items(), i = this.index() + d;
      if (i < 0 || i >= items.length) return;
      S.simple.soe = items[i].name;
      this.render();
      window.scrollTo({ top: 0 });
    },
    render() {
      const U = this.U, items = this.items();
      if (!items.length) { put(U.title, "No SOEs loaded"); put(U.sub); return; }
      const i = this.index(), it = items[i], r = it.r, name = it.name;
      this.cur = name;
      const hist = byYearAsc(allRows().filter((q) => q.Entity === name));
      put(U.title, name);
      put(U.sub, [r.Sector, ok(r.Year) ? `latest accounts: ${r.Year}` : ""].filter(Boolean).join(" · "));
      U.prev.disabled = i <= 0;
      U.next.disabled = i >= items.length - 1;
      put(U.pos, `${i + 1} of ${items.length}`);
      this.renderVerdict(it);
      this.renderHealth(it, hist);
      this.renderRatios(it, hist);
      this.renderCost(it);
      this.renderActions(it);
      this.renderLinks(it);
    },

    /* ---------- verdict ---------- */
    renderVerdict(it) {
      const r = it.r, zl = String(ZLABEL[zk(r.Zone)] || r.Zone).toLowerCase().replace(/ zone$/, ""), why = distressWhy(r);
      if (!ok(r.Z_EM)) { put(this.U.verdict, el("p", { class: "sv-big" }, `${it.name}: the accounts do not have enough figures to work out a distress score, so there is no zone or rating.`)); return; }
      put(this.U.verdict, el("p", { class: "sv-big" }, `${it.name} is in the ${zl} zone${why ? ", " + why : ""}. Its indicative rating is ${r.Rating || "n/a"}. `, zoneChip(r.Zone)));
    },

    /* ---------- four health checks, then the distress score chart ---------- */
    renderHealth(it, hist) {
      const U = this.U, r = it.r, ks = ["X1", "X2", "X3", "X4"], C = CFG.ZEM_COEFFICIENTS;
      const vals = ks.map((k) => r[k] * C[k]), mx = Math.max(1e-9, ...vals.filter(ok).map(Math.abs));
      const rows = ks.map((k, j) => {
        const v = vals[j], has = ok(v), w = has ? (Math.abs(v) / mx) * 50 : 0;
        const mean = !has ? "no figure for this check in the accounts" : v >= 0 ? `Good: ${STRONG[k]}` : `Weak: ${WHY[k]}`;
        return el("li", { class: "sv-hc-row", "data-check": HEALTH[k], "data-v": has ? v : "" }, // the bar and the words carry it: no figure shown
          el("span", { class: "sv-hc-name" }, HEALTH[k]),
          el("span", { class: "sv-hc-bar", role: "img", "aria-label": has ? `${HEALTH[k]}: ${sgn(v, 2)}` : `${HEALTH[k]}: no figure` },
            has ? el("i", { class: v >= 0 ? "pos" : "neg", style: v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%` }) : null),
          el("span", { class: "sv-hc-mean" }, mean));
      });
      U.scoreSub = el("span", { class: "sv-fig-sub" });
      U.score = el("div", { id: "soe-score", class: "chart" });
      put(U.health.body, el("ul", { class: "sv-hc", role: "list" }, rows),
        el("figure", { class: "sv-fig" }, el("figcaption", {}, el("span", { class: "sv-fig-t" }, "Distress score (Altman Z-score)"), U.scoreSub), U.score));
      this.drawScore(it);
    },
    /** the score chart follows the selected scenario */
    drawScore(it) {
      const U = this.U, run = SV.run(S.simple.scen);
      put(U.scoreSub, run.key === "none" ? "Solid: past years. Dashed: the years ahead with no shock." : `Solid: past years. Dashed: under “${run.name}”.`);
      svScoreChart(U.score, SV.score(it.name, run.key), run);
    },

    /* ---------- health ratios: one small chart card per ratio ---------- */
    renderRatios(it, hist) {
      const body = this.U.ratios.body;
      const avail = E.availableKpis(hist), keys = CFG.REPORT_HEADLINE_KPIS.filter((k) => avail.includes(k));
      if (!keys.length) { put(body, el("p", { class: "sv-wait" }, "The file has no figures for the ratios the tool reads, so none can be shown for this SOE.")); return; }
      const grid = el("div", { class: "sv-minis" }), minis = keys.map((k) => kpiMini(hist, k));
      grid.append(...minis);
      put(body, el("p", { class: "kpi-how" }, CFG.KPI_HOW_TO_READ), grid);
      minis.forEach((m) => m.draw()); // measured, so drawn once in the document
    },

    /* ---------- what it could cost ---------- */
    renderCost(it) {
      const U = this.U, st = S.simple, name = it.name, scs = SV.scenarios(), run = SV.run(st.scen), by = svBy(run);
      if (!svNum(run.gdpH)) { put(U.cost.body, el("p", { class: "sv-wait" }, "Choose the country on the first screen to see the cost as a share of GDP.")); return; }
      const shares = scs.map((s) => { const r = SV.run(s.key), x = r.items.find((q) => q.name === name); return x && r.gdpH ? x.fut / r.gdpH : NaN; });
      const fut = scs.map((s) => { const x = SV.run(s.key).items.find((q) => q.name === name); return x ? x.fut : NaN; });
      const mx = Math.max(1e-12, ...shares.filter(ok));
      const rows = scs.map((s, j) => {
        const sel = s.key === st.scen, v = shares[j];
        return el("button", { type: "button", class: "sv-srow" + (sel ? " sel" : ""), "data-scen": s.key, "data-v": ok(fut[j]) ? fut[j] : "", "data-share": ok(v) ? v : "", "aria-pressed": String(sel),
          onclick: () => { st.scen = s.key; this.render(); } },
          el("span", { class: "sv-sr-name" }, el("b", {}, s.name), sel ? el("span", { class: "sv-sr-sel" }, "selected") : null, el("small", {}, s.size)),
          el("span", { class: "sv-sr-bar", "aria-hidden": "true" }, el("i", { style: `width:${ok(v) ? Math.max(0, (v / mx) * 100).toFixed(2) : 0}%` })),
          el("span", { class: "sv-sr-amt num" }, pctS(v)));
      });
      const sr = SV.stateRange(st.scen), b = sr.by[name];
      const state = el("div", { id: "soe-state", class: "sv-soe-state" }, b ? [
        el("p", {}, `If the State bore the low or the high share for ${it.r.Sector} SOEs (from past defaults on public loans), the cost ${by} would be between `,
          el("b", { class: "num", "data-k": "state-lo", "data-v": b.lo / sr.gdpH }, pctS(b.lo / sr.gdpH)), " and ", el("b", { class: "num", "data-k": "state-hi", "data-v": b.hi / sr.gdpH }, `${pctS(b.hi / sr.gdpH)} of GDP`), "."),
        b.share[0] > sr.share ? el("p", { class: "sv-above" }, `For ${it.r.Sector} SOEs the low figure (${fmt(b.share[0] * 100, 0)}%) is above the ${fmt(sr.share * 100, 0)}% assumed, so this range starts above the cost shown.`) : null] : null);
      const box = el("div", { id: "soe-cost-chart", class: "chart" });
      put(U.cost.body,
        el("p", { class: "sv-now" }, "From the latest accounts, the cost today is ", el("b", { class: "num", "data-k": "now-share", "data-v": it.now / S.gdp }, `${pctS(it.now / S.gdp)} of GDP`), "."),
        el("figure", { class: "sv-fig" }, el("figcaption", {}, el("span", { class: "sv-fig-t" }, "Cost to the budget, % of GDP")), box),
        el("h4", { class: "sv-h4 sv-by" }, `By ${run.year || `${run.H} years on`}, under each scenario`),
        el("div", { class: "sv-srows", role: "group", "aria-label": "Scenario" }, rows),
        state);
      svCostChart(box, SV.paths(st.scen), name);
    },


    /* ---------- what to do ---------- */
    renderActions(it) {
      const w = SV.warnings().by[it.name] || { level: "ok", rules: [] };
      const rules = w.rules.map((id) => RULE_BY[id]).filter(Boolean).sort((a, b) => SV_SEV[a.level] - SV_SEV[b.level]);
      const real = rules.filter((q) => q.id !== "routine");
      put(this.U.actions.body,
        el("p", { class: "sv-lead" }, stChip(w.level), " ", real.length ? `${pl(real.length, "warning")} for this SOE, the most severe first.` : "No warning fires for this SOE. Routine monitoring is enough."),
        rules.map((q) => el("div", { class: "sv-rule", "data-rule": q.id },
          el("h4", { class: "sv-h4" }, stChip(q.level, q.short)),
          el("ol", {}, (q.steps || [q.action]).map((t) => el("li", {}, svPlain(t)))))));
    },

    /* ---------- links to the Analyst view ---------- */
    renderLinks(it) {
      const name = it.name, r = it.r;
      const link = (tab, label, text, fn) => el("li", {}, el("a", { href: "#view-" + tab, onclick: (e) => { e.preventDefault(); fn(); showTab(tab); window.scrollTo({ top: 0 }); } }, label), el("span", {}, text));
      put(this.U.links.body, el("ul", { class: "sv-lk" },
        // exactly what Early Warning's "Open in Shock Scenarios" button does for the SOE in focus
        link("shock", "Shock Scenarios", "Test one shock on this SOE and watch its accounts and health checks change.",
          () => { S.sh.soe = name; S.sh.year = r.Year; S.sh.view = "single"; S.sh.mode = "standard"; Object.assign(S.sh.mags, STD_MAG, { fuel_shock_path: [] }); S.built.shock = false; }),
        link("kpi", "KPI Dashboard", "Every ratio for this SOE, year by year.", () => { S.kpi.soe = name; S.kpi.view = "trend"; S.built.kpi = false; }),
        link("altman", "Distress Indicator", "The four health checks and the distress score in detail.", () => { S.alt.soe = name; S.alt.view = "components"; S.built.altman = false; })));
    },
  };
