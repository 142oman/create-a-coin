/* Creator Pool front end: plain JS, no build step. */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const rupees = (x) => "₹" + Math.round(x).toLocaleString("en-IN");
const compact = (x) => {
  if (x >= 1e7) return (x / 1e7).toFixed(x >= 1e8 ? 0 : 1).replace(/\.0$/, "") + "Cr";
  if (x >= 1e5) return (x / 1e5).toFixed(x >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "L";
  if (x >= 1e3) return (x / 1e3).toFixed(x >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(x));
};
const views = (x) => {
  if (x >= 1e6) return (x / 1e6).toFixed(x >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(x >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(x));
};
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const cpm = (x) => (x == null ? "–" : "₹" + (x >= 100 ? Math.round(x).toLocaleString("en-IN") : x.toFixed(1)));
const fmtName = (f) => f.replace("_", " ");

const MODES = [["rungs", "Coin rungs"], ["linear", "No rungs"]];

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/* The settlement rule, mirrored from ladder/rules.py. */
function settle(budget, minted, refPerView) {
  if (minted <= 0) return { rate: 0, regime: "empty" };
  const pool = budget / minted;
  if (!refPerView) return { rate: pool, regime: "cold start" };
  if (pool <= refPerView) return { rate: pool, regime: "competitive" };
  return { rate: Math.sqrt(pool * refPerView), regime: "thin" };
}

/* Theme ------------------------------------------------------------------------------------------ */
(function theme() {
  const key = "coin-theme";
  try { const saved = localStorage.getItem(key); if (saved) document.documentElement.dataset.theme = saved; } catch (_) {}
  $("#theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem(key, document.documentElement.dataset.theme); } catch (_) {}
  });
})();

/* Routing ---------------------------------------------------------------------------------------- */
const VIEWS = ["brand", "creator", "backtest", "compare", "method"];
const loaded = {};
function route() {
  const [view, arg] = (location.hash || "#brand").slice(1).split("/");
  const name = VIEWS.includes(view) ? view : "brand";
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
  $$(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  if (name !== "creator" && name !== "brand") stopPlayers();
  if (name === "brand" && loaded.brand && SIM && SIM !== BRAND_SIM) {
    const o = $("#sim-panel [data-sim-out]");
    if (o) { stopPlayers(); renderSim(o, SIM, false); }
  }
  syncControls();
  if (name === "creator") initCreator(arg);   // always reflects the latest simulation
  else if (!loaded[name]) { loaded[name] = true; ({ brand: initBrand, backtest: initBacktest, compare: initCompare, method: initMethod })[name](); }
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);

let META = null;
const meta = () => META || (META = api("/api/meta"));

/* State shared by the brand and creator pages. */
let CAMPAIGN = null;   // last created campaign (proposal)
let SIM = null;        // last simulation run
let CAMPAIGN_BODY = null;
let BRAND_SIM = null;  // the run the brand page is currently showing
let EXPLAIN = null;    // the category/format the brand last looked at in the rung explainer
const choice = { categories: new Set(["gaming"]), platforms: new Set(["instagram"]), formats: new Set(), tiers: new Set() };
const FORMAT_LABEL = { reel: "reel", carousel: "carousel", short: "short", long_form: "long-form" };
const simState = { scenario: "normal", seed: "" };

/* The coin-value curve: price per 1,000 coins against coins minted, log-log. */
function coinCurve(p, mode = "linear") {
  const budget = p.params.total_budget, mk = p.market[mode];
  const ref = mk.cpm ? mk.cpm / 1000 : null;
  const q = Math.min(...p.ladders.map((l) => l.threshold));
  const center = mk.break_even_coins || budget / 0.05;
  const lo = Math.max(q, center / 300), hi = center * 60;
  const W = 720, H = 240, L = 56, R = 12, T = 18, B = 34;
  const xs = [], N = 90;
  for (let i = 0; i <= N; i++) xs.push(Math.exp(Math.log(lo) + (i / N) * (Math.log(hi) - Math.log(lo))));
  const pool = xs.map((m) => (1000 * budget) / m);
  const paid = xs.map((m) => 1000 * settle(budget, m, ref).rate);
  const yMin = Math.min(...pool, ...paid) * 0.8, yMax = Math.max(...pool, ...paid) * 1.25;
  const X = (m) => L + ((Math.log(m) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (W - L - R);
  const Y = (v) => T + (1 - (Math.log(v) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin))) * (H - T - B);
  const line = (vals) => xs.map((m, i) => `${i ? "L" : "M"}${X(m).toFixed(1)},${Y(vals[i]).toFixed(1)}`).join(" ");
  const refY = mk.cpm ? Y(mk.cpm) : null, be = mk.break_even_coins;
  const ticksX = [], ticksY = [];
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) ticksX.push(10 ** e);
  for (let e = Math.ceil(Math.log10(yMin)); e <= Math.floor(Math.log10(yMax)); e++) ticksY.push(10 ** e);
  return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Coin value against coins minted">
    ${be ? `<rect class="thin-zone" x="${L}" y="${T}" width="${Math.max(0, X(be) - L)}" height="${H - T - B}"/>` : ""}
    ${ticksY.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${L - 6}" y="${Y(t) + 3}" text-anchor="end">₹${compact(t)}</text>`).join("")}
    ${ticksX.map((t) => `<text class="axis" x="${X(t)}" y="${H - B + 16}" text-anchor="middle">${views(t)}</text>`).join("")}
    <path class="pool" d="${line(pool)}"/><path class="paid" d="${line(paid)}"/>
    ${refY ? `<line class="ref" x1="${L}" x2="${W - R}" y1="${refY}" y2="${refY}"/><text class="ref-label" x="${W - R}" y="${refY - 6}" text-anchor="end">market ${cpm(mk.cpm)}</text>` : ""}
    ${be ? `<text class="zone-label" x="${L + 8}" y="${T + 14}">too few: refund</text><text class="zone-label" x="${X(be) + 8}" y="${T + 14}">plenty: whole budget paid</text>` : ""}
    <text class="axis" x="${(L + W) / 2}" y="${H - 4}" text-anchor="middle">coins minted across the campaign (no-rung rule)</text>
  </svg>`;
}
const curveLegend = `<div class="legend small"><span><i class="i-ours"></i>coin price paid (₹ per 1,000 coins)</span><span><i class="i-pool"></i>pool split: budget ÷ coins</span><span><i class="i-ref"></i>market reference</span></div>`;

/* Simulation state at any day, computed in the browser from the run's posts (mirrors simulate.py). */
const growth = (age, days) => (age < 0 ? 0 : 1 - Math.exp(-(age + 1) / days));
const viewsAt = (sim, post, d) => (d < post.day ? 0 : Math.floor(post.organic_final * growth(d - post.day, sim.growth_days) + post.bought_views));
/* Review decisions for held posts: "valid" or "fraud". Defaults to what the review found. */
const decisionOf = (sim, post) => (sim.decisions && sim.decisions[post.key]) || post.review;
function coinsAt(sim, post, d, mode) {
  const v = viewsAt(sim, post, d);
  if (v < post.rungs[0]) return 0;
  if (post.held && (d < sim.days - 1 || decisionOf(sim, post) !== "valid")) return 0;   // held until cleared
  return mode === "linear" ? v : post.rungs.filter((r) => v >= r).pop();
}
function stateAt(sim, d) {
  const final = d === sim.days - 1;
  let t = sim.timeline[d];
  const creators = sim.creators.filter((c) => c.joined <= d).map((c) => {
    const coins = { rungs: 0, linear: 0 };
    let v = 0, live = 0, qualified = 0;
    c.posts.forEach((p) => {
      if (p.day > d) return;
      live++;
      v += viewsAt(sim, p, d);
      MODES.forEach(([m]) => (coins[m] += coinsAt(sim, p, d, m)));
      if (coinsAt(sim, p, d, "linear") > 0) qualified++;
    });
    return { c, views: v, posts: live, qualified, coins };
  });
  if (final) {   // the settlement applies the review decisions, so recompute it from the posts
    const budget = sim.proposal.params.total_budget;
    t = { ...t };
    MODES.forEach(([m]) => {
      const coins = creators.reduce((a, x) => a + x.coins[m], 0);
      const ref = sim.settlement[m].reference_cpm;
      const { rate, regime } = settle(budget, coins, ref ? ref / 1000 : null);
      t[m] = { coins, coin_cpm: rate * 1000, regime, pool_cpm: coins ? (1000 * budget) / coins : null };
    });
  }
  const rate = { rungs: t.rungs.coin_cpm / 1000, linear: t.linear.coin_cpm / 1000 };
  creators.forEach((x) => (x.pay = { rungs: x.coins.rungs * rate.rungs, linear: x.coins.linear * rate.linear }));
  return { d, t, rate, creators, final };
}

/* The settlement with the review's own findings, to show what a change of decision did. */
function baselineAt(sim) {
  const saved = sim.decisions;
  sim.decisions = {};
  const st = stateAt(sim, sim.days - 1);
  sim.decisions = saved;
  return st;
}

const DECISIONS = [["valid", "Valid"], ["fraud", "Fraud"]];
function decisionButtons(sim, post) {
  const now = decisionOf(sim, post);
  return `<div class="seg decide" data-key="${post.key}">${DECISIONS.map(([k, l]) =>
    `<button type="button" data-d="${k}" class="${k === now ? "active " + k : ""}">${l}</button>`).join("")}</div>`;
}
function bindDecisions(root, sim, redraw) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest(".decide button");
    if (!b) return;
    sim.decisions = { ...(sim.decisions || {}), [b.parentElement.dataset.key]: b.dataset.d };
    redraw();
  });
}

/* Playback: auto-plays a run day by day with play/pause, speed and a scrubber. */
let PLAYERS = [];
function stopPlayers() { PLAYERS.forEach((p) => p.stop()); PLAYERS = []; }
function player(sim, onFrame, autoplay = true) {
  const last = sim.days - 1;
  const el = h(`<div class="player">
    <button type="button" class="play" aria-label="Play">▶</button>
    <input type="range" min="0" max="${last}" value="${autoplay ? 0 : last}" aria-label="Day">
    <span class="day"></span>
    <div class="seg speed">${[1, 2, 4].map((s) => `<button type="button" data-s="${s}" class="${s === 1 ? "active" : ""}">${s}×</button>`).join("")}</div>
  </div>`);
  const btn = $(".play", el), range = $("input", el);
  let timer = null, speed = 1;
  const show = () => {
    const d = +range.value;
    $(".day", el).textContent = `Day ${d + 1} of ${sim.days}${d === last ? " · settled" : ""}`;
    onFrame(d);
  };
  const stop = () => { clearInterval(timer); timer = null; btn.textContent = "▶"; btn.setAttribute("aria-label", "Play"); };
  const play = () => {
    if (+range.value >= last) range.value = 0;
    stop();
    btn.textContent = "❚❚"; btn.setAttribute("aria-label", "Pause");
    timer = setInterval(() => {
      if (+range.value >= last) return stop();
      range.value = +range.value + 1;
      show();
    }, Math.max(50, 7000 / sim.days / speed));
    show();
  };
  btn.onclick = () => (timer ? stop() : play());
  range.oninput = () => { stop(); show(); };
  $$(".speed button", el).forEach((b) => (b.onclick = () => {
    speed = +b.dataset.s;
    $$(".speed button", el).forEach((x) => x.classList.toggle("active", x === b));
    if (timer) play();
  }));
  const handle = { el, stop, show, set: (d) => { stop(); range.value = d; show(); } };
  PLAYERS.push(handle);
  setTimeout(() => (autoplay ? play() : show()), 0);
  return handle;
}

/* Live coin value over the simulated campaign, both rules, drawn up to `upto`. */
function timelineChart(sim, upto = sim.days - 1) {
  const tl = sim.timeline, W = 720, H = 230, L = 56, R = 12, T = 16, B = 30;
  const vals = tl.flatMap((d) => MODES.map(([m]) => d[m].coin_cpm)).filter((v) => v > 0);
  const refs = MODES.map(([m]) => sim.settlement[m].reference_cpm).filter(Boolean);
  if (!vals.length) return `<p class="note">No coins were minted in this run.</p>`;
  const yMin = Math.min(...vals, ...refs) * 0.7, yMax = Math.max(...vals, ...refs) * 1.3;
  const X = (i) => L + (tl.length > 1 ? i / (tl.length - 1) : 0.5) * (W - L - R);
  const Y = (v) => T + (1 - (Math.log(v) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin))) * (H - T - B);
  const path = (m) => tl.slice(0, upto + 1).map((d, i) => d[m].coin_cpm > 0 ? `${i && tl[i - 1][m].coin_cpm > 0 ? "L" : "M"}${X(i).toFixed(1)},${Y(d[m].coin_cpm).toFixed(1)}` : "").join(" ");
  const ticksY = [];
  for (let e = Math.ceil(Math.log10(yMin)); e <= Math.floor(Math.log10(yMax)); e++) ticksY.push(10 ** e);
  const maxC = Math.max(1, ...tl.map((d) => d.creators));
  const bars = tl.slice(0, upto + 1).map((d, i) => `<rect class="joined" x="${X(i) - 2}" y="${H - B - (d.creators / maxC) * 36}" width="4" height="${(d.creators / maxC) * 36}"/>`).join("");
  const refLine = MODES.map(([m], k) => {
    const r = sim.settlement[m].reference_cpm;
    return r ? `<line class="ref ${m}" x1="${L}" x2="${W - R}" y1="${Y(r)}" y2="${Y(r)}"/><text class="ref-label" x="${W - R}" y="${Y(r) - 5}" text-anchor="end">${k ? "no-rung" : "coin-rung"} market ${cpm(r)}</text>` : "";
  }).join("");
  const dot = (m) => tl[upto][m].coin_cpm > 0 ? `<circle class="now-dot ${m}" cx="${X(upto)}" cy="${Y(tl[upto][m].coin_cpm)}" r="5"/>` : "";
  const every = Math.max(1, Math.ceil(tl.length / 8));
  return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Live coin value by day">
    ${ticksY.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${L - 6}" y="${Y(t) + 3}" text-anchor="end">₹${compact(t)}</text>`).join("")}
    ${tl.map((d, i) => (i % every === 0 || i === tl.length - 1) ? `<text class="axis" x="${X(i)}" y="${H - B + 16}" text-anchor="middle">day ${i + 1}</text>` : "").join("")}
    ${bars}${refLine}
    <path class="paid rungs" d="${path("rungs")}"/><path class="paid" d="${path("linear")}"/>
    <line class="now" x1="${X(upto)}" x2="${X(upto)}" y1="${T}" y2="${H - B}"/>${dot("rungs")}${dot("linear")}
  </svg>
  <div class="legend small"><span><i class="i-ours"></i>no rungs: coin value if it ended that day</span><span><i class="i-rungs"></i>coin rungs</span><span><i class="i-joined"></i>creators joined</span></div>`;
}

/* BRAND ------------------------------------------------------------------------------------------ */
const EFFECTS = {
  categories: "Each category gets its own rungs, from past posts in that category (gaming travels further than finance). Also picks which past campaigns set the market reference.",
  platforms: "Where creators post. Picking a platform limits the formats below to that platform.",
  formats: "Which kinds of post count. Each gets its own rungs, because a carousel gets about 40% of a reel's views. Only formats with past data are offered: stories, static posts and community posts have no view history yet.",
  tiers: "Only these creators can join. Every tier that can join gets its own rungs.",
};

async function initBrand() {
  const m = await meta();
  const platformOf = {};
  Object.entries(m.formats).forEach(([pl, fs]) => fs.forEach((f) => (platformOf[f] = pl)));
  const options = { categories: m.categories, platforms: Object.keys(m.formats), formats: Object.keys(platformOf), tiers: m.tiers };
  const syncers = [];
  // Formats only make sense on the chosen platforms: hide the rest and drop them from the choice.
  const formatVisible = (f) => choice.platforms.size === 0 || choice.platforms.has(platformOf[f]);
  for (const [name, values] of Object.entries(options)) {
    const box = $(`#brand-form .chips[data-name="${name}"]`);
    const any = h(`<button type="button" class="chip any">any</button>`);
    const sync = () => {
      if (name === "formats") [...choice.formats].forEach((f) => formatVisible(f) || choice.formats.delete(f));
      $$(".chip:not(.any)", box).forEach((c) => {
        c.setAttribute("aria-pressed", choice[name].has(c.dataset.v));
        if (name === "formats") c.hidden = !formatVisible(c.dataset.v);
      });
      any.setAttribute("aria-pressed", choice[name].size === 0);
    };
    syncers.push(sync);
    const changed = () => { syncers.forEach((f) => f()); scheduleBrand(); };
    any.addEventListener("click", () => { choice[name].clear(); changed(); });
    box.append(any);
    values.forEach((v) => {
      const label = name === "formats" ? `${FORMAT_LABEL[v]} <span class="chip-sub">${platformOf[v]}</span>` : esc(v);
      const b = h(`<button type="button" class="chip" data-v="${esc(v)}">${label}</button>`);
      b.addEventListener("click", () => { choice[name].has(v) ? choice[name].delete(v) : choice[name].add(v); changed(); });
      box.append(b);
    });
    box.after(h(`<small class="effect">${EFFECTS[name]}</small>`));
  }
  syncers.forEach((f) => f());
  const budget = $('#brand-form input[name="total_budget"]');
  const hint = () => ($('[data-hint="budget"]').textContent = budget.value ? `${rupees(budget.value)} · ${compact(+budget.value)}. The most that can ever be paid. It only sets what each coin is worth.` : "");
  budget.addEventListener("input", () => { hint(); scheduleBrand(); }); hint();
  $$('#brand-form input[type="date"]').forEach((i) => i.addEventListener("change", scheduleBrand));
  $("#data-foot").textContent = `Rungs and market reference learned from ${m.counts.campaigns} past campaigns and ${m.counts.posts.toLocaleString()} posts.`;
  $("#brand-form").addEventListener("submit", (e) => { e.preventDefault(); runBrand(); });
  runBrand(true);
}

/* Every change to the form refreshes the campaign, after a short pause so typing a budget is smooth. */
let brandTimer = null, brandRequest = 0;
function scheduleBrand() {
  clearTimeout(brandTimer);
  $("#live-status").textContent = "Updating…";
  brandTimer = setTimeout(() => runBrand(false), 350);
}

function campaignBody() {
  const body = { categories: [...choice.categories], platforms: [...choice.platforms], formats: [...choice.formats], tiers: [...choice.tiers] };
  new FormData($("#brand-form")).forEach((v, k) => (body[k] = v));
  return body;
}

async function runBrand(first = false) {
  const out = $("#brand-out"), status = $("#live-status"), mine = ++brandRequest;
  const body = campaignBody();
  if (!(+body.total_budget > 0)) { status.textContent = "Enter a budget above ₹0."; return; }
  try {
    const campaign = await api("/api/campaign", body);
    if (mine !== brandRequest) return;           // a newer change is already on its way
    CAMPAIGN_BODY = body;
    CAMPAIGN = campaign;
    SIM = null;
    const y = window.scrollY, previous = $("#sim-panel [data-sim-out]")?.firstElementChild;
    renderBrand(out, CAMPAIGN);
    if (previous) $("#sim-panel [data-sim-out]").append(previous);   // keep the old run on screen until the new one lands
    window.scrollTo({ top: y });
    status.textContent = `Updated · ${CAMPAIGN.ladders.length} ladders from past posts`;
    runSim(first);                                // same seed and scenario; plays only on the first load
  } catch (err) {
    if (mine !== brandRequest) return;
    status.textContent = "";
    out.replaceChildren(h(`<div class="error">${esc(err.message)}</div>`));
  }
}

function openLine(p) {
  const o = p.params.open, sel = p.params;
  const part = (chosen, all) => (chosen.length ? all.join(", ") : `any (${all.join(", ")})`);
  return `Open to <strong>${esc(part(sel.categories, o.categories))}</strong> · <strong>${esc(part(sel.platforms, o.platforms))}</strong> · formats: <strong>${esc(part(sel.formats, o.formats.map((f) => FORMAT_LABEL[f])))}</strong> · who can join: <strong>${esc(part(sel.tiers, o.tiers))}</strong>`;
}

function renderBrand(out, p) {
  const budget = p.params.total_budget, r = p.market.rungs, l = p.market.linear;
  const market = h(`
    <div class="panel price-card">
      <p class="note">${openLine(p)}</p>
      <div class="price-head">
        <div>
          <div class="eyebrow">What a coin (one view) has fetched on the platform</div>
          <div class="price-range">${l.cpm ? cpm(l.cpm) : "No reference yet"}<small>${l.cpm ? "per 1,000 coins, no rungs" : ""}</small></div>
        </div>
      </div>
      <p class="plain">There is no maximum price per view and no guaranteed minimum payout: the market sets the price when the campaign ends.</p>
      <p class="note">${l.cpm
        ? `This is the median pool split of ${l.campaigns.length} settled campaigns (${esc(l.basis)}). Coin rungs mint fewer coins for the same views, so each of their coins has fetched more: ${cpm(r.cpm)} per 1,000. Nobody sets either number; both come from real settlements.`
        : `${esc(l.basis)}.`}</p>
      <div class="stats">
        <div class="stat"><b>${rupees(budget)}</b><span>your budget: the most that can ever be paid</span></div>
        <div class="stat"><b>${l.break_even_coins ? views(l.break_even_coins) : "–"}</b><span>coins where the pool meets the market (no rungs)</span></div>
        <div class="stat"><b>Refund</b><span>fewer coins: you pay the negotiated price, the rest comes back</span></div>
        <div class="stat"><b>Full spend</b><span>more coins: the budget is split over every coin</span></div>
      </div>
      ${coinCurve(p)}
      ${curveLegend}
    </div>`);

  const tq = (t) => { const ls = p.ladders.filter((x) => x.tier === t); return ls.length ? views(Math.min(...ls.map((x) => x.threshold))) : null; };
  const tierLine = p.params.open.tiers.map((t) => `${t} ${tq(t)}`).join(", ");
  const objectives = [
    ["Budget adherence", `Coin price × coins minted can never exceed ${rupees(budget)}, under either payout rule. That holds in every outcome by construction, not with 95% confidence.`],
    ["Creator motivation", `A post starts earning once it reaches the minimum threshold, which ${pct(p.qualify_reach)} of posts like it reach. Each rung above is reached by half of the posts on the one below: coin rungs pay at each one, and with no rungs every view pays and the rungs are targets.`],
    ["Fairness across tiers", `Rungs are set per category, tier and format (lowest threshold per tier: ${tierLine} views), so every tier has the same odds. Everyone gets the same price per coin.`],
    ["Fraud resistance", "A flagged or suspicious post mints no coins until it is validated. Confirmed bought views are never paid and never dilute honest creators."],
    ["Marginal ROI", `No one guesses the price. If plenty of views arrive, the whole budget buys every coin at the pool split. If too few arrive, the price is the Nash split between your pool and the market${l.cpm ? ` (${cpm(l.cpm)})` : ""}, and you get the rest back.`],
  ];
  const checks = h(`<details class="panel objectives"><summary><span>The brief's objectives</span><span class="eyebrow">5 checks · open to verify</span></summary>
    <ul>${objectives.map(([t, d], i) => `<li><label><input type="checkbox" data-obj="${i}"><span><strong>${t}</strong>${d}</span></label></li>`).join("")}</ul>
    <p class="note">Evidence on replayed history: <a href="#backtest">Backtest</a>. The three systems side by side: <a href="#compare">Compare</a>.</p></details>`);
  $$("input[data-obj]", checks).forEach((c) => {
    try { c.checked = localStorage.getItem("obj-" + c.dataset.obj) === "1"; } catch (_) {}
    c.addEventListener("change", () => { try { localStorage.setItem("obj-" + c.dataset.obj, c.checked ? "1" : "0"); } catch (_) {} });
  });

  out.replaceChildren(market, rungsExplainer(p), simPanel("brand"), checks);
}

/* How the rungs were calculated: every tier side by side, for a chosen category and format. */
function rungsExplainer(p, focus) {
  const card = h(`<div class="panel ladder-card explainer">
      <div class="ladder-top"><h2>How the rungs were calculated</h2></div>
      <p class="note">Each creator tier gets its own rungs for each category and format, from how far posts like theirs travelled before. Pick a category and format to compare the tiers.</p>
      <div class="ladder-top"><span class="eyebrow">Category</span><div class="seg" data-kind="cat"></div></div>
      <div class="ladder-top"><span class="eyebrow">Format</span><div class="seg" data-kind="fmt"></div></div>
      <div class="tiers-slot"></div>
    </div>`);
  const cats = [...new Set(p.ladders.map((l) => l.category))];
  const fkeys = [...new Set(p.ladders.map((l) => l.platform + "|" + l.format))];
  const multiPlat = new Set(p.ladders.map((l) => l.platform)).size > 1;
  const keep = focus ? null : EXPLAIN;
  let cat = focus?.category || (keep && cats.includes(keep.cat) ? keep.cat : cats[0]);
  let fkey = focus ? focus.platform + "|" + focus.format : keep && fkeys.includes(keep.fkey) ? keep.fkey : fkeys[0];
  const draw = () => {
    if (!focus) EXPLAIN = { cat, fkey };
    $('[data-kind="cat"]', card).replaceChildren(...cats.map((c) => {
      const b = h(`<button class="${c === cat ? "active" : ""}">${esc(c)}</button>`);
      b.onclick = () => { cat = c; draw(); };
      return b;
    }));
    $('[data-kind="fmt"]', card).replaceChildren(...fkeys.map((k) => {
      const [pl, f] = k.split("|");
      const b = h(`<button class="${k === fkey ? "active" : ""}">${multiPlat ? pl + " " : ""}${fmtName(f)}</button>`);
      b.onclick = () => { fkey = k; draw(); };
      return b;
    }));
    const rows = p.ladders.filter((l) => l.category === cat && l.platform + "|" + l.format === fkey);
    const lo = Math.min(...rows.map((l) => l.threshold)) / 2, hi = Math.max(...rows.map((l) => l.rungs[l.rungs.length - 1].views)) * 1.3;
    const x = (v) => ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100;
    $(".tiers-slot", card).innerHTML = `<div class="tier-rows">${rows.map((l) => {
      const b = l.basis, median = Math.exp(b.mu);
      const widened = b.widened ? `<span class="widened">Only ${esc(b.group.join(" · "))} had 30+ past posts, so the group was widened ${b.widened} step${b.widened > 1 ? "s" : ""}.</span>` : `<span>Its own history: ${esc(b.group.join(" · "))}.</span>`;
      const math = l.rungs.map((r, i) => {
        const c = l.calc[i], raw = Math.exp(b.mu + b.sigma * c.z);
        return `<tr><td>${i ? "Rung " + (i + 1) : "Threshold"}</td><td class="num">${pct(c.target_reach, c.target_reach < 0.1 ? 1 : 0)}</td><td class="num">${c.z.toFixed(2)}</td>
          <td class="num">${views(median)} × e<sup>${b.sigma.toFixed(2)} × ${c.z.toFixed(2)}</sup> = ${Math.round(raw).toLocaleString("en-IN")}</td><td class="num"><strong>${r.views.toLocaleString("en-IN")}</strong></td><td class="num">${pct(r.reach, 1)}</td></tr>`;
      }).join("");
      return `<div class="tier-row">
        <div class="tier-name"><b>${l.tier}</b><span>${b.posts} past posts</span></div>
        <div class="tier-track">${l.rungs.map((r, i) => `<i class="${i ? "" : "th"}" style="left:${x(r.views)}%"><em>${views(r.views)}</em></i>`).join("")}
          <span class="median" style="left:${x(median)}%" title="typical post"></span></div>
        <details><summary>Typical post ${views(median)} views · spread σ ${b.sigma.toFixed(2)} · threshold <strong>${views(l.threshold)}</strong></summary>
          <p class="note">${widened} Past views are modelled as a lognormal: the typical (median) post got ${views(median)} views, and σ = ${b.sigma.toFixed(2)} measures how uneven they were. A rung that a share <em>r</em> of posts reach sits at median × e<sup>σ·z</sup>, where z is the normal quantile for <em>r</em>. It is then rounded to two significant figures, and its exact reach is recomputed.</p>
          <div class="table-wrap"><table><thead><tr><th></th><th class="num">Aimed reach</th><th class="num">z</th><th class="num">Calculation</th><th class="num">Rung (views = coins)</th><th class="num">Exact reach</th></tr></thead><tbody>${math}</tbody></table></div>
        </details>
      </div>`;
    }).join("")}</div>
    <p class="note">Bars share one log scale so the tiers can be compared: the black mark is the threshold, purple marks are rungs 2–5, and the dot is the typical post. Every tier's threshold is reached by ${pct(p.qualify_reach)} of its own posts, so small and big creators have the same odds.</p>`;
  };
  draw();
  return card;
}

/* Simulation ------------------------------------------------------------------------------------- */
function simControls(where) {
  const box = h(`<div class="sim-controls-wrap">
    <div class="chips" data-scen></div>
    <p class="note" data-about></p>
    <div class="sim-controls">
      <label class="field"><span>Seed</span><input type="number" min="1" step="1" placeholder="random" data-seed value="${esc(simState.seed)}"></label>
      <button type="button" class="ghost" data-reroll>New seed</button>
      <button type="button" class="primary" data-run>Run simulation →</button>
    </div></div>`);
  meta().then((m) => {
    const chips = $("[data-scen]", box);
    const about = () => ($("[data-about]", box).textContent = m.scenarios[simState.scenario].about);
    box.syncAbout = about;
    Object.entries(m.scenarios).forEach(([k, v]) => {
      const b = h(`<button type="button" class="chip" data-k="${k}" aria-pressed="${k === simState.scenario}">${esc(v.label)}</button>`);
      b.onclick = () => { simState.scenario = k; syncControls(); };
      chips.append(b);
    });
    about();
  });
  $("[data-seed]", box).addEventListener("input", (e) => (simState.seed = e.target.value));
  const run = where === "brand" ? () => runSim(true) : () => runCreatorSim();
  $("[data-reroll]", box).onclick = () => { simState.seed = ""; $("[data-seed]", box).value = ""; run(); };
  $("[data-run]", box).onclick = run;
  return box;
}

/* Both pages have scenario controls; keep them showing the same scenario and seed. */
function syncControls() {
  $$("[data-scen] .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.k === simState.scenario));
  $$("[data-seed]").forEach((i) => { if (document.activeElement !== i) i.value = simState.seed; });
  $$(".sim-controls-wrap").forEach((b) => b.syncAbout && b.syncAbout());
}

function simPanel(where) {
  const panel = h(`<div class="panel sim-panel" id="sim-panel">
    <div class="ladder-top"><h2>Simulate this campaign</h2><span class="eyebrow">a demo sandbox · pricing never uses it</span></div>
    <p class="note">Creators are drawn from past creator profiles among those allowed to join. Each makes content in one of the campaign's categories, and their posts come from the same view model as that category's rungs. Every random draw comes from the seed: the same seed replays the same campaign.</p>
    <div data-controls></div>
    <div data-sim-out></div>
  </div>`);
  $("[data-controls]", panel).replaceWith(simControls(where));
  return panel;
}

async function runSim(autoplay = true) {
  const panel = $("#sim-panel");
  if (!panel || !CAMPAIGN_BODY) return;
  const out = $("[data-sim-out]", panel), mine = brandRequest;
  stopPlayers();
  if (!out.children.length) out.replaceChildren(h(`<div class="loading">Running the campaign…</div>`));
  try {
    const sim = await api("/api/simulate", { ...CAMPAIGN_BODY, scenario: simState.scenario, seed: simState.seed });
    if (mine !== brandRequest) return;
    SIM = sim;
    simState.seed = String(SIM.seed);
    syncControls();
    renderSim(out, SIM, autoplay);
  } catch (err) {
    out.replaceChildren(h(`<div class="error">${esc(err.message)}</div>`));
  }
}

/* Why coin rungs and no rungs mint different coin counts, with a real post from this run. */
function coinGapNote(sim) {
  let ex = null;
  for (const c of sim.creators) for (const p of c.posts) {
    if (!p.voided && p.rung > 0 && p.coins.linear > p.coins.rungs * 1.15 && (!ex || p.views < ex.p.views)) ex = { c, p };
  }
  const st = sim.settlement;
  return `<div class="why-coins"><strong>Why the two coin counts differ.</strong> Coin rungs round each post down to the highest rung it reached; no rungs counts every view.
    ${ex ? `Here, ${ex.c.creator_id}'s ${fmtName(ex.p.format)} got ${ex.p.views.toLocaleString("en-IN")} views: it cleared the ${ex.p.coins.rungs.toLocaleString("en-IN")}-view rung, so it mints ${ex.p.coins.rungs.toLocaleString("en-IN")} coins under coin rungs and ${ex.p.coins.linear.toLocaleString("en-IN")} with no rungs.` : ""}
    Across the run that is ${views(st.rungs.coins)} vs ${views(st.linear.coins)} coins. The budget is the same, so each rung coin is worth more (${cpm(st.rungs.coin_cpm)} vs ${cpm(st.linear.coin_cpm)} per 1,000).</div>`;
}

/* Held posts, their review decision, and what each decision does to everyone else's pay. */
function reviewPanel(sim, st) {
  const held = sim.creators.flatMap((c) => c.posts.filter((p) => p.held).map((p) => ({ c, p })));
  if (!held.length) return `<p class="note review-none">No posts were held for review, so the campaign settles on its last day (${sim.ends_on}).</p>`;
  if (!st.final) return `<div class="review"><strong>${held.filter((x) => x.p.day <= st.d).length} post(s) held for review so far.</strong> Their coins are left out of the live value. Settlement waits up to ${sim.review_days} days after the campaign ends, until ${sim.settles_on}, for the review.</div>`;
  const base = baselineAt(sim), changed = MODES.map(([m, l]) => {
    const a = base.t[m], b = st.t[m];
    const others = (s) => s.creators.filter((x) => !x.c.posts.some((p) => p.held)).reduce((acc, x) => acc + x.pay[m], 0);
    const dOthers = others(st) - others(base);
    return `<li><strong>${l}:</strong> coin value ${cpm(a.coin_cpm)} → ${cpm(b.coin_cpm)} per 1,000 · creators with no held posts ${dOthers >= 0 ? "gain" : "lose"} ${rupees(Math.abs(dOthers))} · brand refund ${rupees(total(base, m))} → ${rupees(total(st, m))}</li>`;
  }).join("");
  function total(s, m) { return Math.max(0, sim.proposal.params.total_budget - s.creators.reduce((acc, x) => acc + x.pay[m], 0)); }
  const same = held.every(({ p }) => decisionOf(sim, p) === p.review);
  return `<div class="review">
    <div class="review-head"><strong>Review of held posts</strong><span class="note">Settles ${sim.settles_on}: the campaign ended ${sim.ends_on}, plus a ${sim.review_days}-day review. Nobody is paid before the price is final.</span></div>
    <p class="note">Every held post must be marked valid or fraud within the ${sim.review_days} days; one not cleared by then counts as fraud. Valid: its coins count at the same price as everyone else's. Fraud: never paid. Change a decision to see how it moves everyone's pay.</p>
    <div class="table-wrap"><table><thead><tr><th>Post</th><th>Creator</th><th class="num">Views</th><th class="num">Coins if valid</th><th>What the simulation knows</th><th>Decision</th></tr></thead><tbody>
    ${held.map(({ c, p }) => `<tr><td>${p.key}</td><td>${c.tier} · ${esc(c.category)}</td><td class="num">${views(p.views)}</td>
      <td class="num">${views(p.coins.linear || (p.views >= p.rungs[0] ? p.views : 0))}</td>
      <td>${p.bought_views ? `<span class="flag bad">${views(p.bought_views)} bought</span>` : `<span class="flag good">false alarm</span>`}</td>
      <td>${decisionButtons(sim, p)}</td></tr>`).join("")}</tbody></table></div>
    <ul class="review-effect">${same ? `<li>These are the review's own findings. Change one to see the effect.</li>` : changed}</ul>
    ${same ? "" : `<button type="button" class="link" data-reset-review>Reset to the review's findings</button>`}
  </div>`;
}

function renderSim(out, sim, autoplay = true) {
  BRAND_SIM = sim;
  const budget = sim.proposal.params.total_budget, s = sim.summary;
  const tiers = ["nano", "micro", "mid", "macro"].filter((t) => sim.by_tier[t]);
  const cats = [...new Set(sim.creators.map((c) => c.category))];
  const root = h(`<div class="sim-result">
    <div class="sim-head"><span class="badge ok">${esc(sim.scenario_label)} · seed ${sim.seed}</span>
      <span class="note">${s.creators} creators · ${s.posts} posts · ${s.posts_below_threshold} below the threshold · ${s.posts_held} held for review, ${s.posts_voided} caught buying views</span></div>
    <div data-player></div>
    <div class="live-stats" data-live></div>
    <h3>Live coin value, day by day</h3><div data-chart></div>
    <h3 data-settle-title></h3><div data-settle></div>
    <div data-review></div>
    <div data-why></div>
    <h3>Where the budget goes, by tier</h3><div data-dist></div>
    <h3>Tier × category</h3><p class="note">How each kind of creator did. Rungs differ by category and tier, so each row qualifies against its own rungs.</p><div data-groups></div>
    <h3>Every creator's payout</h3><div data-table></div>
    <p class="note">Nothing is paid until the last day. Before that, amounts show what each creator would get if the campaign ended that day. Click a creator to follow them.</p>
  </div>`);
  $("[data-why]", root).innerHTML = coinGapNote(sim);
  const statCell = (label, val) => `<div><span>${label}</span><b>${val}</b></div>`;
  const frame = (d) => {
    const st = stateAt(sim, d), t = st.t;
    $("[data-live]", root).innerHTML = [
      statCell("Creators joined", t.creators), statCell("Posts", t.posts), statCell("Views", views(t.views)),
      statCell("Coin rungs · value", `${cpm(t.rungs.coin_cpm)}<small>${views(t.rungs.coins)} coins</small>`),
      statCell("No rungs · value", `${cpm(t.linear.coin_cpm)}<small>${views(t.linear.coins)} coins</small>`),
    ].join("");
    $("[data-chart]", root).innerHTML = timelineChart(sim, d);
    $("[data-settle-title]", root).textContent = st.final
      ? (sim.review_days ? `How it settled on ${sim.settles_on}, after the ${sim.review_days}-day review` : `How it settled on ${sim.settles_on}`)
      : `If it ended on day ${d + 1}`;
    $("[data-review]", root).innerHTML = reviewPanel(sim, st);
    const regimeName = (x) => (x === "competitive" ? "plenty of views" : x === "thin" ? "too few views" : x);
    const row = (label, f) => `<tr><td>${label}</td>${MODES.map(([m]) => `<td class="num">${f(m)}</td>`).join("")}</tr>`;
    const paid = (m) => t[m].coin_cpm / 1000 * t[m].coins;
    $("[data-settle]", root).innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th></th>${MODES.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
      ${row("Coins minted", (m) => views(t[m].coins))}
      ${row("Pool split (budget ÷ coins)", (m) => cpm(t[m].pool_cpm))}
      ${row("Market reference", (m) => cpm(sim.settlement[m].reference_cpm))}
      ${row("How it settles", (m) => `<span class="regime ${t[m].regime.replace(" ", "-")}">${regimeName(t[m].regime)}</span>`)}
      ${row("Price per 1,000 coins", (m) => `<strong>${cpm(t[m].coin_cpm)}</strong>`)}
      ${row("Paid to creators", (m) => rupees(paid(m)))}
      ${row("Refunded to the brand", (m) => rupees(budget - paid(m)))}
      </tbody></table></div>`;
    $("[data-dist]", root).innerHTML = `<div class="dist">${MODES.map(([m, label]) => {
      const byT = {};
      st.creators.forEach((x) => (byT[x.c.tier] = (byT[x.c.tier] || 0) + x.pay[m]));
      const parts = tiers.map((tr) => [tr, byT[tr] || 0]).concat([["refund", Math.max(0, budget - paid(m))]]);
      return `<div class="dist-row"><div class="eyebrow">${label}</div><div class="stack">${parts.map(([tr, v]) =>
        `<span class="seg-${tr}" style="width:${(v / budget) * 100}%" title="${tr}: ${rupees(v)}">${v / budget > 0.08 ? `${tr} ${pct(v / budget)}` : ""}</span>`).join("")}</div></div>`;
    }).join("")}<div class="legend small">${tiers.map((tr) => `<span><i class="seg-${tr}"></i>${tr}</span>`).join("")}<span><i class="seg-refund"></i>${st.final ? "refund" : "not yet claimed"}</span></div></div>`;
    const groups = {};
    st.creators.forEach((x) => {
      const g = (groups[x.c.tier + "|" + x.c.category] ||= { tier: x.c.tier, cat: x.c.category, n: 0, posts: 0, q: 0, coins: { rungs: 0, linear: 0 }, pay: { rungs: 0, linear: 0 } });
      g.n++; g.posts += x.posts; g.q += x.qualified;
      MODES.forEach(([m]) => { g.coins[m] += x.coins[m]; g.pay[m] += x.pay[m]; });
    });
    const gl = Object.values(groups).sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier) || a.cat.localeCompare(b.cat));
    $("[data-groups]", root).innerHTML = gl.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Tier</th><th>Category</th><th class="num">Creators</th><th class="num">Posts past threshold</th><th class="num">Rung coins</th><th class="num">Coin rungs ₹</th><th class="num">Coins</th><th class="num">No rungs ₹</th><th class="num">Avg per creator (no rungs)</th></tr></thead>
      <tbody>${gl.map((g) => `<tr><td>${g.tier}</td><td>${esc(g.cat)}</td><td class="num">${g.n}</td><td class="num">${g.q}/${g.posts}</td>
        <td class="num">${views(g.coins.rungs)}</td><td class="num">${rupees(g.pay.rungs)}</td><td class="num">${views(g.coins.linear)}</td><td class="num">${rupees(g.pay.linear)}</td><td class="num">${rupees(g.pay.linear / g.n)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Nobody has joined yet.</p>`;
    const list = st.creators.slice().sort((a, b) => b.pay.linear - a.pay.linear || b.views - a.views).slice(0, 20);
    const flags = (x) => {
      const f = [];
      const held = x.c.posts.filter((p) => p.held && p.day <= d);
      if (held.length && !st.final) f.push(`<span class="flag">${held.length} held for review</span>`);
      else if (held.length) {
        const n = (k) => held.filter((p) => decisionOf(sim, p) === k).length, of = held.length > 1 ? ` of ${held.length} held` : "";
        if (n("valid")) f.push(`<span class="flag good">${n("valid")}${of} found valid</span>`);
        if (n("fraud")) f.push(`<span class="flag bad">${n("fraud")}${of} fraud, not paid</span>`);
      }
      if (x.c.posts.some((p) => p.viral && p.day <= d)) f.push(`<span class="flag good">viral</span>`);
      if (x.posts && !x.coins.linear && !x.c.posts.some((p) => p.held)) f.push(`<span class="flag">below threshold</span>`);
      return f.join(" ");
    };
    $("[data-table]", root).innerHTML = `<div class="table-wrap"><table class="dist-table">
      <thead><tr><th>Creator</th><th>Tier · category</th><th class="num">Posts</th><th class="num">Views</th><th class="num">Rung coins</th><th class="num">Coin rungs ₹</th><th class="num">Coins</th><th class="num">No rungs ₹</th><th>Notes</th></tr></thead>
      <tbody>${list.map((x) => `<tr class="${x.c.joined === d ? "fresh" : ""}"><td><a href="#creator/${x.c.creator_id}">${x.c.creator_id}</a></td><td>${x.c.tier} · ${esc(x.c.category)}</td><td class="num">${x.posts}</td>
        <td class="num">${views(x.views)}</td><td class="num">${views(x.coins.rungs)}</td><td class="num">${rupees(x.pay.rungs)}</td>
        <td class="num">${views(x.coins.linear)}</td><td class="num">${rupees(x.pay.linear)}</td><td>${flags(x)}</td></tr>`).join("")}</tbody></table></div>
      ${st.creators.length > 20 ? `<p class="note">Top 20 of ${st.creators.length} creators so far.</p>` : ""}`;
  };
  const pl = player(sim, frame, autoplay);
  $("[data-player]", root).replaceWith(pl.el);
  bindDecisions(root, sim, () => pl.set(sim.days - 1));   // a decision is made after the campaign: jump to settlement
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-reset-review]")) { sim.decisions = {}; pl.set(sim.days - 1); }
  });
  out.replaceChildren(root);
}

/* CREATOR ---------------------------------------------------------------------------------------- */
let CREATOR_PICK = null;

async function initCreator(pick) {
  if (pick) CREATOR_PICK = pick;
  const out = $("#creator-out");
  stopPlayers();
  try {
    if (!SIM) await runCreatorSim(true);
    else renderCreator(out, SIM);
  } catch (err) {
    out.replaceChildren(h(`<div class="error">${esc(err.message)}</div>`));
  }
}

async function runCreatorSim(first) {
  const out = $("#creator-out");
  if (!CAMPAIGN_BODY) CAMPAIGN_BODY = { categories: ["gaming"], platforms: ["instagram"], tiers: [], total_budget: 300000 };
  stopPlayers();
  if (first) out.replaceChildren(h(`<div class="loading">Simulating a campaign…</div>`));
  try {
    SIM = await api("/api/simulate", { ...CAMPAIGN_BODY, scenario: simState.scenario, seed: simState.seed });
    simState.seed = String(SIM.seed);
    CREATOR_PICK = null;
    renderCreator(out, SIM);
    syncControls();
  } catch (err) {
    out.replaceChildren(h(`<div class="error">${esc(err.message)}</div>`));
  }
}

function renderCreator(out, sim) {
  const p = sim.proposal, budget = p.params.total_budget, last = sim.days - 1;
  const paidList = sim.creators.filter((c) => c.paid.linear > 0).sort((a, b) => a.paid.linear - b.paid.linear);
  let who = sim.creators.find((c) => c.creator_id === CREATOR_PICK) || paidList[Math.floor(paidList.length / 2)] || sim.creators[0];
  const o = p.params.open;
  const page = h(`<div class="creator">
    <div class="panel campaign-strip">
      <div><div class="eyebrow">Campaign</div><b>${esc(o.categories.length > 2 ? o.categories.length + " categories" : o.categories.join(" + "))} · ${esc(o.platforms.join(" + "))}</b></div>
      <div><div class="eyebrow">Budget backing all coins</div><b>${rupees(budget)}</b></div>
      <div><div class="eyebrow">Who can join</div><b>${esc(p.params.tiers.length ? o.tiers.join(", ") : "any tier")}</b></div>
      <a class="link" href="#brand">edit campaign</a>
    </div>
    <div class="panel sim-panel">
      <div class="ladder-top"><h2>Scenario</h2><span class="eyebrow">change it here; the run replays in place</span></div>
      <div data-controls></div>
      <div class="sim-head"><span class="badge ok">${esc(sim.scenario_label)} · seed ${sim.seed}</span><span class="note">${sim.creators.length} creators joined</span></div>
      <label class="field follow"><span>Follow creator</span><select data-who>${sim.creators.map((c) =>
        `<option value="${c.creator_id}" ${c === who ? "selected" : ""}>${c.creator_id} · ${c.tier} · ${esc(c.category)} · ${views(c.views)} views</option>`).join("")}</select></label>
      <div data-player></div>
    </div>
    <div class="panel price-card">
      <div class="two-num">
        ${MODES.map(([m, l]) => `<div><div class="eyebrow">${l}: coin value today</div><div class="price-range"><span data-now="${m}"></span><small>per 1,000 coins</small></div><span class="badge" data-signal="${m}"></span></div>`).join("")}
      </div>
      <div data-chart></div>
    </div>
    <div class="creator-grid">
      <div class="panel your-posts"><div class="ladder-top"><h2>Their posts</h2><span class="eyebrow" data-tier></span></div>
        <div data-review-note></div><div data-posts></div></div>
      <div class="panel your-post"><div class="eyebrow" data-earn-title></div>
        ${MODES.map(([m, l]) => `<div class="earn"><span class="eyebrow">${l}</span><b data-earn="${m}"></b><span data-earn-note="${m}"></span></div>`).join("")}
        <p class="note" data-explain></p></div>
    </div>
    <div data-explainer></div>
  </div>`);
  $("[data-controls]", page).replaceWith(simControls("creator"));

  const frame = (d) => {
    const t = sim.timeline[d], done = d === last;
    for (const [m] of MODES) {
      $(`[data-now="${m}"]`, page).textContent = cpm(t[m].coin_cpm);
      const ref = sim.settlement[m].reference_cpm, pool = t[m].pool_cpm, sig = $(`[data-signal="${m}"]`, page);
      if (!t[m].coins) { sig.className = "badge unknown"; sig.textContent = "no coins yet"; }
      else if (!ref) { sig.className = "badge unknown"; sig.textContent = "no market yet"; }
      else if (pool > ref) { sig.className = "badge ok"; sig.textContent = `pool ${(pool / ref).toFixed(1)}× market: attracts creators`; }
      else { sig.className = "badge warn"; sig.textContent = `pool ${(pool / ref).toFixed(2)}× market: crowded`; }
    }
    $("[data-chart]", page).innerHTML = timelineChart(sim, d);
    $("[data-tier]", page).textContent = `${who.tier} · ${who.category} · ${who.platform} · ${views(who.followers)} followers · joins day ${who.joined + 1}`;
    const held = who.posts.filter((x) => x.held);
    $("[data-review-note]", page).innerHTML = held.length
      ? `<div class="review"><strong>${held.length} of this creator's posts ${held.length > 1 ? "are" : "is"} held for review.</strong>
          <span class="note">Mark each valid or fraud below. Nothing is paid until ${sim.settles_on} (campaign end plus ${sim.review_days} days); the decision then changes this creator's pay and, through the coin price, everyone else's.</span></div>`
      : "";
    const totals = { rungs: 0, linear: 0 };
    $("[data-posts]", page).innerHTML = who.posts.map((post, i) => {
      const v = viewsAt(sim, post, d), c = {}, top = post.rungs[post.rungs.length - 1], floor = post.rungs[0] / 4;
      MODES.forEach(([m]) => { c[m] = coinsAt(sim, post, d, m); totals[m] += c[m]; });
      const x = (val) => Math.min(100, Math.max(0, (Math.log(Math.max(val, floor)) - Math.log(floor)) / (Math.log(top * 1.3) - Math.log(floor)) * 100));
      const next = post.rungs.find((r) => r > v);
      const status = d < post.day ? `posts on day ${post.day + 1}` :
        post.held && !done ? `held for review: marked ${decisionOf(sim, post)}, applied at settlement on ${sim.settles_on}` :
        post.held && decisionOf(sim, post) !== "valid" ? "marked fraud: not paid" :
        v < post.rungs[0] ? `${views(post.rungs[0] - v)} more views to the threshold` :
        next ? `${views(next - v)} more views to rung ${post.rungs.indexOf(next) + 1}` : "past every rung";
      return `<div class="post-row ${d < post.day ? "future" : ""}">
        <div class="post-meta"><b>Post ${i + 1}</b> · ${fmtName(post.format)} · day ${post.day + 1}${post.viral ? ` · <span class="flag good">viral</span>` : ""}${post.held ? ` · <span class="flag">held for review</span> ${decisionButtons(sim, post)}` : ""}</div>
        <div class="rung-track">${post.rungs.map((r, k) => `<i class="${r <= v ? "hit" : ""}" style="left:${x(r)}%" title="${k ? "rung " + (k + 1) : "threshold"}: ${views(r)}"></i>`).join("")}<span style="width:${x(v)}%"></span></div>
        <div class="post-nums"><span>${views(v)} views</span><span>${status}</span><span>rung coins ${views(c.rungs)} · coins ${views(c.linear)}</span></div>
      </div>`;
    }).join("");
    const now = done ? stateAt(sim, d).t : t;   // at settlement, the review decisions apply
    $("[data-earn-title]", page).textContent = done ? `Final payout on ${sim.settles_on}` : `If the campaign ended on day ${d + 1}`;
    for (const [m] of MODES) {
      $(`[data-earn="${m}"]`, page).textContent = rupees(totals[m] * now[m].coin_cpm / 1000);
      $(`[data-earn-note="${m}"]`, page).textContent = `${views(totals[m])} coins × ${cpm(now[m].coin_cpm)} per 1,000`;
    }
    const st = now.linear;
    $("[data-explain]", page).innerHTML = done
      ? `The campaign settled with <strong>${st.regime === "thin" ? "too few views" : "plenty of views"}</strong>: ${views(st.coins)} coins shared ${rupees(budget)}, so each is worth ${cpm(st.coin_cpm)} per 1,000 (no rungs)${budget - st.coins * st.coin_cpm / 1000 > 1 ? `, and the brand got ${rupees(budget - st.coins * st.coin_cpm / 1000)} back` : ""}. This creator holds ${st.coins ? pct(totals.linear / st.coins, 1) : "0%"} of all coins.${sim.review_days ? ` Payment waited ${sim.review_days} days for the review of held posts.` : ""}`
      : "The coin value moves as other creators post: every new coin shares the same budget. Nothing is paid until the last day.";
  };
  const drawExplainer = () => {
    const first = who.posts[0];
    $("[data-explainer]", page).replaceChildren(rungsExplainer(p, { category: who.category, platform: who.platform, format: first.format }));
  };
  const pl = player(sim, frame);
  $("[data-player]", page).replaceWith(pl.el);
  bindDecisions(page, sim, () => pl.set(last));
  $("[data-who]", page).addEventListener("change", (e) => {
    who = sim.creators.find((c) => c.creator_id === e.target.value);
    CREATOR_PICK = who.creator_id;
    drawExplainer();
    pl.show();
  });
  drawExplainer();
  out.replaceChildren(page);
}

/* BACKTEST --------------------------------------------------------------------------------------- */
const SIDES = [["old", "Status quo"], ["rungs", "Coin rungs"], ["linear", "No rungs"]];

async function initBacktest() {
  const out = $("#backtest-out");
  try {
    renderBacktest(out, await api("/api/backtest"));
  } catch (err) {
    out.replaceChildren(h(`<div class="error">${esc(err.message)}</div>`));
  }
}

function trio(title, f, note = "") {
  return `<div class="panel"><h3>${title}</h3>
    <div class="trio">${SIDES.map(([k, l]) => `<div class="${k}"><b>${f(k)}</b><span>${l}</span></div>`).join("")}</div>
    ${note ? `<p class="note" style="margin-top:10px">${note}</p>` : ""}</div>`;
}

function renderBacktest(out, r) {
  const s = r.summary, n = s.campaigns;
  const regimes = (x) => Object.entries(x.regimes).map(([k, v]) => `${v} ${k === "competitive" ? "with plenty of views" : k === "thin" ? "with too few (refund)" : k}`).join(", ");
  const hero = h(`<div>
    <div class="legend"><span><i class="i-old"></i>Status quo (ladder as actually used)</span><span><i class="i-rungs"></i>Coin rungs</span><span><i class="i-ours"></i>No rungs</span></div>
    <div class="hero">
      ${trio("Campaigns within budget", (k) => `${s[k].within_budget}/${n}`)}
      ${trio("Worst overspend", (k) => pct(Math.max(0, s[k].worst_overspend)))}
      ${trio("Views on paid posts that earned nothing", (k) => pct(s[k].views_unpaid_on_paid_posts))}
      ${trio("Creators paid anything", (k) => pct(s[k].completion))}
    </div>
    <p class="note">Coin rungs settled ${regimes(s.rungs)}; no rungs settled ${regimes(s.linear)}. Median paid per 1,000 real views: ${SIDES.map(([k, l]) => `${l.toLowerCase()} ${cpm(s[k].median_cpm)}`).join(", ")}.
      Both coin systems pay out the budget the brand committed whenever plenty of views arrive, while gut-feel ladders often paid out far less than the budget.</p></div>`);

  const tiers = ["nano", "micro", "mid", "macro"].filter((t) => r.completion_by_tier.old[t]);
  const fairness = `<div class="panel"><h2 style="font:400 24px var(--serif);margin:0 0 4px">Creators paid, by tier</h2>
    <p class="note">One round-number ladder is easy for big pages and out of reach for small ones. Our rungs are set per tier and format.</p>
    <div class="bars">${tiers.map((t) => `<div class="row"><div class="label">${t}</div><div class="pair">
      ${SIDES.map(([k]) => { const v = r.completion_by_tier[k][t].rate; return `<div class="bar ${k === "old" ? "old" : k === "rungs" ? "rungs" : "ours"}" style="width:${v * 80}%"><span>${pct(v)}</span></div>`; }).join("")}
      </div></div>`).join("")}</div></div>`;

  const maxUse = Math.max(2, ...r.campaigns.flatMap((c) => SIDES.map(([k]) => c[k].budget_used))) * 1.04;
  const xp = (v) => `${(v / maxUse) * 100}%`;
  const ticks = [0, 0.5, 1, 1.5, 2, 3, 4].filter((t) => t <= maxUse);
  const dots = `<div class="panel"><h2 style="font:400 24px var(--serif);margin:0 0 4px">Spend as a share of budget</h2>
    <p class="note">The dashed line is the budget. Below it, Creator Pool refunded or the status quo underspent.</p>
    <div class="dots">
      ${r.campaigns.map((c) => `<div class="row"><div class="name"><b>${c.campaign.campaign_id}</b> <span>${c.campaign.category}</span></div>
          <div class="track"><div class="limit" style="left:${xp(1)}"></div>
            ${SIDES.map(([k, l]) => `<div class="dot ${k === "old" ? "old" : k === "rungs" ? "rungs" : "ours"}" style="left:${xp(c[k].budget_used)}" title="${l} ${pct(c[k].budget_used)}"></div>`).join("")}</div></div>`).join("")}
      <div class="scale"><div></div><div class="ticks">${ticks.map((t) => `<span style="left:${xp(t)}">${pct(t)}</span>`).join("")}</div></div>
    </div></div>`;

  const cases = r.campaigns.filter((c) => c.showcase).map(caseCard).join("");
  const sens = `<div class="panel" style="padding:22px"><div class="table-wrap"><table>
      <thead><tr><th>Posts reaching the threshold</th><th>Rule</th><th class="num">Within budget</th><th class="num">Creators paid</th><th class="num">Posts qualifying</th><th class="num">Too few views</th><th class="num">Median coin price</th><th class="num">Refunded</th></tr></thead>
      <tbody>${r.sensitivity.flatMap((x) => [["rungs", "Coin rungs"], ["linear", "No rungs"]].map(([m, l]) => {
        const v = x[m], chosen = x.qualify_reach === r.assumptions.qualify_reach;
        return `<tr${chosen ? ' style="font-weight:600"' : ""}><td>${pct(x.qualify_reach)}${chosen ? " (chosen)" : ""}</td><td>${l}</td>
          <td class="num">${v.within_budget}/${x.campaigns}</td><td class="num">${pct(v.completion)}</td><td class="num">${pct(v.posts_qualified)}</td>
          <td class="num">${v.thin}</td><td class="num">${cpm(v.median_coin_cpm)}</td><td class="num">${pct(v.refund_share)}</td></tr>`;
      })).join("")}</tbody></table></div></div>`;
  const fraudNames = { label_only: "Ops label only (status quo)", detector_only: "Our detector only", label_or_detector: "Label or detector (what we use)" };
  const fraud = `<div class="panel" style="padding:22px"><div class="table-wrap"><table>
      <thead><tr><th>Signal</th><th class="num">Caught</th><th class="num">Missed</th><th class="num">Clean posts held</th><th class="num">Precision</th><th class="num">Recall</th></tr></thead>
      <tbody>${Object.entries(r.fraud).map(([k, v]) => `<tr><td>${fraudNames[k]}</td><td class="num">${v.caught}</td><td class="num">${v.missed}</td>
        <td class="num">${v.false_alarms}</td><td class="num">${pct(v.precision)}</td><td class="num">${pct(v.recall)}</td></tr>`).join("")}</tbody></table></div></div>`;

  out.replaceChildren(hero, h(`<div class="two-col" style="margin-top:20px">${fairness}${dots}</div>`),
    h(`<div class="section"><h2>Five campaigns up close</h2><p>Chosen to cover different categories, platforms and target tiers, from the most recent history.</p><div class="showcase">${cases}</div></div>`),
    h(`<div class="section"><h2>Where the minimum threshold sits</h2><p>The threshold is the view count ${pct(r.assumptions.qualify_reach)} of posts like yours reach. A lower bar pays more creators; weak posts carry few views, so the coin value moves far less than the number of creators paid. The budget holds either way.</p>${sens}</div>`),
    h(`<div class="section"><h2>Fraud</h2><p>Scored against which posts the generator secretly boosted. Payment is held until a post is validated.</p>${fraud}</div>`));
}

function caseCard(row) {
  const c = row.campaign, p = row.proposal;
  const line = (label, f) => `<tr><td>${label}</td>${SIDES.map(([k]) => `<td class="num col-${k}">${f(row[k])}</td>`).join("")}</tr>`;
  const main = p.ladders.find((l) => l.tier === c.target_creator_tier) || p.ladders[0];
  const regime = (x) => (x.regime === "thin" ? "too few views" : "plenty of views");
  return `<div class="panel case">
    <header><h3><b>${c.campaign_id}</b>${c.category} · ${c.platform}</h3>
      <span class="meta">mostly ${c.target_creator_tier} creators · budget ${rupees(c.total_budget)}</span></header>
    <div class="grid">
      <div class="table-wrap"><table><thead><tr><th></th>${SIDES.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
        ${line("Paid out", (x) => rupees(x.spend))}
        ${line("Share of budget", (x) => pct(x.budget_used))}
        ${line("Left with / refunded", (x) => rupees(Math.max(0, x.refund)))}
        ${line("Per 1,000 real views", (x) => cpm(x.effective_cpm))}
        ${line("Creators paid", (x) => `${x.creators_paid}/${x.creators}`)}
        ${line("Views unpaid on paid posts", (x) => pct(x.views_unpaid_on_paid_posts))}
      </tbody></table></div>
      <div style="display:grid;gap:12px;align-content:start">
        <div class="verdict">Coin rungs: ${regime(row.rungs)}, ${cpm(row.rungs.coin_cpm)} per 1,000 coins. No rungs: ${regime(row.linear)}, ${cpm(row.linear.coin_cpm)}.</div>
        <div><div class="eyebrow">Status quo ladder, same for everyone</div>
          <div class="old-ladder">${row.old_ladder.map((r) => `${views(r.view_threshold)} → ${rupees(r.payout_amount)}`).join(" · ")}</div></div>
        <div><div class="eyebrow">Our coin rungs, ${main.tier} ${fmtName(main.format)} (one of ${p.ladders.length})</div>
          <div class="old-ladder" style="color:var(--rungs)">${main.rungs.map((x) => `${views(x.views)} views → ${views(x.coins)} coins`).join(" · ")}</div></div>
      </div>
    </div></div>`;
}

/* COMPARE ---------------------------------------------------------------------------------------- */
const BRIEF_EXAMPLE = [[10000, 500], [50000, 2000], [100000, 5000], [500000, 15000]];
const cmpCampaigns = {};

async function initCompare() {
  const [m, bt] = await Promise.all([meta(), api("/api/backtest")]);
  const ids = new Set(bt.campaigns.map((c) => c.campaign.campaign_id));
  m.campaigns.filter((c) => ids.has(c.campaign_id)).forEach((c) => (cmpCampaigns[c.campaign_id] = c));
  const sel = $("#cmp-campaign");
  Object.values(cmpCampaigns).reverse().forEach((c) =>
    sel.append(h(`<option value="${c.campaign_id}">${c.campaign_id} · ${c.category} · ${c.platform} · ${rupees(c.total_budget)}</option>`)));
  sel.addEventListener("change", () => { loadRows("status"); runCompare(); });
  $("#cmp-add").addEventListener("click", () => addRow());
  $$("[data-preset]").forEach((b) => b.addEventListener("click", () => loadRows(b.dataset.preset)));
  $("#cmp-run").addEventListener("click", runCompare);
  loadRows("status");
  runCompare();
}

function addRow(v = "", r = "") {
  const row = h(`<div class="editor-row"><input type="number" min="1" step="1" placeholder="10000" value="${v}"><input type="number" min="0" step="1" placeholder="500" value="${r}"><button type="button" aria-label="Remove rung">×</button></div>`);
  $("button", row).onclick = () => row.remove();
  $("#cmp-rows").append(row);
}

function loadRows(preset) {
  $("#cmp-rows").replaceChildren();
  const c = cmpCampaigns[$("#cmp-campaign").value];
  const rows = preset === "status" && c ? c.ladder.map((r) => [r.view_threshold, r.payout_amount]) : BRIEF_EXAMPLE;
  rows.forEach(([v, r]) => addRow(v, r));
}

async function runCompare() {
  const ladder = $$("#cmp-rows .editor-row").map((row) => {
    const [v, r] = $$("input", row).map((i) => +i.value);
    return { view_threshold: v, payout_amount: r };
  }).filter((r) => r.view_threshold > 0);
  const out = $("#cmp-out");
  out.replaceChildren(h(`<div class="loading">Replaying the campaign three ways…</div>`));
  try {
    const r = await api("/api/compare", { campaign_id: $("#cmp-campaign").value, ladder });
    const same = JSON.stringify(r.manual_ladder.map((x) => [x.view_threshold, x.payout_amount])) ===
      JSON.stringify(r.status_quo_ladder.map((x) => [x.view_threshold, x.payout_amount]));
    const cols = [["status_quo", same ? "Status quo" : "Status quo (edited)", "old"], ["rungs", "Coin rungs", "rungs"], ["linear", "No rungs", "ours"]];
    const rows = [
      ["Paid out", (x) => rupees(x.spend)],
      ["Share of budget", (x) => pct(x.budget_used)],
      ["Within budget", (x) => (x.within_budget ? "yes" : `<span class="bad">no</span>`)],
      ["Left with / refunded", (x) => rupees(Math.max(0, x.refund))],
      ["Paid per 1,000 real views", (x) => cpm(x.effective_cpm)],
      ["Creators paid", (x) => `${x.creators_paid}/${x.creators} (${pct(x.completion)})`],
      ["Views on paid posts that earned nothing", (x) => pct(x.views_unpaid_on_paid_posts)],
      ["Paid to bought views", (x) => rupees(x.paid_to_bought_views)],
    ];
    const tierRows = ["nano", "micro", "mid", "macro"].filter((t) => r.linear.completion_by_tier[t]).map((t) =>
      `<tr><td>&nbsp;&nbsp;${t} paid</td>${cols.map(([k, , cls]) => `<td class="num ${cls}">${r[k].completion_by_tier[t] ? pct(r[k].completion_by_tier[t].rate) : "–"}</td>`).join("")}</tr>`).join("");
    const ladders = r.proposal.ladders;
    const ladderRows = ladders.map((l) => `<tr><td>${l.tier}</td><td>${fmtName(l.format)}</td>${l.rungs.map((x) => `<td class="num">${views(x.views)}</td>`).join("")}</tr>`).join("");
    const regime = (x) => (x.regime === "thin" ? "too few views: refunded the rest" : "plenty of views: whole budget paid");
    out.replaceChildren(
      h(`<div class="panel" style="padding:22px">
        <div class="eyebrow">${r.campaign.campaign_id} · budget ${rupees(r.campaign.total_budget)} · the same real posts, paid three ways</div>
        <div class="table-wrap"><table class="cmp-cols" style="margin-top:12px"><thead><tr><th></th>${cols.map(([, l, c]) => `<th class="num ${c}">${l}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([label, f]) => `<tr><td>${label}</td>${cols.map(([k, , c]) => `<td class="num ${c}">${f(r[k])}</td>`).join("")}</tr>`).join("")}${tierRows}</tbody></table></div>
        <p class="note" style="margin-top:14px"><strong>Coin rungs</strong> settled at ${cpm(r.rungs.coin_cpm)} per 1,000 coins (${regime(r.rungs)}). <strong>No rungs</strong> settled at ${cpm(r.linear.coin_cpm)} (${regime(r.linear)}).
          The status quo pays the fixed rupee amounts in the editor to every creator, withholds ops-flagged posts and has no budget stop.</p></div>`),
      h(`<div class="panel" style="padding:22px"><h2 style="font:400 22px var(--serif);margin:0 0 8px">Our coin rungs for this campaign</h2>
        <p class="note">Built only from campaigns that ended before this one started. One ladder per tier and format; views = coins. The first rung is the minimum threshold.</p>
        <div class="table-wrap"><table><thead><tr><th>Tier</th><th>Format</th><th class="num">Threshold</th><th class="num">Rung 2</th><th class="num">Rung 3</th><th class="num">Rung 4</th><th class="num">Rung 5</th></tr></thead><tbody>${ladderRows}</tbody></table></div></div>`),
      h(`<div class="panel why"><h2>Why no rungs is enough</h2>
        <p>Rungs exist to decide what a view is worth and to stop paying between thresholds. In Creator Pool the budget and the views decide what a view is worth, and each view gets its share. Rounding down to a rung does not save the brand money when plenty of views arrive; it only moves money from views between rungs to posts that crossed a higher one.</p>
        <p>The brief asks for a ladder, so both are here: coin rungs pay the rung's coins, and no rungs pays every view past the same threshold. The threshold keeps duds out under both.</p>
        <p>Rungs are set by how far posts like yours travel, not by the budget, so a ₹1,000 campaign and a ₹3 crore campaign ask a nano reel for the same views. The budget changes only what each coin is worth.</p></div>`));
  } catch (err) {
    out.replaceChildren(h(`<div class="error">${esc(err.message)}</div>`));
  }
}

/* METHOD ----------------------------------------------------------------------------------------- */
function initMethod() {
  $$(".doc-tabs button").forEach((b) => b.addEventListener("click", () => {
    $$(".doc-tabs button").forEach((x) => x.classList.toggle("active", x === b));
    showDoc(b.dataset.doc);
  }));
  showDoc("one-pager");
}

async function showDoc(name) {
  const el = $("#doc");
  el.innerHTML = `<p class="note">Loading…</p>`;
  try {
    const { markdown } = await api("/api/doc/" + name);
    el.innerHTML = window.marked ? marked.parse(markdown) : `<pre>${esc(markdown)}</pre>`;
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

route();
