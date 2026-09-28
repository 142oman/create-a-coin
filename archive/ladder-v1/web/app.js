/* Milestone Ladder front end: plain JS, no build step. */
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
  return String(x);
};
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/* Theme ------------------------------------------------------------------------------------------ */
(function theme() {
  const key = "ladder-theme";
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
const loaded = {};
function route() {
  const view = (location.hash || "#build").slice(1).split("/")[0];
  const name = ["build", "backtest", "compare", "method"].includes(view) ? view : "build";
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
  $$(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  if (!loaded[name]) { loaded[name] = true; ({ build: initBuild, backtest: initBacktest, compare: initCompare, method: initMethod })[name](); }
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);

let META = null;
const meta = () => META || (META = api("/api/meta"));

/* BUILD ------------------------------------------------------------------------------------------ */
const buildState = { category: "gaming", platform: "instagram", target_creator_tier: "micro" };

async function initBuild() {
  const m = await meta();
  const options = { category: m.categories, platform: Object.keys(m.formats), target_creator_tier: m.tiers };
  for (const [name, values] of Object.entries(options)) {
    const box = $(`.chips[data-name="${name}"]`);
    values.forEach((v) => {
      const b = h(`<button type="button" class="chip" aria-pressed="${buildState[name] === v}">${esc(v)}</button>`);
      b.addEventListener("click", () => {
        buildState[name] = v;
        $$(".chip", box).forEach((c) => c.setAttribute("aria-pressed", c === b));
      });
      box.append(b);
    });
  }
  const budget = $('input[name="total_budget"]');
  const hint = () => ($('[data-hint="budget"]').textContent = budget.value ? `${rupees(budget.value)} · ${compact(+budget.value)}` : "");
  budget.addEventListener("input", hint); hint();
  $("#data-foot").textContent = `Learns from ${m.counts.campaigns} past campaigns, ${m.counts.posts.toLocaleString()} posts and ${m.counts.creators} creators.`;
  $("#build-form").addEventListener("submit", (e) => { e.preventDefault(); runBuild(); });
  runBuild();
}

async function runBuild() {
  const form = $("#build-form");
  const btn = $("button.primary", form);
  const body = { ...buildState };
  new FormData(form).forEach((v, k) => (body[k] = v));
  btn.disabled = true;
  const out = $("#build-out");
  try {
    const p = await api("/api/ladder", body);
    renderProposal(out, p);
  } catch (err) {
    out.replaceChildren(h(`<div class="error">${esc(err.message)}</div>`));
  } finally {
    btn.disabled = false;
  }
}

function renderProposal(out, p) {
  const { pricing: pr, simulation: sim, lowball } = p;
  const budget = p.params.total_budget;
  const lo = pr.min_cpm, hi = pr.max_cpm, exp = sim.expected_rate_cpm;
  const scaleMax = hi * 1.08;
  const at = (x) => `${Math.max(0, Math.min(100, (x / scaleMax) * 100))}%`;
  const lowLabel = { ok: "Rate looks fair", warn: "Below typical", block: "Too low", unknown: "No history" }[lowball.status];

  const price = h(`
    <div class="panel price-card">
      <div class="price-head">
        <div>
          <div class="eyebrow">What creators earn per 1,000 views</div>
          <div class="price-range">₹${lo.toFixed(1)}<span class="to">to</span>₹${hi.toFixed(1)}<small>${pr.budget_rich ? "the brand maximum, guaranteed" : "guaranteed → brand maximum"}</small></div>
        </div>
        <span class="badge ${lowball.status}" title="${esc(lowball.message)}">${lowLabel}</span>
      </div>
      <div class="band" aria-hidden="true">
        <div class="track"></div>
        <div class="fill" style="left:${at(lo)};width:calc(${at(hi)} - ${at(lo)})"></div>
        <div class="mark" style="left:${at(exp)}">likely ₹${exp.toFixed(1)}</div>
      </div>
      <p class="note">${esc(lowball.message)} ${pr.budget_rich
        ? `<strong>The budget is larger than the reach this campaign is likely to get</strong>, so creators are paid the full maximum and the rest comes back to the brand.`
        : `The guaranteed rate is what the budget can pay even if views come in at the high end (95th percentile of ${sim.runs.toLocaleString()} simulated campaigns). When views come in lower, the rate rises toward the maximum.`}</p>
      <div class="stats">
        <div class="stat"><b>${Math.round(p.expected_posts)}</b><span>posts expected</span></div>
        <div class="stat"><b>${rupees(sim.expected_spend)}</b><span>expected payout (${pct(sim.expected_spend / budget)})</span></div>
        <div class="stat"><b>${rupees(Math.max(0, sim.expected_refund))}</b><span>expected refund</span></div>
        <div class="stat"><b>${pct(sim.chance_over_at_min)}</b><span>chance it fills up early</span></div>
      </div>
    </div>`);

  const ladderCard = h(`
    <div class="panel ladder-card">
      <div class="ladder-top">
        <h2>The ladder</h2>
        <div class="seg" data-kind="tier"></div>
      </div>
      <div class="ladder-top"><span class="eyebrow">Format</span><div class="seg" data-kind="format"></div></div>
      <div class="stairs-slot"></div>
      <div class="basis"></div>
    </div>`);

  const byTier = {};
  p.ladders.forEach((l) => ((byTier[l.tier] ||= []).push(l)));
  const tiers = Object.keys(byTier);
  let tier = byTier[p.params.target_creator_tier] ? p.params.target_creator_tier : tiers[0];
  let fmt = null;

  const drawSeg = () => {
    const tseg = $('[data-kind="tier"]', ladderCard);
    tseg.replaceChildren(...tiers.map((t) => {
      const n = byTier[t].reduce((a, l) => a + l.expected_posts, 0);
      const b = h(`<button class="${t === tier ? "active" : ""}">${t}<span class="n">${n.toFixed(0)}</span></button>`);
      b.onclick = () => { tier = t; fmt = null; drawSeg(); };
      return b;
    }));
    const formats = byTier[tier];
    if (!fmt || !formats.find((l) => l.format === fmt)) fmt = formats.slice().sort((a, b) => b.expected_posts - a.expected_posts)[0].format;
    const fseg = $('[data-kind="format"]', ladderCard);
    fseg.replaceChildren(...formats.map((l) => {
      const b = h(`<button class="${l.format === fmt ? "active" : ""}">${l.format.replace("_", " ")}</button>`);
      b.onclick = () => { fmt = l.format; drawSeg(); };
      return b;
    }));
    const ladder = formats.find((l) => l.format === fmt);
    $(".stairs-slot", ladderCard).replaceChildren(stairs(ladder));
    const bs = ladder.basis;
    $(".basis", ladderCard).innerHTML =
      `Built from <strong>${bs.posts}</strong> past posts in <strong>${esc(bs.group.join(" · "))}</strong>` +
      ` · typical post ${views(bs.median_views)} views · ${ladder.expected_posts.toFixed(1)} posts expected here.` +
      (bs.widened ? ` <span class="widened">Widened ${bs.widened} step${bs.widened > 1 ? "s" : ""}: too little exact history, so a broader group was used.</span>` : "");
  };
  drawSeg();

  const simCard = h(`
    <div class="panel sim-card">
      <div class="ladder-top"><h2>How the minimum was set</h2></div>
      <p class="note">Each bar counts simulated campaigns by the total views that cleared a rung. The guaranteed rate is the budget divided by the 95th-percentile line.</p>
    </div>`);
  simCard.append(histogram(sim, budget, pr));

  const table = h(`<div class="panel" style="padding:18px 22px"><details><summary>Every ladder in this campaign</summary><div class="table-wrap"></div></details></div>`);
  const rows = p.ladders.map((l) => `<tr><td>${l.tier}</td><td>${l.format.replace("_", " ")}</td><td class="num">${l.expected_posts.toFixed(1)}</td>
      <td>${l.rungs.map((r) => `<span title="reached by ${pct(r.reach, 1)} · ${rupees(r.min_payout)}–${rupees(r.max_payout)}">${views(r.views)}</span>`).join(" · ")}</td></tr>`).join("");
  $(".table-wrap", table).innerHTML = `<table><thead><tr><th>Tier</th><th>Format</th><th class="num">Posts</th><th>Rungs (views)</th></tr></thead><tbody>${rows}</tbody></table>`;

  out.replaceChildren(price, ladderCard, simCard, table);
}

function stairs(ladder) {
  const rungs = ladder.rungs;
  const W = 720, H = 330, top = 58, bottom = 30, left = 8;
  const n = rungs.length;
  const sw = (W - left) / n;
  const lo = Math.log(rungs[0].views / 1.9), hi = Math.log(rungs[n - 1].views * 1.05);
  const y = (v) => H - bottom - ((Math.log(v) - lo) / (hi - lo)) * (H - top - bottom);
  let d = `M${left},${H - bottom}`;
  rungs.forEach((r, i) => { d += ` L${left + i * sw},${y(r.views)} L${left + (i + 1) * sw},${y(r.views)}`; });
  const area = d + ` L${W},${H - bottom} Z`;
  const labels = rungs.map((r, i) => {
    const x = left + i * sw + 10, yy = y(r.views);
    return `<text class="views" x="${x}" y="${yy - 30}">${views(r.views)}</text>
      <text class="pay" x="${x}" y="${yy - 14}">${rupees(r.min_payout)}–${rupees(r.max_payout)}</text>
      <text class="reach" x="${x}" y="${yy + 18}">${pct(r.reach, r.reach < 0.1 ? 1 : 0)} reach</text>`;
  }).join("");
  const svg = h(`<svg class="stairs" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ladder for ${ladder.tier} ${ladder.format}">
      <line class="grid" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}"/>
      <path class="area" d="${area}"/><path class="edge" d="${d}"/>${labels}
      <text class="axis" x="${left}" y="${H - 8}">rung 1 = the typical post</text>
      <text class="axis" x="${W}" y="${H - 8}" text-anchor="end">each next rung: reached by half of those on the one before</text>
    </svg>`);
  return svg;
}

function histogram(sim, budget, pr) {
  const { start, width, counts } = sim.histogram;
  const W = 720, H = 190, pad = 22;
  const max = Math.max(...counts);
  const bw = (W - 2) / counts.length;
  const xOf = (v) => ((v - start) / (width * counts.length)) * W;
  const p95 = sim.p95_cleared_views;
  const bars = counts.map((c, i) => {
    const bh = (c / max) * (H - pad * 2);
    const tail = start + (i + 0.5) * width > p95;
    return `<rect class="${tail ? "tail" : ""}" x="${i * bw + 1}" y="${H - pad - bh}" width="${bw - 2}" height="${bh}" rx="2"/>`;
  }).join("");
  const marker = (v, label, anchor = "middle") => {
    const x = Math.max(0, Math.min(W, xOf(v)));
    return `<line x1="${x}" x2="${x}" y1="${pad - 4}" y2="${H - pad}"/><text x="${x}" y="${pad - 8}" text-anchor="${anchor}">${label}</text>`;
  };
  return h(`<svg class="hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Simulated cleared views">
      ${bars}
      ${marker(sim.p50_cleared_views, "typical " + views(sim.p50_cleared_views))}
      ${marker(p95, "95th pct " + views(p95) + " → ₹" + pr.min_cpm.toFixed(1), "start")}
      <text x="0" y="${H - 4}">${views(start)} views cleared</text>
      <text x="${W}" y="${H - 4}" text-anchor="end">${views(start + width * counts.length)}</text>
    </svg>`);
}

/* BACKTEST --------------------------------------------------------------------------------------- */
async function initBacktest() {
  const out = $("#backtest-out");
  try {
    const r = await api("/api/backtest");
    renderBacktest(out, r);
  } catch (err) {
    out.replaceChildren(h(`<div class="error">${esc(err.message)}</div>`));
  }
}

function duo(title, oldVal, newVal, note = "") {
  return `<div class="panel"><h3>${title}</h3>
    <div class="duo"><span class="old">${oldVal}</span><span class="arrow">→</span><span class="ours">${newVal}</span></div>
    <div class="duo-labels"><span>status quo</span><span>ours</span></div>${note ? `<p class="note" style="margin-top:10px">${note}</p>` : ""}</div>`;
}

function renderBacktest(out, r) {
  const s = r.summary, o = s.old, n = s.new;
  const hero = h(`<div>
    <div class="legend"><span><i class="i-old"></i>Status quo ladder (as actually used)</span><span><i class="i-ours"></i>Our ladder</span></div>
    <div class="hero">
      ${duo("Campaigns within budget", `${o.within_budget}/${s.campaigns}`, `${n.within_budget}/${s.campaigns}`)}
      ${duo("Worst overspend", pct(Math.max(0, o.worst_overspend)), pct(Math.max(0, n.worst_overspend)))}
      ${duo("Paid to bought views", "₹" + compact(o.paid_to_bought_views), "₹" + compact(n.paid_to_bought_views))}
      ${duo("Creators hitting a milestone", pct(o.completion), pct(n.completion), "Slightly lower overall, but now even across tiers (below).")}
    </div></div>`);

  const tiers = ["nano", "micro", "mid", "macro"].filter((t) => r.completion_by_tier.old[t]);
  const fairness = h(`<div class="panel"><h2 style="font:400 24px var(--serif);margin:0 0 4px">Fairness by tier</h2>
    <p class="note">Share of creators who hit at least one milestone. One round-number ladder is easy for big pages and out of reach for small ones; ours gives every tier the same odds.</p>
    <div class="bars">${tiers.map((t) => {
      const a = r.completion_by_tier.old[t].rate, b = r.completion_by_tier.new[t].rate;
      return `<div class="row"><div class="label">${t}</div><div class="pair">
        <div class="bar old" style="width:${a * 85}%"><span>${pct(a)}</span></div>
        <div class="bar ours" style="width:${b * 85}%"><span>${pct(b)}</span></div></div></div>`;
    }).join("")}</div></div>`);

  const maxUse = Math.max(2, ...r.campaigns.flatMap((c) => [c.old.budget_used, c.new.budget_used])) * 1.04;
  const xp = (v) => `${(v / maxUse) * 100}%`;
  const ticks = [0, 0.5, 1, 1.5, 2, 3, 4].filter((t) => t <= maxUse);
  const dots = h(`<div class="panel"><h2 style="font:400 24px var(--serif);margin:0 0 4px">Spend as a share of budget</h2>
    <p class="note">Every campaign with enough history. The dashed line is the budget.</p>
    <div class="dots">
      ${r.campaigns.map((c) => {
        const a = c.old.budget_used, b = c.new.budget_used, lo = Math.min(a, b), hi = Math.max(a, b);
        return `<div class="row"><div class="name"><b>${c.campaign.campaign_id}</b> <span>${c.campaign.category} · ${c.campaign.target_creator_tier}</span></div>
          <div class="track"><div class="limit" style="left:${xp(1)}"></div>
            <div class="link-line" style="left:${xp(lo)};width:calc(${xp(hi)} - ${xp(lo)})"></div>
            <div class="dot old" style="left:${xp(a)}" title="status quo ${pct(a)}"></div>
            <div class="dot ours" style="left:${xp(b)}" title="ours ${pct(b)}"></div></div></div>`;
      }).join("")}
      <div class="scale"><div></div><div class="ticks">${ticks.map((t) => `<span style="left:${xp(t)}">${pct(t)}</span>`).join("")}</div></div>
    </div></div>`);

  const cases = r.campaigns.filter((c) => c.showcase).map(caseCard).join("");
  const sens = `<div class="panel" style="padding:22px"><div class="table-wrap"><table>
      <thead><tr><th>Step chance</th><th class="num">Avg rungs</th><th class="num">Within budget</th><th class="num">Hit rate</th><th class="num">Views unpaid by rounding</th><th class="num">Extra views to next rung</th></tr></thead>
      <tbody>${r.sensitivity.map((x) => `<tr${x.step_chance === r.assumptions.step_chance ? ' style="font-weight:600"' : ""}>
        <td>${pct(x.step_chance)}${x.step_chance === r.assumptions.step_chance ? " (chosen)" : ""}</td><td class="num">${x.avg_rungs.toFixed(1)}</td>
        <td class="num">${x.within_budget}/${x.campaigns}</td><td class="num">${pct(x.completion)}</td>
        <td class="num">${pct(x.views_unpaid_by_rounding)}</td><td class="num">+${pct(x.median_gap_to_next_rung)}</td></tr>`).join("")}</tbody></table></div></div>`;
  const fraudNames = { label_only: "Ops label only (status quo)", detector_only: "Our detector only", label_or_detector: "Label or detector (what we use)" };
  const fraud = `<div class="panel" style="padding:22px"><div class="table-wrap"><table>
      <thead><tr><th>Signal</th><th class="num">Caught</th><th class="num">Missed</th><th class="num">Clean posts held</th><th class="num">Precision</th><th class="num">Recall</th></tr></thead>
      <tbody>${Object.entries(r.fraud).map(([k, v]) => `<tr><td>${fraudNames[k]}</td><td class="num">${v.caught}</td><td class="num">${v.missed}</td>
        <td class="num">${v.false_alarms}</td><td class="num">${pct(v.precision)}</td><td class="num">${pct(v.recall)}</td></tr>`).join("")}</tbody></table></div></div>`;

  out.replaceChildren(hero, h(`<div class="two-col">${fairness.outerHTML}${dots.outerHTML}</div>`),
    h(`<div class="section"><h2>Five campaigns up close</h2><p>Chosen to cover different categories, platforms and target tiers, from the most recent history.</p><div class="showcase">${cases}</div></div>`),
    h(`<div class="section"><h2>The one policy choice, stress-tested</h2><p>Each rung is placed so that half of the posts that reached the previous rung also reach it. Here is what 40% and 60% would have done instead. How creators <em>feel</em> about each cannot be measured from this data, so 50% is the neutral point between "too far to chase" and "too cheap to fake".</p>${sens}</div>`),
    h(`<div class="section"><h2>Fraud</h2><p>Scored against which posts the generator secretly boosted. Our detector learns its thresholds from clean posts; combined with the ops label it catches far more, at the cost of a few more clean posts held for review.</p>${fraud}</div>`));
}

function caseCard(row) {
  const c = row.campaign, o = row.old, n = row.new, p = row.proposal;
  const diff = n.spend - o.spend;
  const verdict = `${o.within_budget ? "Status quo stayed within budget" : `<span class="bad">Status quo overspent by ${pct(o.budget_used - 1)}</span>`}; ours
    ${n.within_budget ? `<span class="good">stayed within budget</span>` : `<span class="bad">overspent by ${pct(n.budget_used - 1)}</span>`}
    and paid <strong>${rupees(Math.abs(diff))} ${diff > 0 ? "more" : "less"}</strong>.
    ${n.posts_rejected ? ` It filled up early and turned away ${n.posts_rejected} late posts.` : ""}`;
  const line = (label, a, b) => `<tr><td>${label}</td><td class="num col-old">${a}</td><td class="num col-ours">${b}</td></tr>`;
  const main = p.ladders.filter((l) => l.tier === c.target_creator_tier).sort((a, b) => b.expected_posts - a.expected_posts)[0];
  return `<div class="panel case">
    <header><h3><b>${c.campaign_id}</b>${c.category} · ${c.platform}</h3>
      <span class="meta">target ${c.target_creator_tier} · budget ${rupees(c.total_budget)} · max ₹${c.brand_max_cpm}/1K views</span></header>
    <div class="grid">
      <div class="table-wrap"><table><thead><tr><th></th><th class="num">Status quo</th><th class="num">Ours</th></tr></thead><tbody>
        ${line("Paid out", rupees(o.spend), rupees(n.spend))}
        ${line("Share of budget", pct(o.budget_used), pct(n.budget_used))}
        ${line("Refund to brand", rupees(Math.max(0, o.refund)), rupees(Math.max(0, n.refund)))}
        ${line("Per 1,000 real views", "₹" + o.effective_cpm.toFixed(1), "₹" + n.effective_cpm.toFixed(1))}
        ${line("Hit a milestone", `${o.creators_hitting_milestone}/${o.creators}`, `${n.creators_hitting_milestone}/${n.creators}`)}
        ${line("Paid to bought views", rupees(o.paid_to_bought_views), rupees(n.paid_to_bought_views))}
      </tbody></table></div>
      <div style="display:grid;gap:12px;align-content:start">
        <div class="verdict">${verdict}</div>
        <div><div class="eyebrow">Status quo ladder, same for everyone</div>
          <div class="old-ladder">${row.old_ladder.map((r) => `${views(r.view_threshold)} → ${rupees(r.payout_amount)}`).join(" · ")}</div></div>
        ${main ? `<div><div class="eyebrow">Ours, ${main.tier} ${main.format.replace("_", " ")} (one of ${p.ladders.length})</div>
          <div class="old-ladder" style="color:var(--ours)">${main.rungs.map((r) => `${views(r.views)} → ${rupees(r.min_payout)}–${rupees(r.max_payout)}`).join(" · ")}</div></div>` : ""}
      </div>
    </div></div>`;
}

/* COMPARE ---------------------------------------------------------------------------------------- */
const BRIEF_EXAMPLE = [[10000, 500], [50000, 2000], [100000, 5000], [500000, 15000]];
let cmpCampaigns = {};

async function initCompare() {
  const [m, bt] = await Promise.all([meta(), api("/api/backtest")]);
  const ids = new Set(bt.campaigns.map((c) => c.campaign.campaign_id));
  m.campaigns.filter((c) => ids.has(c.campaign_id)).forEach((c) => (cmpCampaigns[c.campaign_id] = c));
  const sel = $("#cmp-campaign");
  Object.values(cmpCampaigns).reverse().forEach((c) =>
    sel.append(h(`<option value="${c.campaign_id}">${c.campaign_id} · ${c.category} · ${c.platform} · ${c.target_creator_tier} · ${rupees(c.total_budget)}</option>`)));
  sel.addEventListener("change", () => loadRows("status"));
  $("#cmp-add").addEventListener("click", () => addRow());
  $$("[data-preset]").forEach((b) => b.addEventListener("click", () => loadRows(b.dataset.preset)));
  $("#cmp-run").addEventListener("click", runCompare);
  loadRows("brief");
  runCompare();
}

function addRow(v = "", r = "") {
  const row = h(`<div class="editor-row"><input type="number" min="1" placeholder="10000" value="${v}"><input type="number" min="0" placeholder="500" value="${r}"><button type="button" aria-label="Remove rung">×</button></div>`);
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
    const cols = [["status_quo", "Status quo", "old"], ["manual", "Your ladder", "mine"], ["ours", "Ours", "ours"]];
    const rows = [
      ["Paid out", (x) => rupees(x.spend)],
      ["Share of budget", (x) => pct(x.budget_used)],
      ["Within budget", (x) => (x.within_budget ? "yes" : `<span class="bad">no</span>`)],
      ["Creators hitting a milestone", (x) => `${x.creators_hitting_milestone}/${x.creators} (${pct(x.completion)})`],
      ["Paid per 1,000 real views", (x) => "₹" + x.effective_cpm.toFixed(1)],
      ["Views unpaid by rounding down", (x) => pct(x.views_unpaid_by_rounding)],
      ["Paid to bought views", (x) => rupees(x.paid_to_bought_views)],
    ];
    const tierRows = ["nano", "micro", "mid", "macro"].filter((t) => r.ours.completion_by_tier[t]).map((t) =>
      `<tr><td>&nbsp;&nbsp;${t} hit rate</td>${cols.map(([k, , cls]) => `<td class="num ${cls}">${r[k].completion_by_tier[t] ? pct(r[k].completion_by_tier[t].rate) : "–"}</td>`).join("")}</tr>`).join("");
    out.replaceChildren(h(`<div class="panel" style="padding:22px">
      <div class="eyebrow">${r.campaign.campaign_id} · budget ${rupees(r.campaign.total_budget)} · brand max ₹${r.campaign.brand_max_cpm}/1K views</div>
      <div class="table-wrap"><table class="cmp-cols" style="margin-top:12px"><thead><tr><th></th>${cols.map(([, l, c]) => `<th class="num ${c}">${l}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(([label, f]) => `<tr><td>${label}</td>${cols.map(([k, , c]) => `<td class="num ${c}">${f(r[k])}</td>`).join("")}</tr>`).join("")}${tierRows}</tbody></table></div>
      <p class="note" style="margin-top:14px">Your ladder is applied the way ops applies one today: the same rungs for every creator, fixed rupee amounts, ops-flagged posts withheld, no budget stop.</p></div>`));
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
