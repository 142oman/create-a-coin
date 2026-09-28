/* Creator Coin front end. Plain JS, no build step. */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inr = (x) => "₹" + Math.round(x || 0).toLocaleString("en-IN");
const inrShort = (x) => {
  x = x || 0;
  if (x >= 1e7) return "₹" + (x / 1e7).toFixed(x >= 1e8 ? 0 : 1).replace(/\.0$/, "") + " Cr";
  if (x >= 1e5) return "₹" + (x / 1e5).toFixed(x >= 1e6 ? 0 : 1).replace(/\.0$/, "") + " L";
  return inr(x);
};
const vw = (x) => {
  x = x || 0;
  if (x >= 1e7) return (x / 1e7).toFixed(1).replace(/\.0$/, "") + " Cr";
  if (x >= 1e5) return (x / 1e5).toFixed(1).replace(/\.0$/, "") + " L";
  if (x >= 1e3) return (x / 1e3).toFixed(x >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(x));
};
const pct = (x, d = 0) => (x == null ? "–" : (x * 100).toFixed(d) + "%");
const cpm = (x) => (x == null ? "–" : x >= 100 ? inr(x) : "₹" + x.toFixed(x >= 10 ? 0 : 1));
const FMT = { reel: "Reels", carousel: "Carousels", short: "Shorts", long_form: "Long-form" };
const PLAT = { instagram: "Instagram", youtube: "YouTube" };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function tween(el, to, fmt, ms = 900) {
  const from = +(el.dataset.v || 0);
  el.dataset.v = to;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let META = null;
const meta = async () => META || (META = await api("/api/meta"));
let BT = null;
const bt = async (fresh) => (!fresh && BT) || (BT = await api("/api/backtest"));

/* Routing ----------------------------------------------------------------------------------------- */
const VIEWS = ["home", "advertiser", "creator", "compare", "backtest"];   // "method" hidden for now
const inits = {};
function route() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
  $$("[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  if (!inits[name]) { inits[name] = true; ({ home: initHome, advertiser: initAdvertiser, creator: initCreator, compare: initCompare, backtest: initBacktest, method: initMethod })[name](); }
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);

/* Charts ------------------------------------------------------------------------------------------ */
function deliveryChart(timeline, upto) {
  const W = 760, H = 240, L = 44, R = 44, T = 14, B = 26;
  const n = timeline.length;
  const daily = timeline.map((d, i) => d.views - (i ? timeline[i - 1].views : 0));
  const cost = timeline.map((d) => (d.views ? (1000 * d.spend) / d.views : null));
  const maxV = Math.max(1, ...daily), maxC = Math.max(1, ...cost.filter((x) => x != null));
  const bw = (W - L - R) / n;
  const X = (i) => L + i * bw + bw / 2;
  const bars = daily.map((v, i) => `<rect class="bar ${i <= upto ? "on" : ""}" x="${L + i * bw + 1}" y="${H - B - (i <= upto ? (v / maxV) * (H - T - B) : 0)}" width="${Math.max(1, bw - 2)}" height="${i <= upto ? (v / maxV) * (H - T - B) : 0}" rx="2"/>`).join("");
  const pts = cost.slice(0, upto + 1).map((c, i) => (c == null ? null : `${X(i).toFixed(1)},${(H - B - (c / maxC) * (H - T - B)).toFixed(1)}`)).filter(Boolean);
  const every = Math.max(1, Math.ceil(n / 8));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Views per day and cost per 1,000 views">
    <line class="grid" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
    ${bars}
    ${pts.length > 1 ? `<polyline class="line" points="${pts.join(" ")}"/>` : ""}
    ${timeline.map((d, i) => (i % every === 0 ? `<text class="axis" x="${X(i)}" y="${H - 8}" text-anchor="middle">${i + 1}</text>` : "")).join("")}
    <text class="axis" x="${L - 6}" y="${T + 8}" text-anchor="end">${vw(maxV)}</text>
    <text class="axis" x="${W - R + 6}" y="${T + 8}">${cpm(maxC)}</text>
  </svg>
  <div class="legend"><span><i style="background:#3a3a38"></i>Views per day</span><span><i style="background:var(--gold)"></i>Cost per 1,000 views</span></div>`;
}

function stripChart(rows, key) {
  const W = 760, H = 150, L = 110, R = 20;
  const vals = rows.flatMap((r) => [r.old.paid / r.old.budget, r.ours.paid / r.ours.budget]).filter((x) => x > 0);
  const lo = Math.max(0.01, Math.min(...vals, 0.1) * 0.8), hi = Math.max(...vals, 1.2) * 1.2;
  const X = (v) => L + ((Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (W - L - R);
  const row = (y, cls, get) => rows.map((r, i) => `<circle class="${cls}" cx="${X(get(r))}" cy="${y}" r="${i === key ? 8 : 5}" opacity="${i === key ? 1 : 0.75}" style="animation:rise .5s ${i * 25}ms both"/>`).join("");
  const ticks = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50].filter((t) => t >= lo && t <= hi);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spend as a share of budget, every campaign">
    <text class="lab" x="0" y="44">The old way</text><text class="lab" x="0" y="104">Creator Coin</text>
    <line class="budget" x1="${X(1)}" x2="${X(1)}" y1="14" y2="${H - 22}"/>
    <text class="axis" x="${X(1)}" y="10" text-anchor="middle">budget</text>
    ${row(40, "dot-old", (r) => r.old.paid / r.old.budget)}
    ${row(100, "dot-new", (r) => r.ours.paid / r.ours.budget)}
    ${ticks.map((t) => `<text class="axis" x="${X(t)}" y="${H - 4}" text-anchor="middle">${t >= 1 ? t + "×" : pct(t)}</text>`).join("")}
  </svg>`;
}

function pairBars(items, fmt, higherIsBetter = true) {
  const max = Math.max(1e-9, ...items.flatMap((i) => [i.old || 0, i.new || 0]));
  return `<div style="display:grid;gap:10px">${items.map((i) => `
    <div style="display:grid;grid-template-columns:70px 1fr;gap:10px;align-items:center">
      <span class="label">${esc(i.label)}</span>
      <div style="display:grid;gap:4px">
        <div style="display:flex;align-items:center;gap:8px"><span style="height:10px;border-radius:5px;background:var(--old);width:${((i.old || 0) / max) * 80}%;min-width:2px"></span><span class="num muted" style="font-size:12px">${fmt(i.old)}</span></div>
        <div style="display:flex;align-items:center;gap:8px"><span style="height:10px;border-radius:5px;background:var(--gold);width:${((i.new || 0) / max) * 80}%;min-width:2px"></span><span class="num" style="font-size:12px">${fmt(i.new)}</span></div>
      </div></div>`).join("")}</div>`;
}
const oldNewLegend = `<div class="legend"><span><i style="background:var(--old)"></i>The old way</span><span><i style="background:var(--gold)"></i>Creator Coin</span></div>`;

/* HOME -------------------------------------------------------------------------------------------- */
async function initHome() {
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.15 });
  $$(".reveal").forEach((el) => io.observe(el));
  try {
    const { backtest: b, counts, recipe } = await bt();
    const nano = b.creators_paid_by_tier;
    const p = $$("[data-problem] .big");
    tween(p[0], b.budget.old_over, (x) => `${Math.round(x)} of ${b.campaigns}`);
    tween(p[1], b.budget.old_worst, (x) => x.toFixed(1) + "×");
    tween(p[2], nano.old.nano.rate || 0, (x) => pct(x));
    $("[data-problem-note]").textContent = `From ${b.campaigns} campaigns in our generated history (${counts.posts.toLocaleString("en-IN")} posts, recipe seed ${recipe.seed}). Change the recipe on the Backtest page.`;
    const q = $$("[data-proof] .big"), qp = $$("[data-proof] p");
    tween(q[0], b.budget.new_over, (x) => String(Math.round(x)));
    tween(q[1], b.cost_per_1k.new || 0, cpm);
    qp[1].textContent = `per 1,000 real views, vs ${cpm(b.cost_per_1k.old)} the old way`;
    tween(q[2], nano.new.nano.rate || 0, (x) => pct(x));
    qp[2].textContent = `of small creators paid, up from ${pct(nano.old.nano.rate)}`;
  } catch (e) { /* the landing page reads fine without numbers */ }
}

/* ADVERTISER ------------------------------------------------------------------------------------- */
const adv = { step: 0, categories: new Set(), formats: new Set(), budget: null, typical: null, days: 14, seed: rnd(), scenario: "normal", last: null };
function rnd() { return 1 + Math.floor(Math.random() * 999999); }
const FORMAT_CARDS = [["reel", "Instagram Reels"], ["carousel", "Instagram Carousels"], ["short", "YouTube Shorts"], ["long_form", "YouTube Long-form"]];

async function initAdvertiser() { await meta(); drawWizard(); }

function drawWizard() {
  const root = $("#adv");
  const m = META;
  const steps = [
    () => h(`<div class="q"><span class="label">1 of 4</span><h2>What are you promoting?</h2><p class="hint">Pick one or a few.</p>
      <div class="opts">${m.categories.map((c) => `<button class="opt" data-v="${c}" aria-pressed="${adv.categories.has(c)}">${esc(c)}</button>`).join("")}</div></div>`),
    () => h(`<div class="q"><span class="label">2 of 4</span><h2>Where should it run?</h2><p class="hint">Leave it on Anywhere and we'll take every format.</p>
      <div class="cards"><button class="card-opt" data-v="any" aria-pressed="${adv.formats.size === 0}"><b>Anywhere</b><span>Every format we know</span></button>
      ${FORMAT_CARDS.map(([f, l]) => `<button class="card-opt" data-v="${f}" aria-pressed="${adv.formats.has(f)}"><b>${l}</b><span>${f === "reel" || f === "short" ? "Short video" : f === "carousel" ? "Swipe posts" : "Longer video"}</span></button>`).join("")}</div></div>`),
    () => h(`<div class="q"><span class="label">3 of 4</span><h2>How much?</h2>
      <label class="money"><span>₹</span><input inputmode="numeric" data-budget value="${adv.budget ?? ""}" placeholder="${adv.typical ?? ""}"></label>
      <p class="hint">${adv.typical ? `Brands like you usually spend ${inr(adv.typical)}. ` : ""}This is the most you'll ever pay. If fewer views come in than it can buy, you get money back.</p></div>`),
    () => h(`<div class="q"><span class="label">4 of 4</span><h2>For how long?</h2><p class="hint">Starts today.</p>
      <div class="opts">${[[7, "1 week"], [14, "2 weeks"], [30, "1 month"]].map(([d, l]) => `<button class="opt" data-days="${d}" aria-pressed="${adv.days === d}">${l}</button>`).join("")}
      <label class="opt" style="display:inline-flex;gap:8px;align-items:center" aria-pressed="${![7, 14, 30].includes(adv.days)}">Custom <input type="number" min="3" max="90" data-custom value="${![7, 14, 30].includes(adv.days) ? adv.days : ""}" placeholder="days" style="width:64px;background:transparent;border:0;outline:0;color:inherit"></label></div></div>`),
    () => h(`<div class="q"><span class="label">Review</span><h2>Ready?</h2>
      <div class="panel review"><div class="sentence">${sentence()}</div>
      <div class="review-foot"><span class="more">Every creator size can join. We set their goals, the price and the fraud checks.</span>
        <span class="seed">Run <input type="number" data-seed value="${adv.seed}"><button class="help" data-help>?</button></span></div></div></div>`),
  ];
  const valid = [adv.categories.size > 0, true, (adv.budget ?? adv.typical) > 0, adv.days >= 3, true][adv.step];
  const wiz = h(`<div class="wizard"><div class="progress">${[0, 1, 2, 3, 4].map((i) => `<i class="${i <= adv.step ? "on" : ""}"></i>`).join("")}</div>
    <div data-q></div>
    <div class="wiz-nav"><button class="back" ${adv.step ? "" : "hidden"}>← Back</button>
      <button class="cta ${adv.step === 4 ? "gold" : ""}" data-next ${valid ? "" : "disabled"}>${adv.step === 4 ? "Publish campaign" : "Continue"}</button></div></div>`);
  $("[data-q]", wiz).replaceWith(steps[adv.step]());
  root.replaceChildren(wiz);
  const redraw = () => drawWizard();
  // Choices update in place: redrawing the whole question would replay its entrance animation.
  const canGo = () => [adv.categories.size > 0, true, (adv.budget ?? adv.typical) > 0, adv.days >= 3, true][adv.step];
  const refresh = () => ($("[data-next]", wiz).disabled = !canGo());
  $$(".opt[data-v]", wiz).forEach((b) => (b.onclick = () => {
    const v = b.dataset.v;
    adv.categories.has(v) ? adv.categories.delete(v) : adv.categories.add(v);
    b.setAttribute("aria-pressed", adv.categories.has(v));
    refresh();
  }));
  $$(".card-opt", wiz).forEach((b) => (b.onclick = () => {
    const v = b.dataset.v;
    if (v === "any") adv.formats.clear(); else adv.formats.has(v) ? adv.formats.delete(v) : adv.formats.add(v);
    $$(".card-opt", wiz).forEach((c) => c.setAttribute("aria-pressed", c.dataset.v === "any" ? adv.formats.size === 0 : adv.formats.has(c.dataset.v)));
    refresh();
  }));
  const bi = $("[data-budget]", wiz);
  if (bi) {
    bi.focus();
    bi.oninput = () => {
      const raw = bi.value.replace(/[^\d]/g, "");
      adv.budget = raw ? +raw : null;
      bi.value = raw ? (+raw).toLocaleString("en-IN") : "";
      $("[data-next]", wiz).disabled = !((adv.budget ?? adv.typical) > 0);
    };
    if (adv.budget) bi.value = adv.budget.toLocaleString("en-IN");
  }
  const markDays = () => {
    $$("[data-days]", wiz).forEach((x) => x.setAttribute("aria-pressed", +x.dataset.days === adv.days));
    const custom = $("[data-custom]", wiz);
    if (custom) custom.parentElement.setAttribute("aria-pressed", ![7, 14, 30].includes(adv.days));
  };
  $$("[data-days]", wiz).forEach((b) => (b.onclick = () => {
    adv.days = +b.dataset.days;
    const custom = $("[data-custom]", wiz);
    if (custom) custom.value = "";
    markDays();
    refresh();
  }));
  const ci = $("[data-custom]", wiz);
  if (ci) ci.oninput = () => { if (+ci.value >= 3) { adv.days = Math.min(90, +ci.value); markDays(); refresh(); } };
  const si = $("[data-seed]", wiz);
  if (si) si.oninput = () => (adv.seed = +si.value || adv.seed);
  const help = $("[data-help]", wiz);
  if (help) help.onclick = () => {
    const tip = $(".tip", wiz);
    if (tip) return tip.remove();
    help.parentElement.append(h(`<div class="tip">This number picks which of many possible campaigns plays out. Change it to simulate a different run. We pick a new one each time you publish.</div>`));
  };
  $(".back", wiz).onclick = () => { adv.step--; redraw(); };
  $("[data-next]", wiz).onclick = async () => {
    if (adv.step === 1) {
      const q = new URLSearchParams({ categories: [...adv.categories].join(","), formats: [...adv.formats].join(",") });
      try { adv.typical = (await api("/api/typical-budget?" + q)).budget; } catch (_) { adv.typical = null; }
    }
    if (adv.step === 4) return publish("normal");
    adv.step++;
    redraw();
  };
}

function sentence() {
  const cats = [...adv.categories].map(cap).join(" + ");
  const where = adv.formats.size ? [...adv.formats].map((f) => FORMAT_CARDS.find((x) => x[0] === f)[1]).join(", ") : "anywhere";
  const days = adv.days === 7 ? "1 week" : adv.days === 14 ? "2 weeks" : adv.days === 30 ? "1 month" : `${adv.days} days`;
  return `<b>${esc(cats)}</b>, ${esc(where)}, up to <b>${inr(adv.budget ?? adv.typical)}</b>, for <b>${days}</b>.`;
}

let ADV_TIMER = null;
async function publish(scenario) {
  adv.scenario = scenario;
  clearInterval(ADV_TIMER);   // stop the previous run's playback before starting a new one
  const root = $("#adv");
  window.scrollTo({ top: 0, behavior: "smooth" });
  root.replaceChildren(h(`<div class="loading">${scenario === "normal" ? "Publishing…" : "Replaying your campaign…"}</div>`));
  try {
    const run = await api("/api/publish", { categories: [...adv.categories], formats: [...adv.formats], budget: adv.budget ?? adv.typical, days: adv.days, seed: adv.seed, scenario });
    adv.last = run;
    dashboard(root, run);
  } catch (e) {
    root.replaceChildren(h(`<div class="error">${esc(e.message)}</div>`));
  }
}

function dashboard(root, run) {
  const tl = run.ours.timeline, n = tl.length;
  const d = h(`<div class="dash">
    <div class="dash-head"><div style="display:grid;gap:10px"><span class="label">${run.scenario === "normal" ? "Your campaign" : esc(run.scenario_label)}</span><h2>${sentence()}</h2></div>
      <div style="display:grid;gap:10px;justify-items:end"><span class="chip live" data-chip>Live</span><span class="day-count" data-day></span></div></div>
    <div class="tiles">
      <div class="panel tile"><span class="label">Views</span><b data-t="views">0</b></div>
      <div class="panel tile"><span class="label">Spend so far</span><b data-t="spend">₹0</b></div>
      <div class="panel tile"><span class="label">Per 1,000 views</span><b data-t="cpm">–</b></div>
      <div class="panel tile"><span class="label">Creators live</span><b data-t="creators">0</b></div>
      <div class="panel tile"><span class="label">Posts</span><b data-t="posts">0</b></div>
    </div>
    <div class="panel chart-panel"><div class="player-bar" style="margin-bottom:12px"><button data-pause>Pause</button><button data-fast>2×</button><button data-skip>Skip to results</button></div><div data-chart></div></div>
    <div data-report></div></div>`);
  root.replaceChildren(d);
  let day = -1, speed = 1, timer = null, paused = false;
  const set = (k, v) => ($(`[data-t="${k}"]`, d).textContent = v);
  const frame = () => {
    const t = tl[day];
    set("views", vw(t.views)); set("spend", inr(t.spend)); set("cpm", t.views ? cpm((1000 * t.spend) / t.views) : "–");
    set("creators", t.creators); set("posts", t.posts);
    $("[data-day]", d).textContent = `Day ${day + 1} of ${n}`;
    $("[data-chart]", d).innerHTML = deliveryChart(tl, day);
  };
  const finish = () => {
    clearInterval(timer);
    day = n - 1; frame();
    const chip = $("[data-chip]", d);
    chip.className = "chip done"; chip.textContent = `Completed ${run.settles_on}`;
    $(".player-bar", d).remove();
    report($("[data-report]", d), run);
  };
  const tick = () => { if (paused) return; day++; if (day >= n - 1) return finish(); frame(); };
  const start = () => { clearInterval(timer); timer = ADV_TIMER = setInterval(tick, Math.max(60, 20000 / n / speed)); };
  $("[data-pause]", d).onclick = (e) => { paused = !paused; e.target.textContent = paused ? "Play" : "Pause"; };
  $("[data-fast]", d).onclick = (e) => { speed = speed === 1 ? 2 : 1; e.target.classList.toggle("on", speed === 2); start(); };
  $("[data-skip]", d).onclick = finish;
  day = 0; frame(); start();
}

function report(el, run) {
  const r = run.report;
  const bigs = [
    `<div class="panel"><span class="label">Per 1,000 views</span><b>${cpm(r.cpm)}</b><p class="vs">The old way: <s>${cpm(r.old_cpm)}</s></p></div>`,
    r.money_back > 1 ? `<div class="panel"><span class="label">Money back</span><b class="gold-t">${inrShort(r.money_back)}</b><p>returned to you</p></div>` : `<div class="panel"><span class="label">Budget used</span><b>${inrShort(r.paid)}</b><p>every rupee bought real reach</p></div>`,
    r.fraud_posts ? `<div class="panel"><span class="label">Fakes kept out</span><b>${inrShort(r.fraud_blocked)}</b><p>of bought views never charged</p></div>` : "",
    `<div class="panel"><span class="label">Worked for you</span><b>${r.creators}</b><p>creators, ${r.posts} posts</p></div>`,
  ].filter(Boolean);
  const titles = { cheaper: "Views got cheaper", refund: "Money back", fraud: "Fakes kept out", budget: "Never over budget" };
  const oldOver = r.old_over_budget > 1 ? `<div class="panel"><b class="old-t">The old way would have gone ${inrShort(r.old_over_budget)} over.</b><p>Same posts, a typical gut-feel ladder for your budget.</p></div>` : "";
  const node = h(`<div class="report">
    <span class="label gold">Results</span>
    <div class="hero-line">Your ${inrShort(r.paid + r.money_back)} reached <em>${vw(r.genuine_views)} real views</em>.</div>
    <div class="bigs" style="grid-template-columns:repeat(${bigs.length},1fr)">${bigs.join("")}</div>
    <span class="label">What happened</span>
    <div class="happened">${r.cards.map((c) => `<div class="panel"><b>${titles[c.kind]}</b><p>${esc(c.text)}</p></div>`).join("")}${oldOver}</div>
    <span class="label">See how we'd handle…</span>
    <div class="whatif">${[["crowded", "Too many creators"], ["thin", "Too few views"], ["fraud", "A fraud wave"], ["late_viral", "Viral on the last day"]].map(([k, l]) => `<button class="cta ghost" data-w="${k}">${l}</button>`).join("")}
      <button class="cta" data-new>Start another campaign</button></div>
  </div>`);
  el.replaceChildren(node);
  $$("[data-w]", node).forEach((b) => (b.onclick = () => publish(b.dataset.w)));
  $("[data-new]", node).onclick = () => { adv.step = 0; adv.seed = rnd(); drawWizard(); window.scrollTo({ top: 0 }); };
  node.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* CREATOR ---------------------------------------------------------------------------------------- */
const cre = { seed: rnd() % 1000, profile: null, cards: null, card: null, run: null };
const AV = ["#f2c14e", "#7bd88f", "#8ab4ff", "#ff9e7a", "#d59bff", "#6ee7e0"];

async function initCreator() { drawProfiles(); }

async function drawProfiles() {
  const root = $("#cre");
  root.replaceChildren(h(`<div class="loading">Finding creators…</div>`));
  const profiles = await api(`/api/creator/profiles?seed=${cre.seed}`);
  const node = h(`<div class="wizard" style="max-width:1000px"><div class="q"><span class="label">Creator</span><h2>Who are you?</h2><p class="hint">Pick a creator to play as.</p>
    <div class="profile-grid">${profiles.map((p, i) => `<button class="profile" data-i="${i}"><span class="avatar" style="background:${AV[i % AV.length]}">${esc(p.handle[1].toUpperCase())}</span><b>${esc(p.handle)}</b><span>${PLAT[p.platform]} · ${vw(p.followers)} followers · ${p.tier}</span></button>`).join("")}</div>
    <div class="whatif"><button class="cta ghost" data-surprise>Surprise me</button><button class="back" data-shuffle>Show different creators</button></div></div></div>`);
  root.replaceChildren(node);
  $$(".profile", node).forEach((b) => (b.onclick = () => pickProfile(profiles[+b.dataset.i])));
  $("[data-surprise]", node).onclick = () => pickProfile(profiles[Math.floor(Math.random() * profiles.length)]);
  $("[data-shuffle]", node).onclick = () => { cre.seed = rnd() % 1000; drawProfiles(); };
}

async function pickProfile(p) {
  cre.profile = p;
  const root = $("#cre");
  cre.cards = await api("/api/creator/campaigns", { creator_id: p.creator_id, seed: cre.seed });
  const node = h(`<div class="wizard" style="max-width:1000px"><div class="q"><span class="label">${esc(p.handle)} · ${vw(p.followers)} followers</span><h2>Campaigns you can join</h2>
    <div class="camp-grid">${cre.cards.map((c) => `<div class="camp">
      ${c.cold ? `<span class="tag">New kind of campaign</span>` : `<span class="label">${PLAT[c.platform]}</span>`}
      <h3>${esc(c.brand)}</h3>
      <div class="row"><span>Pool</span><b style="color:var(--ink)">${inrShort(c.budget)}</b></div>
      <div class="row"><span>Formats</span><span>${c.formats.map((f) => FMT[f]).join(", ")}</span></div>
      <div class="row"><span>Runs</span><span>${c.days} days</span></div>
      <button class="cta gold" data-join="${c.id}">Join</button></div>`).join("")}</div>
    <button class="back" data-back>← Be someone else</button></div></div>`);
  root.replaceChildren(node);
  $$("[data-join]", node).forEach((b) => (b.onclick = () => join(cre.cards[+b.dataset.join])));
  $("[data-back]", node).onclick = drawProfiles;
}

async function join(card) {
  cre.card = card;
  const root = $("#cre");
  root.replaceChildren(h(`<div class="loading">Joining ${esc(card.brand)}…</div>`));
  cre.run = await api("/api/creator/run", { creator_id: cre.profile.creator_id, card, seed: cre.seed });
  goals();
}

const ODDS = ["4 in 5", "2 in 5", "1 in 5", "1 in 10", "1 in 20"];
function mySeg(run) { const p = run.me.posts[0]; return p ? [p.category, p.platform, p.tier, p.format].join("|") : null; }

function goals() {
  const run = cre.run, root = $("#cre");
  const seg = mySeg(run);
  const cold = run.ours.cold_segments.includes(seg);
  const base = run.ours.base_rungs[seg] || [];
  const node = h(`<div class="wizard" style="max-width:820px"><div class="q"><span class="label">${esc(cre.profile.handle)} · ${esc(run.cold_category ? "a brand-new kind of campaign" : cap(run.categories[0]))}</span>
    <h2>Your goals</h2>
    ${cold ? `<p class="hint">This is a new kind of campaign, so there's no history yet. Every view earns coins from the start, and your goals unlock at the 25% mark, once creators like you have posted.</p>`
      : `<p class="hint">Set from how posts by creators your size have actually done.</p>
    <div class="goals">${base.map((r, i) => `<div class="goal"><span class="n">${i + 1}</span><div><b>${vw(r)} views</b><br><span>${ODDS[i]} creators like you reach it</span></div><span class="label">${i === 0 ? "first goal" : "stretch"}</span></div>`).join("")}</div>`}
    <div class="wiz-nav"><button class="back" data-back>← Other campaigns</button><button class="cta gold" data-live>Post and go live</button></div></div></div>`);
  root.replaceChildren(node);
  $("[data-back]", node).onclick = () => pickProfile(cre.profile);
  $("[data-live]", node).onclick = live;
}

function rungsAt(run, seg, group, day) {
  const base = run.ours.base_rungs[seg];
  if (base) {
    let f = 1;
    run.me.events.filter((e) => e.kind === "fair_reach" && e.day <= day + 1 && e.group.join("|") === group).forEach((e) => (f = e.factor));
    return base.map((r) => Math.max(1, Math.round(r * f)));
  }
  const ev = run.me.events.filter((e) => e.kind === "cold_start" && e.day <= day + 1 && e.segment.join("|") === seg);
  return ev.length ? ev[ev.length - 1].rungs : null;
}

function live() {
  const run = cre.run, root = $("#cre"), tl = run.ours.timeline, n = tl.length;
  const posts = run.me.posts;
  const post = posts[0];
  const seg = mySeg(run), group = post ? [post.category, post.format].join("|") : "";
  const cum = (p) => { const out = [0]; p.daily.forEach((v) => out.push(out[out.length - 1] + v)); return out; };
  const cums = posts.map(cum);
  // Views a post has at a fractional campaign time t (in days), smoothly between whole days.
  const viewsAt = (i, t) => {
    const p = posts[i], c = cums[i], age = t - p.day;
    if (age <= 0) return 0;
    const k = Math.min(c.length - 1, Math.floor(age)), f = Math.min(1, age - k);
    return c[k] + (c[Math.min(c.length - 1, k + 1)] - c[k]) * f;
  };
  const node = h(`<div class="dash"><div class="dash-head"><div style="display:grid;gap:10px"><span class="label">${esc(cre.profile.handle)} · ${esc(cre.card.brand)}</span><h2>Your post is live</h2></div>
    <div style="display:grid;gap:10px;justify-items:end"><span class="chip live">Live</span><span class="day-count" data-day></span></div></div>
    <div class="live-grid">
      <div class="panel"><span class="label">Views</span><div class="worth"><b data-views>0</b></div>
        <div class="meter smooth" data-meter><span></span></div><div class="goals" data-goals></div></div>
      <div class="panel"><span class="label">What your views are worth right now</span><div class="worth"><b data-worth>₹0</b></div><p class="muted" style="margin:0" data-worthnote></p><div data-toasts style="display:grid;gap:8px"></div>
        <div class="player-bar"><button data-skip>Skip to payday</button></div></div>
    </div></div>`);
  root.replaceChildren(node);
  const meter = $("[data-meter]", node), bar = $("span", meter), goalsEl = $("[data-goals]", node);
  let rungs, top = 1, hit = 0, lastDay = -1, raf = null, stopped = false;
  const toast = (t) => $("[data-toasts]", node).prepend(h(`<div class="toast">${esc(t)}</div>`));

  // Goals and meter marks are built once per rung change and then only updated in place, so the bar
  // glides and a reached goal lights up without the list being rebuilt.
  const buildGoals = (next, myViews) => {
    const before = rungs;
    rungs = next;
    top = rungs ? rungs[rungs.length - 1] * 1.15 : Math.max(1, myViews * 1.3);
    $$("i", meter).forEach((i) => i.remove());
    if (!rungs) {
      goalsEl.innerHTML = `<p class="muted">Goals unlock at the 25% mark. Every view is already a coin.</p>`;
      return;
    }
    rungs.forEach((r) => { const m = document.createElement("i"); m.style.left = `${(r / top) * 100}%`; meter.append(m); });
    goalsEl.innerHTML = rungs.map((r, i) => `<div class="goal" data-g="${i}"><span class="n">${i + 1}</span><div><b>${vw(r)} views</b></div><span class="label"></span></div>`).join("");
    hit = 0;
    if (before && rungs[0] < before[0] && run.ours.base_rungs[seg]) toast("Views are slow for everyone, so your goals came down.");
    else if (!before && !run.ours.base_rungs[seg]) toast("Goals unlocked. They're set from how everyone here is doing.");
    else if (before) toast("Goals updated from how everyone here is doing.");
  };

  const frame = (t) => {
    const day = Math.min(n - 1, Math.floor(t));
    const myViews = post ? viewsAt(0, t) : 0;
    const all = posts.reduce((a, _, i) => a + viewsAt(i, t), 0);
    if (day !== lastDay) {
      lastDay = day;
      const next = rungsAt(run, seg, group, day);
      if (JSON.stringify(next) !== JSON.stringify(rungs)) buildGoals(next, myViews);
      $("[data-day]", node).textContent = `Day ${day + 1} of ${n}`;
    }
    $("[data-views]", node).textContent = vw(all);
    bar.style.width = `${Math.min(100, (myViews / top) * 100)}%`;
    const reached = rungs ? rungs.filter((r) => myViews >= r).length : 0;
    $$("i", meter).forEach((m, i) => m.classList.toggle("hit", i < reached));
    if (reached > hit) {
      for (let i = hit; i < reached; i++) {
        const g = $(`[data-g="${i}"]`, goalsEl);
        if (g) { g.classList.add("hit", "pop"); $(".label", g).textContent = "reached"; }
      }
      toast(`Goal ${reached} reached!`);
      hit = reached;
    }
    const coins = rungs ? posts.reduce((a, _, i) => a + (rungs.filter((r) => viewsAt(i, t) >= r).pop() || 0), 0) : 0;
    const price = tl[day].price;
    $("[data-worth]", node).textContent = inr(coins * price);
    $("[data-worthnote]", node).textContent = coins ? `${vw(coins)} coins × ${cpm(price * 1000)} per 1,000. The price moves as other creators post.` : "Reach your first goal to start earning.";
  };

  const total = 12000, t0 = performance.now();
  const loop = (now) => {
    if (stopped) return;
    const t = Math.min(n, ((now - t0) / total) * n);
    frame(t);
    if (t >= n) return done();
    raf = requestAnimationFrame(loop);
  };
  const done = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    frame(n);
    setTimeout(payday, 900);
  };
  raf = requestAnimationFrame(loop);
  $("[data-skip]", node).onclick = done;
}

function payday() {
  const run = cre.run, root = $("#cre"), me = run.me, price = run.ours.price;
  const fair = me.events.some((e) => e.kind === "fair_reach");
  const lines = me.posts.map((p, i) => {
    const k = p.rung_index;
    return `<div class="goal ${k ? "hit" : ""}"><span class="n">${i + 1}</span><div><b>${vw(p.views)} views</b><br><span>${p.fraud ? "Bought views were found. Not paid." : k ? `Reached goal ${k} (${vw(p.rungs[k - 1])}) → ${vw(p.rung_coins)} coins` : "Didn't reach the first goal"}</span></div><b class="num">${inr(p.paid)}</b></div>`;
  }).join("");
  const node = h(`<div class="wizard" style="max-width:820px"><div class="q"><span class="label">Paid ${esc(run.settles_on)}</span>
    <div class="paid-hero" data-paid>₹0</div>
    <div class="goals">${lines}</div>
    <p class="lede" style="margin:0">Every creator in this campaign got the same price per coin: <b>${cpm(price * 1000)}</b> per 1,000. You were paid your exact share.</p>
    ${fair ? `<p class="muted" style="margin:0">Views were slow for everyone, so your goals were lowered to keep them reachable.</p>` : ""}
    <div class="whatif"><button class="cta gold" data-again>Join another campaign</button><button class="cta ghost" data-other>Be someone else</button></div></div></div>`);
  root.replaceChildren(node);
  tween($("[data-paid]", node), me.paid, inr, 1400);
  $("[data-again]", node).onclick = () => pickProfile(cre.profile);
  $("[data-other]", node).onclick = () => { cre.seed = rnd() % 1000; drawProfiles(); };
}

/* COMPARE ---------------------------------------------------------------------------------------- */
const cmp = { categories: new Set(), formats: new Set(), budget: null, typical: null, days: 14, old: null };

async function initCompare() { await meta(); drawCompare(); }

function drawCompare() {
  const root = $("#cmp");
  const node = h(`<div>
    <div class="page-head"><span class="label">Compare</span><h1 class="h2">Try both. Then look at the bill.</h1>
      <p class="lede">Set up the same campaign two ways. We run both on every matching campaign from the past and show you what happened.</p></div>
    <section class="cmp-step"><span class="label gold">With Creator Coin</span>
      <div class="panel ours-card">
        <div class="field"><span class="label">What are you promoting?</span><div class="opts">${META.categories.map((c) => `<button class="opt" data-c="${c}" aria-pressed="${cmp.categories.has(c)}">${esc(c)}</button>`).join("")}</div></div>
        <div class="field"><span class="label">Where?</span><div class="opts"><button class="opt" data-f="any" aria-pressed="${cmp.formats.size === 0}">Anywhere</button>${FORMAT_CARDS.map(([f, l]) => `<button class="opt" data-f="${f}" aria-pressed="${cmp.formats.has(f)}">${l}</button>`).join("")}</div></div>
        <div class="field-row"><label class="field"><span class="label">How much?</span><input data-b inputmode="numeric" placeholder="₹" value="${cmp.budget ? cmp.budget.toLocaleString("en-IN") : ""}"></label>
          <div class="field"><span class="label">How long?</span><div class="opts">${[[7, "1 week"], [14, "2 weeks"], [30, "1 month"]].map(([d, l]) => `<button class="opt" data-d="${d}" aria-pressed="${cmp.days === d}">${l}</button>`).join("")}</div></div></div>
        <div data-thats></div>
      </div></section>
    <section class="cmp-step" data-oldstep hidden></section>
    <section class="cmp-step" data-result hidden></section></div>`);
  root.replaceChildren(node);
  const ready = () => cmp.categories.size && cmp.budget > 0;
  const refresh = async () => {
    const slot = $("[data-thats]", node), shown = !!slot.firstElementChild;
    if (ready() && !shown) slot.innerHTML = `<div class="thats-it">That's it.</div><p class="muted" style="margin:0">Four answers. Now here's the old way.</p>`;
    if (!ready() && shown) slot.innerHTML = "";
    if (ready() && $("[data-oldstep]", node).hidden) oldWay(node);
  };
  $$("[data-c]", node).forEach((b) => (b.onclick = () => { cmp.categories.has(b.dataset.c) ? cmp.categories.delete(b.dataset.c) : cmp.categories.add(b.dataset.c); b.setAttribute("aria-pressed", cmp.categories.has(b.dataset.c)); prefill(node).then(refresh); }));
  $$("[data-f]", node).forEach((b) => (b.onclick = () => {
    const v = b.dataset.f;
    if (v === "any") cmp.formats.clear(); else cmp.formats.has(v) ? cmp.formats.delete(v) : cmp.formats.add(v);
    $$("[data-f]", node).forEach((x) => x.setAttribute("aria-pressed", x.dataset.f === "any" ? cmp.formats.size === 0 : cmp.formats.has(x.dataset.f)));
    prefill(node).then(refresh);
  }));
  $$("[data-d]", node).forEach((b) => (b.onclick = () => { cmp.days = +b.dataset.d; $$("[data-d]", node).forEach((x) => x.setAttribute("aria-pressed", +x.dataset.d === cmp.days)); refresh(); }));
  const bi = $("[data-b]", node);
  bi.oninput = () => { const raw = bi.value.replace(/[^\d]/g, ""); cmp.budget = raw ? +raw : null; bi.value = raw ? (+raw).toLocaleString("en-IN") : ""; refresh(); };
}

async function prefill(node) {
  if (!cmp.categories.size) return;
  const q = new URLSearchParams({ categories: [...cmp.categories].join(","), formats: [...cmp.formats].join(",") });
  try {
    const t = (await api("/api/typical-budget?" + q)).budget;
    if (t && !cmp.budget) { cmp.budget = t; $("[data-b]", node).value = t.toLocaleString("en-IN"); }
  } catch (_) { /* keep what the user typed */ }
}

function oldWay(node) {
  const step = $("[data-oldstep]", node);
  step.hidden = false;
  if (!cmp.old) cmp.old = { budget: cmp.budget, rate: 50, tier: "micro", rungs: META.brief_ladder.map((r) => [...r]) };
  const o = cmp.old;
  step.innerHTML = `<span class="label">The old way</span>
    <div class="old-card">
      <p class="muted" style="margin:0;font-family:var(--mono);font-size:13px">campaign_setup_v3_FINAL(2).xlsx</p>
      <div class="field-row" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <label class="field"><span class="label">Budget (₹)</span><input data-ob value="${o.budget}"></label>
        <label class="field"><span class="label">Rate (₹ per 1,000 views)</span><input data-or value="${o.rate}"></label>
        <label class="field"><span class="label">Target creator size</span><select data-ot>${META.tiers.map((t) => `<option ${t === o.tier ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <div class="rung-table"><div class="rowh"><span>Views</span><span>Payout (₹, cumulative)</span><span></span></div>
        ${o.rungs.map((r, i) => `<div class="rowx"><input data-rv="${i}" value="${r[0]}"><input data-rp="${i}" value="${r[1]}"><button data-rx="${i}" aria-label="Remove">×</button></div>`).join("")}
        <button class="add-rung" data-ra>+ add rung</button></div>
      <div class="warn">⚠ What if a big creator hits 500K in a day? They get the top payout, same as everyone.<br>⚠ What if views come in higher than you planned? There's no budget stop.<br>⚠ Who checks for bought views? Nobody, in this sheet.<br>⚠ Same ladder for a 5K page and a 5M page.</div>
    </div>
    <div><button class="cta gold" data-run>Run both on every matching past campaign</button></div>`;
  const sync = () => {
    o.budget = +$("[data-ob]", step).value.replace(/[^\d]/g, "") || cmp.budget;
    o.tier = $("[data-ot]", step).value;
    o.rungs = $$(".rowx", step).map((row) => [+$("[data-rv]", row).value.replace(/[^\d]/g, ""), +$("[data-rp]", row).value.replace(/[^\d]/g, "")]).filter((r) => r[0] > 0);
  };
  $$("input, select", step).forEach((i) => (i.oninput = sync));
  $("[data-or]", step).oninput = (e) => {
    o.rate = +e.target.value || 0;
    $$(".rowx", step).forEach((row) => { const v = +$("[data-rv]", row).value || 0; $("[data-rp]", row).value = Math.round((v * o.rate) / 1000 / 100) * 100; });
    sync();
  };
  $$("[data-rx]", step).forEach((b) => (b.onclick = () => { sync(); o.rungs.splice(+b.dataset.rx, 1); oldWay(node); }));
  $("[data-ra]", step).onclick = () => { sync(); const last = o.rungs[o.rungs.length - 1] || [10000, 500]; o.rungs.push([last[0] * 2, last[1] * 2]); oldWay(node); };
  $("[data-run]", step).onclick = () => { sync(); runCompare(node); };
}

async function runCompare(node) {
  const out = $("[data-result]", node);
  out.hidden = false;
  out.innerHTML = `<div class="loading">Running both, campaign by campaign…</div>`;
  out.scrollIntoView({ behavior: "smooth" });
  try {
    const r = await api("/api/compare", { categories: [...cmp.categories], formats: [...cmp.formats], budget: cmp.budget, old: { budget: cmp.old.budget, rungs: cmp.old.rungs } });
    if (!r.count) { out.innerHTML = `<div class="panel" style="padding:24px">No past campaign ran in this format, so there's nothing honest to compare against yet.</div>`; return; }
    const s = r.summary, w = r.worlds[r.worst];
    const basis = r.basis === "same category and format" ? `${r.count} past ${[...cmp.categories].join(" + ")} campaigns` : `${r.count} past campaigns in the same format (no past ${[...cmp.categories].join(" + ")} ones yet)`;
    out.innerHTML = `<span class="label gold">Compared across ${esc(basis)}</span>
      <div class="panel chart-panel strip"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><b>What each campaign cost, against its budget</b>${oldNewLegend}</div>${stripChart(r.worlds, r.worst)}
        <p class="muted" style="margin:0">The old way went over budget in <b class="old-t">${s.old_over_count}</b> of ${r.count}. Creator Coin: <b class="gold-t">${s.ours_over_count}</b>. The big dot is the old way's worst campaign.</p></div>
      <span class="label">The old way's worst campaign, both ways</span>
      <div class="worst">
        <div class="panel old-side"><span class="label old-t">The old way</span>
          <div class="line-item"><span>Paid</span><b data-c="${w.old.paid}">₹0</b></div>
          <div class="line-item"><span>Over budget</span><b class="old-t" data-c="${w.old.over}">₹0</b></div>
          <div class="line-item"><span>Paid for bought views</span><b class="old-t" data-c="${w.old.bought}">₹0</b></div>
          <div class="line-item"><span>Overpaid for real views</span><b class="old-t" data-c="${w.old.overpay}">₹0</b></div></div>
        <div class="panel new-side"><span class="label gold-t">Creator Coin, same posts</span>
          <div class="line-item"><span>Paid</span><b data-c="${w.ours.paid}">₹0</b></div>
          <div class="line-item"><span>Over budget</span><b>₹0</b></div>
          <div class="line-item"><span>Paid for bought views</span><b data-c="${w.ours.bought}">₹0</b></div>
          <div class="line-item"><span>Money back</span><b class="good-t" data-c="${w.ours.refund}">₹0</b></div></div>
      </div>
      <div class="verdict">Across ${r.count} campaigns, the old way wasted <span class="old-t">${inrShort(s.old_waste)}</span> on average. Creator Coin: <span class="gold-t">${inrShort(s.ours_waste)}</span>.</div>
      <p class="muted">Wasted = over budget + paid for bought views + paid more than the market price for the same real views. Same posts both ways; creator behaviour held fixed.</p>`;
    await sleep(600);
    $$("[data-c]", out).forEach((el, i) => setTimeout(() => tween(el, +el.dataset.c, inr, 1200), i * 180));
  } catch (e) {
    out.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

/* BACKTEST --------------------------------------------------------------------------------------- */
const SLIDERS = [
  ["virality", "Virality", "How easily posts break out, and how long viral lasts"],
  ["cheating", "Cheating", "How easily creators drift into buying views"],
  ["seasons", "Seasons", "How often and how long cold months last"],
  ["pay_pull", "Pay pull", "How strongly a higher coin value attracts creators"],
];

async function initBacktest() {
  try { renderBacktest(await bt()); } catch (e) { $("#bt-out").innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

function renderRecipe(data) {
  const r = data.recipe, c = data.counts;
  const el = $("#recipe");
  el.innerHTML = `<span class="label gold">Recipe</span>
    <div class="field"><span class="label">Seed</span><div style="display:flex;gap:8px"><input type="number" data-k="seed" value="${r.seed}"><button class="cta ghost" data-newseed style="padding:8px 12px">New</button></div></div>
    <div class="field"><span class="label">Past budgets (₹)</span><div class="rowf"><input type="number" data-k="budget_min" value="${r.budget_min}"><input type="number" data-k="budget_max" value="${r.budget_max}"></div></div>
    <div class="field"><span class="label">Past durations (days)</span><div class="rowf"><input type="number" data-k="duration_min" value="${r.duration_min}"><input type="number" data-k="duration_max" value="${r.duration_max}"></div></div>
    ${SLIDERS.map(([k, l, d]) => `<label class="slider"><div class="top"><span>${l}</span><span data-sv="${k}">${(+r[k]).toFixed(2)}</span></div><input type="range" min="0" max="1" step="0.01" data-k="${k}" value="${r[k]}"><small>${d}</small></label>`).join("")}
    <button class="cta gold" data-apply>Rebuild the world</button>
    <button class="cta ghost" data-random>Randomise everything</button>
    <p class="muted" style="margin:0;font-size:13px">${c.campaigns} campaigns · ${c.creators} creators · ${c.posts.toLocaleString("en-IN")} posts · built in ${data.seconds.toFixed(1)}s</p>
    <details><summary class="label" style="cursor:pointer">Show all numbers</summary><div class="numbers">${esc(JSON.stringify(roundDeep(data.params), null, 1))}</div></details>`;
  $$("input[type=range]", el).forEach((i) => (i.oninput = () => ($(`[data-sv="${i.dataset.k}"]`, el).textContent = (+i.value).toFixed(2))));
  const recipe = () => Object.fromEntries($$("[data-k]", el).map((i) => [i.dataset.k, +i.value]));
  const rebuild = async (body) => {
    $("#bt-out").innerHTML = `<div class="loading">Regenerating the world and replaying every campaign…</div>`;
    try { BT = await api("/api/world", body); META = null; renderBacktest(BT); } catch (e) { $("#bt-out").innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  $("[data-apply]", el).onclick = () => rebuild(recipe());
  $("[data-newseed]", el).onclick = () => { $("[data-k=seed]", el).value = rnd() % 10000; };
  $("[data-random]", el).onclick = () => rebuild({ randomise: true, seed: rnd() % 10000 });
}

function roundDeep(x) {
  if (Array.isArray(x)) return x.map(roundDeep);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, roundDeep(v)]));
  return typeof x === "number" ? Math.round(x * 1000) / 1000 : x;
}

function measure(title, oldV, newV, note, extra = "") {
  return `<div class="panel measure"><span class="label">${title}</span>
    <div class="pair"><div><span class="label old-t">Old way</span><b class="old-t">${oldV}</b></div><div><span class="label gold-t">Creator Coin</span><b class="gold-t">${newV}</b></div></div>
    ${extra}<p>${note}</p></div>`;
}

function renderBacktest(data) {
  renderRecipe(data);
  const b = data.backtest, v = data.validation, n = b.campaigns;
  const tiers = ["nano", "micro", "mid", "macro"];
  const tierBars = pairBars(tiers.map((t) => ({ label: t, old: b.creators_paid_by_tier.old[t].rate, new: b.creators_paid_by_tier.new[t].rate })), (x) => pct(x));
  const stripRows = b.budget.old_ratios.map((x, i) => ({ old: { paid: x, budget: 1 }, ours: { paid: b.budget.new_ratios[i], budget: 1 } }));
  const ret = b.returned;
  $("#bt-out").innerHTML = `<div class="measures">
    <div class="group-title"><span class="label gold">For advertisers · across ${n} campaigns in this world</span></div>
    ${measure("Budget kept", `${b.budget.old_over} over`, `${b.budget.new_over} over`, `Worst overspend: ${b.budget.old_worst.toFixed(1)}× the budget the old way. Creator Coin can't go over.`, stripChart(stripRows, -1))}
    ${measure("Cost per 1,000 real views", cpm(b.cost_per_1k.old), cpm(b.cost_per_1k.new), "Median across campaigns: what the brand really paid for genuine reach.")}
    ${measure("Money returned", inrShort(ret.old_unspent), inrShort(ret.new_thin + ret.new_between_rungs), `Creator Coin: ${inrShort(ret.new_thin)} back when views were thin, ${inrShort(ret.new_between_rungs)} for views between rungs. The old way just left budget unspent.`)}
    ${measure("Paid for bought views", inrShort(b.bought.old), inrShort(b.bought.new), `${inrShort(b.bought.blocked)} of bought views were caught and never paid. What slipped through was dripped in to look real.`)}
    <div class="group-title"><span class="label gold">For creators</span></div>
    <div class="panel measure"><span class="label">Creators paid anything, by size</span>${tierBars}${oldNewLegend}<p>One gut-feel ladder is out of reach for small pages and easy for big ones. Per-size rungs fix that.</p></div>
    <div class="panel measure"><span class="label">Fair Reach rescues</span><div class="pair"><div><span class="label">Campaigns</span><b class="gold-t">${b.fair_reach.campaigns}</b></div><div><span class="label">Creators paid only because of it</span><b class="gold-t">${b.fair_reach.creators}</b></div></div><p>When views ran cold for everyone in a campaign, rungs came down so they stayed reachable.</p></div>
    <div class="group-title"><span class="label gold">Market health</span></div>
    ${measure("Price stability (lower is steadier)", b.price_stability.old != null ? b.price_stability.old.toFixed(2) : "–", b.price_stability.new != null ? b.price_stability.new.toFixed(2) : "–", "How much the price per view swings between similar campaigns (coefficient of variation).")}
    ${measure("Pay to the top 10% of creators", pct(b.concentration.old), pct(b.concentration.new), "Creator Coin pays for reach, and reach is concentrated: the biggest posts earn the most. The old way's flat payouts hide that big posts were underpaid.")}
    <div class="group-title"><span class="label gold">Checks on the world and the method</span></div>
    <div class="panel measure"><span class="label">Rungs hit what they promise</span>${pairBars(v.rungs.design.map((d, i) => ({ label: "Rung " + (i + 1), old: d, new: v.rungs.actual ? v.rungs.actual[i] : 0 })), (x) => pct(x))}
      <div class="legend"><span><i style="background:var(--old)"></i>Designed</span><span><i style="background:var(--gold)"></i>Actual, on campaigns the rungs weren't built from</span></div></div>
    <div class="panel measure"><span class="label">Is the world realistic?</span>
      <div class="pair"><div><span class="label">Top 10% of posts' share of views</span><b>${pct(v.heavy_tail.top_10pct_share)}</b></div><div><span class="label">Followers vs views</span><b>${v.followers_vs_views_correlation.toFixed(2)}</b></div></div>
      <div class="pair"><div><span class="label">Bought views caught</span><b>${pct(v.fraud.catch_rate)}</b></div><div><span class="label">Genuine posts held</span><b>${pct(v.fraud.false_alarm_rate, 1)}</b></div></div>
      <p>Heavy tails and growth shapes come out of the chains, not out of a formula. Same posts both ways, so creator behaviour is held fixed.</p></div>
  </div>`;
}

/* METHOD ----------------------------------------------------------------------------------------- */
function initMethod() {
  $$(".doc-tabs button").forEach((b) => (b.onclick = () => { $$(".doc-tabs button").forEach((x) => x.classList.toggle("active", x === b)); showDoc(b.dataset.doc); }));
  showDoc("one-pager");
}
async function showDoc(name) {
  const el = $("#doc");
  el.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const { markdown } = await api("/api/doc/" + name);
    el.innerHTML = window.marked ? marked.parse(markdown) : `<pre>${esc(markdown)}</pre>`;
  } catch (e) { el.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

route();
