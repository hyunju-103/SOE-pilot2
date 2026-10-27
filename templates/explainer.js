  /* =====================================================================
     HOW IT WORKS — scrollytelling guide for non-specialists
     Design and copy adapted from the draft explainer "How SOE Pilot Works": a transit-line rail of chapters,
     a sticky stage on the left that animates as the step cards on the right scroll past, and every number
     computed live from the data loaded in the tool. Chapter 2 walks through the whole site, tab by tab.
     The stage is a small keyed-element kit: shapes are placed with CSS transforms, so a change of state
     moves, grows or fades them with CSS transitions (turned off when the reader prefers reduced motion).
     ===================================================================== */
  const HOW_GLOSSARY = CFG.HOW_GLOSSARY || [];
  const HW_REDUCED = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
  const HW_TOP = 46; // height of the tool's sticky tab bar
  // the transmission map: which boxes of the accounts each shock hits first (p) and which it moves next (s)
  const HOW_NODES = [
    ["inc", "Income statement", 1, [["rev", "Revenue"], ["cost", "Operating costs"], ["int", "Interest"]]],
    ["cash", "Profit and cash", 2, [["ebit", "Operating profit"], ["ni", "Net income"], ["gap", "Cash gap → borrowing"]]],
    ["bs", "Balance sheet", 3, [["ca", "Current assets"], ["debt", "Debt (liabilities)"], ["eq", "Equity"]]],
    ["chk", "Health checks", 4, [["X1", "1 · This year's bills"], ["X2", "2 · Savings"], ["X3", "3 · Operating profit"], ["X4", "4 · Equity cushion"]]],
    ["res", "Result", 5, [["z", "Distress score"], ["pd", "Chance of distress"], ["efc", "Expected fiscal cost"]]],
  ];
  const HOW_HITS = {
    fuel: { p: ["cost"], s: ["rev", "ebit", "ni", "gap", "debt", "eq", "X1", "X2", "X3", "X4", "z", "pd", "efc"] },
    fx: { p: ["cost", "rev", "debt"], s: ["ebit", "ni", "gap", "eq", "X1", "X2", "X3", "X4", "z", "pd", "efc"] },
    rates: { p: ["int"], s: ["ni", "gap", "debt", "eq", "X1", "X2", "X4", "z", "pd", "efc"] },
    revenue: { p: ["rev"], s: ["ebit", "ni", "gap", "debt", "eq", "X1", "X2", "X3", "X4", "z", "pd", "efc"] },
    arrears: { p: ["ca"], s: ["eq", "X1", "X2", "X4", "z", "pd", "efc"] },
    standard: { p: ["rev", "cost", "int", "ca", "debt"], s: ["ebit", "ni", "gap", "eq", "X1", "X2", "X3", "X4", "z", "pd", "efc"] },
  };
  const HOW_STD = { id: "standard", label: "Standard stress (all at once)", what: "All six DSA/DSF stress-test shocks at once: fuel, currency, interest rates, refinancing, revenue and arrears.",
    who: "Every SOE, through its own exposures.", direction: "The usual first stress test.",
    path: ["Each shock hits its own line of the accounts.", "The losses add up and are borrowed.", "Extra debt brings extra interest, which the other shocks then build on.", "The health checks weaken and the distress score falls.", "The chance of distress and the expected fiscal cost rise, often by more than the shocks one at a time."],
    results: "", data: "", guide: {} };
  const howShock = (id) => (id === "standard" ? HOW_STD : SHOCK_T[id]) || SHOCK_T[SHOCK_ORDER[0]];
  /** the shock magnitudes of one type at its standard size (all six for "standard") */
  function howMags(id) {
    if (id === "standard") return Object.assign({}, STD_MAG, { fuel_shock_path: [] });
    const t = SHOCK_T[id], m = Object.assign({}, ZERO_MAG, { fuel_shock_path: [] });
    m[t.key] = t.guide.standard;
    if (id === "rates") m.refinancing_spread_bps = STD_MAG.refinancing_spread_bps;
    return m;
  }
  function howRun(row, mags, pdMethod) {
    const D = CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, Hh = CFG.MC_HORIZON_YEARS, ex = expoFor(row);
    const p = paramsFor(row, mags, ex, D, Hh);
    if (pdMethod) p.pd_method = pdMethod;
    return E.costPath(E.runScenario(row, p, Hh), S.efc.lgd, null, S.efc.ead, p);
  }
  const hwB = (s0) => el("b", {}, s0);
  const hwEase = (t) => 1 - Math.pow(1 - t, 3);
  /** count a number up (or down) inside a text node */
  function hwCount(node, from, to, f, dur = 900) {
    if (HW_REDUCED || !ok(from) || !ok(to) || from === to) { node.textContent = f(to); return; }
    const t0 = performance.now(), id = (node._cnt = (node._cnt || 0) + 1);
    const step = (now) => {
      if (node._cnt !== id) return;
      const t = Math.min(1, (now - t0) / dur);
      node.textContent = f(from + (to - from) * hwEase(t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- the stage kit: keyed SVG and HTML elements placed with CSS transforms ---------- */
  function mkStage() {
    const box = el("div", { class: "hw-stage-box" });
    const svg = svgEl("svg", { class: "sk", "aria-hidden": "true", focusable: "false" });
    const lay = el("div", { class: "sk-h" }), under = el("div", { class: "sk-h under" });
    const live = el("p", { class: "sr-only", "aria-live": "polite" });
    box.append(under, svg, lay, live);
    const s = { box, svg, lay, under, live, W: 640, H: 440, idx: new Map(), seen: new Set() };
    s.begin = () => {
      s.seen = new Set();
      const b = box.getBoundingClientRect();
      s.W = Math.max(280, Math.round(b.width || 640)); s.H = Math.max(240, Math.round(b.height || 440));
      svg.setAttribute("viewBox", `0 0 ${s.W} ${s.H}`); svg.setAttribute("width", s.W); svg.setAttribute("height", s.H);
      return s;
    };
    s.end = () => { s.idx.forEach((e, k) => { if (!s.seen.has(k)) e.classList.add("sk-off"); }); };
    s.clear = () => { s.idx.forEach((e) => e.remove()); s.idx.clear(); };
    // create or update one keyed element; a new one fades in from `from` (a transform), an old one moves to `tf`
    function place(root, key, make, cls, tf, o = {}) {
      let e = s.idx.get(key);
      const fresh = !e;
      if (fresh) {
        e = make(); e.dataset.k = key; root.appendChild(e); s.idx.set(key, e);
        e.setAttribute("class", (cls || "") + " sk-off");
        e.style.transform = o.from || tf;
        void e.getBoundingClientRect();
      } else e.setAttribute("class", cls || "");
      e.style.transitionDelay = o.delay ? Math.round(o.delay) + "ms" : "";
      e.style.transform = tf;
      e.classList.remove("sk-off");
      if (o.op !== undefined) e.style.opacity = o.op; else e.style.removeProperty("opacity");
      s.seen.add(key);
      return e;
    }
    const T = (x, y) => `translate(${+x.toFixed(2)}px,${+y.toFixed(2)}px)`;
    s.T = T;
    s.rect = (key, x, y, w, h, cls, o = {}) => {
      const tf = T(x, y) + ` scale(${Math.max(1e-4, w).toFixed(3)},${Math.max(1e-4, h).toFixed(3)})`;
      let from = o.from;
      if (from === "up") from = T(x, y + h) + ` scale(${Math.max(1e-4, w).toFixed(3)},0.0001)`;
      else if (from === "right") from = T(x, y) + ` scale(0.0001,${Math.max(1e-4, h).toFixed(3)})`;
      else if (from === "left") from = T(x + w, y) + ` scale(0.0001,${Math.max(1e-4, h).toFixed(3)})`;
      return place(svg, key, () => svgEl("rect", { width: 1, height: 1 }), cls, tf, Object.assign({}, o, { from }));
    };
    s.circ = (key, cx, cy, r, cls, o = {}) => {
      let from = o.from;
      if (from === "pop") from = T(cx, cy) + " scale(0.0001)";
      else if (from === "drop") from = T(cx, cy - 60) + ` scale(${r})`;
      return place(svg, key, () => svgEl("circle", { r: 1 }), cls, T(cx, cy) + ` scale(${r})`, Object.assign({}, o, { from }));
    };
    s.text = (key, x, y, str, cls, o = {}) => {
      const e = place(svg, key, () => svgEl("text", {}), cls, T(x, y), Object.assign({}, o, { from: o.from === "up" ? T(x, y + 14) : o.from }));
      e.setAttribute("text-anchor", o.anchor || "start");
      e.setAttribute("dominant-baseline", o.base || "middle");
      e.setAttribute("font-size", o.size || 13);
      if (o.weight) e.setAttribute("font-weight", o.weight); else e.removeAttribute("font-weight");
      if (o.num !== undefined && o.fmt) { const prev = e._v; e._v = o.num; hwCount(e, ok(prev) ? prev : o.num * (o.countFrom ?? 0), o.num, o.fmt, o.dur); }
      else e.textContent = str;
      return e;
    };
    s.line = (key, x1, y1, x2, y2, cls, o = {}) => {
      const len = Math.hypot(x2 - x1, y2 - y1), ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      const tf = T(x1, y1) + ` rotate(${ang.toFixed(2)}deg) scale(${Math.max(1e-4, len).toFixed(2)},1)`;
      const from = o.from === "grow" ? T(x1, y1) + ` rotate(${ang.toFixed(2)}deg) scale(0.0001,1)` : o.from;
      return place(svg, key, () => svgEl("line", { x1: 0, y1: 0, x2: 1, y2: 0 }), cls, tf, Object.assign({}, o, { from }));
    };
    s.path = (key, d, cls, o = {}) => {
      const e = place(svg, key, () => svgEl("path", {}), cls, "none", o);
      if (e.getAttribute("d") !== d) {
        e.setAttribute("d", d);
        if (o.draw && !HW_REDUCED) {
          let L = 0; try { L = e.getTotalLength(); } catch (err) { L = 0; }
          if (L > 0) {
            e.style.transition = "none"; e.style.strokeDasharray = L; e.style.strokeDashoffset = L; void e.getBoundingClientRect();
            e.style.transition = `stroke-dashoffset ${o.dur || 1100}ms cubic-bezier(.3,.6,.2,1) ${o.delay || 0}ms, opacity .45s ease`; e.style.strokeDashoffset = 0;
          }
        }
      }
      return e;
    };
    /** arrow: a drawn line with a head */
    s.arrow = (key, x1, y1, x2, y2, cls, o = {}) => {
      const a = Math.atan2(y2 - y1, x2 - x1), h = o.head || 9;
      s.path(key, `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`, cls, { draw: true, delay: o.delay });
      s.path(key + "-h", `M${(x2 - h * Math.cos(a - 0.45)).toFixed(1)},${(y2 - h * Math.sin(a - 0.45)).toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}L${(x2 - h * Math.cos(a + 0.45)).toFixed(1)},${(y2 - h * Math.sin(a + 0.45)).toFixed(1)}`, cls, { delay: o.delay });
    };
    /** HTML card on the stage; rebuilt only when its signature changes */
    s.html = (key, x, y, w, sig, build, cls, o = {}) => {
      const e = place(o.under ? under : lay, key, () => el("div"), "sk-card " + (cls || ""), T(x, y), Object.assign({}, o, { from: o.from === "up" ? T(x, y + 18) : o.from === "down" ? T(x, y - 18) : o.from }));
      e.style.width = w ? Math.round(w) + "px" : "";
      e.style.minHeight = o.h ? Math.round(o.h) + "px" : "";
      if (e._sig !== sig) { e._sig = sig; e.replaceChildren(...[].concat(build()).filter(Boolean)); }
      return e;
    };
    s.say = (t) => { live.textContent = t; };
    return s;
  }
  /** a value-to-pixel scale with nice ticks */
  function hwScale(lo, hi, p0, p1, n = 5) { const sc = nice(lo, hi, n); const f = lin(sc.lo, sc.hi, p0, p1); f.sc = sc; return f; }
  const zoneCls = (z) => (z === "Distress" ? "risk" : z === "Grey" ? "amber" : z === "Safe" ? "health" : "grey");

  /* ---------- what the chapters share: the example SOE and lazily computed runs ---------- */
  function howCtx() {
    const st = S.how;
    const rows = latestOf(S.en).slice().sort((a, b) => a.Z_EM - b.Z_EM);
    const r = rows.find((q) => q.Entity === st.soe) || rows[0];
    const c = { st, rows, r, n: rows.length, cache: {} };
    c.lazy = (k, fn) => (k in c.cache ? c.cache[k] : (c.cache[k] = fn()));
    c.efc = (q) => E.efcRow(q, S.efc.lgd, S.efc.ead, "total_liabilities");
    c.zc = zoneCounts(rows);
    c.best = rows.reduce((m, q) => (q.Z_EM > m.Z_EM ? q : m), rows[0]);
    c.shock = (id) => c.lazy("sh:" + id, () => {
      const base = howRun(r, ZERO_MAG), path = howRun(r, howMags(id));
      const fb = last(base), f = last(path), y1 = path[1], b1 = base[1];
      const gapOf = (pp) => sum(pp.slice(1).map((q) => (q["Cash Funding Gap"] || 0) + (q["Cash Drawdown"] || 0)));
      const dz = (k) => (f[k] - fb[k]) * CFG.ZEM_COEFFICIENTS[k];
      const v = {
        cost: id === "fuel" ? y1["Fuel Cost Change"] || 0 : null, int: (y1["Interest Expense"] || 0) - (b1["Interest Expense"] || 0),
        ebit: y1.EBIT - b1.EBIT, ni: y1["Net Income"] - b1["Net Income"], gap: gapOf(path) - gapOf(base),
        ca: f["Current Assets"] - fb["Current Assets"], debt: f["Total Liabilities"] - fb["Total Liabilities"], eq: f.Equity - fb.Equity,
        X1: dz("X1"), X2: dz("X2"), X3: dz("X3"), X4: dz("X4"), z: f.Z_EM - fb.Z_EM, pd: f.PD - fb.PD, efc: f.EFC - fb.EFC,
      };
      return { base, path, f, fb, y1, b1, v };
    });
    c.singles = () => c.lazy("singles", () => {
      const fb = last(howRun(r, ZERO_MAG));
      const ch = Object.entries(CFG.REPORT_STRESS_CHANNELS).map(([k, [lab, mag]]) => [lab, (last(howRun(r, Object.assign({}, ZERO_MAG, { fuel_shock_path: [], [mag]: STD_MAG[mag] }))).EFC || 0) - (fb.EFC || 0)]);
      const all = (last(howRun(r, howMags("standard"))).EFC || 0) - (fb.EFC || 0);
      return { ch, all, sum: sum(ch.map((x) => x[1])) };
    });
    c.mc = () => c.lazy("mc", () => {
      try {
        const ex = expoFor(r), p = Object.assign(paramsFor(r, STD_MAG, ex, CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, CFG.MC_HORIZON_YEARS), { mc_pd_method: "rating_smooth" });
        const sims = E.monteCarlo(r, p, { n: 300, fuelSd: CFG.MC_DEFAULT_FUEL_STD, fxSd: CFG.MC_DEFAULT_FX_STD, rho: CFG.MC_DEFAULT_CORRELATION, H: CFG.MC_HORIZON_YEARS, lgd: S.efc.lgd, seed: 42, eadShare: S.efc.ead });
        const pts = sims.map((x) => ({ fuel: x.fuel, fx: x.fx, efc: last(x.path).EFC_Rating_Anchored }));
        const q = (x) => E.quantile(pts.map((p0) => p0.efc), x);
        return { pts, p50: q(0.5), p95: q(0.95), p5: q(0.05), fuel0: p.fuel_shock_pct, fx0: p.fx_shock_pct };
      } catch (e) { return null; }
    });
    c.macro = () => c.lazy("macro", () => {
      const n = 120, g = normals(20261026), ks = Array.from({ length: n }, () => Math.exp(0.5 * g() - 0.125));
      const D = CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, Hh = CFG.MC_HORIZON_YEARS;
      const run = (q, ex, mags) => { const pp = Object.assign(paramsFor(q, mags, ex, D, Hh), { pd_method: "rating_smooth" }); return last(E.costPath(E.runScenario(q, pp, Hh), S.efc.lgd, null, S.efc.ead, pp)); };
      const tl = sum(rows.map((q) => q["Total Liabilities"]));
      const res = rows.map((q) => {
        const ex = expoFor(q), sg = volFor(q.Entity, q.Sector)[0], b0 = run(q, ex, ZERO_MAG);
        const de = ks.map((k) => (run(q, ex, Object.assign({}, ZERO_MAG, { revenue_shock_std_devs: sg ? -(0.1 * k) / sg : 0, rate_shock_bps: 200 * k })).EFC || 0) - (b0.EFC || 0));
        return { q, med: E.quantile(de, 0.5), lo: E.quantile(de, 0.05), hi: E.quantile(de, 0.95), tl: tl ? q["Total Liabilities"] / tl : NaN };
      }).sort((a, b) => b.med - a.med);
      const tot = sum(res.map((x) => Math.max(0, x.med)));
      res.forEach((x, i) => { x.share = tot ? Math.max(0, x.med) / tot : NaN; x.flag = i < 3 && x.tl < 0.05 && x.share > 0.15; });
      return { res, tot };
    });
    c.bt = () => c.lazy("bt", () => {
      const hist = S.en.filter((q) => q.Entity === r.Entity).sort((a, b) => a.Year - b.Year), yrs = hist.map((q) => q.Year);
      const cands = yrs.filter((y) => yrs.includes(y - 1));
      if (!cands.length) return null;
      const year = cands.includes(2020) ? 2020 : cands[0], b0 = hist.find((q) => q.Year === year - 1), Hh = Math.min(7, last(yrs) - b0.Year);
      const ex = expoFor(b0), sg = volFor(r.Entity, b0.Sector)[0];
      const pN = paramsFor(b0, ZERO_MAG, ex, 1, Hh), pS = paramsFor(b0, Object.assign({}, ZERO_MAG, { fuel_shock_path: [], revenue_shock_std_devs: sg ? -0.1 / sg : 0 }), ex, 1, Hh);
      const pathN = E.runScenario(b0, pN, Hh), pathS = E.runScenario(b0, pS, Hh);
      const xs = pathS.map((q) => q["Calendar Year"]), act = xs.map((y) => { const q = hist.find((h) => h.Year === y); return q ? q.Z_EM : NaN; });
      const idx = xs.map((_, i) => i).filter((i) => i > 0 && ok(act[i]));
      return { year, b0, xs, act, zS: pathS.map((q) => q.Z_EM), zN: pathN.map((q) => q.Z_EM), gap: mean(idx.map((i) => Math.abs(pathS[i].Z_EM - act[i]))), gapN: mean(idx.map((i) => Math.abs(pathN[i].Z_EM - act[i]))), idx };
    });
    c.ew = () => c.lazy("ew", () => {
      const stress = Object.fromEntries(standardStress(S.en).map((x) => [x.row.Entity, x]));
      const ev = evalTriggers(rows, stress);
      const order = rows.slice().sort((a, b) => ({ alert: 0, watch: 1, ok: 2 }[ev.by[a.Entity].level] - { alert: 0, watch: 1, ok: 2 }[ev.by[b.Entity].level]) || a.Z_EM - b.Z_EM);
      return Object.assign(ev, { order });
    });
    c.std = () => c.lazy("std", () => ({ base: howRun(r, ZERO_MAG), path: howRun(r, howMags("standard")) }));
    return c;
  }
  /* ---------- chapters ---------- */
  const HW_TABS = [
    ["home", "Home", "What data am I using?"],
    ["kpi", "KPI Dashboard", "Is each SOE healthy, and why not?"],
    ["altman", "Distress Indicator", "How close is each SOE to distress?"],
    ["efc", "Expected Fiscal Cost", "What could each SOE cost the budget?"],
    ["shock", "Shock Scenarios", "What could make it worse?"],
    ["warning", "Early Warning", "What should happen next?"],
    ["report", "Report", "How do I brief on it?"],
  ];
  const HW_KPIS = [["operating_margin", "Margin"], ["current_ratio", "Liquidity"], ["liabilities_to_assets", "Leverage"], ["interest_coverage", "Interest cover"]];
  const hwOpen = (id, label) => el("button", { class: "hw-open", type: "button", onclick: () => { showTab(id); window.scrollTo({ top: 0 }); } }, label || "Open this tab →");
  const HW_CHAPTERS = [];

  /* 1 · why it matters */
  HW_CHAPTERS.push({
    id: "why", rail: "Why it matters", title: "Why a state company's troubles reach the budget",
    steps: (c) => [
      ["soe", [`Our example is `, hwB(c.r.Entity), ` (${c.r.Sector}), one of the ${pl(c.n, "SOE")} in the data loaded in the tool. Like most state-owned enterprises, it provides a public service, borrows to build and run its assets, and answers to a ministry. The steps that follow are the same for any non-financial state company. You can change the example SOE at the top of this page.`]],
      ["link", [`If ${c.r.Entity} cannot pay its debts, the government rarely lets it collapse. It pays the lenders, takes over the loans, or puts in fresh money. Whatever form the rescue takes, `, hwB("it comes out of the budget"), "."]],
      ["contingent", ["So a struggling SOE is a cost the budget may have to carry, even when no law or contract says so. Economists call this a ", hwB("contingent liability"), ": a cost that arrives only if something goes wrong."]],
      ["questions", ["The tool answers two questions. ", hwB("How much should the government expect to pay for this SOE?"), " And ", hwB("what could make that number grow?")]],
      ["triage", ["Its answer is a first, quick reading, a ", hwB("triage"), ` that tells you which of the ${pl(c.n, "SOE")} deserve a closer look. In this data ${c.zc.Distress} ${c.zc.Distress === 1 ? "is" : "are"} in the distress zone (red). It is not a budget forecast, and not a credit rating agency's verdict.`]],
    ],
    draw(s, k, c) {
      const { W, H } = s, r = c.r, narrow = W < 560;
      const cw = Math.min(230, W * 0.42), cx = W / 2 - cw / 2, cy = H * (narrow ? 0.3 : 0.34) - 44;
      if (k !== "triage") s.html("w-soe", cx, cy, cw, r.Entity, () => [el("span", { class: "sk-k" }, "State-owned enterprise"), el("b", { class: "sk-big" }, r.Entity), el("span", {}, r.Sector), el("small", {}, "public service · borrows · answers to a ministry")], "soe", { from: "up" });
      if (["link", "contingent", "questions"].includes(k)) {
        const sw = Math.min(150, W * 0.27);
        s.html("w-lend", 10, cy + 6, sw, "l", () => [el("span", { class: "sk-k" }, "Lenders"), el("b", {}, "Banks and bondholders")], "", { from: "up" });
        s.html("w-tre", W - sw - 10, cy + 6, sw, "t", () => [el("span", { class: "sk-k" }, "Treasury"), el("b", {}, "The budget")], "line", { from: "up", delay: 150 });
        s.arrow("w-a1", 10 + sw + 4, cy + 34, cx - 6, cy + 34, "s-ink2", { delay: 200 });
        s.text("w-a1t", (10 + sw + cx) / 2, cy + 22, "lend", "t-ink2", { anchor: "middle", size: 12 });
        s.arrow("w-a2", W - sw - 14, cy + 58, cx + cw + 6, cy + 58, "s-line w3", { delay: 500 });
        s.text("w-a2t", (W - sw + cx + cw) / 2, cy + 74, "rescue if it cannot pay", "t-line", { anchor: "middle", size: 12, weight: 700, delay: 500 });
      }
      if (k === "contingent") {
        const bx = W * 0.12, bw = W * 0.76, by = H * 0.66;
        s.text("w-bud", bx, by - 16, "The budget", "t-ink", { size: 13, weight: 700 });
        s.rect("w-bud-r", bx, by, bw * 0.78, 34, "f-line-soft", { from: "right" });
        s.rect("w-bud-c", bx + bw * 0.78, by, bw * 0.22, 34, "f-risk-soft s-risk-dash", { from: "right", delay: 450 });
        s.text("w-bud-ct", bx + bw * 0.89, by + 54, "contingent liability", "t-risk", { anchor: "middle", size: 12.5, weight: 700, delay: 450 });
        s.text("w-bud-ct2", bx + bw * 0.89, by + 70, "only if something goes wrong", "t-ink2", { anchor: "middle", size: 11.5, delay: 450 });
      }
      if (k === "questions") {
        const qw = Math.min(300, (W - 40) / 2), qy = H * 0.62;
        s.html("w-q1", W / 2 - qw - 8, qy, qw, "q1", () => [el("span", { class: "sk-k" }, "Question 1"), el("b", {}, "How much should the government expect to pay for this SOE?")], "q", { from: "up" });
        s.html("w-q2", W / 2 + 8, qy, qw, "q2", () => [el("span", { class: "sk-k" }, "Question 2"), el("b", {}, "What could make that number grow?")], "q shock", { from: "up", delay: 200 });
      }
      if (k === "triage") {
        const n = c.n, cols = Math.min(n, narrow ? 4 : n > 12 ? 6 : 4), rowsN = Math.ceil(n / cols), gw = Math.min(W - 32, cols * 150), bw = gw / cols - 8, bh = Math.min(54, (H - 90) / rowsN - 8);
        const x0 = (W - gw) / 2, y0 = Math.max(40, (H - rowsN * (bh + 8)) / 2);
        c.rows.forEach((q, i) => {
          const x = x0 + (i % cols) * (gw / cols), y = y0 + Math.floor(i / cols) * (bh + 8);
          s.html("w-t-" + q.Entity, x, y, bw, q.Entity + q.Zone + bh, () => [el("b", {}, q.Entity), bh > 40 ? el("small", {}, `${q.Zone} · score ${fmt(q.Z_EM, 1)}`) : null], "mini z-" + zoneCls(q.Zone) + (q.Entity === r.Entity ? " ex" : ""), { from: "up", delay: i * 40 });
        });
        s.text("w-t-cap", W / 2, y0 - 22, "Weakest first · red = distress zone · outlined = the example", "t-ink2", { anchor: "middle", size: 12 });
      }
      s.say(k);
    },
  });

  /* 2 · the tool at a glance: the website, tab by tab */
  HW_CHAPTERS.push({
    id: "tool", rail: "The tool at a glance", title: "The website in one picture: seven stops, one question each",
    steps: (c) => {
      const ew = c.ew(), lv = (x) => c.rows.filter((q) => ew.by[q.Entity].level === x).length;
      const reds = c.rows.reduce((a, q) => a + HW_KPIS.filter(([kk]) => ok(q[kk]) && E.classify(q[kk], kk)[1] === "red").length, 0);
      const efcs = c.rows.map((q) => c.efc(q).EFC).sort((a, b) => b - a), tot = sum(efcs);
      return [
        ["intro", ["The tool is a set of tabs you use in order, like stops on a line. ", hwB("Each tab answers one question"), " and hands its result to the next. This chapter walks the line once; the chapters after it explain the calculation behind each stop."]],
        ["home", [hwB("1 · Home: load the data. "), "One row per SOE and year, taken from the yearly accounts. Use the standard template, or try one of the built-in examples. Everything is calculated in your browser; nothing is sent anywhere. ", el("br"), `Loaded now: ${S.label}, ${pl(c.n, "SOE")}, ${S.years.length > 1 ? S.years[0] + "–" + last(S.years) : S.years[0]}.`, el("br"), hwOpen("home")]],
        ["kpi", [hwB("2 · KPI Dashboard: is each SOE healthy? "), "Familiar ratios in four groups (profitability, liquidity, solvency, dependence on the government), each coloured green, amber or red. Use it to see ", el("i", {}, "why"), ` an SOE looks weak. On the four ratios shown here there are ${reds} red signals across ${pl(c.n, "SOE")}.`, el("br"), hwOpen("kpi")]],
        ["altman", [hwB("3 · Distress Indicator: one score per SOE. "), `Four health checks combine into a distress score that falls in a safe, grey or distress zone (chapters 4 to 6 show how). Today: ${c.zc.Distress} in distress, ${c.zc.Grey} grey, ${c.zc.Safe} safe.`, el("br"), hwOpen("altman")]],
        ["efc", [hwB("4 · Expected Fiscal Cost: what could it cost the budget? "), `Chance of distress × debt at stake × the share the government bears (chapter 7). This is the only tab that adds SOEs up: ${money(tot, true)} in total, ${pct(tot ? sum(efcs.slice(0, 3)) / tot : NaN, 0)} of it from the three largest.`, el("br"), hwOpen("efc")]],
        ["shock", [hwB("5 · Shock Scenarios: what could make it worse? "), "Pick an SOE and a shock (fuel, exchange rate, interest rates, revenue, arrears) and compare with its no-shock path. Four views: one SOE; a Monte Carlo simulation of the range of outcomes; a portfolio-wide shock that ranks SOEs; and a check of the model against past years (chapters 8 to 10).", el("br"), hwOpen("shock")]],
        ["warning", [hwB("6 · Early Warning: what should happen next? "), `Simple rules turn the numbers into a signal for each SOE (Alert, Watch or Good) with follow-up steps for the ministry. Today: ${lv("alert")} alert, ${lv("watch")} watch, ${lv("ok")} good (chapter 11).`, el("br"), hwOpen("warning")]],
        ["report", [hwB("7 · Report: the write-up. "), "Five sections generated from everything above (summary, performance, distress and fiscal risk, stress tests, policy), ready to print or save as PDF. Check the numbers in the tabs before you use it in a briefing.", el("br"), hwOpen("report")]],
        ["loop", ["Then the line starts again: ", hwB("new accounts each year, the same seven stops."), " That repetition is the monitoring part of the early-warning framework. An SOE it flags, for example a power utility, goes to a deeper model (the energy-sector fiscal-risk model) for a closer look."]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, narrow = W < 620, n = HW_TABS.length, iA = HW_TABS.findIndex(([id]) => id === k);
      // the line of stops
      let fx, fy, fw, fh;
      if (!narrow) {
        const x0 = 30, top = 34, bot = H - 34, yy = (i) => top + (i * (bot - top)) / (n - 1);
        s.rect("t-base", x0 - 3, top, 6, bot - top, "f-rule");
        const upTo = k === "loop" ? n - 1 : Math.max(0, iA);
        s.rect("t-prog", x0 - 3, top, 6, k === "intro" ? 0.0001 : yy(upTo) - top, "f-line", { from: "up" });
        HW_TABS.forEach(([id, lab], i) => {
          const on = i === iA, past = k === "loop" || (iA >= 0 && i < iA);
          s.circ("t-st-" + id, x0, yy(i), on ? 13 : 10, "hw-station" + (on ? " on" : past ? " past" : ""), { from: "pop", delay: k === "intro" ? i * 90 : 0 });
          s.text("t-sn-" + id, x0, yy(i), String(i + 1), on || past ? "t-on t-disp" : "t-ink t-disp", { anchor: "middle", size: 11, weight: 800, delay: k === "intro" ? i * 90 : 0 });
          s.text("t-sl-" + id, x0 + 22, yy(i), lab, on ? "t-ink t-disp" : "t-ink2", { size: on ? 14 : 12.5, weight: on ? 800 : 600, delay: k === "intro" ? i * 90 + 60 : 0 });
        });
        if (k === "loop") s.path("t-loop", `M${x0 + 16},${yy(n - 1)} C${x0 + 150},${yy(n - 1) + 10} ${x0 + 150},${top - 10} ${x0 + 16},${top}`, "s-line w3 dash-run", { draw: true, dur: 1400 });
        fx = Math.min(250, W * 0.36); fy = 14; fw = W - fx - 14; fh = H - 28;
      } else {
        const y0 = 26, x0 = 22, x1 = W - 22, xx = (i) => x0 + (i * (x1 - x0)) / (n - 1);
        s.rect("t-base", x0, y0 - 3, x1 - x0, 6, "f-rule");
        const upTo = k === "loop" ? n - 1 : Math.max(0, iA);
        s.rect("t-prog", x0, y0 - 3, k === "intro" ? 0.0001 : xx(upTo) - x0, 6, "f-line", { from: "right" });
        HW_TABS.forEach(([id], i) => {
          const on = i === iA, past = k === "loop" || (iA >= 0 && i < iA);
          s.circ("t-st-" + id, xx(i), y0, on ? 12 : 9, "hw-station" + (on ? " on" : past ? " past" : ""), { from: "pop", delay: k === "intro" ? i * 80 : 0 });
          s.text("t-sn-" + id, xx(i), y0, String(i + 1), on || past ? "t-on t-disp" : "t-ink t-disp", { anchor: "middle", size: 10, weight: 800 });
        });
        fx = 8; fy = 50; fw = W - 16; fh = H - 58;
      }
      // the "screen" of the current tab
      const tab = HW_TABS[iA] || null;
      s.html("t-frame", fx, fy, fw, (tab ? tab[0] : k) + fh, () => {
        const box = el("div", { class: "hw-screen", style: `height:${Math.round(fh)}px` });
        if (tab) box.append(el("div", { class: "hw-screen-bar" }, el("i"), el("i"), el("i"), el("span", {}, tab[1])), el("p", { class: "hw-screen-q" }, tab[2]));
        else if (k === "intro") box.append(el("div", { class: "hw-screen-bar" }, el("i"), el("i"), el("i"), el("span", {}, "SOE Fiscal Risk Tool")), el("p", { class: "hw-screen-q" }, "Seven stops, one question each"), el("ol", { class: "hw-screen-list" }, HW_TABS.map(([, lab, q]) => el("li", {}, el("b", {}, lab), " · ", q))));
        else box.append(el("div", { class: "hw-screen-bar" }, el("i"), el("i"), el("i"), el("span", {}, "Every year")), el("p", { class: "hw-screen-q" }, "New accounts → the same seven stops"), el("p", { class: "hw-screen-note" }, "Flagged SOEs go to a deep dive: for power utilities, the energy-sector fiscal-risk model. Hidden subsidies and public-service obligations are separate pieces of work."));
        return box;
      }, "screen", { from: "up", under: true });
      if (!tab) { s.say(k); return; }
      // content area inside the screen
      const ax = fx + 18, ay = fy + 92, aw = fw - 36, ah = fh - 110, rows = c.rows, m = Math.min(rows.length, 8), shown = rows.slice(0, m), id = tab[0];
      if (id === "home") {
        s.rect("t-h-drop", ax, ay, aw, Math.min(90, ah * 0.35), "f-line-soft s-line-dash");
        s.text("t-h-dt", ax + aw / 2, ay + Math.min(45, ah * 0.17), "Drop a CSV or Excel file · one row per SOE and year", "t-line", { anchor: "middle", size: 12.5, weight: 700 });
        const cy0 = ay + Math.min(90, ah * 0.35) + 22, cw = Math.min(110, (aw - 24) / 4);
        rows.slice(0, 12).forEach((q, i) => {
          const x = ax + (i % 4) * (cw + 8), y = cy0 + Math.floor(i / 4) * 34;
          if (y + 28 > ay + ah) return;
          s.rect("t-h-c" + i, x, y, cw, 28, "f-surface s-rule", { from: "up", delay: 150 + i * 50 });
          s.text("t-h-ct" + i, x + 8, y + 14, clip(q.Entity, 14), "t-ink", { size: 11.5, weight: 700, delay: 150 + i * 50 });
        });
      } else if (id === "kpi") {
        const lw = Math.min(110, aw * 0.3), cw = (aw - lw) / HW_KPIS.length, rh = Math.min(30, (ah - 30) / m);
        HW_KPIS.forEach(([kk, lab], j) => s.text("t-k-h" + j, ax + lw + cw * j + cw / 2, ay + 8, lab, "t-ink2", { anchor: "middle", size: 11, weight: 700 }));
        shown.forEach((q, i) => {
          const y = ay + 22 + i * rh;
          s.text("t-k-r" + i, ax, y + rh / 2, clip(q.Entity, 14), "t-ink", { size: 11.5, weight: 700 });
          HW_KPIS.forEach(([kk], j) => { const cl = ok(q[kk]) ? E.classify(q[kk], kk)[1] : "muted"; s.rect(`t-k-${i}-${j}`, ax + lw + cw * j + 3, y + 3, cw - 6, rh - 6, "rag-" + cl, { from: "pop", delay: 60 * (i + j) }); });
        });
      } else if (id === "altman") {
        const x = hwScale(Math.max(-8, Math.min(-2, ...rows.map((q) => q.Z_EM))), Math.min(12, Math.max(CFG.Z_SAFE_CUTOFF + 2, ...rows.map((q) => q.Z_EM))), ax, ax + aw, 6), y = ay + ah * 0.55;
        s.rect("t-a-d", x(x.sc.lo), y - 30, x(CFG.Z_DISTRESS_CUTOFF) - x(x.sc.lo), 50, "f-risk-soft");
        s.rect("t-a-g", x(CFG.Z_DISTRESS_CUTOFF), y - 30, x(CFG.Z_SAFE_CUTOFF) - x(CFG.Z_DISTRESS_CUTOFF), 50, "f-amber-soft");
        s.rect("t-a-s", x(CFG.Z_SAFE_CUTOFF), y - 30, x(x.sc.hi) - x(CFG.Z_SAFE_CUTOFF), 50, "f-health-soft");
        [["Distress", (x(x.sc.lo) + x(CFG.Z_DISTRESS_CUTOFF)) / 2], ["Grey", (x(CFG.Z_DISTRESS_CUTOFF) + x(CFG.Z_SAFE_CUTOFF)) / 2], ["Safe", (x(CFG.Z_SAFE_CUTOFF) + x(x.sc.hi)) / 2]].forEach(([l, xx]) => s.text("t-a-l" + l, xx, y - 42, l, "t-ink2", { anchor: "middle", size: 11.5, weight: 700 }));
        rows.forEach((q, i) => s.circ("t-a-p" + q.Entity, x(Math.max(x.sc.lo, Math.min(x.sc.hi, q.Z_EM))), y - 5 + ((i % 3) - 1) * 9, q.Entity === c.r.Entity ? 7 : 5, "dot-" + zoneCls(q.Zone) + (q.Entity === c.r.Entity ? " ex" : ""), { from: "drop", delay: i * 40 }));
        x.sc.ticks.forEach((t, i) => s.text("t-a-t" + i, x(t), y + 34, tickLab(t, x.sc.step), "t-ink2", { anchor: "middle", size: 10.5 }));
      } else if (id === "efc") {
        const v = rows.map((q) => [q, c.efc(q).EFC]).sort((a, b) => b[1] - a[1]).slice(0, m), mx = Math.max(1e-9, ...v.map((x) => x[1])), lw = Math.min(100, aw * 0.28), rh = Math.min(28, ah / m);
        v.forEach(([q, e], i) => {
          const y = ay + i * rh;
          s.text("t-e-l" + i, ax, y + rh / 2, clip(q.Entity, 13), "t-ink", { size: 11.5, weight: 700 });
          s.rect("t-e-b" + i, ax + lw, y + 4, ((aw - lw - 70) * e) / mx, rh - 8, i < 3 ? "f-risk" : "f-line-soft", { from: "right", delay: i * 70 });
          s.text("t-e-v" + i, ax + lw + ((aw - lw - 70) * e) / mx + 6, y + rh / 2, money(e), "t-ink2", { size: 11, delay: i * 70 });
        });
      } else if (id === "shock") {
        const d = c.std(), b = d.base.map((q) => q.EFC), p = d.path.map((q) => q.EFC), xs = d.path.map((q) => q["Calendar Year"]);
        const x = lin(0, xs.length - 1, ax + 30, ax + aw - 70), y = hwScale(0, Math.max(...p, ...b) * 1.1, ay + ah - 20, ay + 10, 4);
        y.sc.ticks.forEach((t, i) => { s.line("t-s-g" + i, ax + 30, y(t), ax + aw - 70, y(t), "s-rule"); s.text("t-s-gt" + i, ax + 24, y(t), moneyTick(t, y.sc.step), "t-ink2", { anchor: "end", size: 10 }); });
        s.rect("t-s-band", x(1) - 6, ay + 4, x(Math.min(CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, xs.length - 1)) - x(1) + 12, ah - 24, "f-shock-soft");
        const pts = (a) => a.map((v, i) => [x(i), y(v)]);
        s.path("t-s-b", smoothPath(pts(b)), "s-grey w2 nofill", { draw: true });
        s.path("t-s-p", smoothPath(pts(p)), "s-shock w3 nofill", { draw: true, delay: 300 });
        s.text("t-s-bl", x(xs.length - 1) + 6, y(last(b)), "no shock", "t-ink2", { size: 11 });
        s.text("t-s-pl", x(xs.length - 1) + 6, y(last(p)), "standard stress", "t-shock", { size: 11, weight: 700 });
        xs.forEach((yv, i) => s.text("t-s-x" + i, x(i), ay + ah - 4, String(yv), "t-ink2", { anchor: "middle", size: 10 }));
      } else if (id === "warning") {
        const ew = c.ew(), colw = (aw - 16) / 3;
        [["alert", "Alert", "risk"], ["watch", "Watch", "amber"], ["ok", "Good", "health"]].forEach(([lv, lab, cl], j) => {
          const x = ax + j * (colw + 8), list = c.rows.filter((q) => ew.by[q.Entity].level === lv);
          s.rect("t-w-c" + j, x, ay, colw, ah, "f-" + cl + "-soft");
          s.text("t-w-h" + j, x + 10, ay + 16, `${lab} · ${list.length}`, "t-" + cl, { size: 12.5, weight: 800 });
          list.slice(0, Math.floor((ah - 40) / 26)).forEach((q, i) => {
            s.rect(`t-w-${q.Entity}`, x + 8, ay + 32 + i * 26, colw - 16, 22, "f-surface", { from: "up", delay: i * 60 + j * 120 });
            s.text(`t-w-t-${q.Entity}`, x + 14, ay + 43 + i * 26, clip(q.Entity, 16), "t-ink", { size: 11, weight: 700, delay: i * 60 + j * 120 });
          });
        });
      } else if (id === "report") {
        ["Executive summary", "Financial performance", "Distress and fiscal risk", "Stress tests", "Policy implications"].forEach((t, i) => {
          const pw = Math.min(200, aw * 0.5), ph = Math.min(150, ah * 0.6), x = ax + i * Math.min(46, (aw - pw) / 4), y = ay + i * Math.min(22, (ah - ph) / 4);
          s.rect("t-r-p" + i, x, y, pw, ph, "f-surface s-rule shadow", { from: "up", delay: i * 120 });
          s.rect("t-r-b" + i, x, y, pw, 6, "f-line", { delay: i * 120 });
          s.text("t-r-t" + i, x + 10, y + 22, `${i + 1} · ${t}`, "t-ink", { size: 11.5, weight: 700, delay: i * 120 });
        });
      }
      s.say(k);
    },
  });
  /* 3 · seven numbers from the accounts */
  const HW_SEVEN = [["Total Assets", "Total assets", "owns"], ["Current Assets", "Current assets", "owns"], ["Total Liabilities", "Total liabilities", "owes"], ["Current Liabilities", "Current liabilities", "owes"], ["Equity", "Equity", "equity"], ["Operating Profits (EBIT)", "Operating profit", "profit"], ["Retained Earnings", "Retained earnings", "profit"]];
  HW_CHAPTERS.push({
    id: "accounts", rail: "Accounts", title: "Seven numbers from the accounts",
    steps: (c) => {
      const r = c.r, K = E.K;
      return [
        ["slots", [`Everything starts from the SOE's yearly accounts. To score an SOE the tool needs only `, hwB("seven numbers"), `. Here they are for ${r.Entity} in ${r.Year}. They are in the upload template; the tool reads them from your file.`]],
        ["owns", [hwB("What it owns: "), money(r[K.ta], true), " in total assets (plants, networks, buildings, cash, money owed to it). Of that, ", money(r[K.ca], true), " turns into cash within a year: its ", hwB("current assets"), " (the darker part)."]],
        ["owes", [hwB("What it owes: "), money(r[K.tl], true), " in total liabilities. Of that, ", money(r[K.cl], true), " falls due within the year: its ", hwB("current liabilities"), " (supplier bills, short-term loans, loan repayments due soon)."]],
        ["equity", [hwB("Equity"), ` = what it owns minus what it owes: ${money(r[K.eq], true)}. Think of it as the owners' cushion. Losses eat into it; ${r[K.eq] <= 0 ? `for ${r.Entity} it has already run out: it owes more than everything it has.` : "if it runs out, the SOE owes more than everything it has."}`]],
        ["profit", ["Two numbers come from the profit side. ", hwB("Operating profit"), ` (${money(r[K.ebit], true)}) is what the business earns from its day-to-day activity, before interest and tax. `, hwB("Retained earnings"), ` (${money(r[K.re], true)}) is the running total of all past profits and losses kept in the company.`]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, r = c.r, K = E.K, narrow = W < 620;
      const ord = ["slots", "owns", "owes", "equity", "profit"], ki = ord.indexOf(k);
      // the seven tiles
      const cols = narrow ? 4 : 7, tw = (W - 24 - (cols - 1) * 6) / cols, th = narrow ? 56 : 58;
      HW_SEVEN.forEach(([col, lab, grp], i) => {
        const x = 12 + (i % cols) * (tw + 6), y = 12 + Math.floor(i / cols) * (th + 6);
        const on = k === "slots" || grp === k || (k === "equity" && grp === "equity") || (k === "owes" && grp === "owes") || (k === "owns" && grp === "owns");
        s.html("a-t" + i, x, y, tw, lab + r.Entity, () => [el("span", { class: "sk-k" }, lab), el("b", { class: "num" }, money(r[col]))], "tile" + (narrow ? " sm" : "") + (on ? " on" : " dim") + (r[col] < 0 ? " neg" : ""), { from: "up", delay: k === "slots" ? i * 110 : 0, h: th });
      });
      const top = 12 + (narrow ? 2 : 1) * (th + 6) + 26, profH = 76, bot = H - profH - 24, hMax = Math.max(60, bot - top);
      if (ki >= 1) {
        const ta = Math.max(0, r[K.ta]), tl = Math.max(0, r[K.tl]), ca = Math.max(0, Math.min(r[K.ca], ta)), cl = Math.max(0, Math.min(r[K.cl], tl)), eq = r[K.eq];
        const mx = Math.max(ta, tl, 1), y = (v) => (v / mx) * hMax, cw = Math.min(130, W * 0.22), xa = W * 0.27 - cw / 2, xl = W * 0.63 - cw / 2;
        s.text("a-own", xa + cw / 2, top - 10, "Owns", "t-ink t-disp", { anchor: "middle", size: 14, weight: 800 });
        s.rect("a-ca", xa, bot - y(ca), cw, y(ca), "f-line", { from: "up" });
        s.rect("a-oa", xa, bot - y(ta), cw, y(ta - ca), "f-line-mid", { from: "up", delay: 250 });
        s.text("a-tav", xa + cw / 2, bot + 14, money(ta), "t-ink t-disp", { anchor: "middle", size: 13, weight: 800, num: ta, fmt: (v) => money(v) });
        if (y(ca) > 20) s.text("a-cav", xa + cw / 2, bot - y(ca) / 2, (narrow ? "" : "within a year ") + money(ca), "t-on", { anchor: "middle", size: 11 });
        if (ki >= 2) {
          s.text("a-owe", xl + cw / 2, top - 10, "Owes", "t-ink t-disp", { anchor: "middle", size: 14, weight: 800 });
          s.rect("a-cl", xl, bot - y(cl), cw, y(cl), "f-amber", { from: "up" });
          s.rect("a-ol", xl, bot - y(tl), cw, y(tl - cl), "f-amber-mid", { from: "up", delay: 250 });
          s.text("a-tlv", xl + cw / 2, bot + 14, money(tl), "t-ink t-disp", { anchor: "middle", size: 13, weight: 800, num: tl, fmt: (v) => money(v) });
          if (y(cl) > 20) s.text("a-clv", xl + cw / 2, bot - y(cl) / 2, (narrow ? "" : "due in a year ") + money(cl), "t-on", { anchor: "middle", size: 11 });
        }
        if (ki >= 3) {
          if (eq > 0) { s.rect("a-eq", xl, bot - y(ta), cw, y(eq), "f-health", { from: "up" }); s.text("a-eqv", xl + cw + 8, bot - y(ta) + y(eq) / 2, "equity " + money(eq), "t-health", { size: 12, weight: 700 }); }
          else { s.rect("a-eqn", xa, bot - y(tl), cw, y(tl - ta), "f-risk-soft s-risk-dash", { from: "up" }); s.text("a-eqv", xa - 8, bot - y(tl) + y(tl - ta) / 2, "negative equity " + money(eq), "t-risk", { anchor: "end", size: 12, weight: 700 }); }
        }
      }
      if (ki >= 4) {
        const pv = [["Operating profit", r[K.ebit]], ["Retained earnings", r[K.re]]], m = Math.max(1, ...pv.map(([, v]) => Math.abs(v || 0)));
        const x0 = Math.max(150, W * 0.45), half = Math.max(30, Math.min(W - x0 - 90, x0 - 140));
        pv.forEach(([lab, v], i) => {
          const yy = H - profH + i * 32, w = (Math.abs(v || 0) / m) * half;
          s.text("a-pl" + i, 12, yy + 8, lab, "t-ink2", { size: 12.5, weight: 700 });
          s.rect("a-pb" + i, v >= 0 ? x0 : x0 - w, yy, w, 16, v >= 0 ? "f-line" : "f-risk", { from: v >= 0 ? "right" : "left", delay: i * 200 });
          s.text("a-pv" + i, v >= 0 ? x0 + w + 6 : x0 + 6, yy + 8, money(v), v >= 0 ? "t-ink" : "t-risk", { size: 12, weight: 700, delay: i * 200 });
        });
        s.line("a-p0", x0, H - profH - 6, x0, H - profH + 54, "s-ink2");
      }
      s.say(k);
    },
  });

  /* 4 · four health checks */
  const HW_CHECKS = [["X1", "Can it pay this year's bills?", "(current assets − current liabilities) ÷ total assets"], ["X2", "Has it built up savings?", "retained earnings ÷ total assets"], ["X3", "Does the business make money?", "operating profit ÷ total assets"], ["X4", "How thick is the cushion?", "equity ÷ total liabilities"]];
  HW_CHAPTERS.push({
    id: "health", rail: "Health checks", title: "Four health checks",
    steps: (c) => {
      const r = c.r, b = c.best;
      return [
        ["intro", ["The tool turns the seven numbers into ", hwB("four health checks"), ". Each divides one number by another, so a large utility and a small transport company can be compared on the same scale."]],
        ["X1", [hwB("1 · Can it pay this year's bills? "), "(current assets − current liabilities) ÷ total assets. The top part is ", hwB("working capital"), `. ${r.Entity}: `, hwB(pct(r.X1, 1)), ". Below zero means it must find money it does not have."]],
        ["X2", [hwB("2 · Has it built up savings? "), `Retained earnings ÷ total assets. ${r.Entity}: `, hwB(pct(r.X2, 1)), ". Years of losses push this below zero."]],
        ["X3", [hwB("3 · Does the business make money? "), `Operating profit ÷ total assets. ${r.Entity}: `, hwB(pct(r.X3, 1)), "."]],
        ["X4", [hwB("4 · How thick is the cushion? "), `Equity ÷ total liabilities. ${r.Entity}: `, hwB(pct(r.X4, 1)), ". Below zero means it owes more than it owns."]],
        ["compare", ["Now compare ", hwB(b.Entity), ` (${b.Sector}), the healthiest SOE in the data. Its checks are ${["X1", "X2", "X3", "X4"].map((x) => pct(b[x], 1)).join(", ")}: the grey ticks. `, b.Entity === r.Entity ? "It is the example itself." : `Where its tick is to the right of ${r.Entity}'s bar, it is stronger on that check.`]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, r = c.r, narrow = W < 620, order = ["intro", "X1", "X2", "X3", "X4", "compare"], ki = order.indexOf(k);
      /* the axis follows the example SOE; in "compare" it widens a little for the healthiest SOE, but a
         very large check (an equity cushion of several hundred percent, say) is pinned to the edge with
         its value printed, so the example's bars stay readable */
      const mEx = Math.max(0.2, ...HW_CHECKS.map(([x]) => r[x]).filter(ok).map(Math.abs));
      const mB = Math.max(0, ...HW_CHECKS.map(([x]) => c.best[x]).filter(ok).map(Math.abs));
      const m = k === "compare" ? Math.max(mEx, Math.min(mB, Math.max(mEx * 1.6, 0.6))) : mEx, xz = narrow ? W / 2 : W * 0.62, half = narrow ? W / 2 - 20 : W * 0.34, rowH = Math.min(120, (H - 40) / 4);
      s.line("h-zero", xz, 20, xz, 20 + rowH * 4, "s-ink2");
      s.text("h-l", xz - 8, 12, "← warning", "t-risk", { anchor: "end", size: 11, weight: 700 });
      s.text("h-r", xz + 8, 12, "healthy →", "t-health", { size: 11, weight: 700 });
      HW_CHECKS.forEach(([x, q, f], i) => {
        const y = 24 + i * rowH, act = ki === i + 1, shown = ki >= i + 1, dim = ki > 0 && ki <= 4 && !act;
        const tx = narrow ? 12 : 12, ty = narrow ? y + 6 : y + rowH * 0.32;
        s.text("h-q" + x, tx, ty, `${i + 1} · ${q}`, act ? "t-ink t-disp" : "t-ink2 t-disp", { size: narrow ? 12.5 : 14, weight: 800, op: dim ? 0.45 : 1 });
        s.text("h-f" + x, tx, ty + 18, f, "t-ink2", { size: 11, op: act || !narrow ? (dim ? 0.45 : 1) : 0 });
        const v = r[x], w = ok(v) ? (Math.min(Math.abs(v), m) / m) * half : 0, by = narrow ? y + 34 : y + rowH * 0.22, bh = Math.min(28, rowH * 0.36);
        s.rect("h-b" + x, v >= 0 ? xz : xz - (shown ? w : 0), by, shown ? w : 0.0001, bh, v >= 0 ? "f-health" : "f-risk", { from: v >= 0 ? "right" : "left", op: dim ? 0.45 : 1 });
        if (shown) s.text("h-v" + x, v >= 0 ? xz + w + 6 : xz - w - 6, by + bh / 2, pct(v, 1), v >= 0 ? "t-health t-disp" : "t-risk t-disp", { anchor: v >= 0 ? "start" : "end", size: 13, weight: 800, num: v, fmt: (z) => pct(z, 1), op: dim ? 0.45 : 1 });
        if (k === "compare") {
          const bv = c.best[x];
          if (ok(bv)) {
            const cut = Math.abs(bv) > m, bx = xz + (bv >= 0 ? 1 : -1) * (Math.min(Math.abs(bv), m) / m) * half;
            s.line("h-c" + x, bx, by - 6, bx, by + bh + 6, "s-grey w3", { delay: i * 120 });
            s.text("h-cv" + x, bx, by + bh + 19, cut ? (bv >= 0 ? `${pct(bv, 0)} →` : `← ${pct(bv, 0)}`) : pct(bv, 0), "t-ink2", { anchor: cut ? (bv >= 0 ? "end" : "start") : "middle", size: 10.5, weight: 700, delay: i * 120 });
            if (i === 0) s.text("h-ct", bx, by - 14, c.best.Entity, "t-ink2", { anchor: "middle", size: 11, weight: 700 });
          }
        }
      });
      s.say(k);
    },
  });

  /* 5 · one score */
  HW_CHAPTERS.push({
    id: "score", rail: "Score", title: "One distress score, three zones",
    steps: (c) => {
      const r = c.r, w = CFG.ZEM_COEFFICIENTS;
      return [
        ["weights", ["Four numbers are harder to follow than one. So the tool multiplies each check by a fixed ", hwB("weight"), `. Operating profit (×${w.X3}) and this year's bills (×${w.X1}) count most, savings (×${w.X2}) next, the cushion (×${w.X4}) least. The weights come from a method Edward Altman built for companies in emerging markets.`]],
        ["sum", ["Add the four weighted checks and you get the ", hwB("distress score"), ` (Altman Z″-EM). ${r.Entity} scores `, hwB(fmt(r.Z_EM, 2)), ". Higher is healthier."]],
        ["line", [`Put the score on a line. ${r.Entity} sits at ${fmt(r.Z_EM, 2)}.`]],
        ["zones", ["The line has three ", hwB("zones"), `. Below ${fmt(CFG.Z_DISTRESS_CUTOFF, 1)} is `, hwB("distress"), `, up to ${fmt(CFG.Z_SAFE_CUTOFF, 1)} `, hwB("grey"), " (unclear), above that ", hwB("safe"), `. ${r.Entity} is in the ${String(r.Zone).toLowerCase()} zone, ${distressWhy(r)}. The zone warns of weakness; it does not mean the SOE has already needed a rescue.`]],
        ["all", [`Here are all ${pl(c.n, "SOE")} in the data. ${c.zc.Distress} ${c.zc.Distress === 1 ? "is" : "are"} in distress, ${c.zc.Grey} grey and ${c.zc.Safe} safe. This is what the `, hwB("Distress Indicator"), " tab shows, SOE by SOE.", el("br"), hwOpen("altman")]],
        ["try", [hwB("Try it. "), `Move the four checks and watch ${r.Entity}'s dot. Notice how much one weak check can pull the whole score down.`, el("div", { class: "hw-try", "data-try": "1" })]],
      ];
    },
    draw(s, k, c, extra) {
      const { W, H } = s, r = c.r, cf = CFG.ZEM_COEFFICIENTS, narrow = W < 620;
      const xs = extra && extra.try ? extra.try : { X1: r.X1, X2: r.X2, X3: r.X3, X4: r.X4 };
      const contrib = ["X1", "X2", "X3", "X4"].map((x) => [x, (xs[x] || 0) * cf[x]]), z = sum(contrib.map((q) => q[1])) + (CFG.ZEM_CONSTANT || 0);
      if (k === "weights" || k === "sum") {
        /* "weights": one bar per weighted check, all from zero. "sum": the same bars become a waterfall,
           each starting where the previous one ended, and a fifth row shows the total = the score */
        const base = CFG.ZEM_CONSTANT || 0, vals = contrib.map((q) => q[1]); let run = base; const cum = vals.map((v) => (run += v));
        const allv = [0, base, ...vals, ...cum], sc = hwScale(Math.min(...allv), Math.max(...allv), narrow ? 24 : W * 0.34, W - 24, 5);
        const top = narrow ? 56 : 40, rowH = Math.min(66, (H - top - 60) / 5), bh = Math.min(26, rowH * 0.42);
        sc.sc.ticks.forEach((t, i) => s.text("s-tk" + i, sc(t), top + rowH * 5 + 4, tickLab(t, sc.sc.step), "t-ink2", { anchor: "middle", size: 10.5 }));
        s.line("s-zero", sc(0), top - 10, sc(0), top + rowH * 5 - 10, "s-ink2");
        contrib.forEach(([x, v], i) => {
          const a = k === "sum" ? (i ? cum[i - 1] : base) : 0, b = k === "sum" ? cum[i] : v, y = top + i * rowH;
          const lx = narrow ? 24 : 12, ly = narrow ? y - 6 : y + bh / 2 + 4;
          s.rect("s-c" + x, sc(Math.min(a, b)), y, Math.max(1, Math.abs(sc(b) - sc(a))), bh, v >= 0 ? "f-health" : "f-risk", { from: "right", delay: k === "sum" ? i * 160 : i * 100 });
          s.text("s-cl" + x, lx, ly, k === "sum" ? `${HEALTH[x]}  ${sgn(v, 2)}` : `${HEALTH[x]}: ${cf[x]} × ${pct(xs[x], 1)} = ${sgn(v, 2)}`, v >= 0 ? "t-ink" : "t-risk", { size: narrow ? 10.5 : 12, weight: 700 });
          if (k === "sum" && i < 3) s.line("s-k" + x, sc(b), y + bh, sc(b), y + rowH, "s-ink2", { delay: i * 160 + 120 });
        });
        if (k === "sum") {
          const y = top + 4 * rowH, lx = narrow ? 24 : 12;
          s.line("s-k4", sc(z), top + 3 * rowH + bh, sc(z), y, "s-ink2", { delay: 600 });
          s.rect("s-tot", sc(Math.min(base, z)), y, Math.max(1, Math.abs(sc(z) - sc(base))), bh, "f-ink", { from: "right", delay: 700 });
          s.text("s-totl", lx, narrow ? y - 6 : y + bh / 2 + 4, "= distress score", "t-ink t-disp", { size: narrow ? 11 : 13, weight: 800, delay: 700 });
          s.text("s-totv", z >= base ? sc(z) + 8 : sc(z) - 8, y + bh / 2 + 5, fmt(z, 2), "t-ink t-disp", { anchor: z >= base ? "start" : "end", size: 17, weight: 800, delay: 900 });
        }
        s.say(k); return;
      }
      const all = c.rows.map((q) => q.Z_EM).concat([z]).filter(ok);
      const x = hwScale(Math.max(-9, Math.min(-2, ...all)), Math.min(12, Math.max(CFG.Z_SAFE_CUTOFF + 2, ...all)), 24, W - 24, narrow ? 5 : 8), y = H * 0.55;
      const clampX = (v) => x(Math.max(x.sc.lo, Math.min(x.sc.hi, v)));
      s.line("s-axis", 24, y + 22, W - 24, y + 22, "s-ink2");
      x.sc.ticks.forEach((t, i) => s.text("s-tk" + i, x(t), y + 38, tickLab(t, x.sc.step), "t-ink2", { anchor: "middle", size: 11 }));
      s.text("s-ax", W - 24, y + 58, "distress score → healthier", "t-ink2", { anchor: "end", size: 11 });
      if (k !== "line") {
        s.rect("s-zd", x(x.sc.lo), y - 60, x(CFG.Z_DISTRESS_CUTOFF) - x(x.sc.lo), 80, "f-risk-soft", { from: "up" });
        s.rect("s-zg", x(CFG.Z_DISTRESS_CUTOFF), y - 60, x(CFG.Z_SAFE_CUTOFF) - x(CFG.Z_DISTRESS_CUTOFF), 80, "f-amber-soft", { from: "up", delay: 120 });
        s.rect("s-zs", x(CFG.Z_SAFE_CUTOFF), y - 60, x(x.sc.hi) - x(CFG.Z_SAFE_CUTOFF), 80, "f-health-soft", { from: "up", delay: 240 });
        s.text("s-zdl", (x(x.sc.lo) + x(CFG.Z_DISTRESS_CUTOFF)) / 2, y - 74, "Distress", "t-risk t-disp", { anchor: "middle", size: 13, weight: 800 });
        s.text("s-zgl", (x(CFG.Z_DISTRESS_CUTOFF) + x(CFG.Z_SAFE_CUTOFF)) / 2, y - 74, "Grey", "t-amber t-disp", { anchor: "middle", size: 13, weight: 800 });
        s.text("s-zsl", (x(CFG.Z_SAFE_CUTOFF) + x(x.sc.hi)) / 2, y - 74, "Safe", "t-health t-disp", { anchor: "middle", size: 13, weight: 800 });
      }
      if (k === "all" || k === "try") c.rows.forEach((q, i) => { if (q.Entity !== r.Entity) s.circ("s-o-" + q.Entity, clampX(q.Z_EM), y - 6 + ((i % 3) - 1) * 12, 6, "dot-" + zoneCls(q.Zone), { from: "drop", delay: i * 45 }); });
      const zz = E.classifyZone(z);
      s.circ("s-ex", clampX(z), y - 6, 11, "dot-" + zoneCls(zz) + " ex", { from: "pop" });
      s.text("s-exl", clampX(z), y - 100, `${r.Entity} · ${fmt(z, 2)}`, "t-ink t-disp", { anchor: "middle", size: 15, weight: 800 });
      s.line("s-exs", clampX(z), y - 88, clampX(z), y - 20, "s-ink");
      s.say(k);
    },
  });

  /* 6 · rating and chance of distress */
  HW_CHAPTERS.push({
    id: "chance", rail: "Rating & chance", title: "From score to rating to the chance of distress",
    steps: (c) => {
      const r = c.r, pd = E.pdByRating(r.Rating), k = Math.round(pd * 1000);
      return [
        ["ladder", ["Ratings are easier to talk about than scores. The tool cuts the score line into ", hwB("20 steps"), " and gives each a familiar label, from AAA (strongest) down to D (weakest). One step is a ", hwB("notch"), "."]],
        ["ex", [`${r.Entity}'s score of ${fmt(r.Z_EM, 2)} lands on `, hwB(r.Rating), ". Each step covers a range of scores, so an SOE can move inside its step without its rating changing."]],
        ["indicative", ["These are ", hwB("indicative"), " ratings, read off the accounts alone. They are not ratings from S&P, Moody's or Fitch, and they ignore any help the government might give."]],
        ["dots", ["Each step comes with a ", hwB("chance of distress"), ` (PD): the chance that, in a given year, the SOE needs the government to rescue it. For ${r.Rating} it is `, hwB(pctAuto(pd)), `. Picture 1,000 SOEs just like ${r.Entity}: in a typical year about `, hwB(k.toLocaleString("en-US")), " of them would need a rescue."]],
        ["stairs", ["Down the ladder the chance climbs steeply, like a staircase, up to 40% at D. These values are the team's starting assumptions, not observed default history: placeholders to replace when better local evidence exists. Distress here means needing fiscal support, not going to court."]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, r = c.r, T = CFG.Z_RATING_TABLE, narrow = W < 620, pd = E.pdByRating(r.Rating);
      const showLadder = k !== "stairs" && !(narrow && k === "dots");
      const lw = k === "dots" ? Math.min(220, W * 0.36) : Math.min(300, W * 0.5), rh = Math.min(22, (H - 30) / 20), lx = k === "dots" ? 12 : (W - lw) / 2 - (narrow ? 0 : 40), ly = (H - rh * 20) / 2;
      T.forEach(([a, b, name, p], i) => {
        const y = ly + i * rh, on = name === r.Rating && k !== "ladder";
        if (showLadder) {
          s.rect("c-r" + i, lx, y + 1, lw, rh - 2, (p >= 0.16 ? "f-risk-soft" : p >= 0.01 ? "f-amber-soft" : "f-health-soft") + (on ? " s-ink w2" : ""), { from: "right", delay: k === "ladder" ? i * 35 : 0 });
          s.text("c-n" + i, lx + 8, y + rh / 2, name, "t-ink t-disp", { size: Math.min(12, rh - 7), weight: 800, delay: k === "ladder" ? i * 35 : 0 });
          s.text("c-p" + i, lx + lw - 8, y + rh / 2, pctAuto(p), "t-ink2", { anchor: "end", size: Math.min(11, rh - 8), delay: k === "ladder" ? i * 35 : 0 });
          if (name === "BBB-") s.line("c-ig", lx - 6, y + rh, lx + lw + 6, y + rh, "s-line w2");
        }
      });
      if (showLadder && k !== "ladder") {
        const i = T.findIndex((q) => q[2] === r.Rating), y = ly + i * rh + rh / 2;
        s.path("c-mk", `M${lx + lw + 8},${y} l12,-7 v14 z`, "f-ink", {});
        s.text("c-mkl", lx + lw + 26, y, `${r.Entity} · score ${fmt(r.Z_EM, 2)}`, "t-ink t-disp", { size: 13, weight: 800 });
        if (showLadder && ly + 4 * rh > 0) s.text("c-igl", lx + lw + 10, ly + 10 * rh, "investment grade above the line", "t-line", { size: 11, op: k === "dots" ? 0 : 1 });
      }
      if (k === "indicative") s.html("c-stamp", Math.min(W - 230, lx + lw + 24), ly + 12 * rh, 210, "st", () => [el("b", {}, "Indicative only"), el("span", {}, "from the accounts alone, not an agency rating, no government support")], "stamp", { from: "up" });
      if (k === "dots") {
        const gx = narrow ? 14 : lx + lw + 30, gw = W - gx - 14, cols = 40, g = Math.min(gw / cols, (H - 60) / 25), kk = Math.round(pd * 1000), y0 = 20;
        for (let i = 0; i < 1000; i++) s.circ("c-d" + i, gx + (i % cols) * g + g / 2, y0 + Math.floor(i / cols) * g + g / 2, g * 0.36, i < kk ? "dot-riskf" : "dot-mute", { from: "pop", delay: i < kk ? Math.min(900, i * 3) : 0 });
        s.text("c-dl", gx + (cols * g) / 2, y0 + 25 * g + 22, `${kk.toLocaleString("en-US")} of 1,000 need a rescue in a typical year`, "t-ink t-disp", { anchor: "middle", size: 14, weight: 800 });
      }
      if (k === "stairs") {
        const x = lin(0, 19, 50, W - 24), y = hwScale(0, 0.42, H - 50, 24, 4);
        y.sc.ticks.forEach((t, i) => { s.line("c-g" + i, 50, y(t), W - 24, y(t), "s-rule"); s.text("c-gt" + i, 44, y(t), fmt(t * 100, 0) + "%", "t-ink2", { anchor: "end", size: 10.5 }); });
        const rev = T.slice().reverse(); // AAA ... D from left (strong) to right (weak)? keep AAA on the left
        let d = "";
        T.forEach(([, , name, p], i) => { const x0 = x(i) - (x(1) - x(0)) / 2, x1 = x(i) + (x(1) - x(0)) / 2; d += (i ? `V${y(p).toFixed(1)}` : `M${x0.toFixed(1)},${y(p).toFixed(1)}`) + `H${x1.toFixed(1)}`; });
        s.path("c-st", d, "s-risk w3 nofill", { draw: true, dur: 1500 });
        T.forEach(([, , name], i) => { if (i % (narrow ? 4 : 2) === 0 || name === r.Rating) s.text("c-sx" + i, x(i), H - 30, name, name === r.Rating ? "t-ink t-disp" : "t-ink2", { anchor: "middle", size: 10.5, weight: name === r.Rating ? 800 : 400 }); });
        const ie = T.findIndex((q) => q[2] === r.Rating);
        s.circ("c-se", x(ie), y(pd), 7, "dot-risk ex", { from: "pop", delay: 900 });
        s.text("c-sel", x(ie), y(pd) - 18, `${r.Entity}: ${pctAuto(pd)}`, "t-ink t-disp", { anchor: x(ie) > W - 80 ? "end" : "middle", size: 13, weight: 800, delay: 900 });
        s.text("c-sxl", W - 24, H - 12, "rating step: strongest → weakest", "t-ink2", { anchor: "end", size: 11 });
        void rev;
      }
      s.say(k);
    },
  });

  /* 7 · expected fiscal cost */
  HW_CHAPTERS.push({
    id: "cost", rail: "Expected cost", title: "Expected fiscal cost: a money figure for the risk",
    steps: (c) => {
      const r = c.r, e = c.efc(r), tot = sum(c.rows.map((q) => c.efc(q).EFC)), top3 = c.rows.map((q) => [q.Entity, c.efc(q).EFC]).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return [
        ["ead", ["Now the risk gets a money figure. Start with ", hwB("how much is at stake"), `: the exposure at default (EAD). As a starting assumption the tool counts ${pct0(S.efc.ead)} of what ${r.Entity} owes, `, hwB(money(e.EAD, true)), ", as if the government stands behind the whole company."]],
        ["lgd", ["Next, ", hwB("how much of it the government would bear"), ": the loss given default (LGD). Part of the debt can be recovered by selling assets or restructuring. The tool assumes the government ends up bearing ", hwB(`${fmt(S.efc.lgd, 0)}%`), "."]],
        ["pd", ["Then ", hwB("how likely trouble is"), ": the chance of distress from the last chapter, ", hwB(pctAuto(e.PD)), "."]],
        ["efc", [`Multiply them: ${money(e.EAD)} × ${fmt(S.efc.lgd, 0)}% × ${pctAuto(e.PD)} = `, hwB(money(e.EFC, true)), `. This is ${r.Entity}'s `, hwB("expected fiscal cost"), ". You can change the share at stake and the share the government bears on the Expected Fiscal Cost tab and in Shock Scenarios."]],
        ["average", [el("i", {}, "Expected"), ` means average. Imagine the same year playing out many times. In most of them ${r.Entity} survives without help and costs the budget nothing; in a few it needs a rescue of up to ${money(e.EAD * e.LGD, true)}. The average across all of them is the expected cost. It is not the bill if the SOE fails.`]],
        ["portfolio", [`Add up all ${pl(c.n, "SOE")} and you get the portfolio's expected cost: `, hwB(money(tot, true)), `. The three largest, ${top3.map((x) => x[0]).join(", ")}, make up ${pct(tot ? sum(top3.map((x) => x[1])) / tot : NaN, 0)} of it. This sum, from the latest accounts, is on the `, hwB("Expected Fiscal Cost"), " tab.", el("br"), hwOpen("efc")]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, r = c.r, e = c.efc(r), order = ["ead", "lgd", "pd", "efc", "average", "portfolio"], ki = order.indexOf(k);
      if (k === "portfolio") {
        const v = c.rows.map((q) => [q, c.efc(q).EFC]).sort((a, b) => b[1] - a[1]).slice(0, 12), mx = Math.max(1e-9, ...v.map((q) => q[1])), lw = Math.min(110, W * 0.25), rh = Math.min(30, (H - 90) / v.length);
        v.forEach(([q, ef], i) => {
          const y = 30 + i * rh, w = ((W - lw - 100) * ef) / mx;
          s.text("o-l" + q.Entity, 12, y + rh / 2, clip(q.Entity, 14), q.Entity === r.Entity ? "t-ink t-disp" : "t-ink2", { size: 12, weight: 700 });
          s.rect("o-b" + q.Entity, lw, y + 4, w, rh - 8, i < 3 ? "f-risk" : q.Entity === r.Entity ? "f-line" : "f-line-mid", { from: "right", delay: i * 60 });
          s.text("o-v" + q.Entity, lw + w + 6, y + rh / 2, money(ef), "t-ink2", { size: 11.5, delay: i * 60 });
        });
        s.text("o-t", 12, 12, `Expected fiscal cost by SOE, latest accounts · total ${money(sum(c.rows.map((q) => c.efc(q).EFC)), true)}`, "t-ink t-disp", { size: 13, weight: 800 });
        const more = c.rows.length - v.length, rest = sum(c.rows.map((q) => c.efc(q).EFC)) - sum(v.map((q) => q[1]));
        s.text("o-n", 12, 30 + v.length * rh + 18, more > 0 ? `+ ${pl(more, "smaller SOE")} not drawn: ${money(rest)} together, included in the total` : "", "t-ink2", { size: 11.5, op: more > 0 ? 1 : 0 });
        s.say(k); return;
      }
      const x0 = 24, full = W - 48, y0 = H * 0.26, bh = Math.min(84, H * 0.2);
      s.rect("o-ead", x0, y0, full, bh, "f-line-soft s-line", { from: "right" });
      s.text("o-eadl", x0, y0 - 14, `At stake (EAD): ${money(e.EAD, true)}`, "t-line t-disp", { size: 14, weight: 800 });
      if (ki >= 1) {
        s.rect("o-lgd", x0, y0, full * e.LGD, bh, "f-line", { from: "right" });
        s.text("o-lgdl", x0 + full * e.LGD - 8, y0 + bh + 18, `Government bears ${pct0(e.LGD)}: ${money(e.EAD * e.LGD)}`, "t-line", { anchor: "end", size: 12.5, weight: 700 });
      }
      if (ki >= 2) {
        const w = Math.max(3, full * e.LGD * e.PD);
        s.rect("o-pd", x0, y0, w, bh, "f-risk", { from: "right" });
        s.text("o-pdl", x0 + w + 8, y0 + bh / 2, `× chance ${pctAuto(e.PD)}`, "t-on t-disp", { size: 13, weight: 800 });
      }
      if (ki >= 3 && ki < 4) {
        s.text("o-big", W / 2, H * 0.7, money(e.EFC, true), "t-risk t-disp", { anchor: "middle", size: Math.min(44, W / 12), weight: 800, num: e.EFC, fmt: (v) => money(v, true), dur: 1200 });
        s.text("o-bigl", W / 2, H * 0.7 + 34, "expected fiscal cost", "t-ink2", { anchor: "middle", size: 13 });
      }
      if (k === "average") {
        const n = 20, red = Math.max(1, Math.round(e.PD * n)), bw = Math.min(40, (W - 48) / n - 4), y = H * 0.62;
        for (let i = 0; i < n; i++) {
          const rescue = i < red;
          s.rect("o-y" + i, 24 + i * (bw + 4), y, bw, rescue ? 70 : 6, rescue ? "f-risk" : "f-rule", { from: "up", delay: i * 50 });
        }
        s.text("o-yl", 24, y - 18, `${n} possible years: a rescue in ${red}, nothing in ${n - red}`, "t-ink t-disp", { size: 13, weight: 800 });
        s.text("o-ya", 24, y + 96, `Average over all of them: ${money(e.EFC, true)}`, "t-risk t-disp", { size: 14, weight: 800 });
      }
      s.say(k);
    },
  });
  /* 8 · shocks: what if next year goes badly? */
  const HW_SH_LVL = { intro: 0, hit: 1, profit: 2, cash: 2.5, balance: 3, checks: 4, result: 5 };
  /* one-line node names for the phone layout */
  const HW_SH_SHORT = { rev: "Revenue", cost: "Op. costs", int: "Interest", ebit: "Op. profit", ni: "Net income", gap: "Borrowing", ca: "Curr. assets", debt: "Debt", eq: "Equity", X1: "1 Bills", X2: "2 Savings", X3: "3 Profit", X4: "4 Cushion", z: "Score", pd: "Chance", efc: "Exp. cost" };
  HW_CHAPTERS.push({
    id: "shocks", rail: "Shocks", title: "What if next year goes badly? How a shock travels", picker: true,
    steps: (c) => {
      const id = c.st.shock, t = howShock(id), d = c.shock(id), r = c.r, v = d.v, f = d.f, fb = d.fb;
      const sm = (x) => (Math.abs(x) < 1e-6 ? "no change" : (x > 0 ? "+" : "−") + money(Math.abs(x)));
      const sg = c.singles();
      const sizeTxt = id === "standard" ? "all six shocks at their standard sizes" : `the standard size, ${id === "rates" ? bpsF(t.guide.standard) + " (and refinancing " + bpsF(STD_MAG.refinancing_spread_bps) + ")" : id === "revenue" ? `${sgn(t.guide.standard, 1)} s.d. of its own revenue growth (${pctSig(t.guide.standard * volFor(r.Entity, r.Sector)[0])})` : id === "arrears" ? pct0(t.guide.standard) + " of revenue a year" : id === "fx" ? "a " + pct0(t.guide.standard) + " fall in the currency" : pctSig(t.guide.standard)}`;
      return [
        ["intro", ["So far we used one year of accounts. But what if fuel gets dearer, the currency falls, rates rise, sales drop or the government stops paying its bills? A ", hwB("shock"), " is such a ‘what if’, applied to the accounts. The tool rolls the accounts forward ", hwB(`${CFG.MC_HORIZON_YEARS} years`), `; the shock lasts ${CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years} of them (magenta). `, hwB("Choose a shock above the picture"), `. Shown now: ${t.label}, at ${sizeTxt}.`]],
        ["hit", [hwB("1 · It hits a line of the accounts. "), `${t.what} ${t.who}`, el("br"), hwB("Direction: "), t.direction]],
        ["profit", [hwB("2 · Profit moves. "), `In ${d.y1["Calendar Year"]}, ${r.Entity}'s operating profit changes by `, hwB(sm(v.ebit)), " and its net income by ", hwB(sm(v.ni)), ` against the no-shock path${Math.abs(v.ebit) < 1e-6 && Math.abs(v.ni) < 1e-6 ? ": this shock does not go through profit" : ""}.`]],
        ["cash", [hwB("3 · A cash gap opens. "), "When income no longer covers the bills, the SOE has to find the money. By default it borrows to fill the gap, so it ends up owing more. Extra cash gap over the projection: ", hwB(sm(v.gap)), "."]],
        ["balance", [hwB("4 · The balance sheet weakens. "), `By ${f["Calendar Year"]}, debt changes by `, hwB(sm(v.debt)), " and equity by ", hwB(sm(v.eq)), id === "arrears" ? "; current assets fall by " + sm(-v.ca).replace("+", "") + " as the unpaid bills are written off." : "."]],
        ["checks", [hwB("5 · The health checks fall. "), `Less profit, more debt and less equity weaken the four checks. Their weighted change by ${f["Calendar Year"]}: bills ${sgn(v.X1, 2)}, savings ${sgn(v.X2, 2)}, profit ${sgn(v.X3, 2)}, cushion ${sgn(v.X4, 2)} points.`]],
        ["result", [hwB("6 · The score, the chance and the cost move. "), `The distress score goes from ${fmt(fb.Z_EM, 2)} to `, hwB(fmt(f.Z_EM, 2)), `; the chance of distress from ${pctAuto(fb.PD)} to ${pctAuto(f.PD)}; the expected fiscal cost from ${money(fb.EFC)} to `, hwB(money(f.EFC, true)), f.Rating === fb.Rating && Math.abs(v.z) > 0.005 ? `. The score moved but stayed on the ${f.Rating} step, so the chance did not change: only the larger debt raised the cost.` : "."]],
        ["paths", ["Every result is compared with the same SOE's ", hwB("no-shock path"), ": its accounts rolled forward with nothing going wrong. The gap between the two lines is the effect of the shock alone. When the shock ends, profit recovers, but the extra debt stays, so the damage lasts to the end."]],
        ["together", [hwB("Shocks make each other worse. "), `For ${r.Entity}, the six standard shocks one at a time add ${sm(sg.sum)} to the final-year cost; all six together add `, hwB(sm(sg.all)), ". Each adds debt and interest that the others then build on, and a weaker score can drop the SOE a rating step, where the chance of distress jumps. Try any of this on the ", hwB("Shock Scenarios"), " tab.", el("br"), el("button", { class: "hw-open", type: "button", onclick: () => pages.how.tryIt(r, id) }, `Open ${id === "standard" ? "the standard stress" : "this shock"} for ${r.Entity} →`)]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, id = c.st.shock, t = howShock(id), d = c.shock(id), hits = HOW_HITS[id], narrow = W < 700, r = c.r;
      // the shock picker lives on the stage; the content starts below it (it wraps to two rows on a phone)
      const pickEl = s.html("sh-pick", 10, 8, W - 20, id + W, () => [el("div", { class: "hw-pick", role: "radiogroup", "aria-label": "Choose a shock" }, [...SHOCK_ORDER, "standard"].map((sid) =>
        el("button", { type: "button", role: "radio", class: "hw-chip" + (sid === "standard" ? " std" : ""), "aria-checked": String(sid === id), onclick: () => pages.how.setShock(sid) }, howShock(sid).label.replace(" (currency fall)", "").replace(" (any cause)", "").replace(" (all at once)", ""))))], "pick");
      const top = Math.max(58, 8 + (pickEl.offsetHeight || 40) + 14);
      if (k === "intro") {
        const n = CFG.MC_HORIZON_YEARS + 1, bw = (W - 40) / n, y = H * 0.48;
        for (let i = 0; i < n; i++) {
          const on = i >= 1 && i <= CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years;
          s.rect("sh-y" + i, 20 + i * bw + 4, y, bw - 8, 54, on ? "f-shock-soft s-shock" : "f-surface s-rule", { from: "up", delay: i * 120 });
          s.text("sh-yt" + i, 20 + i * bw + bw / 2, y + 20, "Year " + i, "t-ink t-disp", { anchor: "middle", size: 15, weight: 800, delay: i * 120 });
          s.text("sh-yy" + i, 20 + i * bw + bw / 2, y + 40, String(r.Year + i) + (i === 0 ? " · accounts" : " · projected"), "t-ink2", { anchor: "middle", size: 11.5, delay: i * 120 });
        }
        const x1 = 20 + bw + 4, x2 = 20 + (CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years + 1) * bw - 4;
        s.rect("sh-on", x1, y + 66, x2 - x1, 5, "f-shock", { from: "right", delay: 500 });
        s.text("sh-onl", (x1 + x2) / 2, y + 86, "Shock on", "t-shock t-disp", { anchor: "middle", size: 14, weight: 800, delay: 500 });
        s.say(k); return;
      }
      if (k in HW_SH_LVL) {
        const lvl = HW_SH_LVL[k], groups = [["sh", "Shock", 0, [["shock", t.label]]], ...HOW_NODES];
        const vals = d.v, f = d.f, fb = d.fb;
        const sm = (x) => (Math.abs(x) < 1e-6 ? "no change" : (x > 0 ? "+" : "−") + money(Math.abs(x)));
        const vtxt = { cost: id === "fuel" ? sm(vals.cost) + " fuel bill" : "", int: sm(vals.int), ebit: sm(vals.ebit), ni: sm(vals.ni), gap: sm(vals.gap), ca: sm(vals.ca), debt: sm(vals.debt), eq: sm(vals.eq),
          X1: sgn(vals.X1, 2) + " pts", X2: sgn(vals.X2, 2) + " pts", X3: sgn(vals.X3, 2) + " pts", X4: sgn(vals.X4, 2) + " pts", z: `${fmt(fb.Z_EM, 2)} → ${fmt(f.Z_EM, 2)}`, pd: `${pctAuto(fb.PD)} → ${pctAuto(f.PD)}`, efc: sm(vals.efc), shock: "" };
        const tiny = (nk) => { const x = vals[nk]; if (x === null || x === undefined || !ok(x)) return false; return ["X1", "X2", "X3", "X4", "z"].includes(nk) ? Math.abs(x) < 0.005 : nk === "pd" ? Math.abs(x) < 1e-6 : Math.abs(x) < Math.max(1, Math.abs(fb.EFC || 0)) * 1e-6; };
        const focus = { hit: ["rev", "cost", "int", "ca", "debt"], profit: ["ebit", "ni"], cash: ["gap"], balance: ["ca", "debt", "eq"], checks: ["X1", "X2", "X3", "X4"], result: ["z", "pd", "efc"] }[k] || [];
        const G = groups.length, maxN = Math.max(...groups.map((g) => g[3].length)), wideH = Math.max(52, Math.min(84, (H - top - 60) / maxN - 12));
        groups.forEach(([gk, gl, gLvl, nodes], gi) => {
          const reached = gLvl <= lvl || (gk === "cash" && lvl >= 2);
          let gx, gy, nw, nh = 50;
          if (!narrow) { const cw = (W - 20) / G; gx = 10 + gi * cw; nw = cw - 16; gy = top + 28; nh = wideH; s.text("sh-gh" + gk, gx + 4, top + 12, gl.toUpperCase(), "t-ink2", { size: 10.5, weight: 800, op: reached ? 1 : 0.35 }); if (gi) s.text("sh-ga" + gk, gx - 8, gy + nh / 2 + 6, "→", "t-ink2", { anchor: "middle", size: 18, weight: 800, op: reached ? 1 : 0.3 }); }
          else { const rh = (H - top - 4) / G; gy = top + gi * rh + 13; gx = 10; nw = (W - 20 - (nodes.length - 1) * 5) / nodes.length; nh = rh - 16; s.text("sh-gh" + gk, 12, gy - 5, gl.toUpperCase(), "t-ink2", { size: 9.5, weight: 800, op: reached ? 1 : 0.35 }); }
          nodes.forEach(([nk, nl], ni) => {
            const role = gk === "sh" ? "p" : hits.p.includes(nk) ? "p" : hits.s.includes(nk) ? "s" : "off";
            const lit = reached && role !== "off", zero = lit && role === "s" && tiny(nk);
            const x = narrow ? gx + ni * (nw + 5) : gx, y = narrow ? gy : gy + ni * (nh + 10);
            const cls = "node " + (lit ? (zero ? "s zero" : role) : role === "off" && reached ? "off" : "wait") + (focus.includes(nk) && lit ? " focus" : "") + (narrow ? " xs" : "");
            let val = gk === "sh" ? (id === "standard" ? "all six" : "standard size") : !reached ? "" : role === "off" ? "not moved" : zero ? "no change by " + f["Calendar Year"] : vtxt[nk] || (nk === "rev" ? (id === "revenue" ? "falls" : "moves") : "rises");
            if (narrow) val = gk === "sh" ? "" : focus.includes(nk) && lit ? (zero ? "no change" : (vtxt[nk] || "").replace(" fuel bill", "")) : "";
            const lab = narrow ? HW_SH_SHORT[nk] || nl : nl;
            s.html("sh-n-" + nk, x, y, nw, [cls, val, lab, nw].join("|"), () => [el("b", {}, lab), val ? el("small", {}, val) : null], cls, { from: "up", delay: reached && !narrow ? ni * 90 : 0, h: nh });
          });
        });
        s.say(k); return;
      }
      if (k === "paths") {
        const b = d.base.map((q) => q.EFC), p = d.path.map((q) => q.EFC), xs = d.path.map((q) => q["Calendar Year"]);
        const x = lin(0, xs.length - 1, narrow ? 52 : 70, W - (narrow ? 24 : 150)), lo0 = Math.min(...p, ...b), hi0 = Math.max(...p, ...b), pad = Math.max((hi0 - lo0) * 0.35, Math.abs(hi0) * 0.04, 1e-9), y = hwScale(Math.max(0, lo0 - pad), hi0 + pad * 0.6, H - 40, top + (narrow ? 44 : 30), 5);
        const gx0 = narrow ? 52 : 70;
        y.sc.ticks.forEach((tk, i) => { s.line("sh-g" + i, gx0, y(tk), W - (narrow ? 16 : 30), y(tk), "s-rule"); s.text("sh-gt" + i, gx0 - 8, y(tk), moneyTick(tk, y.sc.step), "t-ink2", { anchor: "end", size: 11 }); });
        s.rect("sh-band", x(1) - 10, top + (narrow ? 40 : 26), x(Math.min(CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, xs.length - 1)) - x(1) + 20, H - top - (narrow ? 80 : 66), "f-shock-soft", { from: "up" });
        const pts = (a) => a.map((v, i) => [x(i), y(v)]);
        s.path("sh-area", smoothPath(pts(p)) + smoothPath(pts(b).slice().reverse(), false) + "Z", "f-shock-area");
        s.path("sh-lb", smoothPath(pts(b)), "s-grey w3 nofill", { draw: true });
        s.path("sh-lp", smoothPath(pts(p)), "s-shock w3 nofill", { draw: true, delay: 300 });
        const ex = x(xs.length - 1) + (narrow ? 0 : 8), ea = narrow ? "end" : "start";
        s.text("sh-lbl", ex, y(last(b)) + (narrow ? 16 : 12), `no shock ${money(last(b))}`, "t-ink2", { anchor: ea, size: 12 });
        s.text("sh-lpl", ex, y(last(p)) - 12, `${id === "standard" ? "standard stress" : narrow ? "shock" : t.label.toLowerCase()} ${money(last(p))}`, "t-shock t-disp", { anchor: ea, size: 12.5, weight: 800 });
        xs.forEach((yv, i) => s.text("sh-x" + i, x(i), H - 22, i ? String(yv) : yv + " now", "t-ink2", { anchor: "middle", size: 11 }));
        s.text("sh-yl", gx0, top + 16, `Expected fiscal cost, ${r.Entity}`, "t-ink t-disp", { size: 13, weight: 800 });
        s.text("sh-yl0", narrow ? gx0 : W - 30, top + (narrow ? 32 : 16), y.sc.lo > 0 ? "axis zoomed in, does not start at 0" : "", "t-ink2", { anchor: narrow ? "start" : "end", size: 10.5, op: y.sc.lo > 0 ? 1 : 0 });
        s.say(k); return;
      }
      if (k === "together") {
        const sg = c.singles(), items = [...sg.ch, ["One at a time, added up", sg.sum], ["All six together", sg.all]];
        const mx = Math.max(1e-9, ...items.map((q) => Math.abs(q[1]))), lw = Math.min(190, W * 0.4), rh = Math.min(34, (H - top - 40) / items.length);
        items.forEach(([lab, v], i) => {
          const y = top + 20 + i * rh, w = ((W - lw - 110) * Math.abs(v)) / mx, last2 = i >= items.length - 2;
          s.text("sh-tl" + i, 12, y + rh / 2, lab, last2 ? "t-ink t-disp" : "t-ink2", { size: 12.5, weight: last2 ? 800 : 600 });
          s.rect("sh-tb" + i, lw, y + 5, w, rh - 10, i === items.length - 1 ? "f-shock" : i === items.length - 2 ? "f-grey" : "f-shock-soft s-shock", { from: "right", delay: i * 90 });
          s.text("sh-tv" + i, lw + w + 6, y + rh / 2, (v >= 0 ? "+" : "−") + money(Math.abs(v)), "t-ink", { size: 12, weight: 700, delay: i * 90 });
          if (i === items.length - 3) s.line("sh-tsep", 12, y + rh + 2, W - 12, y + rh + 2, "s-rule");
        });
        s.say(k); return;
      }
    },
  });

  /* 9 · many possible futures */
  HW_CHAPTERS.push({
    id: "mc", rail: "Many futures", title: "Many possible futures (Monte Carlo)",
    steps: (c) => {
      const m = c.mc(), r = c.r;
      if (!m) return [["one", ["The simulation could not run for this SOE with these settings."]]];
      return [
        ["one", [`A scenario asks ‘what if fuel rises by ${pctSig(m.fuel0)} and the currency falls ${pct0(m.fx0)}?’ That is one point (the dark dot). But nobody knows whether fuel will rise 15% or 40%.`]],
        ["cloud", [hwB("Monte Carlo simulation"), ` tries many sizes. The tool draws ${m.pts.length} random combinations of fuel and currency shocks around the standard stress. Each dot is one `, hwB("draw"), ": one possible future. Most are close to the standard sizes, a few are extreme, and fuel and the currency tend to move together."]],
        ["run", [`The tool runs ${r.Entity}'s accounts through each future, exactly as in chapter 8, and records the expected fiscal cost in the final year. Darker dots are futures that cost more.`]],
        ["hist", ["Stack the futures by their cost and you get a spread of outcomes. The middle one, the ", hwB("median (P50)"), ", is ", hwB(money(m.p50, true)), "."]],
        ["p95", ["One future in twenty comes out worse than ", hwB(money(m.p95, true)), ". That is the ", hwB("P95"), ", sometimes called fiscal-at-risk: a bad case, not a maximum. It is in Shock Scenarios › Monte Carlo simulation."]],
        ["caution", [hwB("Be careful with P95. "), `It is still an `, el("i", {}, "expected"), ` cost, averaged over the chance of distress. It shows how high the expected bill gets when the shock turns out bad. It is `, hwB("not"), ` the bill if ${r.Entity} actually fails. Inside the simulation the chance of distress comes from a smooth curve instead of the rating steps, so small changes count; that is why its numbers can differ from the other tabs.`]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, m = c.mc();
      if (!m) { s.text("m-none", W / 2, H / 2, "No simulation", "t-ink2", { anchor: "middle", size: 14 }); s.say(k); return; }
      const L = 64, R = 24, T = 30, B = 50, pts = m.pts;
      const scatter = k === "one" || k === "cloud" || k === "run";
      const fx = hwScale(Math.min(...pts.map((p) => p.fuel)), Math.max(...pts.map((p) => p.fuel)), L, W - R, 5), fy = hwScale(Math.min(...pts.map((p) => p.fx)), Math.max(...pts.map((p) => p.fx)), H - B, T, 4);
      const ex = hwScale(Math.min(...pts.map((p) => p.efc)), Math.max(...pts.map((p) => p.efc)), L, W - R, 5);
      const qs = pts.map((p) => p.efc).slice().sort((a, b) => a - b), rank = (v) => qs.findIndex((q) => q >= v) / qs.length;
      if (scatter) {
        fx.sc.ticks.forEach((t, i) => s.text("m-xt" + i, fx(t), H - B + 18, pctSig(t), "t-ink2", { anchor: "middle", size: 11 }));
        fy.sc.ticks.forEach((t, i) => s.text("m-yt" + i, L - 8, fy(t), "−" + pct0(t), "t-ink2", { anchor: "end", size: 11 }));
        s.text("m-xl", W - R, H - 14, "fuel price change →", "t-ink2", { anchor: "end", size: 11.5, weight: 700 });
        s.text("m-yl", L, T - 14, "↑ currency fall", "t-ink2", { size: 11.5, weight: 700 });
      } else {
        ex.sc.ticks.forEach((t, i) => s.text("m-xt" + i, ex(t), H - B + 18, moneyTick(t, ex.sc.step), "t-ink2", { anchor: "middle", size: 11 }));
        s.text("m-xl", W - R, H - 14, "expected fiscal cost in the final year →", "t-ink2", { anchor: "end", size: 11.5, weight: 700 });
        s.text("m-yl", L, T - 14, "number of futures", "t-ink2", { size: 11.5, weight: 700 });
      }
      s.line("m-ax", L, H - B, W - R, H - B, "s-ink2");
      // histogram positions
      const nb = 26, lo = ex.sc.lo, hi = ex.sc.hi, bwv = (hi - lo) / nb, cnt = new Array(nb).fill(0), pos = [];
      pts.forEach((p) => { const b = Math.min(nb - 1, Math.max(0, Math.floor((p.efc - lo) / bwv))); pos.push([b, cnt[b]++]); });
      const step = Math.min(9, (H - B - T - 10) / Math.max(...cnt)), rr = Math.max(1.8, Math.min(3.6, step / 2 - 0.3));
      pts.forEach((p, i) => {
        let x, y, cls = "dot-sh";
        if (scatter) { x = fx(p.fuel); y = fy(p.fx); if (k === "run") { const q = rank(p.efc); cls = "dot-q" + Math.min(4, Math.floor(q * 5)); } }
        else { const [b, j] = pos[i]; x = ex(lo + (b + 0.5) * bwv); y = H - B - (j + 0.5) * step; const q = rank(p.efc); cls = "dot-q" + Math.min(4, Math.floor(q * 5)); }
        if (k === "one") s.circ("m-d" + i, x, y, rr, cls, { op: 0 }); else s.circ("m-d" + i, x, y, rr, cls, { from: "pop", delay: k === "cloud" ? i * 4 : k === "hist" ? (i % 60) * 12 : 0 });
      });
      if (scatter) { s.circ("m-std", fx(m.fuel0), fy(m.fx0), 8, "dot-ink", { from: "pop" }); s.text("m-stdl", fx(m.fuel0) + 12, fy(m.fx0) - 12, "standard stress", "t-ink t-disp", { size: 12.5, weight: 800 }); }
      if (k === "hist" || k === "p95" || k === "caution") {
        s.line("m-p50", ex(m.p50), T, ex(m.p50), H - B, "s-ink w2", { delay: 400 });
        s.text("m-p50l", ex(m.p50) + 6, T + 10, `P50 ${money(m.p50)}`, "t-ink t-disp", { size: 12.5, weight: 800, delay: 400 });
      }
      if (k === "p95" || k === "caution") {
        s.rect("m-tail", ex(m.p95), T, W - R - ex(m.p95), H - B - T, "f-risk-soft", { from: "right" });
        s.line("m-p95", ex(m.p95), T, ex(m.p95), H - B, "s-risk w2");
        s.text("m-p95l", Math.min(W - R - 4, ex(m.p95) + 6), T + 30, `P95 ${money(m.p95)}`, "t-risk t-disp", { anchor: ex(m.p95) > W - 140 ? "end" : "start", size: 12.5, weight: 800 });
      }
      if (k === "caution") s.html("m-warn", Math.max(12, W / 2 - 170), T + 30, Math.min(340, W - 24), "w", () => [el("b", {}, "Expected cost, not the bill if the SOE fails"), el("span", {}, "Each future is an average over rescue and no rescue.")], "warn", { from: "up" });
      s.say(k);
    },
  });

  /* 10 · the whole portfolio, and checking the model */
  HW_CHAPTERS.push({
    id: "portfolio", rail: "Portfolio & check", title: "The whole portfolio under one shock, and checking the model",
    steps: (c) => {
      const mc = c.macro(), top = mc.res.slice(0, 3), bt = c.bt(), fl = mc.res.find((x) => x.flag);
      return [
        ["macro", ["What if one broad shock hits ", hwB("every"), " SOE at once, like a pandemic or a commodity slump? Shock Scenarios › ", hwB("Portfolio macro shock"), " applies the same revenue fall (here −10%) and rise in borrowing costs (+200 bps) to all SOEs, many times with a varying severity, each with its own exposures."]],
        ["rank", ["The answer is a ", hwB("ranking, not a total"), `. It is nearly impossible for all SOEs to fail at once, so the question is which ones drive the cost. Here: `, hwB(top.map((x) => x.q.Entity).join(", ")), ` add ${pct(sum(top.map((x) => Math.max(0, x.med))) / (mc.tot || 1), 0)} of the extra cost. Dots are the middle outcome; lines show the range.`]],
        ["flag", ["The ranking also ", hwB("checks the model"), ". If an SOE that holds little of the portfolio's debt comes out on top, look at its data first. ", fl ? `Here ${fl.q.Entity} ranks high with only ${pct(fl.tl, 0)} of the debt: worth a look.` : "Here no SOE is flagged: the ranking follows where the debt and the weakness are."]],
        ["backtest", bt ? ["Another check: ", hwB("Model check"), ` starts the model from ${c.r.Entity}'s ${bt.b0.Year} accounts, lets a shock hit in ${bt.year} (here a 10% revenue fall, like COVID-19 in 2020), and draws the projected distress score next to the score in the accounts of the following years.`] : [`${c.r.Entity} has only one year of data, so the model check needs another SOE.`]],
        ["gap", bt ? ["There is always a gap: the model holds revenue and costs at their starting levels except for the shock, while real years bring other changes too. Here the projection is on average ", hwB(`${fmt(bt.gap, 2)} points`), ` from the accounts (${fmt(bt.gapN, 2)} without the shock). Small gaps and the same direction give confidence; large ones say where the model misses something.`, el("br"), hwOpen("shock", "Open Shock Scenarios →")] : ["Pick an SOE with several years of data to see the check."]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, narrow = W < 620;
      if (k === "macro" || k === "rank" || k === "flag") {
        const mc = c.macro(), res = mc.res.slice(0, Math.min(10, mc.res.length)), lw = narrow ? 96 : 150, rh = Math.min(52, (H - 70) / res.length);
        const x = hwScale(Math.min(0, ...res.map((q) => q.lo)), Math.max(...res.map((q) => q.hi)), lw + 10, W - 80, 4);
        x.sc.ticks.forEach((t, i) => { s.line("p-g" + i, x(t), 30, x(t), 30 + res.length * rh, "s-rule"); s.text("p-gt" + i, x(t), 30 + res.length * rh + 16, moneyTick(t, x.sc.step), "t-ink2", { anchor: "middle", size: 10.5 }); });
        s.text("p-t", 12, 14, "Rise in expected fiscal cost under the macro shock", "t-ink t-disp", { size: 13, weight: 800 });
        res.forEach((q, i) => {
          const y = 30 + i * rh + rh / 2, hl = k !== "macro" && i < 3, fl = k === "flag" && q.flag;
          s.text("p-l" + q.q.Entity, 12, y - (narrow ? 0 : 6), `${i + 1}. ${clip(q.q.Entity, narrow ? 11 : 18)}`, hl ? "t-risk t-disp" : "t-ink t-disp", { size: 12.5, weight: 800 });
          if (!narrow) s.text("p-s" + q.q.Entity, 12, y + 9, `${q.q.Sector} · ${pct(q.tl, 0)} of debt`, "t-ink2", { size: 10.5 });
          s.line("p-w" + q.q.Entity, x(q.lo), y, x(q.hi), y, hl ? "s-risk w3 soft" : "s-grey w3 soft", { from: "grow", delay: i * 70 });
          s.circ("p-d" + q.q.Entity, x(q.med), y, hl ? 7 : 5.5, hl ? "dot-riskf" : "dot-mute2", { from: "pop", delay: i * 70 });
          s.text("p-v" + q.q.Entity, x(q.hi) + 8, y, (q.med >= 0 ? "+" : "−") + money(Math.abs(q.med)), "t-ink2", { size: 11.5, weight: 700 });
          if (fl) s.text("p-f" + q.q.Entity, x(q.hi) + 8, y + 14, "⚠ check data", "t-risk", { size: 11, weight: 800 });
        });
        if (k !== "macro" && !narrow) s.html("p-note", W - Math.min(260, W * 0.5) - 12, 30 + Math.min(res.length, 4) * rh + 10, Math.min(260, W * 0.5), "n" + k, () => [el("b", {}, k === "rank" ? "A ranking, not a total" : "A check on the model"), el("span", {}, k === "rank" ? "All SOEs failing at once is nearly impossible; the top of the list is where to look first." : "A small SOE at the top of the list is a reason to look at its data.")], "note", { from: "up" });
        s.say(k); return;
      }
      const bt = c.bt();
      if (!bt) { s.text("p-none", W / 2, H / 2, "Needs at least two years of data for this SOE", "t-ink2", { anchor: "middle", size: 13 }); s.say(k); return; }
      const all = [...bt.act, ...bt.zS, ...bt.zN].filter(ok), x = lin(0, bt.xs.length - 1, 60, W - (narrow ? 60 : 140));
      const y = hwScale(Math.min(CFG.Z_DISTRESS_CUTOFF - 0.5, ...all), Math.max(CFG.Z_SAFE_CUTOFF + 0.5, ...all), H - 44, 40, 5);
      s.rect("p-zd", 60, y(Math.max(y.sc.lo, Math.min(y.sc.hi, CFG.Z_DISTRESS_CUTOFF))), W - 84 - 60 + 24, y(y.sc.lo) - y(Math.max(y.sc.lo, Math.min(y.sc.hi, CFG.Z_DISTRESS_CUTOFF))), "f-risk-soft");
      s.rect("p-zg", 60, y(Math.min(y.sc.hi, CFG.Z_SAFE_CUTOFF)), W - 84 - 60 + 24, y(Math.max(y.sc.lo, CFG.Z_DISTRESS_CUTOFF)) - y(Math.min(y.sc.hi, CFG.Z_SAFE_CUTOFF)), "f-amber-soft");
      y.sc.ticks.forEach((t, i) => s.text("p-yt" + i, 52, y(t), tickLab(t, y.sc.step), "t-ink2", { anchor: "end", size: 11 }));
      s.rect("p-band", x(1) - 10, 34, 20, H - 82, "f-shock-soft");
      s.text("p-bandl", x(1), 26, `shock in ${bt.year}`, "t-shock t-disp", { anchor: "middle", size: 12, weight: 800 });
      const P = (a) => a.map((v, i) => [x(i), y(v)]).filter((p, i) => ok(a[i]));
      s.path("p-act", smoothPath(P(bt.act)), "s-ink w3 nofill", { draw: true });
      s.path("p-ms", smoothPath(P(bt.zS)), "s-line w3 nofill", { draw: true, delay: 400 });
      s.path("p-mn", smoothPath(P(bt.zN)), "s-grey w2 dash nofill", { draw: true, delay: 700 });
      const li = bt.xs.length - 1;
      s.text("p-actl", x(li) + 8, y(bt.act[li]), "actual", "t-ink t-disp", { size: 12, weight: 800 });
      s.text("p-msl", x(li) + 8, y(bt.zS[li]) + 14, narrow ? "model" : "model + shock", "t-line t-disp", { size: 12, weight: 800 });
      s.text("p-mnl", x(li) + 8, y(bt.zN[li]) - 10, narrow ? "" : "model, no shock", "t-ink2", { size: 11.5, weight: 700, op: narrow ? 0 : 1 });
      bt.xs.forEach((yv, i) => s.text("p-x" + i, x(i), H - 22, String(yv) + (i ? "" : " start"), "t-ink2", { anchor: "middle", size: 11 }));
      if (k === "gap") bt.idx.forEach((i) => { const a = bt.act[i], m = bt.zS[i]; s.line("p-gp" + i, x(i), y(a), x(i), y(m), "s-risk w3", { from: "grow", delay: i * 120 }); s.text("p-gpt" + i, x(i) + 6, (y(a) + y(m)) / 2, fmt(Math.abs(a - m), 1), "t-risk", { size: 11, weight: 800, delay: i * 120 }); });
      s.text("p-t", 60, 12, `${c.r.Entity}: distress score, accounts vs model`, "t-ink t-disp", { size: 13, weight: 800 });
      s.say(k);
    },
  });

  /* 11 · early warning and the report */
  HW_CHAPTERS.push({
    id: "warn", rail: "Warning & report", title: "From numbers to action: early warning and the report",
    steps: (c) => {
      const ew = c.ew(), w = ew.order[0], lv = (x) => c.rows.filter((q) => ew.by[q.Entity].level === x).length;
      const rule = (CFG.TRIGGER_RULES.find((q) => q.id === ew.by[w.Entity].rules[0]) || {});
      return [
        ["rules", ["Numbers matter only if they lead to a decision. The ", hwB("Early Warning"), " tab applies simple rules to each SOE's latest year, grouped by issue: overall health, solvency and debt, liquidity, the stress test, the trend, and dependence on the government."]],
        ["board", ["Each SOE gets one signal, from its most severe rule: ", hwB(`Alert (${lv("alert")})`), ", ", hwB(`Watch (${lv("watch")})`), " or ", hwB(`Good (${lv("ok")})`), ". It shows where to look first."]],
        ["plan", ["Each rule comes with ", hwB("follow-up steps"), `. For ${w.Entity}, the first signal is “${rule.short || ""}”: ${(rule.steps || [rule.action || ""])[0]}. The steps are examples, to be agreed with the ministry.`, el("br"), hwOpen("warning")]],
        ["report", ["Finally the ", hwB("Report"), " tab writes everything up in five sections: summary, financial performance, distress and fiscal risk, stress tests, and policy implications, ready to print or save as PDF. Then the cycle starts again with next year's accounts.", el("br"), hwOpen("report")]],
      ];
    },
    draw(s, k, c) {
      const { W, H } = s, ew = c.ew(), narrow = W < 620;
      if (k === "rules") {
        const cats = CFG.TRIGGER_CATEGORIES || [], cols = narrow ? 2 : 3, cw = (W - 24 - (cols - 1) * 10) / cols, chh = Math.min(96, (H - 40) / Math.ceil(cats.length / cols) - 10);
        cats.forEach((cat, i) => {
          const rs = CFG.TRIGGER_RULES.filter((q) => q.category === cat), n = rs.reduce((a, q) => a + (ew.hits[q.id] || []).length, 0);
          s.html("r-c" + i, 12 + (i % cols) * (cw + 10), 20 + Math.floor(i / cols) * (chh + 10), cw, cat + n, () => [el("span", { class: "sk-k" }, `${rs.length} rule${rs.length === 1 ? "" : "s"}`), el("b", {}, cat), el("small", {}, rs.map((q) => q.short).join(" · "))], "cat", { from: "up", delay: i * 90 });
        });
        s.say(k); return;
      }
      if (k === "board" || k === "plan") {
        const colw = (W - 24 - 20) / 3, focus = ew.order[0].Entity, LV = [["alert", "Alert", "risk"], ["watch", "Watch", "amber"], ["ok", "Good", "health"]];
        const lists = LV.map(([lv]) => c.rows.filter((q) => ew.by[q.Entity].level === lv)), maxL = Math.max(1, ...lists.map((l) => l.length));
        /* chips are 24 px high; a long list wraps into two or three sub-columns inside its column */
        const pitch = 29, perCol = Math.max(4, Math.floor((H - 100) / pitch)), subs = narrow ? 1 : Math.min(3, Math.ceil(maxL / perCol)), rowsN = Math.min(perCol, Math.ceil(maxL / subs));
        const colH = Math.min(H - 28, Math.max(200, 56 + rowsN * pitch + 18)), sw = (colw - 16 - (subs - 1) * 4) / subs, why = subs === 1 && colw >= 150;
        LV.forEach(([lv, lab, cl], j) => {
          const x = 12 + j * (colw + 10), list = lists[j];
          s.rect("r-col" + j, x, 14, colw, colH, "f-" + cl + "-soft", { from: "up" });
          s.text("r-colh" + j, x + 10, 34, `${lab} · ${list.length}`, "t-" + cl + " t-disp", { size: 14, weight: 800 });
          s.text("r-cole" + j, x + 10, 62, list.length ? "" : "none", "t-ink2", { size: 12, op: list.length ? 0 : 1 });
          list.forEach((q, i) => {
            const col = Math.floor(i / rowsN), row = i % rowsN, hide = col >= subs;
            const r0 = CFG.TRIGGER_RULES.find((x) => x.id === ew.by[q.Entity].rules[0]), sub = why && r0 ? r0.short : "";
            s.html("r-s-" + q.Entity, x + 8 + Math.min(col, subs - 1) * (sw + 4), 50 + row * pitch, sw, q.Entity + sub + subs + (k === "plan" && q.Entity === focus), () => [el("b", {}, q.Entity), sub ? el("small", {}, " · " + sub) : null], "chip" + (k === "plan" && q.Entity === focus ? " focus" : k === "plan" ? " dim" : "") + (hide ? " gone" : ""), { from: "down", delay: k === "board" ? Math.min(i, 12) * 50 + j * 160 : 0, h: 24 });
          });
          const left = list.length - subs * rowsN;
          s.text("r-more" + j, x + 10, 50 + rowsN * pitch + 12, left > 0 ? `+ ${left} more` : "", "t-ink2", { size: 11.5, weight: 700, op: left > 0 ? 1 : 0 });
        });
        if (k === "plan") {
          const q = ew.order[0], rules = ew.by[q.Entity].rules.map((id) => CFG.TRIGGER_RULES.find((x) => x.id === id)).filter(Boolean), r0 = rules[0] || {};
          s.html("r-plan", narrow ? 12 : 12 + colw + 10, narrow ? H * 0.38 : 60, narrow ? W - 24 : colw * 2 + 10, q.Entity + r0.id, () => [el("span", { class: "sk-k" }, `Action plan · ${q.Entity}`), el("b", {}, r0.short || ""), el("ol", {}, (r0.steps || [r0.action]).map((t) => el("li", {}, t)))], "plan", { from: "up" });
        }
        s.say(k); return;
      }
      ["Executive summary", "Financial performance", "Distress and fiscal risk", "Stress tests", "Policy implications"].forEach((t, i) => {
        const pw = Math.min(240, W * 0.5), ph = Math.min(300, H * 0.62), x = W / 2 - pw / 2 + (i - 2) * Math.min(60, W * 0.1), y = H / 2 - ph / 2 + (i - 2) * 14;
        s.rect("r-p" + i, x, y, pw, ph, "f-surface s-rule shadow", { from: "up", delay: i * 140 });
        s.rect("r-pb" + i, x, y, pw, 8, "f-line", { delay: i * 140 });
        s.text("r-pt" + i, x + 12, y + 28, `${i + 1} · ${t}`, "t-ink t-disp", { size: 12.5, weight: 800, delay: i * 140 });
        for (let j = 0; j < 4; j++) s.rect(`r-pl${i}-${j}`, x + 12, y + 46 + j * 16, pw * (0.55 + ((j * 37) % 30) / 100), 6, "f-rule", { delay: i * 140 });
      });
      s.say(k);
    },
  });
  /* ---------- tool map: every tab, what it answers, what to set ---------- */
  const HW_MAP = [
    ["home", "Home", "What data am I using?", "The start screen: what the tool calculates (with the Altman Z″-EM distress score explained), load data with the column list and preview, then four questions with today's answers (SOEs in trouble, cost to the budget, shocks, signals).", [["set", "Upload your file, or pick a built-in example"], ["set", "Download the template and dictionary to prepare your data"]]],
    ["kpi", "KPI Dashboard", "Is each SOE healthy, and why not?", "Ratios in four groups, coloured green, amber or red; one SOE's trend, or SOEs side by side.", [["set", "View, years and SOE"], ["adv", "Red / amber / green cut-offs are illustrative (Technical notes)"]]],
    ["altman", "Distress Indicator", "How close is each SOE to distress?", "The four health checks, the distress score and its zone, an indicative rating.", [["set", "SOE and period"], ["def", "Weights and zone cut-offs: leave as they are"]]],
    ["efc", "Expected Fiscal Cost", "What could each SOE cost the budget?", "PD × EAD × LGD for each SOE and the portfolio, as money and as a share of GDP.", [["set", "Share the government bears (LGD), share of debt at stake (EAD), GDP"], ["def", "Chance of distress per rating step: placeholder values"]]],
    ["shock", "Shock Scenarios", "What could make it worse?", "One SOE against its no-shock path; a Monte Carlo simulation; a portfolio ranking under one broad shock; a check of the model against past years.", [["set", "SOE, then the shock type and its size"], ["def", "Structural factors when you have no data for them"], ["adv", "Cash financing, tariffs and collections, payment priority, PD method"]]],
    ["warning", "Early Warning", "What should happen next?", "A signal for each SOE, the rules grouped by issue, and an action plan with follow-up steps.", [["set", "Issue filter, and the SOE to look at"], ["adv", "Rules and steps are examples, to agree with the ministry"]]],
    ["report", "Report", "How do I brief on it?", "Five automatically written sections from everything above.", [["set", "The stress channel and SOE for the charts"], ["set", "Print or save as PDF"]]],
    ["assumptions", "Technical notes (for analysts)", "Where does each number come from?", "Every coefficient, threshold and default with its source and status, and the data dictionary.", [["adv", "Read before quoting results"]]],
  ];
  const HW_BADGE = { set: ["Set this", "set"], def: ["Leave at default", "def"], adv: ["Advanced", "adv"] };

  pages.how = {
    build(root) {
      const st = S.how, H = (this.H = {});
      const rows0 = latestOf(S.en);
      if (!S.names.includes(st.soe)) {
        const grey = rows0.filter((r) => r.Zone === "Grey").sort((a, b) => (b["Total Liabilities"] || 0) - (a["Total Liabilities"] || 0))[0];
        const dist = rows0.filter((r) => r.Zone === "Distress" && r.Z_EM > -3).sort((a, b) => b.Z_EM - a.Z_EM)[0];
        st.soe = S.names.includes("SOE C") ? "SOE C" : (grey || dist || rows0[0]).Entity;
      }
      if (!(st.shock === "standard" || SHOCK_T[st.shock])) st.shock = SHOCK_ORDER[0];
      const c = (this.c = howCtx());
      this.chs = HW_CHAPTERS.map((ch) => Object.assign({}, ch, { stage: mkStage(), cur: null, stepEls: [] }));
      // hero
      const chain = el("ol", { class: "hw-chain", "aria-label": "The chain of the calculation" }, ["Accounts", "Health checks", "Score", "Rating", "Chance of distress", "Expected cost"].map((t, i) =>
        el("li", { style: `--i:${i}` }, el("span", { class: "hw-chain-dot" }), el("span", { class: "hw-chain-lab" }, t))));
      const pick = fSelect("Example SOE", S.names, st.soe, (v) => { st.soe = v; const y = window.scrollY; this.build(root); this.render(); window.scrollTo({ top: y }); }, { info: "Every number on this page is computed for this SOE from the data loaded in the tool." });
      const hero = el("header", { class: "hw-hero" },
        el("p", { class: "hw-kicker" }, "How it works · a guide for non-specialists"),
        el("h1", {}, "When a state company cannot pay its debts, the budget usually pays."),
        el("p", { class: "hw-lede" }, "This tool estimates what that might cost, and what could make it worse. This guide walks through the website stop by stop, then follows one example SOE through every step of the calculation. It is written for readers who work with budgets but not with company accounts."),
        el("div", { class: "hw-actions" },
          el("a", { class: "hw-btn primary", href: "#hw-why", onclick: (e) => { e.preventDefault(); this.goto("hw-why"); } }, "Start reading"),
          el("a", { class: "hw-btn", href: "#hw-tool", onclick: (e) => { e.preventDefault(); this.goto("hw-tool"); } }, "See the website in one picture"),
          el("a", { class: "hw-btn", href: "#hw-map", onclick: (e) => { e.preventDefault(); this.goto("hw-map"); } }, "Go to the tool map")),
        chain,
        el("div", { class: "hw-hero-foot" }, el("p", {}, `About 15 minutes to read in full. Every number comes from the data loaded in the tool (${S.label}).`), pick));
      // rail
      const stations = [...this.chs.map((ch, i) => [ch.id, String(i + 1), ch.rail]), ["map", "◎", "Tool map"]];
      H.rail = el("nav", { class: "hw-rail", "aria-label": "Chapters" },
        el("ol", { class: "hw-rail-st" }, stations.map(([id, n, lab]) => el("li", {}, el("a", { href: "#hw-" + id, class: "hw-st", "data-ch": id, title: lab, onclick: (e) => { e.preventDefault(); this.goto("hw-" + id); } }, n), el("span", { class: "hw-rail-lab" }, lab)))),
        el("span", { class: "hw-rail-now" }));
      // chapters
      const secs = this.chs.map((ch, i) => {
        const steps = ch.steps(c);
        ch.stepEls = steps.map(([key, kids], j) => el("div", { class: "hw-step", id: `hw-step-${ch.id}-${key}`, "data-ch": ch.id, "data-k": key }, el("div", { class: "hw-step-text" }, ...kids)));
        ch.keys = steps.map(([key]) => key);
        return el("section", { class: "hw-ch", id: "hw-" + ch.id, "aria-labelledby": "hw-h-" + ch.id },
          el("div", { class: "hw-ch-h" }, el("span", { class: "hw-num" }, String(i + 1)), el("h2", { id: "hw-h-" + ch.id }, ch.title)),
          el("div", { class: "hw-grid" }, el("div", { class: "hw-stage" }, ch.stage.box), el("div", { class: "hw-steps" }, ...ch.stepEls)));
      });
      // tool map
      const map = el("section", { class: "hw-plain", id: "hw-map" },
        el("div", { class: "hw-ch-h" }, el("span", { class: "hw-num map" }, "◎"), el("h2", {}, "Tool map: every tab, what it answers, what to touch")),
        el("p", { class: "hw-intro" }, "Use it as a checklist the first time you run the tool. ", el("span", { class: "hw-badge set" }, "Set this"), " changes the answer; ", el("span", { class: "hw-badge def" }, "Leave at default"), " is fine for a first run; ", el("span", { class: "hw-badge adv" }, "Advanced"), " only if you know why."),
        el("div", { class: "hw-map" }, HW_MAP.map(([id, name, q, see, sets], i) => el("article", { class: "hw-map-card" },
          el("div", { class: "hw-map-h" }, el("span", { class: "hw-map-n" }, id === "assumptions" ? "+" : String(i + 1)), el("h3", {}, name)),
          el("p", { class: "hw-map-q" }, q), el("p", {}, el("b", {}, "You see: "), see),
          el("ul", {}, sets.map(([b, t]) => el("li", {}, el("span", { class: "hw-badge " + HW_BADGE[b][1] }, HW_BADGE[b][0]), " ", t))),
          hwOpen(id, `Open ${name.replace(" (for analysts)", "")} →`)))));
      // recap
      H.which = el("div");
      H.gloss = el("div");
      const recap = el("section", { class: "hw-plain", id: "hw-recap" },
        el("div", { class: "hw-ch-h" }, el("span", { class: "hw-num" }, "✓"), el("h2", {}, "The whole chain in six lines")),
        el("div", { class: "hw-recap" },
          el("ol", { class: "hw-recap-line" },
            el("li", {}, "The tool reads ", hwB("seven numbers"), " from an SOE's accounts."),
            el("li", {}, "It turns them into ", hwB("four health checks"), " and adds them into one ", hwB("distress score"), "."),
            el("li", {}, "The score maps to one of ", hwB("20 rating steps"), ", and each step has a ", hwB("chance of distress"), "."),
            el("li", {}, hwB("Expected cost"), " = what the SOE owes × the share the government would bear × the chance of distress."),
            el("li", {}, hwB("Shocks"), " roll the accounts forward under a bad scenario and compare the result with a no-shock path."),
            el("li", {}, hwB("Monte Carlo"), " tries many shock sizes and uses a ", hwB("smooth PD curve"), ". That curve is used nowhere else.")),
          notThis()),
        el("h3", { class: "hw-sub" }, "Which number am I looking at?"),
        el("p", { class: "hw-intro" }, `The same SOE shows several expected costs in the tool. They answer different questions. For ${c.r.Entity}:`), H.which,
        H.gloss,
        el("p", { class: "hw-foot" }, "For analysts: the formulas, every parameter with its source and status, and the data dictionary are in the ", go("assumptions", "Technical notes"), ". Adapted from the draft explainer ‘How SOE Pilot Works’; all numbers are computed live. Demo data are invented."));
      const page = el("div", { class: "hw" }, hero, H.rail, ...secs, map, recap);
      root.replaceChildren(page);
      this.page = page;
      this.buildGlossary();
      this.wireTry();
      this.drawWhich();
      this.wireScroll();
    },
    /** scroll to a chapter (its title under the rail) or to one step (its text at the reading line, so it is the active
        one); long jumps, and jumps from another tab, are instant rather than a long smooth scroll */
    goto(id, instant) {
      const n = document.getElementById(id);
      if (!n) return;
      const vh = window.innerHeight, phone = window.matchMedia("(max-width: 959px)").matches, railB = HW_TOP + (this.H.rail ? this.H.rail.offsetHeight : 60);
      const off = n.classList.contains("hw-step") ? (phone ? railB + 0.46 * vh + 24 : vh * 0.4) : railB + 8;
      const y = Math.max(0, n.getBoundingClientRect().top + window.scrollY - off), far = Math.abs(y - window.scrollY) > 3 * vh;
      window.scrollTo({ top: y, behavior: HW_REDUCED || instant || far ? "auto" : "smooth" });
    },
    /** scroll: the active step in each chapter (closest to the reading line) drives its stage; the rail follows */
    wireScroll() {
      if (this._scroll) window.removeEventListener("scroll", this._scroll);
      let raf = 0;
      this._scroll = () => { if (S.tab !== "how" || raf) return; raf = requestAnimationFrame(() => { raf = 0; this.onScroll(); }); };
      window.addEventListener("scroll", this._scroll, { passive: true });
    },
    onScroll(force) {
      if (!this.chs) return;
      const vh = window.innerHeight, phone = window.matchMedia("(max-width: 959px)").matches;
      const railB = HW_TOP + (this.H.rail ? this.H.rail.offsetHeight : 60);
      const line = phone ? railB + 0.46 * vh + (vh - railB - 0.46 * vh) * 0.35 : vh * 0.52;
      let curCh = null;
      this.chs.forEach((ch) => {
        const sec = document.getElementById("hw-" + ch.id);
        if (!sec) return;
        const b = sec.getBoundingClientRect();
        if (b.top < vh * 0.6) curCh = ch.id;
        if (b.bottom < -200 || b.top > vh + 200) return; // off screen: leave the stage as it is
        let best = 0, bd = Infinity;
        ch.stepEls.forEach((e, i) => { const r = e.getBoundingClientRect(), mid = r.top + Math.min(r.height, 160) / 2, d = Math.abs(mid - line); if (r.top - line < 40 && d < bd) { bd = d; best = i; } });
        if (ch.stepEls.length && ch.stepEls[0].getBoundingClientRect().top > line) best = 0;
        this.activate(ch, best, force);
      });
      const mapSec = document.getElementById("hw-map"), recapSec = document.getElementById("hw-recap");
      if (mapSec && mapSec.getBoundingClientRect().top < vh * 0.6) curCh = "map";
      if (recapSec && recapSec.getBoundingClientRect().top < vh * 0.6) curCh = "map";
      // rail
      const ids = [...this.chs.map((ch) => ch.id), "map"], ci = ids.indexOf(curCh);
      this.H.rail.querySelectorAll(".hw-st").forEach((a, i) => { a.classList.toggle("is-current", i === ci); a.classList.toggle("is-passed", ci >= 0 && i < ci); });
      this.H.rail.querySelectorAll(".hw-rail-lab").forEach((l, i) => l.classList.toggle("is-current", i === ci));
      this.H.rail.style.setProperty("--progress", ci < 0 ? 0 : ci / (ids.length - 1));
      this.H.rail.querySelector(".hw-rail-now").textContent = ci < 0 ? "Start" : `${ci < ids.length - 1 ? ci + 1 + " · " : ""}${ci < ids.length - 1 ? this.chs[ci].rail : "Tool map"}`;
    },
    activate(ch, i, force) {
      const key = ch.keys[i];
      if (!force && ch.cur === key && ch.act === i) return;
      ch.cur = key; ch.act = i; // ch.act: the step whose text is highlighted (render() sets ch.cur without it)
      ch.stepEls.forEach((e, j) => e.classList.toggle("is-active", j === i));
      this.drawCh(ch);
    },
    drawCh(ch, extra) {
      const s = ch.stage.begin();
      try { ch.draw(s, ch.cur || ch.keys[0], this.c, extra); } catch (e) { console.error("How it works · " + ch.id + ": " + (e && e.stack || e)); }
      s.end();
    },
    render() {
      if (!this.chs) return;
      document.body.dataset.tab = "how";
      // after a resize the stages re-measure; every chapter is drawn in its current step
      requestAnimationFrame(() => { this.chs.forEach((ch) => { if (!ch.cur) ch.cur = ch.keys[0]; this.drawCh(ch); }); this.onScroll(true); });
    },
    setShock(id) {
      S.how.shock = id;
      const ch = this.chs.find((x) => x.id === "shocks"), steps = ch.steps(this.c);
      steps.forEach(([key, kids], j) => { if (ch.stepEls[j]) ch.stepEls[j].firstChild.replaceChildren(...kids); });
      this.drawCh(ch);
    },
    /** the "Try it" sliders of the score chapter */
    wireTry() {
      const box = this.page.querySelector("[data-try]");
      if (!box) return;
      const r = this.c.r, v = { X1: r.X1, X2: r.X2, X3: r.X3, X4: r.X4 }, ch = this.chs.find((x) => x.id === "score");
      const redraw = () => { ch.cur = "try"; ch.act = ch.keys.indexOf("try"); ch.stepEls.forEach((e) => e.classList.toggle("is-active", e.dataset.k === "try")); this.drawCh(ch, { try: v }); };
      box.replaceChildren(...["X1", "X2", "X3", "X4"].map((x) => fSlider(`${HEALTH[x]} (check ${x.slice(1)})`, { min: -0.6, max: 0.6, step: 0.01, value: Math.max(-0.6, Math.min(0.6, ok(v[x]) ? v[x] : 0)), fmt: (z) => pct(z, 0) }, (z) => { v[x] = z; redraw(); })),
        el("button", { class: "hw-open", type: "button", onclick: () => { Object.assign(v, { X1: r.X1, X2: r.X2, X3: r.X3, X4: r.X4 }); this.wireTry(); redraw(); } }, `Back to ${r.Entity}'s values`));
    },
    buildGlossary() {
      const q = el("input", { type: "search", placeholder: "Search the glossary", "aria-label": "Search the glossary" }), list = el("dl", { class: "hw-gloss" });
      const draw = () => {
        const s0 = q.value.trim().toLowerCase();
        list.replaceChildren(...HOW_GLOSSARY.filter((g) => !s0 || (g.term + " " + g.def).toLowerCase().includes(s0)).flatMap((g) => [el("dt", {}, g.term), el("dd", {}, g.def)]));
      };
      q.addEventListener("input", draw); draw();
      put(this.H.gloss, el("details", { class: "hw-gloss-card", open: S.how.glossOpen ? true : null, ontoggle: (e) => { S.how.glossOpen = e.target.open; } }, el("summary", {}, `Glossary: ${HOW_GLOSSARY.length} terms in plain words`), q, list));
    },
    tryIt(r, id) {
      const st = S.sh;
      st.soe = r.Entity; st.year = r.Year; st.view = "single";
      if (id === "standard") { st.mode = "standard"; Object.assign(st.mags, STD_MAG, { fuel_shock_path: [] }); }
      else { st.mode = "custom"; st.stype = id; Object.assign(st.mags, howMags(id)); }
      st.D = Math.min(CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, st.H);
      S.built.shock = false; showTab("shock"); window.scrollTo({ top: 0 });
    },
    /** the expected costs the same SOE shows in different places, and why they differ */
    drawWhich() {
      const c = this.c, r = c.r, efc = E.efcRow(r, S.efc.lgd, S.efc.ead, S.efc.basis).EFC, d = c.std(), m = c.mc();
      const yN = r.Year + CFG.MC_HORIZON_YEARS;
      put(this.H.which, el("div", { class: "hw-which" }, [
        ["Expected Fiscal Cost tab", `Today: latest accounts (${r.Year}), rating steps`, efc, "efc"],
        ["Shock Scenarios · no shock", `Year ${yN} if nothing goes wrong`, last(d.base).EFC, "shock"],
        ["Shock Scenarios · standard stress", `Year ${yN} under all six standard shocks`, last(d.path).EFC, "shock"],
        ["Monte Carlo simulation · median", `Year ${yN}, middle of many shock sizes, smooth curve`, m ? m.p50 : NaN, "shock"]].map(([w, q, v, id]) =>
        el("div", { class: "hw-which-card" }, el("span", { class: "sk-k" }, w), el("b", { class: "num" }, money(v, true)), el("small", {}, q), go(id, "Open →")))),
        el("p", { class: "hw-intro" }, "If two numbers for the same SOE disagree, check which year they refer to, whether a shock is applied, and whether one of them is a Monte Carlo result."));
    },
  };
  /** open How it works at a chapter or step */
  function goHow(anchor) {
    showTab("how");
    requestAnimationFrame(() => requestAnimationFrame(() => { if (pages.how.goto) pages.how.goto(anchor, true); }));
  }
  // which part of the guide explains each tab
  const HW_GUIDE = { kpi: "hw-step-tool-kpi", altman: "hw-score", efc: "hw-cost", shock: "hw-shocks", warning: "hw-warn", report: "hw-step-tool-report", assumptions: "hw-map" };
