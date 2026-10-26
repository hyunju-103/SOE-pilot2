  /* =====================================================================
     HOW IT WORKS — the non-specialist guide inside the tool
     Adapted from the "How SOE Pilot Works" explainer (scrollytelling draft) for the meeting of
     2026-10-26: the chain from accounts to fiscal cost in six stops, then "shock transmission":
     pick a shock and see which lines of the accounts it hits, how it reaches the distress score
     and the budget, with live numbers for an example SOE from the data loaded in this page.
     ===================================================================== */
  const HOW_GLOSSARY = CFG.HOW_GLOSSARY || [];
  const HOW_STOPS = [
    ["accounts", "Accounts", "Seven numbers from the accounts"],
    ["health", "Health checks", "Four health checks"],
    ["score", "Score", "One distress score"],
    ["rating", "Rating", "From score to rating"],
    ["chance", "Chance of distress", "The chance of distress"],
    ["cost", "Expected cost", "Expected fiscal cost"],
  ];
  // the transmission map: which boxes of the accounts each shock hits first (p) and which it moves next (s)
  const HOW_NODES = [
    ["inc", "Income statement", [["rev", "Revenue"], ["cost", "Operating costs"], ["int", "Interest"]]],
    ["cash", "Profit and cash", [["ebit", "Operating profit"], ["ni", "Net income"], ["gap", "Cash gap → borrowing"]]],
    ["bs", "Balance sheet", [["ca", "Current assets"], ["debt", "Debt (liabilities)"], ["eq", "Equity"]]],
    ["chk", "Health checks", [["X1", "1 · This year's bills"], ["X2", "2 · Savings"], ["X3", "3 · Operating profit"], ["X4", "4 · Equity cushion"]]],
    ["res", "Result", [["z", "Distress score"], ["pd", "Chance of distress"], ["efc", "Expected fiscal cost"]]],
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
  /** the shock magnitudes of one type at its standard size (the macro of the standard stress for "standard") */
  function howMags(id, row) {
    if (id === "standard") return Object.assign({}, STD_MAG, { fuel_shock_path: [] });
    const t = SHOCK_T[id], m = Object.assign({}, ZERO_MAG, { fuel_shock_path: [] });
    m[t.key] = t.guide.standard;
    if (id === "rates") m.refinancing_spread_bps = STD_MAG.refinancing_spread_bps;
    return m;
  }
  function howRun(row, mags) {
    const D = CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, Hh = CFG.MC_HORIZON_YEARS, ex = expoFor(row);
    const p = paramsFor(row, mags, ex, D, Hh);
    return E.costPath(E.runScenario(row, p, Hh), S.efc.lgd, null, S.efc.ead, p);
  }
  pages.how = {
    build(root) {
      const st = S.how, H = (this.H = {});
      const latest = latestOf(S.en);
      if (!S.names.includes(st.soe)) {
        const grey = latest.filter((r) => r.Zone === "Grey").sort((a, b) => (b["Total Liabilities"] || 0) - (a["Total Liabilities"] || 0))[0];
        const dist = latest.filter((r) => r.Zone === "Distress" && r.Z_EM > -3).sort((a, b) => b.Z_EM - a.Z_EM)[0];
        st.soe = S.names.includes("SOE C") ? "SOE C" : (grey || dist || latest[0]).Entity;
      }
      if (!HOW_STOPS.some(([k]) => k === st.stop)) st.stop = "accounts";
      if (!(st.shock === "standard" || SHOCK_T[st.shock])) st.shock = SHOCK_ORDER[0];
      const pick = fSelect("Example SOE", S.names, st.soe, (v) => { st.soe = v; this.render(); }, { info: "Every number on this page is computed for this SOE from the data loaded in the tool. Change it to follow another SOE." });
      H.hero = el("section", { class: "how-hero" },
        el("div", {}, el("div", { class: "eyebrow" }, "HOW IT WORKS · FOR NON-SPECIALISTS"),
          el("h2", {}, "When a state company cannot pay its debts, the budget usually pays."),
          el("p", { class: "how-lede" }, "This tool estimates what that might cost. This page follows one example SOE through each step of the calculation, then shows how a shock travels from its accounts to the budget. It is written for readers who work with budgets but not with company accounts."),
          el("div", { class: "how-actions" }, el("a", { class: "btn primary", href: "#how-chain", onclick: (e) => { e.preventDefault(); $("#how-chain").scrollIntoView({ behavior: "smooth" }); } }, "Start with the chain"),
            el("a", { class: "btn", href: "#how-shock", onclick: (e) => { e.preventDefault(); $("#how-shock").scrollIntoView({ behavior: "smooth" }); } }, "Go to shock transmission"))),
        el("div", { class: "how-q card" }, el("h3", {}, "The tool answers two questions"),
          el("ol", {}, el("li", {}, el("b", {}, "How much should the government expect to pay for this SOE?")), el("li", {}, el("b", {}, "What could make that number grow?"))),
          el("p", { class: "note" }, "Its answer is a first, quick reading, a triage that tells you which SOEs deserve a closer look. It is not a budget forecast, and not a credit rating agency's verdict."),
          pick));
      // A. the chain
      H.rail = el("ol", { class: "how-rail", role: "tablist", "aria-label": "Steps of the calculation" });
      H.stage = el("div", { class: "how-stage" });
      H.stageText = el("div", { class: "how-text" });
      H.chain = el("section", { class: "how-sec", id: "how-chain" },
        el("div", { class: "how-sec-h" }, el("span", { class: "how-num" }, "A"), el("div", {}, el("h3", {}, "From the accounts to the budget, in six stops"), el("p", { class: "sub" }, "Select a stop, or use the arrows. The numbers are for the example SOE."))),
        H.rail, el("div", { class: "how-panel card" }, el("div", { class: "how-viz" }, H.stage), H.stageText));
      // B. shock transmission
      H.shockPick = el("div", { class: "how-shock-pick", role: "radiogroup", "aria-label": "Choose a shock" });
      H.flow = el("div", { class: "how-flow" });
      H.path = el("div", { class: "how-path" });
      H.live = el("div");
      H.who = el("div");
      H.shock = el("section", { class: "how-sec", id: "how-shock" },
        el("div", { class: "how-sec-h" }, el("span", { class: "how-num shock" }, "B"), el("div", {}, el("h3", {}, "How a shock travels: shock transmission"), el("p", { class: "sub" }, "A shock is a ‘what if’ applied to the SOE's accounts. Choose one to see which lines it hits and how it reaches the budget."))),
        H.shockPick, el("div", { class: "card how-flow-card" }, H.flow, H.path), H.live, H.who);
      // C. simulation, D. which number, E. limits and glossary
      H.mc = el("section", { class: "how-sec", id: "how-mc" },
        el("div", { class: "how-sec-h" }, el("span", { class: "how-num" }, "C"), el("div", {}, el("h3", {}, "Many possible futures (Monte Carlo)"), el("p", { class: "sub" }, "Used in Shock Scenarios › Range of outcomes, and in the portfolio macro shock"))),
        el("div", { class: "grid3 how-cards" },
          el("div", { class: "card" }, el("h4", {}, "Why"), el("p", {}, "A scenario asks ‘what if fuel rises by 25%?’ Nobody knows whether it will be 15% or 40%. The simulation tries many sizes around the one you set, with fuel and the currency tending to move together.")),
          el("div", { class: "card" }, el("h4", {}, "What comes out"), el("p", {}, "A spread of results. The middle one is the median (P50). One run in twenty comes out worse than the P95, sometimes called fiscal-at-risk. It is a bad case, not a maximum.")),
          el("div", { class: "card" }, el("h4", {}, "Be careful"), el("p", {}, "P95 is still an ", el("i", {}, "expected"), " cost, averaged over the chance of distress. It is not the bill if the SOE actually fails. Inside the simulation the chance of distress comes from a smooth curve instead of the rating steps, so small changes count."))));
      H.which = el("section", { class: "how-sec", id: "how-which" },
        el("div", { class: "how-sec-h" }, el("span", { class: "how-num" }, "D"), el("div", {}, el("h3", {}, "Which number am I looking at?"), el("p", { class: "sub" }, "The same SOE shows several expected costs in the tool. They answer different questions."))),
        el("div", { class: "card" }, el("div")));
      H.gloss = el("div");
      H.end = el("section", { class: "how-sec", id: "how-end" },
        el("div", { class: "how-sec-h" }, el("span", { class: "how-num" }, "E"), el("div", {}, el("h3", {}, "The whole chain in six lines, and what the tool is not"))),
        el("div", { class: "grid" }, el("div", { class: "s6" }, el("div", { class: "card how-recap" }, el("ol", {},
          el("li", {}, "The tool reads ", el("b", {}, "seven numbers"), " from an SOE's accounts."),
          el("li", {}, "It turns them into ", el("b", {}, "four health checks"), " and adds them into one ", el("b", {}, "distress score"), "."),
          el("li", {}, "The score maps to one of ", el("b", {}, "20 rating steps"), ", and each step has a ", el("b", {}, "chance of distress"), "."),
          el("li", {}, el("b", {}, "Expected cost"), " = what the SOE owes × the share the government would bear × the chance of distress."),
          el("li", {}, el("b", {}, "Shocks"), " roll the accounts forward under a bad scenario and compare the result with a no-shock path."),
          el("li", {}, el("b", {}, "Monte Carlo"), " tries many shock sizes and uses a ", el("b", {}, "smooth PD curve"), ". That curve is used nowhere else.")))),
          el("div", { class: "s6" }, notThis())),
        H.gloss,
        el("p", { class: "note" }, "For analysts: the formulas, every parameter with its source and status, and the data dictionary are in the ", go("assumptions", "Technical notes"), ". Adapted from the draft explainer ‘How SOE Pilot Works’; all numbers on this page are computed live from the data loaded in the tool."));
      root.replaceChildren(H.hero, H.chain, H.shock, H.mc, H.which, H.end);
      this.buildGlossary();
    },
    buildGlossary() {
      const H = this.H, q = el("input", { type: "search", placeholder: "Search the glossary", "aria-label": "Search the glossary" }), list = el("dl", { class: "how-gloss" });
      const draw = () => {
        const s0 = q.value.trim().toLowerCase();
        list.replaceChildren(...HOW_GLOSSARY.filter((g) => !s0 || (g.term + " " + g.def).toLowerCase().includes(s0)).flatMap((g) => [el("dt", {}, g.term), el("dd", {}, g.def)]));
      };
      q.addEventListener("input", draw); draw();
      put(H.gloss, el("details", { class: "card how-gloss-card", open: S.how.glossOpen ? true : null, ontoggle: (e) => { S.how.glossOpen = e.target.open; } }, el("summary", {}, `Glossary: ${HOW_GLOSSARY.length} terms in plain words`), q, list));
    },
    render() {
      const st = S.how, H = this.H;
      const row = latestOf(S.en.filter((r) => r.Entity === st.soe))[0];
      if (!row) return;
      this.row = row;
      // rail
      const i0 = HOW_STOPS.findIndex(([k]) => k === st.stop);
      put(H.rail, HOW_STOPS.map(([k, lab], i) => el("li", { class: "how-stop" + (i === i0 ? " on" : i < i0 ? " done" : "") },
        el("button", { type: "button", role: "tab", "aria-selected": String(i === i0), onclick: () => { st.stop = k; this.render(); } }, el("span", { class: "how-dot num" }, String(i + 1)), el("span", { class: "how-lab" }, lab)))));
      this.drawStop(row);
      // shock picker + transmission
      put(H.shockPick, [...SHOCK_ORDER, "standard"].map((id) => el("button", { type: "button", role: "radio", class: "how-chip" + (id === "standard" ? " std" : ""), "aria-checked": String(st.shock === id), onclick: () => { st.shock = id; this.render(); } }, howShock(id).label)));
      this.drawShock(row);
      this.drawWhich(row);
    },
    /** stage + text for the selected stop of the chain */
    drawStop(r) {
      const st = S.how, H = this.H, i0 = HOW_STOPS.findIndex(([k]) => k === st.stop);
      const nav = el("div", { class: "how-nav" },
        el("button", { class: "btn-ghost", type: "button", disabled: i0 === 0 ? true : null, onclick: () => { st.stop = HOW_STOPS[i0 - 1][0]; this.render(); } }, "← Back"),
        el("span", { class: "muted num" }, `${i0 + 1} of ${HOW_STOPS.length}`),
        i0 < HOW_STOPS.length - 1 ? el("button", { class: "btn-ghost", type: "button", onclick: () => { st.stop = HOW_STOPS[i0 + 1][0]; this.render(); } }, "Next →")
          : el("button", { class: "btn-ghost", type: "button", onclick: () => $("#how-shock").scrollIntoView({ behavior: "smooth" }) }, "Now add a shock ↓"));
      const K = E.K, ta = r[K.ta], tl = r[K.tl], ca = r[K.ca], cl = r[K.cl], eq = r[K.eq], ebit = r[K.ebit], re = r[K.re];
      const c = CFG.ZEM_COEFFICIENTS, efc = E.efcRow(r, S.efc.lgd, S.efc.ead, "total_liabilities"), pdB = E.pdByRating(r.Rating);
      const b = (s0) => el("b", {}, s0);
      const P = (...k) => el("p", {}, ...k);
      let text = [], draw = null;
      const nm = r.Entity, yr = r.Year;
      if (st.stop === "accounts") {
        text = [P("Everything starts from the SOE's yearly accounts. To score it, the tool needs only ", b("seven numbers"), `. Here they are for ${nm} in ${yr}.`),
          P(b("What it owns: "), money(ta, true), " in total assets (plants, networks, buildings, cash, money owed to it). Of that, ", money(ca, true), " turns into cash within a year: its ", b("current assets"), "."),
          P(b("What it owes: "), money(tl, true), " in total liabilities. Of that, ", money(cl, true), " falls due within the year: its ", b("current liabilities"), "."),
          P(b("Equity "), `= what it owns minus what it owes: ${money(eq, true)}. Think of it as the owners' cushion. Losses eat into it; if it runs out, the SOE owes more than everything it has.`),
          P("Two numbers come from the profit side: ", b("operating profit"), ` (${money(ebit, true)}), what the business earns before interest and tax, and `, b("retained earnings"), ` (${money(re, true)}), the running total of all past profits and losses.`)];
        draw = (box) => this.vizAccounts(box, r);
      } else if (st.stop === "health") {
        text = [P("The tool turns the seven numbers into ", b("four health checks"), ". Each divides one number by another, so a large utility and a small transport company can be compared."),
          P(b("1 · Can it pay this year's bills? "), "(current assets − current liabilities) ÷ total assets. Below zero means it must find money it does not have."),
          P(b("2 · Has it built up savings? "), "retained earnings ÷ total assets. Years of losses push this below zero."),
          P(b("3 · Does the business make money? "), "operating profit ÷ total assets."),
          P(b("4 · How thick is the cushion? "), "equity ÷ total liabilities. Below zero means it owes more than it owns.")];
        draw = (box) => this.vizChecks(box, r);
      } else if (st.stop === "score") {
        text = [P("Four numbers are harder to follow than one. So the tool multiplies each check by a fixed weight and adds them up: the ", b("distress score"), " (Altman Z″-EM, a method built for companies in emerging markets)."),
          P(`Operating profit (×${c.X3}) and this year's bills (×${c.X1}) count most, savings (×${c.X2}) next, the cushion (×${c.X4}) least.`),
          P(`${nm} scores `, b(fmt(r.Z_EM, 2)), ". Higher is healthier. Below ", b(fmt(CFG.Z_DISTRESS_CUTOFF, 1)), " is the ", b("distress"), " zone, up to ", b(fmt(CFG.Z_SAFE_CUTOFF, 1)), " the ", b("grey"), " zone (unclear), above that ", b("safe"), `. ${nm} is in the ${String(r.Zone).toLowerCase()} zone, ${distressWhy(r)}.`),
          P("The zone warns of weakness. It does not mean the SOE has already needed a rescue.")];
        draw = (box) => this.vizScore(box, r);
      } else if (st.stop === "rating") {
        text = [P("Ratings are easier to communicate than scores. The tool cuts the score line into ", b("20 steps"), " and gives each a familiar label, from AAA (strongest) down to D (weakest). One step is a notch."),
          P(`${nm}'s score of ${fmt(r.Z_EM, 2)} lands on `, b(r.Rating), ". Steps from BBB− up are called investment grade."),
          P("These are ", b("indicative"), " ratings, read off the accounts alone. They are not ratings from S&P, Moody's or Fitch, and they ignore any help the government might give."),
          P("Each step covers a range of scores: an SOE can move inside its step without its rating changing.")];
        draw = (box) => this.vizLadder(box, r);
      } else if (st.stop === "chance") {
        const k = Math.round(pdB * 1000);
        text = [P("Each rating step comes with a ", b("chance of distress"), " (PD): the chance that, in a given year, the SOE needs the government to rescue it."),
          P(`For ${nm}'s step, ${r.Rating}, the table uses `, b(pctAuto(pdB)), `. Picture 1,000 SOEs just like ${nm}: in a typical year, about `, b(`${k.toLocaleString("en-US")}`), " of them would need a rescue."),
          P("Distress here means needing fiscal support, not going to court. State companies rarely go bankrupt; they get rescued."),
          P("Down the ladder the chance climbs steeply, up to 40% at D. These values are the team's starting assumptions, not observed default history: placeholders to be replaced when better local evidence exists.")];
        draw = (box) => this.vizDots(box, pdB);
      } else {
        text = [P("Now the risk gets a money figure. The tool multiplies three things: ", b("how much is at stake"), ", ", b("how much of it the government would bear"), ", and ", b("how likely trouble is"), "."),
          P(b("At stake (EAD): "), `${money(efc.EAD, true)}, ${pct0(S.efc.ead)} of what ${nm} owes, as if the government stands behind the whole company. If the government would only cover guaranteed debt, change this on the Expected Fiscal Cost tab.`),
          P(b("Government bears (LGD): "), `${fmt(S.efc.lgd, 0)}%. Part of the debt can be recovered by selling assets or restructuring.`),
          P(b("Chance (PD): "), pctAuto(efc.PD), " from the last stop."),
          P(`${money(efc.EAD)} × ${fmt(S.efc.lgd, 0)}% × ${pctAuto(efc.PD)} = `, b(money(efc.EFC, true)), `: ${nm}'s `, b("expected fiscal cost"), "."),
          P(el("i", {}, "Expected"), ` means average. In most years ${nm} survives without help and costs the budget nothing; in a few it needs a rescue of up to ${money(efc.EAD * efc.LGD, true)}. The average across all of them is the expected cost, not the bill if the SOE fails.`)];
        draw = (box) => this.vizCost(box, efc);
      }
      put(H.stageText, el("h4", {}, HOW_STOPS[i0][2]), ...text, nav);
      const box = el("div", { class: "chart" });
      put(H.stage, box);
      draw(box);
    },
    vizAccounts(box, r) {
      const K = E.K, W = widthOf(box), Hh = 322, ta = Math.max(0, r[K.ta]), tl = Math.max(0, r[K.tl]), ca = Math.max(0, r[K.ca]), cl = Math.max(0, r[K.cl]), eq = r[K.eq];
      const top = Math.max(ta, tl, 1), y0 = 34, hMax = 170, y = (v) => (v / top) * hMax;
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: "img", "aria-label": `What the SOE owns and owes: assets ${money(ta)}, liabilities ${money(tl)}, equity ${money(eq)}` });
      const colW = Math.min(150, W * 0.3), xA = W * 0.25 - colW / 2, xL = W * 0.68 - colW / 2, base = y0 + hMax;
      const blk = (x, v0, v1, cls, lab) => {
        const h = y(v1 - v0); if (h <= 0.5) return;
        svgEl("rect", { x, y: base - y(v1), width: colW, height: h, class: cls, rx: 2 }, svg);
        const short = lab.length * 6.6 > colW - 8 ? money(v1 - v0) : lab; // narrow screens: the amount only
        if (h > 22) txt(svg, x + colW / 2, base - y(v1) + h / 2, short, "t-on num", "middle", 11, 700);
      };
      txt(svg, xA + colW / 2, 14, "Owns", "t-head", "middle", 13, 700); txt(svg, xL + colW / 2, 14, "Owes", "t-head", "middle", 13, 700);
      blk(xA, 0, ca, "acc-cur", "current " + money(ca)); blk(xA, ca, ta, "acc-oth", "other " + money(ta - ca));
      blk(xL, 0, Math.min(cl, tl), "liab-cur", "due in a year " + money(cl)); blk(xL, Math.min(cl, tl), tl, "liab-oth", "later " + money(tl - Math.min(cl, tl)));
      if (eq > 0) blk(xL, tl, ta, "eq-pos", "equity " + money(eq));
      else svgEl("rect", { x: xA, y: base - y(tl), width: colW, height: Math.max(0, y(tl - ta)), class: "eq-neg", rx: 2 }, svg);
      if (eq <= 0 && y(tl - ta) > 18) txt(svg, xA + colW / 2, base - y(tl) + y(tl - ta) / 2, "negative equity " + money(eq), "t-crit num", "middle", 11, 700);
      txt(svg, xA + colW / 2, base + 16, money(ta, true), "t-ink num", "middle", 12, 700); txt(svg, xL + colW / 2, base + 16, money(tl, true), "t-ink num", "middle", 12, 700);
      // profit side
      const pv = [["Operating profit", r[K.ebit]], ["Retained earnings", r[K.re]]], m = Math.max(1, ...pv.map(([, v]) => Math.abs(v || 0)));
      const x0 = Math.max(150, W * 0.5), half = Math.min(W * 0.28, (W - x0) - 70, x0 - 130);
      pv.forEach(([lab, v], i) => {
        const yy = base + 46 + i * 30, w = (Math.abs(v || 0) / m) * Math.max(20, half);
        txt(svg, 8, yy + 7, lab, "t-ink2", "start", 11.5, 600);
        svgEl("rect", { x: v >= 0 ? x0 : x0 - w, y: yy, width: Math.max(1, w), height: 14, class: v >= 0 ? "bar" : "bar neg", rx: 2 }, svg);
        txt(svg, v >= 0 ? x0 + w + 6 : x0 + 6, yy + 7, money(v), "t-ink num", "start", 11.5, 700);
      });
      svgEl("line", { x1: x0, x2: x0, y1: base + 40, y2: base + 106, class: "zero-l" }, svg);
      if (W < 520) { txt(svg, W / 2, Hh - 20, "Darker part: cash or bills within a year", "t-muted", "middle", 10); txt(svg, W / 2, Hh - 6, "Green: equity (owns minus owes)", "t-muted", "middle", 10); }
      else txt(svg, W / 2, Hh - 8, "Darker part: cash within a year (owns) or due within a year (owes) · green: equity", "t-muted", "middle", 10.5);
      box.replaceChildren(svg);
    },
    vizChecks(box, r) {
      const c = CFG.ZEM_COEFFICIENTS, rows = [["X1", "This year's bills", "(current assets − current liabilities) ÷ total assets"], ["X2", "Savings", "retained earnings ÷ total assets"], ["X3", "Operating profit", "operating profit ÷ total assets"], ["X4", "Equity cushion", "equity ÷ total liabilities"]];
      const m = Math.max(0.25, ...rows.map(([k]) => Math.abs(r[k] || 0)));
      box.replaceChildren(el("div", { class: "how-checks" }, rows.map(([k, lab, f]) => el("div", { class: "how-check" },
        el("div", { class: "hc-h" }, el("b", {}, `${k.slice(1)} · ${lab}`), el("span", { class: "num " + (r[k] < 0 ? "neg" : "pos") }, pct(r[k], 1))),
        el("div", { class: "track" }, ok(r[k]) ? el("span", { class: r[k] >= 0 ? "pos" : "neg", style: `width:${(Math.min(Math.abs(r[k]), m) / m) * 50}%` }) : null),
        el("small", { class: "muted" }, f, ` · weight ×${c[k]}`)))),
        el("p", { class: "note" }, "Bars start at zero in the middle: to the right is healthy, to the left (red) is a warning sign."));
    },
    vizScore(box, r) {
      const W = widthOf(box), Hh = 210, L = 20, R = 20, rows = latestOf(S.en);
      const zs = rows.map((q) => q.Z_EM).filter(ok), lo = Math.min(-2, CFG.Z_DISTRESS_CUTOFF - 1.5, ...zs.map((v) => Math.max(v, -9))), hi = Math.max(CFG.Z_SAFE_CUTOFF + 2, ...zs.map((v) => Math.min(v, 12)));
      const sc = nice(lo, hi, 6), x = lin(sc.lo, sc.hi, L, W - R), yL = 120;
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: "img", "aria-label": `Distress score line with zones; ${r.Entity} at ${fmt(r.Z_EM, 2)}` });
      shadeZones(svg, sc, x, true, yL - 26, yL + 10);
      if (x(CFG.Z_SAFE_CUTOFF) < W - R) svgEl("rect", { x: x(CFG.Z_SAFE_CUTOFF), y: yL - 26, width: W - R - x(CFG.Z_SAFE_CUTOFF), height: 36, class: "z-safe" }, svg);
      txt(svg, (x(sc.lo) + x(CFG.Z_DISTRESS_CUTOFF)) / 2, yL - 36, "Distress", "t-muted z-lab", "middle", 11, 700);
      txt(svg, (x(CFG.Z_DISTRESS_CUTOFF) + x(CFG.Z_SAFE_CUTOFF)) / 2, yL - 36, "Grey", "t-muted z-lab", "middle", 11, 700);
      txt(svg, (x(CFG.Z_SAFE_CUTOFF) + x(sc.hi)) / 2, yL - 36, "Safe", "t-muted z-lab", "middle", 11, 700);
      svgEl("line", { x1: L, x2: W - R, y1: yL + 10, y2: yL + 10, class: "axis-l" }, svg);
      sc.ticks.forEach((t) => txt(svg, x(t), yL + 26, tickLab(t, sc.step), "t-muted num", "middle", 10.5));
      rows.forEach((q) => { if (q.Entity === r.Entity || !ok(q.Z_EM)) return; const cx = x(Math.max(sc.lo, Math.min(sc.hi, q.Z_EM))); const g = svgEl("g", {}, svg); svgEl("circle", { cx, cy: yL - 8, r: 4.5, class: "dot-prev" }, g); const h = svgEl("circle", { cx, cy: yL - 8, r: 9, class: "hit", tabindex: 0 }, g); bindTip(h, q.Entity, [[fmt(q.Z_EM, 2), `${q.Rating} · ${q.Zone}`]]); });
      const cx = x(Math.max(sc.lo, Math.min(sc.hi, r.Z_EM)));
      svgEl("circle", { cx, cy: yL - 8, r: 8, class: "dot-now" }, svg);
      txt(svg, cx, yL - 56, `${r.Entity} ${fmt(r.Z_EM, 2)}`, "t-head num", cx < 70 ? "start" : cx > W - 70 ? "end" : "middle", 12.5, 700);
      svgEl("line", { x1: cx, x2: cx, y1: yL - 48, y2: yL - 16, class: "ref-l" }, svg);
      const c = CFG.ZEM_COEFFICIENTS, parts = ["X1", "X2", "X3", "X4"].map((k) => `${c[k]} × ${pct(r[k], 1)}`);
      txt(svg, W / 2, Hh - 30, `Score = ${parts.join(" + ")}`, "t-ink2 num", "middle", W < 520 ? 9.5 : 11.5, 600);
      txt(svg, W / 2, Hh - 12, "Grey dots: the other SOEs in the data, latest year", "t-muted", "middle", 10.5);
      box.replaceChildren(svg);
    },
    vizLadder(box, r) {
      const T = CFG.Z_RATING_TABLE, rg = (v) => (v === null ? "" : fmt(v, 2));
      box.replaceChildren(el("ol", { class: "how-ladder" }, T.map(([a, bb, name, pd], i) => el("li", { class: (name === r.Rating ? "on " : "") + (name === "BBB-" ? "ig-line " : "") + (pd >= 0.16 ? "hi" : pd >= 0.01 ? "mid" : "lo") },
        el("span", { class: "lad-r" }, name), el("span", { class: "lad-z num" }, a === null ? `≤ ${rg(bb)}` : bb === null ? `> ${rg(a)}` : `${rg(a)} to ${rg(bb)}`), el("span", { class: "lad-pd num" }, pctAuto(pd)),
        name === r.Rating ? el("span", { class: "lad-tag" }, `← ${r.Entity}`) : null))),
        el("p", { class: "note" }, "Columns: rating step · score range · chance of distress in a year. The line under BBB− marks the end of investment grade."));
    },
    vizDots(box, pd) {
      const W = widthOf(box), cols = 40, rowsN = 25, k = Math.round(pd * 1000), g = Math.min(12, (W - 8) / cols), Hh = rowsN * g + 30;
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: "img", "aria-label": `${k} of 1,000 similar SOEs need a rescue in a typical year` });
      const x0 = (W - cols * g) / 2;
      for (let i = 0; i < 1000; i++) { const cx = x0 + (i % cols) * g + g / 2, cy = Math.floor(i / cols) * g + g / 2; svgEl("circle", { cx, cy, r: g * 0.36, class: i < k ? "dot-risk" : "dot-ok" }, svg); }
      txt(svg, W / 2, Hh - 10, `${k.toLocaleString("en-US")} of 1,000 need a rescue in a typical year`, "t-head num", "middle", 12.5, 700);
      box.replaceChildren(svg);
    },
    vizCost(box, e) {
      const W = widthOf(box), Hh = 230, L = 8, R = 8, w = W - L - R, y0 = 40, h = 90;
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: "img", "aria-label": `Expected fiscal cost ${money(e.EFC)} = EAD × LGD × PD` });
      const wL = w * e.LGD, wE = Math.max(2, wL * e.PD);
      svgEl("rect", { x: L, y: y0, width: w, height: h, class: "cost-ead", rx: 3 }, svg);
      svgEl("rect", { x: L, y: y0, width: wL, height: h, class: "cost-lgd", rx: 3 }, svg);
      svgEl("rect", { x: L, y: y0, width: wE, height: h, class: "cost-efc", rx: 3 }, svg);
      txt(svg, L + w - 6, y0 - 12, `At stake (EAD) ${money(e.EAD)}`, "t-ink2 num", "end", 11.5, 700);
      txt(svg, L + wL - 6, y0 + h + 16, `Government bears (LGD ${pct0(e.LGD)}) ${money(e.EAD * e.LGD)}`, "t-ink2 num", wL > 200 ? "end" : "start", 11.5, 700);
      txt(svg, L + 4, y0 + h + 40, `× chance of distress ${pctAuto(e.PD)} = expected fiscal cost ${money(e.EFC)}`, "t-head num", "start", W < 520 ? 11 : 12.5, 700);
      svgEl("line", { x1: L + wE, x2: L + wE + 14, y1: y0 + h / 2, y2: y0 + h / 2, class: "ref-l" }, svg);
      txt(svg, L + wE + 18, y0 + h / 2, "expected cost", "t-ink", "start", 11.5, 700);
      box.replaceChildren(svg);
    },
    /** shock transmission: map, steps, live numbers for the example SOE, and the SOEs most exposed */
    drawShock(r) {
      const st = S.how, H = this.H, id = st.shock, t = howShock(id), hits = HOW_HITS[id];
      const base = howRun(r, ZERO_MAG), path = howRun(r, howMags(id, r)), f = last(path), fb = last(base), y1 = path[1], b1 = base[1];
      const gapOf = (pp) => sum(pp.slice(1).map((q) => (q["Cash Funding Gap"] || 0) + (q["Cash Drawdown"] || 0)));
      const sgnMoney = (v) => (Math.abs(v) < 1e-6 ? "no change" : (v > 0 ? "+" : "−") + money(Math.abs(v)));
      const dz = (k) => (f[k] - fb[k]) * CFG.ZEM_COEFFICIENTS[k];
      const nd = (d, t0) => ({ d, t: t0 === undefined ? sgnMoney(d) : t0 });
      const vals = {
        cost: id === "fuel" ? nd(y1["Fuel Cost Change"] || 0, sgnMoney(y1["Fuel Cost Change"] || 0) + " fuel bill") : null,
        int: nd((y1["Interest Expense"] || 0) - (b1["Interest Expense"] || 0)),
        ebit: nd(y1.EBIT - b1.EBIT), ni: nd(y1["Net Income"] - b1["Net Income"]), gap: nd(gapOf(path) - gapOf(base)),
        ca: nd(f["Current Assets"] - fb["Current Assets"]), debt: nd(f["Total Liabilities"] - fb["Total Liabilities"]), eq: nd(f.Equity - fb.Equity),
        X1: nd(dz("X1"), sgn(dz("X1"), 2) + " pts"), X2: nd(dz("X2"), sgn(dz("X2"), 2) + " pts"), X3: nd(dz("X3"), sgn(dz("X3"), 2) + " pts"), X4: nd(dz("X4"), sgn(dz("X4"), 2) + " pts"),
        z: nd(f.Z_EM - fb.Z_EM, `${fmt(fb.Z_EM, 2)} → ${fmt(f.Z_EM, 2)}`), pd: nd(f.PD - fb.PD, `${pctAuto(fb.PD)} → ${pctAuto(f.PD)}`), efc: nd(f.EFC - fb.EFC),
      };
      const tiny = (v, k) => !v || v.d === null || !ok(v.d) ? false : ["X1", "X2", "X3", "X4", "z"].includes(k) ? Math.abs(v.d) < 0.005 : k === "pd" ? Math.abs(v.d) < 1e-6 : Math.abs(v.d) < Math.max(1, Math.abs(fb.EFC || 0)) * 1e-6;
      const sizeTxt = id === "standard" ? "all six at their standard sizes" : `standard size: ${id === "rates" ? bpsF(t.guide.standard) + " (refinancing " + bpsF(STD_MAG.refinancing_spread_bps) + ")" : id === "revenue" ? `${sgn(t.guide.standard, 1)} s.d. of its own revenue growth (${pctSig(t.guide.standard * volFor(r.Entity, r.Sector)[0])})` : id === "arrears" ? pct0(t.guide.standard) + " of revenue a year" : id === "fx" ? "−" + pct0(t.guide.standard) : pctSig(t.guide.standard)}`;
      put(H.flow,
        el("div", { class: "how-flow-col how-flow-shock" }, el("span", { class: "how-col-h" }, "Shock"), el("div", { class: "how-node p" }, el("b", {}, t.label), el("small", {}, sizeTxt))),
        ...HOW_NODES.map(([ck, ch, nodes]) => el("div", { class: "how-flow-col" }, el("span", { class: "how-col-h" }, ch),
          nodes.map(([nk, nl]) => {
            let cls = hits.p.includes(nk) ? "p" : hits.s.includes(nk) ? "s" : "off";
            const v = vals[nk], zero = cls !== "off" && tiny(v, nk);
            if (zero && cls === "s") cls = "s zero";
            return el("div", { class: "how-node " + cls, title: cls === "off" ? "Not moved by this shock" : zero ? `No change for ${r.Entity} by ${f["Calendar Year"]} with these settings (flows may have recovered after the shock ended)` : "" }, el("b", {}, nl),
              cls === "off" ? el("small", {}, "not moved") : zero ? el("small", {}, `no change by ${f["Calendar Year"]}`) : v ? el("small", { class: "num" }, v.t) : el("small", {}, nk === "rev" ? (id === "revenue" ? "falls" : "moves with the shock") : "rises"));
          }))));
      put(H.path, el("div", { class: "how-path-grid" },
        el("div", {}, el("h4", {}, `${t.label}: step by step`), el("ol", { class: "how-steps" }, t.path.map((s0) => el("li", {}, s0)))),
        el("div", { class: "how-facts" },
          el("p", {}, el("b", {}, "What it is. "), t.what), el("p", {}, el("b", {}, "Who it hits. "), t.who),
          t.direction ? el("p", {}, el("b", {}, "Direction. "), t.direction) : null, t.results ? el("p", {}, el("b", {}, "Effect on the results. "), t.results) : null,
          el("p", { class: "muted" }, el("span", { class: "how-key p" }), " hit first  ", el("span", { class: "how-key s" }), " moved next  ", el("span", { class: "how-key off" }), " not moved. Numbers: ", `${r.Entity}, ${sizeTxt}, against its no-shock path (flows in ${y1["Calendar Year"]}, stocks in ${f["Calendar Year"]}).`))));
      // live: the example SOE's path, and the total of shocks one at a time
      const chart = el("div", { class: "chart" });
      const chans = Object.entries(CFG.REPORT_STRESS_CHANNELS).map(([k, [lab, mag]]) => { const q = last(howRun(r, Object.assign({}, ZERO_MAG, { fuel_shock_path: [], [mag]: STD_MAG[mag] }))); return [lab, (q.EFC || 0) - (fb.EFC || 0)]; });
      const comb = last(howRun(r, howMags("standard", r))), combD = (comb.EFC || 0) - (fb.EFC || 0), singles = sum(chans.map((x) => x[1]));
      const tryBtn = el("button", { class: "btn primary", type: "button", onclick: () => this.tryIt(r, id) }, `Try ${id === "standard" ? "the standard stress" : "this shock"} in Shock Scenarios →`);
      put(H.live, el("div", { class: "grid" },
        el("div", { class: "s7" }, el("div", { class: "card" }, el("div", { class: "card-head" }, el("div", {}, el("h3", {}, `${r.Entity}: expected fiscal cost with and without the shock`), el("p", { class: "sub" }, `Shock in years 1–${CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years} of ${CFG.MC_HORIZON_YEARS}; the gap between the lines is the effect of the shock alone.`))),
          legendRow([legendItem(LG.str, "With the shock"), legendItem(LG.base, "No shock"), legendItem(LG.act, "Shock active")]), chart)),
        el("div", { class: "s5" }, el("div", { class: "card how-take" }, el("h3", {}, "What to take away"),
          el("ul", {},
            el("li", {}, `Final year: the expected fiscal cost goes from ${money(fb.EFC, true)} to `, el("b", {}, money(f.EFC, true)), ` (${sgn(fb.EFC ? (f.EFC / fb.EFC - 1) * 100 : NaN, 0)}%).`),
            el("li", {}, `The distress score moves from ${fmt(fb.Z_EM, 2)} to `, el("b", {}, fmt(f.Z_EM, 2)), f.Zone !== fb.Zone ? ` and ${r.Entity} moves from the ${fb.Zone.toLowerCase()} to the ${f.Zone.toLowerCase()} zone.` : `, staying in the ${f.Zone.toLowerCase()} zone.`),
            f["Total Liabilities"] > fb["Total Liabilities"] * 1.0005 ? el("li", {}, "When a shock ends, profit recovers but the extra debt stays, so the damage lasts to the end of the horizon.") : null,
            f.Rating === fb.Rating && Math.abs(f.Z_EM - fb.Z_EM) > 0.005 ? el("li", {}, `The score moved but stayed on the same rating step (${f.Rating}), so the chance of distress did not change. Small moves inside a step are invisible with rating steps; the smooth curve used in Monte Carlo picks them up.`) : null,
            el("li", {}, el("b", {}, "Shocks make each other worse. "), `For ${r.Entity}, the six standard shocks one at a time add ${sgnMoney(singles)}; all six together add ${sgnMoney(combD)}. Each adds debt and interest that the others build on, and a weaker score can drop the SOE a rating step, where the chance of distress jumps.`)),
          tryBtn))));
      const xs = path.map((q) => q["Calendar Year"]);
      lines(chart, xs, [{ vals: base.map((q) => q.EFC), cls: "ln-base", dot: "prev", skipFirstDot: true, label: "No shock" }, { vals: path.map((q) => q.EFC), cls: "ln-str", dot: "now", label: "With the shock" }],
        { zeroFloor: true, h: 230, L: 62, active: [1, CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years], yFmt: (v, s2) => moneyTick(v, s2), xLab: (i) => (i === 0 ? `${xs[i]} now` : String(xs[i])), tipTitle: (i) => `${r.Entity} · ${xs[i]}`, tip: (i) => [[money(path[i].EFC), `with the shock · PD ${pctAuto(path[i].PD)}`], [money(base[i].EFC), "no shock"]], endLabel: { series: 1, fmt: (v) => money(v) } });
      // which SOEs in the data are most exposed to this shock
      const all = latestOf(S.en).map((q) => { const b0 = last(howRun(q, ZERO_MAG)), s1 = last(howRun(q, howMags(id, q))); return { q, d: (s1.EFC || 0) - (b0.EFC || 0), dz: s1.Z_EM - b0.Z_EM, drop: zoneRank(s1.Zone) < zoneRank(b0.Zone) }; }).sort((a, b) => b.d - a.d);
      const ex = (q) => { const e0 = expoFor(q); return id === "fuel" ? `fuel ${pct0(e0.fuel_cost_share)} of costs` : id === "fx" ? `${pct0(e0.fx_debt_share)} of debt in foreign currency` : id === "rates" ? `${pct0(e0.floating_debt_share)} floating-rate debt` : id === "revenue" ? `revenue volatility ${pct(volFor(q.Entity, q.Sector)[0], 1)}` : id === "arrears" ? `revenue ${money(q[E.K.rev])}` : q.Sector; };
      const mx = Math.max(1e-9, ...all.map((x) => Math.abs(x.d)));
      put(H.who, el("div", { class: "card" }, el("div", { class: "card-head" }, el("div", {}, el("h3", {}, `Which SOEs in your data does this shock hit hardest?`), el("p", { class: "sub" }, `Same shock for every SOE, each with its own exposures · rise in expected fiscal cost in year ${CFG.MC_HORIZON_YEARS} · this is a ranking, not a sum`))),
        el("ol", { class: "how-who" }, all.slice(0, 5).map((x) => el("li", {}, el("span", { class: "w-n" }, el("b", {}, x.q.Entity), el("small", {}, `${x.q.Sector} · ${ex(x.q)}`)),
          el("span", { class: "track" }, el("span", { class: x.d >= 0 ? "neg" : "pos", style: `width:${(Math.abs(x.d) / mx) * 100}%;left:0` })), el("span", { class: "w-v num" }, sgnMoney(x.d) + (x.drop ? " · drops a zone" : ""))))),
        all.length > 5 ? el("p", { class: "note" }, `${all.length - 5} more SOEs in the data; the full ranking under a broad shock is in Shock Scenarios › Portfolio macro shock.`) : null));
    },
    tryIt(r, id) {
      const st = S.sh;
      st.soe = r.Entity; st.year = r.Year; st.view = "single";
      if (id === "standard") { st.mode = "standard"; Object.assign(st.mags, STD_MAG, { fuel_shock_path: [] }); }
      else { st.mode = "custom"; st.stype = id; Object.assign(st.mags, howMags(id, r)); }
      st.D = Math.min(CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, st.H);
      S.built.shock = false; showTab("shock"); window.scrollTo({ top: 0 });
    },
    /** the expected costs the same SOE shows in different places, and why they differ */
    drawWhich(r) {
      const H = this.H, efc = E.efcRow(r, S.efc.lgd, S.efc.ead, S.efc.basis).EFC;
      const b = last(howRun(r, ZERO_MAG)), s1 = last(howRun(r, howMags("standard", r)));
      let med = NaN;
      try {
        const ex = expoFor(r), p = Object.assign(paramsFor(r, STD_MAG, ex, CFG.DEFAULT_SHOCK_PARAMS.shock_duration_years, CFG.MC_HORIZON_YEARS), { mc_pd_method: "rating_smooth" });
        const sims = E.monteCarlo(r, p, { n: 400, fuelSd: CFG.MC_DEFAULT_FUEL_STD, fxSd: CFG.MC_DEFAULT_FX_STD, rho: CFG.MC_DEFAULT_CORRELATION, H: CFG.MC_HORIZON_YEARS, lgd: S.efc.lgd, seed: 42, eadShare: S.efc.ead });
        med = E.quantile(sims.map((x) => last(x.path).EFC_Rating_Anchored), 0.5);
      } catch (e) { /* the table shows a dash */ }
      const yN = r.Year + CFG.MC_HORIZON_YEARS;
      H.which.querySelector(".card").firstChild.replaceWith(simpleTable(["Where", "What it answers", `${r.Entity}`],
        [[go("efc", "Expected Fiscal Cost tab"), `Today: latest accounts (${r.Year}), rating steps`, money(efc, true)],
          [go("shock", "Shock Scenarios · no shock"), `Year ${yN} if nothing goes wrong (the SOE's trend rolled forward)`, money(b.EFC, true)],
          [go("shock", "Shock Scenarios · standard stress"), `Year ${yN} under all six standard shocks, rating steps`, money(s1.EFC, true)],
          [go("shock", "Range of outcomes (Monte Carlo)"), `Year ${yN}, middle of many shock sizes, smooth PD curve`, money(med, true)]],
        { cls: "compact", right: (i) => i === 2 }));
      if (!H.which.querySelector(".note")) H.which.querySelector(".card").appendChild(el("p", { class: "note" }, "If two numbers for the same SOE disagree, first check which year they refer to, whether a shock is applied, and whether one of them is a Monte Carlo result (smooth curve instead of rating steps)."));
    },
  };
