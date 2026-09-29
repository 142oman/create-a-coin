/* Clearing front end. Plain JS, no build step. */
"use strict";

/* Hero background: WebGL ribbon field (ported from ThreeUI's MIT-licensed ribbon-field renderer). */
function initHeroBg() {
  const canvas = $(".hero-bg");
  const host = canvas && canvas.closest(".hero");
  if (!canvas || !host) return;
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) return;

  const vertexSrc = `
    attribute vec2 position;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;
  const fragmentSrc = `
    precision highp float;
    uniform vec2 resolution;
    uniform float time;
    uniform vec2 pointer;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float ribbon(vec2 uv, float offset, float width, float phase) {
      float y = 0.55 + 0.20 * sin((uv.x * 2.15) + phase) + 0.045 * sin((uv.x * 7.0) - phase * 0.7);
      float d = abs(uv.y - y - offset);
      return exp(-(d * d) / width);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec2 p = uv;
      p.x *= resolution.x / resolution.y;

      float t = time * 0.22;
      float drift = (pointer.x - 0.5) * 0.06;

      float rightFade = smoothstep(0.28, 0.72, uv.x);
      float centerDark = 1.0 - smoothstep(0.0, 0.88, distance(uv, vec2(0.18, 0.48)));

      float r1 = ribbon(vec2(uv.x + drift, uv.y), 0.03, 0.0065, t + 0.9);
      float r2 = ribbon(vec2(uv.x - drift * 0.7, uv.y), -0.23, 0.0085, t + 3.25);
      float r3 = ribbon(vec2(uv.x + drift * 0.4, uv.y), 0.25, 0.014, t + 1.85);

      float glow = r1 * 1.14 + r2 * 1.05 + r3 * 0.48;

      vec3 teal = vec3(0.17, 0.83, 0.75);
      vec3 cyan = vec3(0.22, 0.82, 0.96);
      vec3 indigo = vec3(0.39, 0.38, 0.92);
      vec3 purple = vec3(0.66, 0.33, 0.98);
      vec3 blue = vec3(0.23, 0.51, 0.96);

      vec3 col = vec3(0.0);
      col += cyan * r1 * 0.92;
      col += teal * r1 * 0.62;
      col += indigo * r3 * 0.42;
      col += blue * r2 * 0.66;
      col += purple * (r2 + r3) * 0.30;

      float bloom = exp(-pow(distance(uv, vec2(0.76, 0.40 + 0.035 * sin(t))), 2.0) / 0.050);
      bloom += exp(-pow(distance(uv, vec2(0.71, 0.75 + 0.025 * cos(t))), 2.0) / 0.030);
      col += vec3(0.42, 0.85, 1.0) * bloom * 0.34;

      vec2 grid = fract(gl_FragCoord.xy / 7.0) - 0.5;
      float dotShape = smoothstep(0.29, 0.11, length(grid));
      float noise = hash(floor(gl_FragCoord.xy / 7.0));
      float scan = 0.72 + 0.28 * sin((uv.x + uv.y) * 38.0 + time * 1.3);
      float dots = dotShape * (0.48 + 0.52 * noise) * scan;

      float micro = hash(gl_FragCoord.xy + time) * 0.035;
      float alpha = clamp((glow * 1.55 + bloom * 0.50) * dots * rightFade, 0.0, 1.0);
      alpha *= 1.0 - centerDark * 0.56;

      vec3 finalColor = col + micro * rightFade;
      float outAlpha = clamp(alpha * 1.55, 0.0, 1.0);

      gl_FragColor = vec4(finalColor, outAlpha);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
    return shader;
  }

  const vertex = compile(gl.VERTEX_SHADER, vertexSrc);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "program link failed");
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolutionLoc = gl.getUniformLocation(program, "resolution");
  const timeLoc = gl.getUniformLocation(program, "time");
  const pointerLoc = gl.getUniformLocation(program, "pointer");

  let mouseX = 0.72, mouseY = 0.42, targetX = 0.72, targetY = 0.42;
  let frame = 0, visible = true;
  const smoothing = 0.035, speed = 1;
  const startedAt = performance.now();

  const onPointerMove = (e) => {
    const bounds = host.getBoundingClientRect();
    targetX = (e.clientX - bounds.left) / Math.max(bounds.width, 1);
    targetY = 1 - (e.clientY - bounds.top) / Math.max(bounds.height, 1);
  };

  const resize = () => {
    const bounds = host.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
  };

  const render = (now) => {
    mouseX += (targetX - mouseX) * smoothing;
    mouseY += (targetY - mouseY) * smoothing;
    gl.uniform1f(timeLoc, (now - startedAt) * 0.001 * speed);
    gl.uniform2f(pointerLoc, mouseX, mouseY);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    frame = visible && !document.hidden ? requestAnimationFrame(render) : 0;
  };

  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry ? entry.isIntersecting : true;
    if (visible && !frame) frame = requestAnimationFrame(render);
    if (!visible && frame) { cancelAnimationFrame(frame); frame = 0; }
  });
  resizeObserver.observe(host);
  intersectionObserver.observe(host);
  host.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && visible && !frame) frame = requestAnimationFrame(render); });

  resize();
  frame = requestAnimationFrame(render);
}

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

/* Routing ----------------------------------------------------------------------------------------- */
const VIEWS = ["home", "advertiser", "creator", "compare"];   // "method" hidden for now; Backtest replaced by Benchmark (benchmark.html)
const inits = {};
function route() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + name));
  $$("[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  if (!inits[name]) { inits[name] = true; ({ home: initHome, advertiser: initAdvertiser, creator: initCreator, compare: initCompare, method: initMethod })[name](); }
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);

/* Charts ------------------------------------------------------------------------------------------ */
const oldNewLegend = `<div class="legend"><span><i style="background:var(--old)"></i>The old way</span><span><i style="background:var(--gold)"></i>Clearing</span></div>`;

/* HOME -------------------------------------------------------------------------------------------- */
async function initHome() {
  const on = (sel, cls, opts) => {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); } }), opts);
    $$(sel).forEach((el) => io.observe(el));
  };
  $$(".rv").forEach((el) => el.style.setProperty("--i", [...el.parentNode.children].indexOf(el)));
  on(".reveal", "in", { threshold: 0.15 });
  on(".rv", "in", { threshold: 0.25 });
  on(".beat", "on", { rootMargin: "0px 0px -30% 0px", threshold: 0.4 });
  initHeroViz();
  initHeroBg();
  initRungs();
}

function initRungs() {
  const fig = $("#rungs");
  if (!fig) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = false;
  new IntersectionObserver((e) => (visible = e[0].isIntersecting), { threshold: 0.3 }).observe(fig);
  const VERDICT = { bad: (r) => (+r.dataset.start < +r.dataset.reach ? "Too easy · reset" : "Too hard · reset"), ok: () => "About right" };
  const show = (r, step) => {
    const st = $(".st", r), pp = $(".pp", r), v = r.dataset.verdict;
    const set = (pos, text, dv, on) => {
      r.style.setProperty("--pos", pos + "%");
      r.style.setProperty("--reach", r.dataset.reach + "%");
      st.textContent = text; r.dataset.v = dv; pp.classList.toggle("on", on);
    };
    if (step === 0) { r.classList.remove("watch"); set(r.dataset.start, "Rung set", "", false); }
    else if (step === 1) { r.classList.add("watch"); st.textContent = "Watching real reach"; }
    else if (step === 2) { st.textContent = VERDICT[v](r); r.dataset.v = v === "ok" ? "ok" : "bad"; }
    else if (step === 3) { set(v === "ok" ? r.dataset.start : r.dataset.reach, v === "ok" ? "Holds" : "Reset", "ok", false); }
    else if (step === 4) { pp.textContent = r.dataset.price; pp.classList.add("on"); st.textContent = "Price found"; }
    else if (step === 6) { pp.classList.remove("on"); }
  };
  $$(".r", fig).forEach((r, i) => {
    if (still) { show(r, 0); show(r, 1); show(r, 3); show(r, 4); return; }
    let step = 0;
    show(r, 0);
    setTimeout(() => setInterval(() => { if (!visible) return; step = (step + 1) % 8; show(r, step); }, 1300), i * 450);
  });
}

function initHeroViz() {
  const c = $("#hero-viz");
  if (!c) return;
  const ctx = c.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CYCLE = 9;
  let W = 0, H = 0, visible = true;
  const size = () => {
    const dpr = window.devicePixelRatio || 1;
    W = c.clientWidth; H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  window.addEventListener("resize", size);
  new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(c);
  const noise = (x) => Math.sin(x * 1.7) * 0.5 + Math.sin(x * 3.1 + 1.3) * 0.3 + Math.sin(x * 7.7 + 0.4) * 0.2;
  const draw = (p) => {
    ctx.clearRect(0, 0, W, H);
    const mid = H * 0.5, head = Math.min(1, p / 0.62), fade = p > 0.86 ? 1 - (p - 0.86) / 0.14 : 1;
    ctx.globalAlpha = fade;
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = "rgba(243,242,238,.28)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    ctx.setLineDash([]);
    const n = 90, bw = W / n;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if (u > head) break;
      const h = (0.2 + Math.abs(noise(i * 0.9)) * 0.8) * H * 0.22 * (0.5 + u);
      ctx.fillStyle = i % 11 === 5 ? "#f2c14e" : "#2c2c2c";
      ctx.fillRect(i * bw + 1, H - h, Math.max(1, bw - 3), h);
    }
    ctx.beginPath();
    const steps = Math.floor(W / 3);
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      if (u > head) break;
      const y = mid + H * 0.36 * Math.exp(-3.4 * u) * noise(u * 16);
      s ? ctx.lineTo(u * W, y) : ctx.moveTo(u * W, y);
    }
    ctx.strokeStyle = "#f2c14e"; ctx.lineWidth = 2.2; ctx.stroke();
    if (head >= 1) {
      ctx.fillStyle = "#f2c14e";
      ctx.font = "500 11px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText("CLEARING PRICE", W - 4, mid - 10);
    }
    ctx.globalAlpha = 1;
  };
  if (still) return draw(0.75);
  const t0 = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    if (visible) draw((((now - t0) / 1000) % CYCLE) / CYCLE);
  };
  requestAnimationFrame(frame);
}

/* ADVERTISER ------------------------------------------------------------------------------------- */
const adv = { step: 0, categories: new Set(), formats: new Set(), budget: null, typical: null, cpm: null, days: 14, seed: rnd(), scenario: "normal", last: null };
function rnd() { return 1 + Math.floor(Math.random() * 999999); }
const FORMAT_CARDS = [["reel", "Instagram Reels"], ["carousel", "Instagram Carousels"], ["short", "YouTube Shorts"], ["long_form", "YouTube Long-form"]];

async function initAdvertiser() { await meta(); drawWizard(); }

function drawWizard() {
  const root = $("#adv");
  const m = META;
  const steps = [
    () => h(`<div class="q"><span class="label">1 of 5</span><h2>What are you promoting?</h2><p class="hint">Pick one or a few.</p>
      <div class="opts">${m.categories.map((c) => `<button class="opt" data-v="${c}" aria-pressed="${adv.categories.has(c)}">${esc(c)}</button>`).join("")}</div></div>`),
    () => h(`<div class="q"><span class="label">2 of 5</span><h2>Where should it run?</h2><p class="hint">Leave it on Anywhere and we'll take every format.</p>
      <div class="cards"><button class="card-opt" data-v="any" aria-pressed="${adv.formats.size === 0}"><b>Anywhere</b><span>Every format we know</span></button>
      ${FORMAT_CARDS.map(([f, l]) => `<button class="card-opt" data-v="${f}" aria-pressed="${adv.formats.has(f)}"><b>${l}</b><span>${f === "reel" || f === "short" ? "Short video" : f === "carousel" ? "Swipe posts" : "Longer video"}</span></button>`).join("")}</div></div>`),
    () => h(`<div class="q"><span class="label">3 of 5</span><h2>How much?</h2>
      <label class="money"><span>₹</span><input inputmode="numeric" data-budget value="${adv.budget ?? ""}" placeholder="${adv.typical ?? ""}"></label>
      <p class="hint">Total budget for this campaign. You won't be charged more than this; any unused amount is refunded.</p></div>`),
    () => h(`<div class="q"><span class="label">4 of 5</span><h2>What price per 1,000 views would you be happy with?</h2>
      <label class="money"><span>₹</span><input inputmode="numeric" data-cpm value="${adv.cpm ?? ""}" placeholder="e.g. 250"></label>
      <p class="hint">Tell us your ideal rate. We'll work to get you the best price the market allows, and you'll never pay more than your budget.</p></div>`),
    () => h(`<div class="q"><span class="label">5 of 5</span><h2>For how long?</h2><p class="hint">Starts today.</p>
      <div class="opts">${[[7, "1 week"], [14, "2 weeks"], [30, "1 month"]].map(([d, l]) => `<button class="opt" data-days="${d}" aria-pressed="${adv.days === d}">${l}</button>`).join("")}
      <label class="opt" style="display:inline-flex;gap:8px;align-items:center" aria-pressed="${![7, 14, 30].includes(adv.days)}">Custom <input type="number" min="3" max="90" data-custom value="${![7, 14, 30].includes(adv.days) ? adv.days : ""}" placeholder="days" style="width:64px;background:transparent;border:0;outline:0;color:inherit"></label></div></div>`),
    () => h(`<div class="q"><span class="label">Review</span><h2>Ready?</h2>
      <div class="panel review"><div class="sentence">${sentence()}</div>
      <div class="review-foot"><span class="more">Every creator size can join. We set their goals, the price and the fraud checks.</span></div></div></div>`),
  ];
  const valid = [adv.categories.size > 0, true, (adv.budget ?? adv.typical) > 0, adv.cpm > 0, adv.days >= 3, true][adv.step];
  const wiz = h(`<div class="wizard"><div class="progress">${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i <= adv.step ? "on" : ""}"></i>`).join("")}</div>
    <div data-q></div>
    <div class="wiz-nav"><button class="back" ${adv.step ? "" : "hidden"}>← Back</button>
      <button class="cta ${adv.step === 5 ? "gold" : ""}" data-next ${valid ? "" : "disabled"}>${adv.step === 5 ? "Publish campaign" : "Continue"}</button></div></div>`);
  $("[data-q]", wiz).replaceWith(steps[adv.step]());
  root.replaceChildren(wiz);
  const redraw = () => drawWizard();
  // Choices update in place: redrawing the whole question would replay its entrance animation.
  const canGo = () => [adv.categories.size > 0, true, (adv.budget ?? adv.typical) > 0, adv.cpm > 0, adv.days >= 3, true][adv.step];
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
      refresh();
    };
    if (adv.budget) bi.value = adv.budget.toLocaleString("en-IN");
  }
  const pi = $("[data-cpm]", wiz);
  if (pi) {
    pi.focus();
    pi.oninput = () => {
      const raw = pi.value.replace(/[^\d]/g, "");
      adv.cpm = raw ? +raw : null;
      pi.value = raw ? (+raw).toLocaleString("en-IN") : "";
      refresh();
    };
    if (adv.cpm) pi.value = adv.cpm.toLocaleString("en-IN");
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
  $(".back", wiz).onclick = () => { adv.step--; redraw(); };
  $("[data-next]", wiz).onclick = async () => {
    if (adv.step === 1) {
      const q = new URLSearchParams({ categories: [...adv.categories].join(","), formats: [...adv.formats].join(",") });
      try { const t = await api("/api/typical-budget?" + q); adv.typical = t.budget; } catch (_) { adv.typical = null; }
    }
    if (adv.step === 5) return publish("normal");
    adv.step++;
    redraw();
  };
}

function sentence() {
  const cats = [...adv.categories].map(cap).join(" + ");
  const where = adv.formats.size ? [...adv.formats].map((f) => FORMAT_CARDS.find((x) => x[0] === f)[1]).join(", ") : "anywhere";
  const days = adv.days === 7 ? "1 week" : adv.days === 14 ? "2 weeks" : adv.days === 30 ? "1 month" : `${adv.days} days`;
  return `<b>${esc(cats)}</b>, ${esc(where)}, up to <b>${inr(adv.budget ?? adv.typical)}</b> expecting <b>${inr(adv.cpm)}</b> per 1,000 views, for <b>${days}</b>.`;
}

async function publish(scenario) {
  adv.scenario = scenario;
  const root = $("#adv");
  window.scrollTo({ top: 0, behavior: "smooth" });
  root.replaceChildren(h(`<div class="loading">${scenario === "normal" ? "Publishing…" : "Replaying your campaign…"}</div>`));
  try {
    const run = await api("/api/publish", { categories: [...adv.categories], formats: [...adv.formats], budget: adv.budget ?? adv.typical, max_cpm: adv.cpm, days: adv.days, seed: adv.seed, scenario });
    adv.last = run;
    dashboard(root, run);
  } catch (e) {
    root.replaceChildren(h(`<div class="error">${esc(e.message)}</div>`));
  }
}

// A campaign plays as one continuous, calm flow of time: the current day's bar swells as it happens, the
// cost line is a smooth curve whose tip glides between days, and the chart keeps a gentle motion after.
const niceMax = (x) => {
  const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
};

// Bars: views each day. Line: cost per 1,000 views, from day one. The cost starts very high (a few views
// carry the whole budget) and falls a long way, so its axis is a square-root scale: zero stays at the
// bottom and every day is drawn, but the early spike doesn't flatten the rest. Time flows continuously.
function liveChart(timeline) {
  const W = 760, H = 300, L = 62, R = 66, T = 18, B = 32, ch = H - T - B;
  const n = timeline.length;
  const daily = timeline.map((d, i) => d.views - (i ? timeline[i - 1].views : 0));
  let last = null;
  const cost = timeline.map((d) => { if (d.views) last = (1000 * d.spend) / d.views; return last; });
  const first = cost.find((c) => c != null) ?? 0;
  const costs = cost.map((c) => (c == null ? first : c));
  const maxV = niceMax(Math.max(1, ...daily));
  const maxC = niceMax(Math.max(1, ...costs) * 1.03);
  const bw = (W - L - R) / n, base = H - B;
  const X = (i) => L + i * bw + bw / 2;
  const Y = (c) => base - Math.sqrt(Math.min(Math.max(c, 0), maxC) / maxC) * ch;
  const every = Math.max(1, Math.ceil(n / 8));
  const ticks = [0.5, 1];
  const html = `<svg class="chart live" viewBox="0 0 ${W} ${H}" role="img" aria-label="Views per day and cost per 1,000 views">
    <defs>
      <linearGradient id="barfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2c14e" stop-opacity=".30"/><stop offset="1" stop-color="#f2c14e" stop-opacity=".04"/></linearGradient>
      <linearGradient id="areafill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2c14e" stop-opacity=".2"/><stop offset="1" stop-color="#f2c14e" stop-opacity="0"/></linearGradient>
    </defs>
    ${ticks.map((k) => `<line class="grid faint" x1="${L}" x2="${W - R}" y1="${base - k * ch}" y2="${base - k * ch}"/>
      <text class="axis" x="${L - 10}" y="${base - k * ch + 3.5}" text-anchor="end">${vw(maxV * k)}</text>
      <text class="axis gold" x="${W - R + 10}" y="${base - k * ch + 3.5}">${cpm(maxC * k * k)}</text>`).join("")}
    <line class="grid" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>
    ${daily.map((_, i) => `<path class="lbar" data-bar="${i}"/>`).join("")}
    <clipPath id="reveal"><rect data-reveal x="0" y="0" width="0" height="${H}"/></clipPath>
    <g clip-path="url(#reveal)"><path class="area" data-area/><path class="line" data-line pathLength="1000"/><path class="line flow" data-flow pathLength="1000"/></g>
    <circle class="ring" data-ring r="5"/><circle class="head" data-head r="4.5"/>
    ${timeline.map((_, i) => (i % every === 0 ? `<text class="axis" x="${X(i)}" y="${H - 10}" text-anchor="middle">${i + 1}</text>` : "")).join("")}
  </svg>
  <div class="legend"><span><i style="background:#8a6f2c"></i>Views per day</span><span><i style="background:var(--gold)"></i>Cost per 1,000 views</span></div>`;

  // A bar with a rounded, softly rising top: a wave that swells rather than a hard rectangle.
  const barPath = (i, h) => {
    if (h < 0.5) return "";
    const x0 = L + i * bw + 2, x1 = L + (i + 1) * bw - 2, y1 = base - h, r = Math.min(7, (x1 - x0) / 2, h);
    return `M${x0},${base}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x1 - r}Q${x1},${y1} ${x1},${y1 + r}V${base}Z`;
  };
  // One smooth curve through every day's cost, computed once. Monotone cubic (Hermite), so it never
  // overshoots the axis or the top between two days.
  const pts = [[L, Y(costs[0])], ...costs.map((c, i) => [X(i), Y(c)]), [L + n * bw, Y(costs[n - 1])]];
  const m = pts.length, dx = [], sl = [], t = [];
  for (let i = 0; i < m - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; sl[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
  t[0] = sl[0]; t[m - 1] = sl[m - 2];
  for (let i = 1; i < m - 1; i++) t[i] = sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2;
  for (let i = 0; i < m - 1; i++) {
    if (sl[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / sl[i], b = t[i + 1] / sl[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * sl[i]; t[i + 1] = k * b * sl[i]; }
  }
  let full = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < m - 1; i++) {
    full += `C${(pts[i][0] + dx[i] / 3).toFixed(1)},${(pts[i][1] + (t[i] * dx[i]) / 3).toFixed(1)} ${(pts[i + 1][0] - dx[i] / 3).toFixed(1)},${(pts[i + 1][1] - (t[i + 1] * dx[i]) / 3).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  const areaD = `${full}L${pts[m - 1][0].toFixed(1)},${base}L${L},${base}Z`;
  // The curve's height at any x (the Bézier's x is linear in its parameter, so this is exact).
  const yAt = (x) => {
    let i = 0;
    while (i < m - 2 && x > pts[i + 1][0]) i++;
    const u = Math.min(1, Math.max(0, (x - pts[i][0]) / dx[i])), u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * pts[i][1] + (u3 - 2 * u2 + u) * dx[i] * t[i] + (-2 * u3 + 3 * u2) * pts[i + 1][1] + (u3 - u2) * dx[i] * t[i + 1];
  };
  const painted = new WeakSet();
  return {
    html,
    // p: days completed so far, fractional (0 to n). Everything moves at a constant rate: no easing, so
    // nothing slows or stops at a day boundary. now: for the gentle idle motion.
    update(root, p, now) {
      if (!painted.has(root)) {   // the curve is fixed, so its paths are written once
        painted.add(root);
        $("[data-line]", root).setAttribute("d", full);
        $("[data-flow]", root).setAttribute("d", full);
        $("[data-area]", root).setAttribute("d", areaD);
      }
      const done = Math.floor(p), frac = p - done;
      $$("[data-bar]", root).forEach((el) => {
        const i = +el.dataset.bar;
        const grown = i < done ? 1 : i === done && done < n ? frac : 0;
        const breathe = grown ? 1 + 0.014 * Math.sin(now / 900 + i * 0.7) : 1;
        el.setAttribute("d", barPath(i, (daily[i] / maxV) * ch * grown * breathe));
        el.classList.toggle("growing", i === done && done < n);
      });
      const hx = L + Math.min(Math.max(p, 0), n) * bw, hy = yAt(hx);
      const clip = $("[data-reveal]", root);
      if (clip) clip.setAttribute("width", hx.toFixed(1));
      [$("[data-head]", root), $("[data-ring]", root)].forEach((c) => { c.style.opacity = 1; c.setAttribute("cx", hx.toFixed(1)); c.setAttribute("cy", hy.toFixed(1)); });
    },
  };
}

// State between two days, so the tiles move steadily instead of jumping.
function lerpDay(tl, p) {
  const zero = { views: 0, spend: 0, creators: 0, posts: 0 };
  const i = Math.min(Math.floor(p), tl.length), f = p - i;
  if (i >= tl.length) return tl[tl.length - 1];
  const a = i ? tl[i - 1] : zero, b = tl[i];
  const m = (k) => a[k] + (b[k] - a[k]) * f;
  return { views: m("views"), spend: m("spend"), creators: Math.round(m("creators")), posts: Math.round(m("posts")) };
}

// The "what you'd owe if it ended today" estimate swings while only a few posts exist. For the live view it is
// eased over neighbouring days, and the last day is always the real final figure.
function easedSpend(timeline) {
  const raw = timeline.map((d) => d.spend);
  const once = (a) => a.map((v, i) => (a[Math.max(0, i - 1)] + 2 * v + a[Math.min(a.length - 1, i + 1)]) / 4);
  const out = once(once(raw));
  out[out.length - 1] = raw[raw.length - 1];
  return timeline.map((d, i) => ({ ...d, spend: out[i] }));
}

function dashboard(root, run) {
  const tl = easedSpend(run.ours.timeline), n = tl.length;
  const chart = liveChart(tl);
  const d = h(`<div class="dash">
    <div class="dash-head"><div style="display:grid;gap:10px"><span class="label">${run.scenario === "normal" ? "Your campaign" : esc(run.scenario_label)}</span><h2>${sentence()}</h2></div>
      <div style="display:grid;gap:10px;justify-items:end"><span class="chip live" data-chip>Live</span><span class="day-count" data-day></span></div></div>
    <div class="tiles">
      <div class="panel tile"><span class="label">Views</span><b data-t="views">0</b></div>
      <div class="panel tile"><span class="label">Estimated cost</span><b data-t="spend">₹0</b></div>
      <div class="panel tile"><span class="label">Est. per 1,000</span><b data-t="cpm">–</b></div>
      <div class="panel tile"><span class="label">Creators live</span><b data-t="creators">0</b></div>
      <div class="panel tile"><span class="label">Posts</span><b data-t="posts">0</b></div>
    </div>
    <div class="panel chart-panel"><div class="player-bar" style="margin-bottom:12px"><button data-pause>Pause</button><button data-fast>2×</button><button data-skip>Skip to results</button></div><div data-chart>${chart.html}</div></div>
    <div data-report></div></div>`);
  root.replaceChildren(d);
  const box = $("[data-chart]", d);
  const DURATION = 32;   // seconds for a whole campaign: slow enough to read, never twitchy
  let p = 0, speed = 1, paused = false, finished = false, prev = performance.now(), tileAt = 0, shownCpm = null;
  const set = (k, v) => ($(`[data-t="${k}"]`, d).textContent = v);
  // The tiles tick a few times a second and ease toward the true figure; the chart itself moves every frame.
  const tiles = (now) => {
    const t = lerpDay(tl, p);
    set("views", vw(t.views)); set("spend", inr(t.spend)); set("creators", t.creators); set("posts", t.posts);
    const settled = finished || p >= 1;
    if (!settled || !t.views) { set("cpm", "Settling…"); shownCpm = null; }
    else {
      const target = (1000 * t.spend) / t.views;
      shownCpm = shownCpm == null || finished ? target : shownCpm + (target - shownCpm) * 0.3;
      set("cpm", cpm(shownCpm));
    }
    $("[data-day]", d).textContent = `Day ${finished ? n : Math.min(n, Math.floor(p) + 1)} of ${n}`;
    tileAt = now;
  };
  const paint = (now, force) => { if (force || now - tileAt > 400) tiles(now); chart.update(box, p, now); };
  const finish = () => {
    if (finished) return;
    finished = true; p = n; paint(performance.now(), true);
    const chip = $("[data-chip]", d);
    chip.className = "chip done"; chip.textContent = `Completed ${run.settles_on}`;
    $(".player-bar", d)?.remove();
    report($("[data-report]", d), run);
  };
  const loop = (now) => {
    if (!d.isConnected) return;   // a new campaign replaced this one
    requestAnimationFrame(loop);
    if (document.hidden) { prev = now; return; }
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    if (!paused && !finished) { p += (dt * n * speed) / DURATION; if (p >= n) return finish(); }
    paint(now);
  };
  $("[data-pause]", d).onclick = (e) => { paused = !paused; e.target.textContent = paused ? "Play" : "Pause"; };
  $("[data-fast]", d).onclick = (e) => { speed = speed === 1 ? 2 : 1; e.target.classList.toggle("on", speed === 2); };
  $("[data-skip]", d).onclick = finish;
  paint(prev, true);
  requestAnimationFrame(loop);
}

// Each replay: what goes wrong, why it matters, and a teaser (not an explanation) of what we do.
const REPLAYS = [
  ["crowded", "Too many creators", "More creators join than you planned for.", "With a rate fixed in advance, every extra creator is paid on top, so spend can run past your budget.", "More creators, lower prices. Watch every view get cheaper."],
  ["thin", "Too few views", "Only a few creators join, or their posts get few views.", "A large budget split between very few creators would pay them far more than their reach is worth.", "Few takers. We negotiate the price down and return the rest. Watch it settle."],
  ["fraud", "A fraud wave", "Creators buy fake views to look better.", "Fake views make a creator's numbers look better than they are, and every one of them is a view you could end up paying for.", "Fakes come in, and nothing is paid until they're checked. Watch what happens to your budget."],
  ["late_viral", "Viral on the last day", "One post explodes on the final day.", "With rates fixed in advance, a viral post is paid its full rate on top of everyone else.", "A last-minute spike, and your budget holds. Watch it happen."],
];

const fit = (root) => {
  const run = () => root.querySelectorAll("[data-fit]").forEach((el) => {
    el.style.fontSize = "";
    let px = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && px > 13) { px -= 1; el.style.fontSize = px + "px"; }
  });
  run();
  new ResizeObserver(run).observe(root);
};

function report(el, run) {
  const r = run.report;
  const budget = r.paid + r.money_back;
  const n = (x) => Math.round(x).toLocaleString("en-IN");
  const stat = (label, value, note, cls = "") => `<div class="stat ${cls}"><span class="label">${label}</span><b data-fit>${value}</b>${note ? `<p class="note">${note}</p>` : ""}</div>`;

  // Cost per 1,000 views, set against what the advertiser expected and what the old way would have paid.
  const expected = adv.cpm;
  const notes = [];
  if (expected && r.cpm != null) {
    notes.push(r.cpm < expected
      ? `<em>${Math.round((100 * (expected - r.cpm)) / expected)}% less</em> than the ${cpm(expected)} you expected.`
      : `You expected ${cpm(expected)}.`);
  }
  if (r.old_cpm && r.cpm && r.old_cpm > r.cpm) {
    const x = r.old_cpm / r.cpm;
    notes.push(`The old way would have cost <s>${cpm(r.old_cpm)}</s>${x >= 1.5 ? `, <em>${x >= 10 ? Math.round(x).toLocaleString("en-IN") : x.toFixed(1)}× more</em>` : ""}.`);
  }
  const headline = [
    stat("Real views", vw(r.genuine_views), "", "lead"),
    stat("Cost per 1,000 views", cpm(r.cpm), notes.join("<br>") || "What you paid for every 1,000 real views."),
    stat("Spent", inrShort(r.paid), `Paid to creators, out of your ${inrShort(budget)} budget.`),
    stat("Money back", inrShort(r.money_back), r.money_back > 1 ? "Budget that wasn't needed, returned to you." : "Your whole budget was put to work."),
  ];

  // What happened: short lines, only for what actually occurred.
  const shrunk = new Set((run.ours.events || []).filter((e) => e.kind === "fair_reach").map((e) => e.group.join("|"))).size;
  const eg = (run.ours.posts || []).filter((p) => !p.fraud && p.rung_coins > 0 && p.views > p.rung_coins * 1.25).sort((a, b) => a.views - b.views);
  const ex = eg[Math.floor(eg.length * 0.85)];   // a sizeable post, not a tiny one
  const rungText = ex
    ? `A post is paid up to the highest milestone it reached. For example, one post got ${n(ex.views)} views but only reached the ${n(ex.rung_coins)} milestone, so it was paid for ${n(ex.rung_coins)}. The rest of its budget came back to you.`
    : "A post is paid up to the highest milestone it reached. The views it got beyond that milestone aren't paid for, so that part of its budget came back to you.";
  const happened = [
    r.money_back_liquidity > 1 && [inrShort(r.money_back_liquidity), "Few views came in for your budget, so we negotiated a lower price per view instead of overpaying a few creators."],
    r.money_back_rungs > 1 && [inrShort(r.money_back_rungs), rungText],
    r.cards.some((c) => c.kind === "cheaper") && ["", "Lots of creators joined, so the same budget was shared across more views and each view cost you less.", "Cheaper views"],
    shrunk > 0 && ["", "Views ran cold for everyone, so we lowered the milestones. Creators who did well still got paid.", "Lower milestones"],
  ].filter(Boolean);
  const happenedBlock = happened.length
    ? `<span class="label">What happened</span><div class="happened">${happened.map(([a, t, tag]) => `<div><b data-fit class="${a ? "" : "tg"}">${a || tag}</b><span>${t}</span></div>`).join("")}</div>`
    : "";

  const facts = [
    ["Creators", n(r.creators), "posted for you"],
    ["Posts", n(r.posts), "published"],
    r.fraud_posts ? ["Fakes kept out", inrShort(r.fraud_blocked), "of bought views, never charged"] : null,
  ].filter(Boolean);

  const compare = `<span class="label">Old way vs Clearing</span>
    <p class="intro">The same campaign, paid the old way: a fixed rate ladder set in advance.</p>
    <div class="compare">
      <div class="ch"><span></span><span class="label">Old way</span><span class="label gold">Clearing</span></div>
      <div><span>Cost per 1,000 views</span><b class="bad" data-fit>${cpm(r.old_cpm)}</b><b data-fit>${cpm(r.cpm)}</b></div>
      <div><span>Against your ${inrShort(budget)} budget</span><b class="bad" data-fit>${r.old_over_budget > 1 ? `${inrShort(r.old_over_budget)} over` : "Within budget"}</b><b data-fit>Never over</b></div>
    </div>`;

  const node = h(`<div class="report">
    <span class="label gold">Results</span>
    <div class="hero-line">You spent ${inrShort(r.paid)} and got <em>${vw(r.genuine_views)} real views</em>.</div>
    <p class="hero-sub">${r.money_back > 1 ? `The other ${inrShort(r.money_back)} of your ${inrShort(budget)} budget came back to you.` : `That's your whole ${inrShort(budget)} budget, put to work.`}</p>
    <div class="stats s4">${headline.join("")}</div>
    ${happenedBlock}
    <div class="facts">${facts.map(([l, v, x]) => `<div><span class="label">${l}</span><b data-fit>${v}</b><span>${x}</span></div>`).join("")}</div>
    ${compare}
    <span class="label">See how we'd handle…</span>
    <p class="intro">Every problem below is handled by one idea: the price is set after the campaign, from your budget and the real views, so it can't run past what you set aside. Pick one to replay this campaign with that problem.</p>
    <div class="replays">${REPLAYS.map(([k, l, what, why, tease]) => `<button class="replay ${run.scenario === k ? "now" : ""}" data-w="${k}">
      <h3>${l}</h3><p class="what">${what}</p>
      <div><span class="label">Why it matters</span><p>${why}</p></div>
      <div class="tease"><span class="label gold">What we do</span><p>${tease}</p></div>
      <span class="go">${run.scenario === k ? "Showing now" : "Watch it happen →"}</span></button>`).join("")}</div>
    <button class="cta again" data-new>Start another campaign</button>
  </div>`);
  el.replaceChildren(node);
  fit(node);
  $$("[data-w]", node).forEach((b) => (b.onclick = () => publish(b.dataset.w)));
  $("[data-new]", node).onclick = () => { adv.step = 0; adv.seed = rnd(); drawWizard(); window.scrollTo({ top: 0 }); };
  node.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* CREATOR ---------------------------------------------------------------------------------------- */
const cre = { seed: rnd() % 1000, profile: null, cards: null, card: null, run: null };
const AV = ["#f2c14e", "#7bd88f", "#8ab4ff", "#ff9e7a", "#d59bff", "#6ee7e0"];
const avatarUrl = (p) => `https://api.dicebear.com/10.x/lorelei/svg?seed=${encodeURIComponent(p.handle)}`;

async function initCreator() { drawProfiles(); }

async function drawProfiles() {
  const root = $("#cre");
  root.replaceChildren(h(`<div class="loading">Finding creators…</div>`));
  const profiles = await api(`/api/creator/profiles?seed=${cre.seed}`);
  const node = h(`<div class="wizard" style="max-width:1000px"><div class="q"><span class="label">Creator</span><h2>Who are you?</h2><p class="hint">Pick a creator to play as.</p>
    <div class="profile-grid">${profiles.map((p, i) => `<button class="profile" data-i="${i}"><span class="avatar" style="background:${AV[i % AV.length]}"><img src="${avatarUrl(p)}" alt="" loading="lazy"></span><b class="handle">${esc(p.handle)}</b><span class="plat">${PLAT[p.platform]}</span>
      <span class="pstats"><span><b>${vw(p.followers)}</b><small>Followers</small></span><span><b>${esc(cap(String(p.tier)))}</b><small>Tier</small></span></span></button>`).join("")}</div>
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
      <span class="camp-art"><img src="${waveUrl(c)}" alt="" loading="lazy"></span>
      ${c.cold ? `<span class="tag">New kind of campaign</span>` : `<span class="label">${PLAT[c.platform]}</span>`}
      <h3>${esc(c.brand)}</h3>
      <div class="pool"><b>${inrShort(c.budget)}</b><small>Coin pool</small></div>
      <div class="cstats"><span><b>${c.days} days</b><small>Runs</small></span><span><b>${c.formats.map((f) => FMT[f]).join(", ")}</b><small>Formats</small></span></div>
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
// Display only: round a milestone to a clean 1 / 5 / 10 x 10^k so the ladder reads at a glance.
// Payouts and goal detection always use the real values.
function niceViews(r, floor = 0) {
  const step = Math.max(1, 5 * Math.pow(10, Math.floor(Math.log10(Math.max(1, r))) - 2));
  return Math.max(Math.round(r / step) * step, floor + step);
}
function niceLadder(rungs) {
  const out = [];
  rungs.forEach((r) => out.push(niceViews(r, out[out.length - 1] || 0)));
  return out;
}
// The ladder, left to right: reach a milestone, get its coins.
// Display only: a payout rounded to a tidy rupee amount (3 significant digits, ending in 0 or 5).
const niceRupees = (x) => { const step = Math.max(1, 5 * Math.pow(10, Math.floor(Math.log10(Math.max(1, x))) - 2)); return Math.round(x / step) * step; };
// opts: carousel (big snap cards with arrows), est (payouts are estimates), reached (rung index that was reached,
// for a finished post; earlier rungs show as passed), exact (show the exact rupees instead of tidy ones).
const rungCards = (rungs, price, opts = {}) => {
  const { carousel = false, est = true, reached = 0, exact = false } = opts;
  const shown = niceLadder(rungs), rs = (x) => (est ? "~" : "") + inr(exact ? x : niceRupees(x));
  const card = (i, top) => {
    const real = rungs[Math.min(i, rungs.length - 1)], v = top ? shown[shown.length - 1] : shown[i];
    const cls = top ? (reached >= rungs.length ? "hit" : "") : reached > i + 1 ? "passed" : reached === i + 1 ? "hit" : "";
    return `<div class="rung ${top ? "beyond" : ""} ${cls}" data-g="${i}">
      ${carousel ? `<span class="step">${top ? "& beyond" : `Rung ${i + 1}`}</span>` : ""}
      <div class="rside"><span class="rl">Reach</span><b class="rnum">${vw(v)}${top ? "+" : ""}</b><span class="ru">views</span></div>
      <span class="rarrow">${carousel ? "↓" : "→"}</span>
      <div class="rside"><span class="rl">Get</span><b class="rnum gold-t" data-coins="${real}">${rs(real * price)}</b><span class="ru">${top ? "top payout, no cap on views" : est ? "estimated payout" : "payout"}</span></div></div>`;
  };
  const track = `<div class="ladder ${carousel ? "car" : ""}">${shown.map((_, i) => card(i, false)).join("")}</div>`;
  return carousel ? `<div class="carousel"><button class="car-btn" data-car="-1" aria-label="Previous">‹</button>${track}<button class="car-btn" data-car="1" aria-label="Next">›</button></div>` : track;
};
function wireCarousel(root, focus = null) {
  const track = $(".ladder.car", root);
  if (!track) return;
  $$("[data-car]", root).forEach((b) => (b.onclick = () => track.scrollBy({ left: +b.dataset.car * 260, behavior: "smooth" })));
  if (focus !== null) { const c = $(`[data-g="${focus}"]`, track); if (c) track.scrollTo({ left: c.offsetLeft - track.clientWidth / 2 + c.offsetWidth / 2, behavior: "smooth" }); }
}
const waveUrl = (c) => `https://api.dicebear.com/10.x/waves/svg?seed=${encodeURIComponent(c.brand)}`;
const avatar = (p, size = 44) => `<span class="avatar sm" style="width:${size}px;height:${size}px"><img src="${avatarUrl(p)}" alt=""></span>`;
function mySeg(run) { const p = run.me.posts[0]; return p ? [p.category, p.platform, p.tier, p.format].join("|") : null; }

function goals() {
  const run = cre.run, root = $("#cre");
  const seg = mySeg(run);
  const cold = run.ours.cold_segments.includes(seg);
  const base = run.ours.base_rungs[seg] || [];
  const node = h(`<div class="wizard" style="max-width:820px"><div class="q" style="text-align:center;justify-items:center">${avatar(cre.profile, 88)}<span class="label">${esc(cre.profile.handle)} · ${esc(run.cold_category ? "a brand-new kind of campaign" : cap(run.categories[0]))}</span>
    <h2>Your goals</h2>
    ${cold ? "" : rungCards(base, run.ours.price, { carousel: true })}
    <div class="wiz-nav"><button class="back" data-back>← Other campaigns</button><button class="cta gold" data-live>Post and go live</button></div></div></div>`);
  root.replaceChildren(node);
  $("[data-back]", node).onclick = () => pickProfile(cre.profile);
  $("[data-live]", node).onclick = live;
  wireCarousel(node);
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
  const everyone = run.posts.map((p) => ({ day: p.day, c: cum(p) }));   // every creator in the campaign, for the campaign total
  const campaignViews = (t) => everyone.reduce((s, q) => { const age = t - q.day; if (age <= 0) return s; const k = Math.min(q.c.length - 1, Math.floor(age)), f = Math.min(1, age - k); return s + q.c[k] + (q.c[Math.min(q.c.length - 1, k + 1)] - q.c[k]) * f; }, 0);
  // Views a post has at a fractional campaign time t (in days), smoothly between whole days.
  const viewsAt = (i, t) => {
    const p = posts[i], c = cums[i], age = t - p.day;
    if (age <= 0) return 0;
    const k = Math.min(c.length - 1, Math.floor(age)), f = Math.min(1, age - k);
    return c[k] + (c[Math.min(c.length - 1, k + 1)] - c[k]) * f;
  };
  const node = h(`<div class="dash"><div class="dash-head"><div class="who">${avatar(cre.profile, 64)}<div style="display:grid;gap:8px"><span class="label">${esc(cre.profile.handle)} · ${esc(cre.card.brand)}</span><h2>Your post is live</h2></div></div>
    <div style="display:grid;gap:10px;justify-items:end"><span class="chip live">Live</span><span class="day-count" data-day></span></div></div>
    <div class="live-grid">
      <div class="panel"><span class="label">Your ladder</span>
        <div class="meter smooth" data-meter><span></span></div><div data-goals style="width:100%"></div></div>
      <div class="panel pay"><span class="label gold">Your estimated payout</span>
        <div class="worth"><b data-worth>~₹0</b></div>
        <div class="lock" data-lock></div>
        <div class="next"><div class="next-h"><span data-nexttitle></span></div><div class="mini"><span data-nextbar></span></div></div>
        <div class="kpis">
          <div><small>Your views</small><b data-myviews>0</b></div>
          <div><small>Rung</small><b data-rung>0 / 0</b></div>
          <div><small>Campaign</small><b data-views>0</b></div>
          <div><small>To next rung</small><b data-togo>-</b></div>
        </div>
        <div data-toasts style="display:grid;gap:8px;width:100%"></div>
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
      goalsEl.innerHTML = "";
      return;
    }
    rungs.forEach((r) => { const m = document.createElement("i"); m.style.left = `${(r / top) * 100}%`; meter.append(m); });
    goalsEl.innerHTML = rungCards(rungs, tl[Math.max(0, lastDay)].price, { carousel: true });
    wireCarousel(goalsEl);
    hit = 0;
    if (before && rungs[0] < before[0]) toast(`Goals lowered: ${niceLadder(rungs).map(vw).join(" · ")} views`);
  };

  const frame = (t) => {
    const day = Math.max(0, Math.min(n - 1, Math.floor(t)));
    const myViews = post ? viewsAt(0, t) : 0;
    const all = posts.reduce((a, _, i) => a + viewsAt(i, t), 0);
    if (day !== lastDay) {
      lastDay = day;
      const next = rungsAt(run, seg, group, day);
      if (JSON.stringify(next) !== JSON.stringify(rungs)) buildGoals(next, myViews);
      $("[data-day]", node).textContent = `Day ${day + 1} of ${n}`;
      $$("[data-coins]", node).forEach((b) => (b.textContent = "~" + inr(niceRupees(+b.dataset.coins * tl[day].price))));
    }
    $("[data-views]", node).textContent = vw(campaignViews(t));
    bar.style.width = `${Math.min(100, (myViews / top) * 100)}%`;
    const reached = rungs ? rungs.filter((r) => myViews >= r).length : 0;
    $$("i", meter).forEach((m, i) => m.classList.toggle("hit", i < reached));
    if (reached > hit) {
      for (let i = hit; i < reached; i++) {
        const g = $(`[data-g="${i}"]`, goalsEl);
        if (g) g.classList.add("hit", "pop");
      }
      toast(`Rung ${reached} reached!`);
      hit = reached;
      wireCarousel(goalsEl, Math.min(reached, rungs.length - 1));
    }
    const coins = rungs ? posts.reduce((a, _, i) => a + (rungs.filter((r) => viewsAt(i, t) >= r).pop() || 0), 0) : 0;
    const price = tl[day].price, now = coins * price;
    $("[data-worth]", node).textContent = "~" + inr(niceRupees(now));
    $("[data-myviews]", node).textContent = vw(myViews);
    $("[data-rung]", node).textContent = rungs ? `${reached} / ${rungs.length}` : "unlocks soon";
    $("[data-lock]", node).innerHTML = reached ? `<span class="chip done">Rung ${reached} locked in</span>` : `<span class="chip">Reach rung 1 to start earning</span>`;
    const nx = rungs && reached < rungs.length ? rungs[reached] : null;
    const prev = reached ? rungs[reached - 1] : 0;
    $("[data-nexttitle]", node).textContent = nx ? `Next: rung ${reached + 1} at ${vw(nx)} views` : rungs ? "Top rung reached. Views beyond it keep this payout" : "";
    $("[data-nextbar]", node).style.width = nx ? `${Math.min(100, Math.max(0, ((myViews - prev) / (nx - prev)) * 100))}%` : "100%";
    $("[data-togo]", node).textContent = nx ? vw(Math.max(0, Math.ceil(nx - myViews))) : "Done";
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
    return `<div class="goal ${k ? "hit" : ""}"><span class="n">${i + 1}</span><div><span class="label">Post ${i + 1}</span><br><b>${vw(p.views)} views</b><br><span>${p.fraud ? "Bought views were found. Not paid." : k ? `Reached rung ${k} (${vw(p.rungs[k - 1])} views)` : "Didn't reach the first rung"}</span></div><b class="num">${inr(p.paid)}</b></div>`;
  }).join("");
  // Multiple posts can each land on a different rung of the same ladder, so the carousel can't highlight
  // a single "reached" rung for the whole campaign — it just shows what each rung was worth.
  const mine = me.posts.find((p) => p.rungs) || me.posts[0];
  const ladderFinal = mine && mine.rungs ? rungCards(mine.rungs, price, { carousel: true, est: false, exact: true }) : "";
  const node = h(`<div class="wizard" style="max-width:900px"><div class="q" style="text-align:center;justify-items:center">${avatar(cre.profile, 88)}<span class="label">${esc(cre.profile.handle)} · paid ${esc(run.settles_on)}</span>
    <div class="paid-hero" data-paid>₹0</div>
    ${ladderFinal}
    <div class="goals">${lines}</div>
    <div class="whatif"><button class="cta gold" data-again>Join another campaign</button><button class="cta ghost" data-other>Be someone else</button></div></div></div>`);
  root.replaceChildren(node);
  tween($("[data-paid]", node), me.paid, inr, 1400);
  wireCarousel(node);
  $("[data-again]", node).onclick = () => { cre.seed = rnd() % 1000; pickProfile(cre.profile); };
  $("[data-other]", node).onclick = () => { cre.seed = rnd() % 1000; drawProfiles(); };
}

/* COMPARE ---------------------------------------------------------------------------------------- */
const cmp = { budget: null, cpm: null, old: null };
const MARKET_LABELS = { smooth: "Smooth", abundant: "Abundant", scarce: "Scarce", viral_one: "1 viral surge", viral_many: "Many surges" };

async function initCompare() { await meta(); drawCompare(); }

function drawCompare() {
  const root = $("#cmp");
  const node = h(`<div>
    <div class="page-head"><span class="label">Compare</span><h1 class="h2">Try both. Then look at the bill.</h1>
      <p class="lede">Set up the same campaign two ways, then watch both run through 300 simulated draws of it — 60 apiece across five market conditions, smooth to viral — so the result is a real distribution, not one lucky roll. Same engine as <a href="benchmark.html">Benchmark</a>, scoped to your own numbers.</p></div>
    <section class="cmp-step"><span class="label gold">With Clearing</span>
      <div class="panel ours-card">
        <div class="field-row">
          <div class="field">
            <span class="label"><i class="fico">💰</i>Budget <i class="req">required</i></span>
            <div class="field-money"><span>₹</span><input data-b inputmode="numeric" placeholder="5,00,000" value="${cmp.budget ? cmp.budget.toLocaleString("en-IN") : ""}"></div>
            <div class="opts chips" data-bchips>${[100000, 500000, 1000000, 2500000, 5000000].map((v) => `<button type="button" class="opt sm" data-v="${v}">${inrShort(v)}</button>`).join("")}</div>
          </div>
          <div class="field">
            <span class="label"><i class="fico">📈</i>Fair CPI, per 1,000 views <i class="req">required</i></span>
            <div class="field-money"><span>₹</span><input data-cpm inputmode="numeric" placeholder="40" value="${cmp.cpm ? cmp.cpm.toLocaleString("en-IN") : ""}"></div>
            <div class="opts chips" data-cchips>${[15, 25, 35, 50, 75].map((v) => `<button type="button" class="opt sm" data-v="${v}">₹${v}</button>`).join("")}</div>
          </div>
        </div>
        <div data-thats></div>
      </div></section>
    <section class="cmp-step" data-oldstep hidden></section>
    <section class="cmp-step" data-result hidden></section></div>`);
  root.replaceChildren(node);
  const ready = () => cmp.budget > 0 && cmp.cpm > 0;
  const refresh = () => {
    const slot = $("[data-thats]", node), shown = !!slot.firstElementChild;
    if (ready() && !shown) slot.innerHTML = `<div class="thats-it">That's it.</div><p class="muted" style="margin:0">Now here's the old way.</p>`;
    if (!ready() && shown) slot.innerHTML = "";
    if (ready() && $("[data-oldstep]", node).hidden) oldWay(node);
  };
  const bi = $("[data-b]", node);
  const setBudget = (v) => { cmp.budget = v || null; bi.value = v ? v.toLocaleString("en-IN") : ""; $$("[data-bchips] .opt", node).forEach((c) => c.setAttribute("aria-pressed", +c.dataset.v === v)); refresh(); };
  bi.oninput = () => setBudget(+bi.value.replace(/[^\d]/g, "") || null);
  $$("[data-bchips] .opt", node).forEach((c) => (c.onclick = () => setBudget(+c.dataset.v)));
  const ci = $("[data-cpm]", node);
  const setCpm = (v) => { cmp.cpm = v || null; ci.value = v ? v.toLocaleString("en-IN") : ""; $$("[data-cchips] .opt", node).forEach((c) => c.setAttribute("aria-pressed", +c.dataset.v === v)); refresh(); };
  ci.oninput = () => setCpm(+ci.value.replace(/[^\d]/g, "") || null);
  $$("[data-cchips] .opt", node).forEach((c) => (c.onclick = () => setCpm(+c.dataset.v)));
}

/* Real, computed feedback on the ladder as typed. Same 1.4x-3.5x "healthy climb" band the scorecard's
   Retention score uses, so the story is consistent end to end — shown only as small per-gap chips. */
const CMP_GAP_LO = 1.4, CMP_GAP_HI = 3.5;
function cmpGapClass(ratio) {
  if (!isFinite(ratio) || ratio <= 1) return "bad";
  if (ratio < CMP_GAP_LO) return "warn";
  if (ratio <= CMP_GAP_HI) return "ok";
  return "bad";
}
function cmpGapLabel(ratio, cls) {
  if (cls === "bad" && ratio <= 1) return "out of order";
  return `${cmpTimes(ratio)} step`;
}

function oldWayWarnings(step, o) {
  const views = o.rungs.map((r) => r[0]);
  const gaps = [];
  for (let i = 0; i < views.length - 1; i++) gaps.push(views[i + 1] / views[i]);
  $$(".gapchip", step).forEach((el, i) => {
    const g = gaps[i], cls = cmpGapClass(g);
    el.className = `gapchip ${cls}`;
    el.textContent = cmpGapLabel(g, cls);
  });
  $("[data-typed]", step).textContent = 1 + o.rungs.length * 2;
}

async function oldWay(node) {
  const step = $("[data-oldstep]", node);
  step.hidden = false;
  if (!cmp.old) {
    step.innerHTML = `<span class="label">The old way</span><div class="old-card old-loading"><p class="muted">Drawing up a starting ladder…</p></div>`;
    let rungs;
    try { rungs = (await api(`/api/compare/random-ladder?budget=${cmp.budget}`)).rungs; }
    catch (_) { rungs = META.brief_ladder.map((r) => [...r]); }
    cmp.old = { budget: cmp.budget, tier: "micro", rungs };
  }
  const o = cmp.old;
  step.innerHTML = `<span class="label">The old way</span>
    <div class="old-card">
      <div class="old-file"><span>📄</span><p class="muted">campaign_setup_v3_FINAL(2).xlsx · <span data-typed>0</span> numbers typed by hand so far</p><button type="button" class="dice" data-dice title="Draw a new random starting ladder">🎲</button></div>
      <div class="field-row old-fields">
        <label class="field"><span class="label">Budget (₹)</span><input data-ob value="${o.budget}"></label>
        <label class="field"><span class="label">Target creator size</span><select data-ot>${META.tiers.map((t) => `<option ${t === o.tier ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <div class="rung-table"><div class="rowh"><span>Views</span><span>Payout (₹, cumulative)</span><span></span></div>
        ${o.rungs.map((r, i) => `<div class="rowx"><input data-rv="${i}" value="${r[0]}"><input data-rp="${i}" value="${r[1]}"><button data-rx="${i}" aria-label="Remove">×</button></div>${i < o.rungs.length - 1 ? `<div class="gaprow"><span class="gapchip"></span></div>` : ""}`).join("")}
        <button class="add-rung" data-ra>+ add rung</button></div>
    </div>
    <div><button class="cta gold" data-run>Run both through 300 simulated markets</button></div>`;
  const sync = () => {
    o.budget = +$("[data-ob]", step).value.replace(/[^\d]/g, "") || cmp.budget;
    o.tier = $("[data-ot]", step).value;
    o.rungs = $$(".rowx", step).map((row) => [+$("[data-rv]", row).value.replace(/[^\d]/g, ""), +$("[data-rp]", row).value.replace(/[^\d]/g, "")]).filter((r) => r[0] > 0);
    oldWayWarnings(step, o);
  };
  $$("input, select", step).forEach((i) => (i.oninput = sync));
  $$("[data-rx]", step).forEach((b) => (b.onclick = () => { sync(); o.rungs.splice(+b.dataset.rx, 1); oldWay(node); }));
  $("[data-ra]", step).onclick = () => { sync(); const last = o.rungs[o.rungs.length - 1] || [10000, 500]; o.rungs.push([last[0] * 2, last[1] * 2]); oldWay(node); };
  $("[data-dice]", step).onclick = async () => {
    sync();
    const btn = $("[data-dice]", step);
    btn.disabled = true;
    try { o.rungs = (await api(`/api/compare/random-ladder?budget=${o.budget}`)).rungs; } catch (_) { /* keep current */ }
    oldWay(node);
  };
  $("[data-run]", step).onclick = () => { sync(); runCompare(node); };
  sync();
}

const CMP_VERDICT = { blown: ["Overspent", "var(--old)"], overpaid: ["Overpriced", "#e0a24a"], fine: ["Fair", "var(--good)"] };
const cmpLogPos = (x, lo, hi) => { x = Math.max(lo, Math.min(hi, x)); return ((Math.log(x) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100; };
const cmpTimes = (x) => (x >= 10 ? x.toFixed(0) : x.toFixed(1)) + "×";

/* A ring split into fine/overpriced/overspent, same idea as Benchmark's donuts. */
function cmpRing(verdicts, size = 108, stroke = 14) {
  const R = (size - stroke) / 2 - 2, C = 2 * Math.PI * R, h = size / 2, fs = Math.max(11, size * 0.19);
  let off = 0;
  const segs = ["fine", "overpaid", "blown"].map((k) => {
    const len = (verdicts[k] || 0) * C;
    const s = `<circle cx="${h}" cy="${h}" r="${R}" fill="none" stroke="${CMP_VERDICT[k][1]}" stroke-width="${stroke}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${h} ${h})"><title>${CMP_VERDICT[k][0]}: ${pct(verdicts[k] || 0)}</title></circle>`;
    off += len;
    return s;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${h}" cy="${h}" r="${R}" fill="none" stroke="var(--bg-2)" stroke-width="${stroke}"/>${segs}
    <text x="${h}" y="${h + fs / 3.4}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="var(--ink)">${pct(verdicts.fine || 0)}</text></svg>`;
}

/* One square per simulated draw, coloured by outcome — Benchmark's waffle grid. */
function cmpWaffle(reps, key) {
  return `<div class="cmp-waffle">${reps.map((r) => { const [label, col] = CMP_VERDICT[r[`verdict_${key}`]]; return `<i style="background:${col}" title="#${r.id} · ${esc(MARKET_LABELS[r.scenario] || r.scenario)} · ${label} · ${inr(r[`${key}_spend`])}"></i>`; }).join("")}</div>`;
}

/* Every draw sorted into how far over budget it landed — Benchmark's severity bands. */
const CMP_BANDS = [["Within budget", 0, 1, "var(--good)"], ["Up to 1.5×", 1, 1.5, "#ffc247"], ["1.5×–2×", 1.5, 2, "#ff8a3d"], ["2×–5×", 2, 5, "#ff5230"], ["Over 5×", 5, Infinity, "var(--old)"]];
function cmpBandShares(reps, key, budget) {
  return CMP_BANDS.map(([, lo, hi]) => reps.filter((r) => { const x = r[`${key}_spend`] / budget; return lo === 0 ? x <= 1 : x > lo && x <= hi; }).length / reps.length);
}
function cmpBandBar(shares, cls, name) {
  return `<div class="cmp-bandrow"><span class="label ${cls}">${name}</span><div class="cmp-bandtrack">${shares.map((x, i) => (x > 0 ? `<i style="background:${CMP_BANDS[i][3]};flex:${x}" title="${CMP_BANDS[i][0]}: ${pct(x)}">${x >= 0.08 ? pct(x) : ""}</i>` : "")).join("")}</div></div>`;
}

/* p10–median–p90 range bar on a shared log scale, with optional dashed markers (true price, fair price, …). */
function cmpRangeTrack(v, cls, lo, hi, markers = []) {
  const x1 = cmpLogPos(v.p10, lo, hi), x2 = cmpLogPos(v.p90, lo, hi), xm = cmpLogPos(v.median, lo, hi);
  return `<div class="cmp-track">${markers.map((m) => `<span class="mk" style="left:${cmpLogPos(m.v, lo, hi)}%" title="${esc(m.label)}"></span>`).join("")}
    <i class="${cls}" style="left:${x1}%;width:${Math.max(1, x2 - x1)}%"></i><b style="left:${xm}%"></b></div>`;
}

/* Fixed 0-100 scale bar (never rescaled by neighbouring values, unlike pairBars) — for the scorecard only. */
function cmpScale(val, cls) {
  return `<div class="cmp-scale"><i class="${cls}" style="width:${Math.max(0, Math.min(100, val))}%"></i><span class="t25"></span><span class="t50"></span><span class="t75"></span></div>`;
}
function cmpTile(label, note, oldVal, newVal, big) {
  return `<div class="cmp-tile${big ? " cmp-tile-big" : ""}"><span class="label">${label}</span>
    <div class="cmp-tile-row"><span class="tag old-t">Old</span>${cmpScale(oldVal, "old")}<b class="old-t">${Math.round(oldVal)}</b></div>
    <div class="cmp-tile-row"><span class="tag gold-t">New</span>${cmpScale(newVal, "new")}<b class="gold-t">${Math.round(newVal)}</b></div>
    ${note ? `<p class="muted">${note}</p>` : ""}</div>`;
}

async function runCompare(node) {
  const out = $("[data-result]", node);
  out.hidden = false;
  out.innerHTML = `<div class="loading">Running 300 simulated markets…</div>`;
  out.scrollIntoView({ behavior: "smooth" });
  try {
    const r = await api("/api/compare", { budget: cmp.budget, old: { rungs: cmp.old.rungs }, fair_cpm: cmp.cpm });
    const o = r.totals.old, n = r.totals.new, fairCpm = r.fair_cpi * 1000;
    const markets = Object.keys(r.by_market);

    // shared log domain for the price-range chart: every market's p10/p90, plus the true and fair prices
    const priceVals = markets.flatMap((k) => [r.by_market[k].old.cpm_p10, r.by_market[k].old.cpm_p90, r.by_market[k].new.cpm_p10, r.by_market[k].new.cpm_p90]).concat([r.true_cpm, fairCpm]).filter((x) => x > 0);
    const pLo = Math.min(...priceVals) * 0.7, pHi = Math.max(...priceVals) * 1.4;
    const priceMarkers = [{ v: r.true_cpm, label: `True price ${cpm(r.true_cpm)}` }, { v: fairCpm, label: `Your fair price ${cpm(fairCpm)}` }];

    // shared log domain for the crowd-size chart
    const postVals = markets.flatMap((k) => [r.by_market[k].posts_p10, r.by_market[k].posts_p90]);
    const nLo = Math.max(1, Math.min(...postVals) * 0.7), nHi = Math.max(...postVals) * 1.4;

    out.innerHTML = `<span class="label gold">${r.n} simulated draws of this campaign — ${r.reps_per_market} in each of 5 market conditions</span>

      <div class="cmp-rings">
        <div class="cmp-ringcard"><span class="label old-t">Old way</span>${cmpRing(o.verdicts, 76, 10)}</div>
        <div class="cmp-ringcard"><span class="label gold-t">Clearing</span>${cmpRing(n.verdicts, 76, 10)}</div>
        <div class="legend cmp-ringlegend"><span><i style="background:var(--good)"></i>Fair</span><span><i style="background:#e0a24a"></i>Overpriced</span><span><i style="background:var(--old)"></i>Overspent</span></div>
      </div>

      <span class="label">Scorecard, out of 100</span>
      <div class="cmp-scoregrid">
        ${cmpTile("Overall", "Average of the four scores below.", r.scores.old.overall, r.scores.new.overall, true)}
        ${cmpTile("Budget adherence", "How rarely, and how badly, each method breaks budget across the 300 draws.", r.scores.old.budget, r.scores.new.budget)}
        ${cmpTile("Retention", `Are milestone gaps sized so a creator keeps climbing? Ideal step: ${r.scores.retention_band[0]}×–${r.scores.retention_band[1]}× — my call, not measured.`, r.scores.old.retention, r.scores.new.retention)}
        ${cmpTile("Fairness across tiers", `Nano clears the first rung ${pct(r.scores.reach_by_tier.old.nano)} of the time the old way vs ${pct(r.scores.reach_by_tier.new.nano)} with Clearing; macro ${pct(r.scores.reach_by_tier.old.macro)} vs ${pct(r.scores.reach_by_tier.new.macro)}.`, r.scores.old.fairness, r.scores.new.fairness)}
        ${cmpTile("Brand ROI", `100 at or under ${cpm(r.scores.reference_cpm)}, the true price — paying less isn't a foul, only paying more counts against it.`, r.scores.old.roi, r.scores.new.roi)}
      </div>

      <div class="measures">
        ${measure("Overspent at all", pct(o.over_share), pct(n.over_share), `${o.over_count} of ${r.n} draws the old way, ${n.over_count} of ${r.n} Clearing.`)}
        ${measure("Fair draws", pct(o.verdicts.fine), pct(n.verdicts.fine), "Within budget, and not badly overpriced against the true price.")}
        ${measure("Average paid", inr(o.paid), inr(n.paid), `Across all ${r.n} draws.`)}
        ${measure("Cost per 1,000 views (median)", cpm(o.cpm_median), cpm(n.cpm_median), `The market's true price is ${cpm(r.true_cpm)}; you told Clearing to aim for ${cpm(fairCpm)}.`)}
      </div>

      <span class="label">Every draw, one square each</span>
      <div class="panel chart-panel">
        <div class="cmp-waffles"><div><span class="label old-t">Old way</span>${cmpWaffle(r.reps, "old")}</div><div><span class="label gold-t">Clearing</span>${cmpWaffle(r.reps, "new")}</div></div>
        <div class="legend"><span><i style="background:var(--good)"></i>Fair</span><span><i style="background:#e0a24a"></i>Overpriced</span><span><i style="background:var(--old)"></i>Overspent</span></div>
      </div>

      <span class="label">How far over budget, when it goes wrong</span>
      <div class="panel chart-panel">
        ${cmpBandBar(cmpBandShares(r.reps, "old", r.budget), "old-t", "Old way")}
        ${cmpBandBar(cmpBandShares(r.reps, "new", r.budget), "gold-t", "Clearing")}
        <div class="legend">${CMP_BANDS.map(([l, , , c]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}</div>
      </div>

      <span class="label">Price paid per 1,000 views, by market</span>
      <div class="panel chart-panel">
        ${markets.map((k) => {
          const v = r.by_market[k];
          return `<div class="cmp-rangerow"><span class="label">${esc(MARKET_LABELS[k] || k)}</span>
            <div class="cmp-rangestack">
              ${cmpRangeTrack({ p10: v.old.cpm_p10, median: v.old.cpm_median, p90: v.old.cpm_p90 }, "old", pLo, pHi, priceMarkers)}
              ${cmpRangeTrack({ p10: v.new.cpm_p10, median: v.new.cpm_median, p90: v.new.cpm_p90 }, "new", pLo, pHi, priceMarkers)}
            </div>
            <span class="cmp-rangeval"><b class="old-t">${cpm(v.old.cpm_median)}</b> · <b class="gold-t">${cpm(v.new.cpm_median)}</b></span></div>`;
        }).join("")}
        ${oldNewLegend}<p class="muted" style="margin:0">Bars show the middle 80% of draws (p10–p90), tick is the median. Dashed markers: the true price (${cpm(r.true_cpm)}) and your fair-price ask (${cpm(fairCpm)}).</p>
      </div>

      <span class="label">How many creators showed up, by market</span>
      <div class="panel chart-panel">
        ${markets.map((k) => { const v = r.by_market[k]; return `<div class="cmp-rangerow"><span class="label">${esc(MARKET_LABELS[k] || k)}</span><div class="cmp-rangestack">${cmpRangeTrack({ p10: v.posts_p10, median: v.posts_median, p90: v.posts_p90 }, "neutral", nLo, nHi)}</div><span class="cmp-rangeval">${Math.round(v.posts_median).toLocaleString("en-IN")} posts</span></div>`; }).join("")}
        <p class="muted" style="margin:0">The same crowd feeds both methods on each draw — it's the one thing that isn't a choice either side makes. Bars show the middle 80% of draws.</p>
      </div>

      <div class="verdict">Across ${r.n} draws, the old way paid <span class="old-t" data-c="${o.paid}">₹0</span> on average. Clearing paid <span class="gold-t" data-c="${n.paid}">₹0</span>.</div>
      ${(() => {
        const worst = [...r.reps].sort((a, b) => b.old_spend / r.budget - a.old_spend / r.budget)[0];
        const totalOver = o.over_amount * r.n;
        return `<div class="facts">
          <div><span class="label old-t">Paid past budget, in total</span><b class="old-t">${inrShort(totalOver)}</b><span>added up across these ${r.n} draws — Clearing: ₹0</span></div>
          <div><span class="label old-t">Its single worst draw</span><b class="old-t">${cmpTimes(worst.old_spend / r.budget)}</b><span>${esc(MARKET_LABELS[worst.scenario] || worst.scenario)} market: ${inrShort(worst.old_spend)} paid on a ${inrShort(r.budget)} budget</span></div>
          <div><span class="label old-t">Blew this exact budget</span><b class="old-t">${o.over_count} of ${r.n}</b><span>times — Clearing: 0 of ${r.n}</span></div>
          <div><span class="label old-t">Nano creators paid anything</span><b class="old-t">${pct(r.scores.reach_by_tier.old.nano)}</b><span>of the time, one shared ladder — Clearing: ${pct(r.scores.reach_by_tier.new.nano)}</span></div>
        </div>`;
      })()}
      <p class="muted">Simulated, not pulled from real past campaigns: four creator sizes, ${r.reps_per_market} random crowds in each of 5 market conditions (smooth, abundant, scarce, one viral surge, many surges) — ${r.n} draws total, so a single lucky or unlucky one doesn't decide it. Clearing's fair-price reference: ${cpm(fairCpm)} per 1,000 views.</p>`;
    await sleep(300);
    $$("[data-c]", out).forEach((el, i) => setTimeout(() => tween(el, +el.dataset.c, inr, 900), i * 90));
  } catch (e) {
    out.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

/* Shared by the Compare page (moved here since the old Backtest page, its original home, is gone). */
function measure(title, oldV, newV, note, extra = "") {
  return `<div class="panel measure"><span class="label">${title}</span>
    <div class="pair"><div><span class="label old-t">Old way</span><b class="old-t">${oldV}</b></div><div><span class="label gold-t">Clearing</span><b class="gold-t">${newV}</b></div></div>
    ${extra}<p>${note}</p></div>`;
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
