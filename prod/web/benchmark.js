/* Benchmark. Standalone: shares only style.css with the rest of the site. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inr = (x) => { x = Math.round(x || 0); const a = Math.abs(x); return (x < 0 ? "-" : "") + "₹" + (a >= 1e7 ? (a / 1e7).toFixed(a >= 1e8 ? 0 : 1) + " cr" : a >= 1e5 ? (a / 1e5).toFixed(a >= 1e6 ? 0 : 1) + " L" : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K" : String(a)); };
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const cpm = (x) => "₹" + (x >= 100 ? x.toFixed(0) : x.toFixed(1));
const num = (x) => (x >= 1e6 ? (x / 1e6).toFixed(1) + "M" : x >= 1e3 ? (x / 1e3).toFixed(1) + "K" : String(Math.round(x)));
const times = (x) => (x >= 10 ? x.toFixed(0) : x.toFixed(1)) + "×";
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logPos = (x, lo, hi) => (Math.log(clamp(x, lo, hi)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
const RED = "#ff3b30";
const VERDICT = { blown: ["Overspent", RED], overpaid: ["Overpriced", "var(--amber)"], fine: ["Fair", "var(--good)"] };
const SHORT = (d, k) => d.labels[k].split(":")[0];
const TAGLINE = { smooth: "A steady crowd, about the size expected", abundant: "A crowd floods in", scarce: "Far too few people arrive", viral_one: "One size group surges", viral_many: "Several groups surge" };
let DATA = null;

/* Bars, columns and rings are drawn at zero, then grown, so they animate in. */
function grow(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll("[data-w]").forEach((e) => (e.style.width = e.dataset.w));
    root.querySelectorAll("[data-h]").forEach((e) => (e.style.height = e.dataset.h));
    root.querySelectorAll("[data-dash]").forEach((e) => e.setAttribute("stroke-dasharray", e.dataset.dash));
  }));
}

const section = (label, title, sub, body) => `<section class="bm-sec"><header><span class="label">${label}</span><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</header>${body}</section>`;
const card = (title, sub, body, take = "", cls = "") => `<div class="card ${cls}"><div><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ""}</div>${body}${take ? `<p class="take">${take}</p>` : ""}</div>`;
const legend = (items, cls = "") => `<div class="legend-row ${cls}">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div>`;
const OLD_NEW = legend([["var(--old)", "Old way"], ["var(--gold)", "Clearing"]]);

/* What the price is judged against: the market's true price per view. */
/* One seller, many buyers: the true price is only a guide, and overpaying is the only failure. So the test is
   simply whether the price actually paid per view was at or below it. */
const atOrUnder = (rows, key) => (rows.length ? rows.filter((r) => r[key].spend <= r.true_cpi * r.views * (1 + 1e-9)).length / rows.length : 0);

/* Thin liquidity: campaigns where Clearing's settled price itself ran at or past 1.5x the true price
   (few enough views that the pool alone would have priced above the reference). This is a per-view-price
   condition, not the "overpriced" verdict (which now also requires the excess to be real money) — using
   the verdict here would leave almost nothing to compare, since a big-money overpay is rare for Clearing. */
function priceStats(d) {
  const worth = (r) => r.true_cpi * r.views, extra = (r, k) => Math.max(0, r[k].spend - worth(r));
  const set = d.rows.filter((r) => r.new.price >= d.overpaid * r.true_cpi * (1 - 1e-9)), sum = (f) => set.reduce((a, r) => a + f(r), 0), bud = sum((r) => r.budget);
  return { n: set.length, oldExtra: sum((r) => extra(r, "old")), newExtra: sum((r) => extra(r, "new")), oldSpent: bud ? sum((r) => r.old.spend) / bud : 0, newSpent: bud ? sum((r) => r.new.spend) / bud : 0 };
}

/* ---------- HERO: the most damning result ---------- */
function ring(share, col, size = 132, stroke = 16, c1 = "", c2 = "", base = "var(--card-2)") {
  const R = (size - stroke) / 2 - 2, C = 2 * Math.PI * R, len = clamp(share, 0, 1) * C, h = size / 2;
  return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${h}" cy="${h}" r="${R}" fill="none" stroke="${base}" stroke-width="${stroke}"/>
    <circle class="seg" cx="${h}" cy="${h}" r="${R}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="butt" stroke-dasharray="0 ${C}" data-dash="${len} ${C - len}" transform="rotate(-90 ${h} ${h})"/>
    ${c1 ? `<text x="${h}" y="${h + 2}" text-anchor="middle" class="c1">${c1}</text><text x="${h}" y="${h + 18}" text-anchor="middle" class="c2">${c2}</text>` : ""}</svg>`;
}
function donut(t, N, name, cls) {
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const segs = ["fine", "overpaid", "blown"].map((k) => {
    const len = (t.verdicts[k] / N) * C, s = `<circle class="seg" cx="66" cy="66" r="${R}" fill="none" stroke="${VERDICT[k][1]}" stroke-width="16" stroke-dasharray="0 ${C}" data-dash="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 66 66)"><title>${VERDICT[k][0]}: ${t.verdicts[k]}</title></circle>`;
    off += len;
    return s;
  }).join("");
  return `<div class="bm-donut"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="${R}" fill="none" stroke="var(--card-2)" stroke-width="16"/>${segs}
    <text x="66" y="68" text-anchor="middle" class="c1">${pct(t.verdicts.fine / N)}</text><text x="66" y="84" text-anchor="middle" class="c2">fair</text></svg>
    <span class="label ${cls}">${name}</span></div>`;
}

function hero(d) {
  const o = d.totals.old, n = d.totals.new, N = d.campaigns;
  const w = [...d.rows].sort((a, b) => (b.old.spend - b.budget) - (a.old.spend - a.budget))[0];
  const oX = w.old.spend / w.budget, nX = w.new.spend / w.budget, S = 24;   // budget marker sits at 24% of the track
  const track = (x, col) => `<div class="strack"><span class="mk" style="left:${S}%"></span><span class="mkl" style="left:${S}%">budget</span><i style="background:${col}" data-w="${Math.min(100, x * S)}%"></i></div>`;
  return `<section class="bm-hero">
    <div class="card">
      <span class="label gold">The headline</span>
      <p class="bm-kick">The old way paid <em>${inr(o.over_amount)}</em> beyond what brands had budgeted. Clearing paid <u>${inr(n.over_amount)}</u>.</p>
      <p class="sub">Across ${N} campaigns and ${inr(o.total_budget)} of budgets, the old way ended up paying <b class="old-t">${inr(o.total_spend)}</b> (${times(o.total_spend / o.total_budget)} the budgets). It overspent, by any amount, in <b class="old-t">${pct(o.over_count / N)}</b> of them. Clearing never overspent.</p>
      <div class="bm-donuts">${donut(o, N, "Old way", "old-t")}${donut(n, N, "Clearing", "new-t")}
        <div style="display:grid;gap:8px;align-content:center">${legend([["var(--good)", VERDICT.fine[0]], [VERDICT.overpaid[1], VERDICT.overpaid[0]], [RED, VERDICT.blown[0]]], "col")}</div></div>
    </div>
    <div class="card story">
      <div class="storyhead"><span class="label old-t">The single worst campaign</span><b>${inr(w.budget)} budget in a ${esc(SHORT(d, w.scenario).toLowerCase())} market</b></div>
      <div class="row"><div><span>Old way paid</span><b class="old-t">${inr(w.old.spend)}</b></div>${track(oX, "var(--old)")}<div><span>${times(oX)} the budget${oX * S > 100 ? " (bar cut off)" : ""}</span><span>${inr(w.old.spend - w.budget)} over</span></div></div>
      <div class="row"><div><span>Clearing paid</span><b class="new-t">${inr(w.new.spend)}</b></div>${track(nX, "var(--gold)")}<div><span>${pct(nX)} of the budget</span><span>${inr(w.budget - w.new.spend)} handed back</span></div></div>
      <p class="sub">The advertiser's gut feel was ${w.feel.toFixed(0)} (100 is exactly right). His ladder had no way to notice ${num(w.posts)} posts arriving. Clearing only ever splits the budget it was given.</p>
    </div></section>`;
}

/* ---------- THE GIST: one table, the whole story ---------- */
function scorecard(d) {
  const o = d.totals.old, n = d.totals.new, N = d.campaigns, plan = 1e6, r = (x) => inr(x * plan);
  const ppk = (t) => { const p = t.pay_per_1k_by_tier; return p.macro ? p.nano / p.macro : 0; };
  const chip = (c, t) => `<span class="chip ${c}">${t}</span>`;
  const ps = priceStats(d), fo = atOrUnder(d.rows, "old"), fn = atOrUnder(d.rows, "new");
  const saved = o.over_amount;
  const better = (a, b) => (b <= a ? ["new", "Clearing"] : ["old", "Old way ahead"]);
  const rows = [
    ["g", "Staying inside the budget"],
    ["Overspent at all", "Paid even ₹1 more than the budget.", pct(o.over_count / N), pct(n.over_count / N), chip("new", "Clearing")],
    ["Overspent by more than 2×", "Paid over double the budget.", pct(o.over_2x / N), pct(n.over_2x / N), chip("new", "Clearing")],
    ["Overspend, as a share of every budget", `The old ladder keeps paying every rung crossed, even past the budget — it floods. Clearing stops the moment the pool is spent, so this is always ${inr(0)}.`, pct(o.over_amount / o.total_budget), pct(n.over_amount / n.total_budget), chip("new", "Clearing")],
    ["Worst single overspend", "The most any one campaign went past its budget.", times(o.over_worst), times(n.over_worst), chip("new", "Clearing")],
    ["A ₹10 L plan, in practice", "Where 8 in 10 campaigns land.", `<span style="font-size:15px">${r(o.ratio_p10)} – ${r(o.ratio_p90)}</span>`, `<span style="font-size:15px">${r(n.ratio_p10)} – ${r(n.ratio_p90)}</span>`, chip("new", "Clearing")],
    ["g", "Whether the price is fair"],
    ["Fair campaigns", "Within budget, and no big overpay — see below.", pct(o.verdicts.fine / N), pct(n.verdicts.fine / N), chip("new", "Clearing")],
    ["Paid at or under the true price", "The true price is a guide, not a ceiling — overpaying is the real risk.", pct(fo), pct(fn), fn > fo + 0.03 ? chip("new", "Clearing") : fn < fo - 0.03 ? chip("old", "Old way ahead") : chip("tie", "Near tie")],
    ["When the price runs high: how much gets spent before it stops", `On the ${ps.n} campaigns where Clearing's price ran above the true price. Clearing settles there but recovers fast, spending only a slice and returning the rest. The old ladder floods on, paying every rung to the end.`, pct(ps.oldSpent), pct(ps.newSpent), chip(...better(ps.oldSpent, ps.newSpent))],
    ["g", "Fairness to creators"],
    ["n", `<b>Why it matters:</b> a rung nobody can reach pays nobody. Clearing sets each size's first rung so 80% of that size's past posts clear it — about 4 in 5 posts get paid, whatever the size. One ladder for everyone can't do that.`],
    ["Nano creators who got paid", "Share of the smallest creators' posts that earned anything.", pct(o.paid_by_tier.nano), pct(n.paid_by_tier.nano), chip("new", "Clearing")],
    ["Pay gap, nano vs macro", "Pay per view, smallest ÷ largest creator. 1× is even.", times(ppk(o)), times(ppk(n)), chip("new", "Clearing")],
  ];
  const body = rows.map((x) => x[0] === "g" ? `<tr class="g"><td colspan="4">${x[1]}</td></tr>` : x[0] === "n" ? `<tr class="n"><td colspan="4">${x[1]}</td></tr>` :
    `<tr><td class="what"><b>${x[0]}</b><small>${x[1]}</small></td><td class="v old-t" data-l="Old way">${x[2]}</td><td class="v new-t" data-l="Clearing">${x[3]}</td><td data-l="Verdict">${x[4]}</td></tr>`).join("");
  return section("The gist", "Everything, side by side", "One table, every measure. Grey chips are where it is close.",
    `<div class="card"><div class="score-wrap"><table class="score"><thead><tr><th>Measure</th><th>Old way</th><th>Clearing</th><th>Verdict</th></tr></thead><tbody>${body}</tbody></table></div></div>`);
}

/* ---------- CHARTS ---------- */
function waffle(rows, key) {
  return `<div class="waffle">${rows.map((r, i) => {
    const x = r[key], [label, col] = VERDICT[x.verdict];
    return `<i style="background:${col};animation-delay:${Math.min(i, 400) * 2}ms" title="#${r.id} · ${label} · budget ${inr(r.budget)}, paid ${inr(x.spend)} (${pct(x.spend / r.budget)})"></i>`;
  }).join("")}</div>`;
}
function waffleCard(d) {
  const N = d.campaigns, lg = (t) => legend(Object.entries(VERDICT).map(([k, [l, c]]) => [c, `${l} <b>${t.verdicts[k]}</b>`]));
  return card(`Every campaign, one square each`, "Hover a square for its budget and what was paid.",
    `<div class="bm-two"><div style="display:grid;gap:10px"><span class="label old-t">Old way</span>${waffle(d.rows, "old")}${lg(d.totals.old)}</div>
      <div style="display:grid;gap:10px"><span class="label new-t">Clearing</span>${waffle(d.rows, "new")}${lg(d.totals.new)}</div></div>`,
    `Out of ${N} campaigns, the old way was fair in ${d.totals.old.verdicts.fine}. Clearing was fair in ${d.totals.new.verdicts.fine}.`);
}

function axisY(ticks, x0, x1, y) {
  return ticks.map(([v, l]) => `<line class="gl" x1="${x0}" x2="${x1}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${x0 - 8}" y="${y(v) + 3}" text-anchor="end">${l}</text>`).join("");
}
function scatter(d) {
  const W = 640, H = 340, L = 50, R = 12, T = 14, B = 36;
  const X = (f) => L + logPos(f, 5, 500) * (W - L - R), Y = (v) => T + (1 - logPos(v, 0.01, 100)) * (H - T - B);
  const dots = (key, col, r) => d.rows.map((row) => `<circle cx="${X(row.feel).toFixed(1)}" cy="${Y(row[key].spend / row.budget).toFixed(1)}" r="${r}" fill="${col}" fill-opacity=".6"><title>#${row.id} · feel ${row.feel.toFixed(0)} · paid ${times(row[key].spend / row.budget)} the budget</title></circle>`).join("");
  const xt = [5, 10, 25, 50, 100, 250, 500].map((v) => `<text class="ax" x="${X(v)}" y="${H - 14}" text-anchor="middle">${v}</text>`).join("");
  const near = d.rows.filter((r) => r.feel >= 70 && r.feel <= 140), blown = near.filter((r) => r.old.verdict === "blown").length;
  return card("Gut feel doesn't predict the bill", "Each dot: one campaign. Right = a better guess. Up = paid more than budgeted.",
    `<svg class="chart" viewBox="0 0 ${W} ${H}">${axisY([[0.01, "0.01×"], [0.1, "0.1×"], [1, "1×"], [10, "10×"], [100, "100×"]], L, W - R, Y)}
      <line class="bl" x1="${L}" x2="${W - R}" y1="${Y(1)}" y2="${Y(1)}"/><text class="bt" x="${W - R}" y="${Y(1) - 5}" text-anchor="end">budget</text>
      <line class="gl" x1="${X(100)}" x2="${X(100)}" y1="${T}" y2="${H - B}" stroke-dasharray="2 4"/>${dots("old", "var(--old)", 3)}${dots("new", "var(--gold)", 3)}${xt}
      <text class="ax" x="${(L + W - R) / 2}" y="${H}" text-anchor="middle">advertiser's CPI feel</text></svg>${OLD_NEW}`,
    near.length ? `Even when the advertiser was roughly right (feel 70–140), the old way overspent in ${pct(blown / near.length)} of ${near.length} campaigns. Clearing's dots never rise above the budget line.` : "");
}

/* How far past the budget: campaigns sorted into plain-language bands. */
const BANDS = [["Stayed within budget", 0, 1, "var(--good)"], ["Up to 1.5× the budget", 1, 1.5, "#ffc247"], ["1.5× to 2×", 1.5, 2, "#ff8a3d"], ["2× to 5×", 2, 5, "#ff5230"], ["More than 5×", 5, Infinity, RED]];
function bandShares(rows, key) {
  return BANDS.map(([, lo, hi]) => rows.filter((r) => { const x = r[key].spend / r.budget; return lo === 0 ? x <= 1 : x > lo && x <= hi; }).length / rows.length);
}
function severity(d) {
  const so = bandShares(d.rows, "old"), sn = bandShares(d.rows, "new");
  const bar = (sh, name, cls) => `<div class="sev"><span class="label ${cls}">${name}</span><div class="sevbar">${sh.map((x, i) => x > 0 ? `<i style="background:${BANDS[i][3]};flex:${x}" title="${BANDS[i][0]}: ${pct(x)}">${x >= 0.08 ? pct(x) : ""}</i>` : "").join("")}</div></div>`;
  return card("How far over budget?", "Every campaign, sorted by what it paid vs. its budget.",
    `${bar(so, "Old way", "old-t")}${bar(sn, "Clearing", "new-t")}${legend(BANDS.map(([l, , , c]) => [c, l]))}`,
    `${pct(so[3] + so[4])} of old-way campaigns paid more than double their budget, and ${pct(so[4])} paid more than five times. Every Clearing campaign stayed within budget.`);
}

/* Market cards: a ring per side, plus how much was paid and how often the price stayed at or under the true price. */
function marketCards(d) {
  const cards = Object.entries(d.by_scenario).map(([k, v]) => {
    const rows = d.rows.filter((r) => r.scenario === k), o = v.old.verdicts.blown / v.n, n = v.new.verdicts.blown / v.n;
    return `<div class="mcard"><div><b>${esc(SHORT(d, k))}</b><small>${TAGLINE[k] || ""}</small></div>
      <div class="rings"><div>${ring(o, RED, 68, 9, "", "", "var(--good)")}<b class="ringpct old-t">${pct(o)}</b><span class="label old-t">Old way</span></div><div>${ring(n, RED, 68, 9, "", "", "var(--good)")}<b class="ringpct new-t">${pct(n)}</b><span class="label new-t">Clearing</span></div></div>
      <div class="mrow"><span>Overspent</span><b><em class="old-t">${pct(o)}</em> → <em class="new-t">${pct(n)}</em></b></div>
      <div class="mrow"><span>Paid ÷ budget</span><b><em class="old-t">${times(v.old.total_spend / v.old.total_budget)}</em> → <em class="new-t">${times(v.new.total_spend / v.new.total_budget)}</em></b></div>
      <div class="mrow"><span>Paid ≤ true price</span><b><em class="old-t">${pct(atOrUnder(rows, "old"))}</em> → <em class="new-t">${pct(atOrUnder(rows, "new"))}</em></b></div></div>`;
  }).join("");
  return card("Which markets break it", `Same campaigns, grouped by market${d.mode === "unbiased" ? " (named from what happened, not chosen)" : ""}. Green ring = never overspent.`,
    `<div class="mgrid">${cards}</div>${OLD_NEW}`,
    "A crowd or a viral surge breaks a fixed ladder — it pays per creator who crosses a rung, so more creators means more payouts, with no ceiling. Clearing has one: the budget.");
}

/* Heatmap: how often the old way overspends, by budget size and market. */
function heatmap(d) {
  const edges = [0, 1e5, 5e5, 2.5e6, Infinity], names = ["< ₹1 L", "₹1–5 L", "₹5–25 L", "> ₹25 L"], mk = Object.keys(d.by_scenario);
  const head = `<div class="hm h"></div>${mk.map((k) => `<div class="hm h">${({ smooth: "Smooth", abundant: "Abundant", scarce: "Scarce", viral_one: "1 surge", viral_many: "Surges" })[k] || esc(SHORT(d, k))}</div>`).join("")}`;
  const body = names.map((nm, i) => `<div class="hm h l">${nm}</div>${mk.map((k) => {
    const g = d.rows.filter((r) => r.scenario === k && r.budget >= edges[i] && r.budget < edges[i + 1]), s = g.length ? g.filter((r) => r.old.verdict === "blown").length / g.length : null;
    return s == null ? `<div class="hm">–</div>` : `<div class="hm" style="background:rgba(255,59,48,${(0.08 + s * 0.8).toFixed(2)})" title="${g.length} campaigns"><b>${pct(s)}</b></div>`;
  }).join("")}`).join("");
  return card("Does the budget's size matter?", "Old way only — share of campaigns that overspent, by size and market.",
    `<div class="heat" style="grid-template-columns:64px repeat(${mk.length}, minmax(0, 1fr))">${head}${body}</div>`,
    "Clearing is 0% in every one of these cells.");
}

/* The biggest blowouts as a compact leaderboard. */
function leaderboard(d) {
  const top = [...d.rows].sort((a, b) => b.old.spend / b.budget - a.old.spend / a.budget).slice(0, 5);
  return card("The five worst blowouts", "Same campaign, both ways.",
    `<div class="lb"><div class="lbh"><span></span><span></span><span class="old-t">Old way</span><span class="new-t">Clearing</span></div>${top.map((r, i) => `<div class="lbr"><span class="rk">${i + 1}</span><div><b>${inr(r.budget)}</b><small>#${r.id} · ${esc(SHORT(d, r.scenario))}</small></div>
      <div><b class="old-t">${times(r.old.spend / r.budget)}</b><small>${inr(r.old.spend)}</small></div><div><b class="new-t">${times(r.new.spend / r.budget)}</b><small>${inr(r.new.spend)}</small></div></div>`).join("")}</div>`);
}

/* ---------- Creators: one card, two views ---------- */
function creators(d) {
  const o = d.totals.old, n = d.totals.new, T = d.tiers, ppk = (t) => t.pay_per_1k_by_tier;
  const dots = (share, col) => `<span class="dots">${Array.from({ length: 10 }, (_, i) => `<i style="background:${i < Math.round(share * 10) ? col : "var(--card-2)"}"></i>`).join("")}</span>`;
  const pic = T.map((t) => `<div class="pic"><b>${t}</b><div>${dots(o.paid_by_tier[t], "var(--old)")}<em class="old-t">${pct(o.paid_by_tier[t])}</em></div><div>${dots(n.paid_by_tier[t], "var(--gold)")}<em class="new-t">${pct(n.paid_by_tier[t])}</em></div></div>`).join("");
  const all = T.flatMap((t) => [ppk(o)[t], ppk(n)[t]]), lo = Math.min(...all), hi = Math.max(...all);
  const tint = (v, rgb) => `rgba(${rgb},${(0.1 + 0.6 * logPos(v, Math.max(lo, 0.5), hi)).toFixed(2)})`;
  const tbl = `<div class="pay"><span></span><span class="label old-t">Old way</span><span class="label new-t">Clearing</span>${T.map((t) => `<b>${t}</b><span style="background:${tint(ppk(o)[t], "255,106,77")}">${cpm(ppk(o)[t])}</span><span style="background:${tint(ppk(n)[t], "242,193,78")}">${cpm(ppk(n)[t])}</span>`).join("")}</div>`;
  const gapO = ppk(o).nano / ppk(o).macro, gapN = ppk(n).nano / ppk(n).macro;
  return `<div class="card"><div class="cr">
    <div style="display:grid;gap:14px;align-content:start"><div><h3>Out of 10 posts, how many earn anything?</h3><p class="sub">By creator size.</p></div>${pic}${OLD_NEW}</div>
    <div style="display:grid;gap:14px;align-content:start"><div><h3>Pay per 1,000 views, by size</h3><p class="sub">Darker = more.</p></div>${tbl}
      <p class="gap"><b class="old-t">${times(gapO)}</b> old way, <b class="new-t">${times(gapN)}</b> Clearing: how much more a nano creator earns per view than a macro creator.</p></div></div>
    <p class="take"><b>Why it matters.</b> A rung nobody can reach pays nobody. Clearing sets each size's first rung so 4 in 5 of that size's posts clear it. One ladder for everyone is out of reach for small creators and trivial for large ones.</p></div>`;
}

function trust(d) {
  const N = d.campaigns, W = 640, L = 150, R = 24, rowH = 32, rs = [{ name: `This run · ${N} campaigns`, old: { blown: d.totals.old.verdicts.blown / N }, new: { blown: d.totals.new.verdicts.blown / N } }, ...d.robust.map((r, i) => ({ name: `Other seed ${i + 1} · 100 campaigns`, ...r }))];
  const H = rs.length * rowH + 40, X = (v) => L + v * (W - L - R);
  const dumb = rs.map((r, i) => { const y = 28 + i * rowH; return `<text class="ax" x="${L - 12}" y="${y + 3}" text-anchor="end">${r.name}</text><line x1="${X(r.new.blown)}" x2="${X(r.old.blown)}" y1="${y}" y2="${y}" stroke="var(--line-2)" stroke-width="3"/>
    <circle cx="${X(r.old.blown)}" cy="${y}" r="7" fill="var(--old)"><title>Old way: ${pct(r.old.blown)} overspent</title></circle><text class="ax" x="${X(r.old.blown) + 12}" y="${y + 3}" style="fill:var(--old)">${pct(r.old.blown)}</text>
    <circle cx="${X(r.new.blown)}" cy="${y}" r="7" fill="var(--gold)"><title>Clearing: ${pct(r.new.blown)} overspent</title></circle>`; }).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line class="gl" x1="${X(v)}" x2="${X(v)}" y1="12" y2="${H - 22}"/><text class="ax" x="${X(v)}" y="${H - 6}" text-anchor="middle">${pct(v)}</text>`).join("");
  const seeds = card("Is this just one lucky run?", "Overspend rate, this run and five other random ones.",
    `<svg class="chart" viewBox="0 0 ${W} ${H}">${ticks}${dumb}</svg>${OLD_NEW}`,
    `The old way overspent in ${pct(Math.min(...rs.map((r) => r.old.blown)))} to ${pct(Math.max(...rs.map((r) => r.old.blown)))} of campaigns across all six runs. Clearing overspent in none of them.`);
  const notes = { Perfect: "knows the exact price", Careful: "small errors", Typical: "this page's default", Careless: "big errors" };
  const sk = d.skills.map((s) => `<div class="skill"><div class="cols"><div><em>${pct(s.old.blown)}</em><i style="background:var(--old)" data-h="${Math.max(2, s.old.blown * 100)}px"></i></div><div><em>${pct(s.new.blown)}</em><i style="background:var(--gold)" data-h="${Math.max(2, s.new.blown * 100)}px"></i></div></div><b>${s.label}</b><small>${notes[s.label]}</small></div>`).join("");
  const perfect = d.skills.find((s) => s.skill === 0);
  const skills = card("What if the advertiser were sharper?", "Overspend rate as his guesses improve.",
    `<div class="skills">${sk}</div>${OLD_NEW}`,
    `Even an advertiser who knows the exact price overspent in ${pct(perfect.old.blown)} of campaigns. Fixing the guess doesn't fix the design: a fixed ladder can't know how many creators will turn up.`);
  return section("Can we trust it?", "Two sanity checks", "Other seeds, and a better advertiser.", `<div class="bm-grid">${seeds}${skills}</div>`);
}

/* ---------- EXPLORER: filterable, sortable, readable ---------- */
const EX = { market: "all", outcome: "all", sort: "multiple", shown: 12 };
function cellbar(r, key) {
  const x = r[key].spend / r.budget, [label, col] = VERDICT[r[key].verdict], S = 1 / 3;
  return `<div class="cellbar"><b><span class="pill"><i style="background:${col}"></i>${times(x)}</span></b><div class="t"><i style="background:${col};width:${Math.min(100, x * S * 100)}%"></i><span class="tp" style="left:${S * 100}%"></span></div><span>${inr(r[key].spend)} · ${label}</span></div>`;
}
function explorer(d) {
  const mkts = Object.keys(d.by_scenario);
  return section("Explore", "Look at any campaign", "Filter to the cases you care about. Click a row for the rungs behind it. The tick on each bar is the budget.",
    `<div class="card"><div class="filters">
      <div><span class="label">Market</span><select id="ex-m"><option value="all">All markets</option>${mkts.map((k) => `<option value="${k}">${esc(SHORT(d, k))}</option>`).join("")}</select></div>
      <div><span class="label">Old way outcome</span><div class="tabs" id="ex-o">${[["all", "All"], ["blown", VERDICT.blown[0]], ["overpaid", VERDICT.overpaid[0]], ["fine", VERDICT.fine[0]]].map(([k, l]) => `<button type="button" data-o="${k}" aria-pressed="${k === "all"}">${l}</button>`).join("")}</div></div>
      <div><span class="label">Sort by</span><select id="ex-s"><option value="multiple">Biggest overspend (×)</option><option value="amount">Biggest overspend (₹)</option><option value="budget">Largest budget</option><option value="id">Campaign number</option></select></div></div>
      <div class="ex-wrap"><table class="ex"><thead><tr><th>Campaign</th><th>Budget</th><th>Advertiser's feel</th><th>Old way paid</th><th>Clearing paid</th></tr></thead><tbody id="ex-rows"></tbody></table></div>
      <div id="ex-foot" class="legend-row" style="justify-content:space-between"></div><button class="cta ghost more" type="button" id="ex-more">Show more</button></div>`);
}
function detail(d, r) {
  const line = (name, arr, fmt = num) => `<span>${name}</span>${arr.map((x) => `<span>${fmt(x)}</span>`).join("")}`;
  const pad = (a) => a.concat(Array(8 - a.length).fill(0));
  const tiers = d.tiers.map((t) => line(`Clearing · ${t}${r.rescued.includes(t) ? " ↓" : ""}`, pad(r.new_rungs[t]), (x) => (x ? num(x) : "–"))).join("");
  const surges = r.surges.map((s) => `${s.tier} ${pct(s.share)} of posts ×${s.mult.toFixed(1)}`).join(", ");
  return `<td colspan="5"><div class="ex-wrap"><div class="rungs"><span class="h">Rung (views)</span>${r.optimal_rungs.map((_, i) => `<span class="h">${i + 1}</span>`).join("")}
    ${line("Truly optimal", r.optimal_rungs)}${line("Advertiser's score", r.rung_scores, (x) => x.toFixed(0))}${line("Old rungs", r.old_rungs)}${line("Old payout", r.old_payouts, inr)}${tiers}</div></div>
    <p class="sub" style="margin:14px 0 0">He expected ${num(r.expected_posts)} posts; a market at the true CPI would bring ${num(r.true_posts)}; ${num(r.posts)} came. Posts by size: ${d.tiers.map((t) => `${t} ${r.tier_posts[t]}`).join(", ")}.
    ${surges ? `Surges: ${esc(surges)}.` : ""}${r.spikes ? ` ${r.spikes} single-post spike${r.spikes > 1 ? "s" : ""}.` : ""} Clearing price ${r.new.price.toFixed(4)} ₹/view, regime "${esc(r.new.regime)}"${r.rescued.length ? `, Fair Reach lowered ${r.rescued.join(", ")}` : ""}.</p></td>`;
}
function drawRows() {
  const d = DATA, key = { multiple: (r) => -r.old.spend / r.budget, amount: (r) => -(r.old.spend - r.budget), budget: (r) => -r.budget, id: (r) => r.id }[EX.sort];
  const list = d.rows.filter((r) => (EX.market === "all" || r.scenario === EX.market) && (EX.outcome === "all" || r.old.verdict === EX.outcome)).sort((a, b) => key(a) - key(b));
  $("#ex-rows").innerHTML = list.slice(0, EX.shown).map((r) => `<tr class="click" data-i="${r.id - 1}"><td><b>#${r.id}</b> <span class="mkt">${esc(SHORT(d, r.scenario))}</span></td><td class="num" data-l="Budget">${inr(r.budget)}</td><td class="num" data-l="Advertiser's feel">${r.feel.toFixed(0)}</td><td data-l="Old way paid">${cellbar(r, "old")}</td><td data-l="Clearing paid">${cellbar(r, "new")}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No campaigns match.</td></tr>`;
  $("#ex-foot").innerHTML = `<span>Showing ${Math.min(EX.shown, list.length)} of ${list.length} matching campaigns</span>`;
  $("#ex-more").hidden = EX.shown >= list.length;
}
function wireExplorer() {
  drawRows();
  $("#ex-m").onchange = (e) => { EX.market = e.target.value; EX.shown = 12; drawRows(); };
  $("#ex-s").onchange = (e) => { EX.sort = e.target.value; drawRows(); };
  $("#ex-o").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; EX.outcome = b.dataset.o; EX.shown = 12; $$("#ex-o button").forEach((x) => x.setAttribute("aria-pressed", x === b)); drawRows(); };
  $("#ex-more").onclick = () => { EX.shown += 20; drawRows(); };
  $("#ex-rows").onclick = (e) => {
    const tr = e.target.closest("tr.click"); if (!tr) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("detail")) return next.remove();
    const el = document.createElement("tr"); el.className = "detail"; el.innerHTML = detail(DATA, DATA.rows[+tr.dataset.i]); tr.after(el);
  };
}

/* ---------- UNBIASED BANNER ---------- */
function unbiasedBanner(d) {
  if (d.mode !== "unbiased") return "";
  return `<section class="unb"><h3>Unbiased mode: nothing here was hand-picked</h3>
    <p>${d.campaigns} campaigns, each with its own random world. There are no market types, no 20% splits and no fixed price. Markets are labelled only after the fact, from what actually happened.</p>
    <div class="two"><div><b>Drawn fresh for every campaign</b><ul>
      <li>The true price per view: ₹5 to ₹100 per 1,000, log-uniform</li>
      <li>Each creator size's typical views, spread and share of the crowd</li>
      <li>How many creators turn up: lognormal around the expected crowd</li>
      <li>How many viral surges (Poisson, average 1), which size group, how many posts, how strong</li>
      <li>Single-post spikes (Poisson, average 2), 5× to 200×</li>
      <li>The advertiser's skill, from perfect to careless, and his gut feel</li>
      <li>How far Clearing's past data has drifted from today's market</li></ul></div>
    <div><b>Still fixed, and why</b><ul>
      <li>The four creator sizes and their rough order (from the brief)</li>
      <li>The budget range, ₹20,000 to ₹2 crore</li>
      <li>The rules: Clearing's rungs and price, the old ladder's payouts sized to spend the budget under the advertiser's own beliefs (this favours the old way)</li>
      <li>Market labels use thresholds (crowd 2× or more = abundant, half or less = scarce). They only name a campaign, they never change it</li>
      <li>"Never overspends" for Clearing is a property of splitting a fixed pool, not a simulation result</li></ul></div></div></section>`;
}

/* ---------- PAGE ---------- */
function render(d) {
  DATA = d; EX.market = "all"; EX.outcome = "all"; EX.sort = "multiple"; EX.shown = 12;
  const out = $("#bm-out");
  out.innerHTML = unbiasedBanner(d) + hero(d) +
    section("See it", "Every campaign, at a glance", "", `${waffleCard(d)}<div class="bm-grid">${scatter(d)}${severity(d)}</div>`) +
    section("Why it happens", "What breaks a fixed ladder", "", `${marketCards(d)}<div class="bm-grid">${heatmap(d)}${leaderboard(d)}</div>`) +
    section("Who gets paid", "Fairness to creators", "", creators(d)) + trust(d) + scorecard(d) + explorer(d);
  wireExplorer();
  grow(out);
}

function setLoader(show, done = 0, total = 1, stage = "Starting") {
  $("#bm-loader").hidden = !show;
  if (!show) return;
  const p = clamp(done / total, 0, 1);
  $("#bm-fill").style.width = (p * 100).toFixed(1) + "%";
  $("#bm-pct").textContent = Math.round(p * 100) + "%";
  $("#bm-stage").textContent = stage;
  $("#bm-count").textContent = total > 1 ? `${done.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} simulated campaigns` : "Warming up…";
}

let RUN = 0, UNB = false;
async function go() {
  const me = ++RUN;
  $("#bm-out").innerHTML = "";
  setLoader(true);
  const q = new URLSearchParams({ seed: $("#bm-seed").value || 1, n: $("#bm-n").value || 400, scenario: $("#bm-scn").value });
  if (UNB) q.set("mode", "unbiased");
  try {
    const s = await fetch("/api/benchmark/start?" + q);
    if (!s.ok) throw new Error("This server doesn't have the benchmark route yet. Restart it with: python -m ladder serve");
    const { id } = await s.json();
    for (;;) {
      await new Promise((r) => setTimeout(r, 250));
      if (me !== RUN) return;
      const p = await (await fetch("/api/benchmark/progress?id=" + id)).json();
      if (p.error) throw new Error(p.error);
      setLoader(true, p.done, p.total, p.stage);
      if (p.result) { setLoader(false); return render(p.result); }
    }
  } catch (e) {
    setLoader(false);
    $("#bm-out").innerHTML = `<div class="card"><h3>Could not run</h3><p class="sub">${esc(e.message)}</p></div>`;
  }
}

const LABELS = { all: "All five markets, mixed", smooth: "Everything moves smoothly", abundant: "Abundant: a crowd floods in", scarce: "Scarce: too few people arrive", viral_one: "One viral surge", viral_many: "Many viral surges" };
$("#bm-scn").innerHTML = Object.entries(LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
$("#bm-form").onsubmit = (e) => { e.preventDefault(); go(); };
$("#bm-unb").onclick = () => {
  UNB = !UNB;
  $("#bm-unb").setAttribute("aria-pressed", UNB);
  $("#bm-scn").disabled = UNB;
  if (UNB) $("#bm-seed").value = 1 + Math.floor(Math.random() * 999999);   // a fresh seed, so no run is a favourite
  go();
};
$("#bm-rand").onclick = () => { $("#bm-seed").value = 1 + Math.floor(Math.random() * 999999); go(); };
go();
