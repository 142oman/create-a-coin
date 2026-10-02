/* Loader. A full-screen warp-field overlay for the first load and for any request that takes long
   enough to notice.

   The effect is ThreeUI's "hyperspace" warp field (hyperspace.js, MIT, needs Three.js r128 from vendor/).
   It is loaded in the background. Until it is ready, and wherever WebGL is unavailable, a light 2D-canvas
   star field is shown instead, so the overlay is never blank and never depends on the 600 KB script.

     Loader.show("Running your campaign")   Loader.hide()
     Loader.message("…")   Loader.progress(done, total)
     Loader.fetch(url, options, "label")    like fetch(), but retries a restarting server and shows the overlay
                                            only if the request is slow (so quick requests never flash it).
*/
(function () {
  "use strict";
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection && navigator.connection.saveData;
  const SLOW_MS = 400;        // a request faster than this never shows the overlay
  const WAKE_MS = 4000;       // still waiting after this long: say the server is waking up
  const MIN_BOOT_MS = 450;    // the first-load screen stays at least this long, so it never flickers

  let el, cv2, cvGL, ctx, msgEl, subEl, barEl, fillEl;
  let holds = 0, raf = 0, stars = [], W = 0, H = 0, shownAt = 0, last = 0, speed = 0.55;
  let gl = null, glReady = false, glFailed = false, usingGL = false;

  function build() {
    el = document.createElement("div");
    el.id = "ld";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = '<canvas class="ld-2d" aria-hidden="true"></canvas><canvas class="ld-gl" aria-hidden="true" hidden></canvas>' +
      '<div class="ld-sr"><span class="ld-msg"></span> <span class="ld-sub"></span></div><div class="ld-line" aria-hidden="true"><i></i></div>';
    document.body.appendChild(el);
    cv2 = el.querySelector(".ld-2d");
    cvGL = el.querySelector(".ld-gl");
    ctx = cv2.getContext("2d");
    msgEl = el.querySelector(".ld-msg");
    subEl = el.querySelector(".ld-sub");
    barEl = el.querySelector(".ld-line");
    fillEl = barEl.firstChild;
    window.addEventListener("resize", resize);
    resize();
  }

  function resize() {
    if (!cv2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv2.clientWidth; H = cv2.clientHeight;
    cv2.width = W * dpr; cv2.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(260, Math.max(90, (W * H) / 6500)));
    stars = Array.from({ length: n }, () => spawn({}, true));
    if (gl) gl.resize(window.innerWidth, window.innerHeight);
  }

  // ---- fallback: a 2D star field. A star is a direction and a distance from the centre.
  function spawn(s, anywhere) {
    s.a = Math.random() * Math.PI * 2;
    s.r = anywhere ? Math.random() * Math.hypot(W, H) * 0.5 : 6 + Math.random() * 30;
    s.v = 0.4 + Math.random() * 1.1;
    s.w = 0.6 + Math.random() * 1.3;
    s.gold = Math.random() < 0.35;
    return s;
  }

  function frame2D(t) {
    raf = requestAnimationFrame(frame2D);
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    ctx.fillStyle = "rgba(10,10,10,0.28)";           // fading the last frame is what draws the streaks
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, reach = Math.hypot(W, H) / 2;
    for (const s of stars) {
      const k = 1 + (s.r / reach) * 5;
      const step = s.v * k * speed * 160 * dt;
      const x0 = cx + Math.cos(s.a) * s.r, y0 = cy + Math.sin(s.a) * s.r;
      s.r += step;
      const x1 = cx + Math.cos(s.a) * s.r, y1 = cy + Math.sin(s.a) * s.r;
      const alpha = Math.min(1, s.r / (reach * 0.5));
      ctx.strokeStyle = s.gold ? "rgba(242,193,78," + (0.25 + alpha * 0.7) + ")" : "rgba(243,242,238," + (0.12 + alpha * 0.55) + ")";
      ctx.lineWidth = s.w * (0.5 + alpha);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      if (s.r > reach * 1.05) spawn(s, false);
    }
  }

  // ---- the real effect: ThreeUI hyperspace, when Three.js and WebGL are available
  function frameGL() {
    raf = requestAnimationFrame(frameGL);
    gl.render();
  }

  function useGL() {
    if (!glReady || glFailed || reduce || !el) return false;
    try {
      if (!gl) gl = window.createHyperspace(cvGL);
      gl.resize(window.innerWidth, window.innerHeight);
    } catch (e) {
      glFailed = true;   // no WebGL, or the context was refused: stay on the 2D star field for good
      return false;
    }
    cvGL.hidden = false; cv2.hidden = true;
    usingGL = true;
    return true;
  }

  function loadHyperspace() {
    if (reduce || saveData) return;
    const add = (src, next) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = next;
      s.onerror = () => { glFailed = true; };
      document.head.appendChild(s);
    };
    add("vendor/three.r128.min.js", () => add("hyperspace.js", () => {
      glReady = true;
      if (holds > 0 && useGL()) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frameGL); }
    }));
  }

  function start() {
    if (reduce || raf) return;
    if (useGL()) { raf = requestAnimationFrame(frameGL); return; }
    usingGL = false; cv2.hidden = false; cvGL.hidden = true;
    ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, W, H);
    last = performance.now();
    raf = requestAnimationFrame(frame2D);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  const Loader = {
    show(message, sub) {
      if (!el) build();
      holds++;
      if (holds === 1) { shownAt = performance.now(); el.classList.add("on"); document.documentElement.style.overflow = "hidden"; start(); }
      Loader.message(message, sub);
    },
    hide(minMs) {
      if (!el || holds === 0) return;
      holds--;
      if (holds > 0) return;
      const wait = Math.max(0, (minMs || 0) - (performance.now() - shownAt));
      setTimeout(() => {
        if (holds > 0) return;
        el.classList.remove("on");
        document.documentElement.style.overflow = "";
        barEl.classList.remove("det"); fillEl.style.width = "";
        setTimeout(() => { if (holds === 0) stop(); }, 450);   // after the fade-out, so the effect never freezes mid-fade
      }, wait);
    },
    message(text, sub) {
      if (!el) return;
      if (text != null) msgEl.textContent = text;
      subEl.textContent = sub || "";
    },
    progress(done, total) {
      if (!el) return;
      barEl.classList.add("det");
      fillEl.style.width = Math.max(0, Math.min(100, (100 * done) / Math.max(1, total))) + "%";
    },

    // fetch that survives a server that is restarting, and shows the overlay only when it is slow.
    async fetch(url, options, label) {
      let shown = false;
      const slow = setTimeout(() => { shown = true; Loader.show(label || "Working", ""); }, SLOW_MS);
      const wake = setTimeout(() => Loader.message(label || "Working", "Still going. The server may be waking up."), WAKE_MS);
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const res = await fetch(url, options);
            if ([502, 503, 504].includes(res.status) && attempt < 3) { await sleep(600 * 2 ** attempt); continue; }
            return res;
          } catch (e) {
            if (attempt >= 3) throw e;
            await sleep(600 * 2 ** attempt);
          }
        }
      } finally {
        clearTimeout(slow); clearTimeout(wake);
        if (shown) Loader.hide();
      }
    },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.Loader = Loader;

  // First load: cover the page until everything (fonts, scripts, first paint) is in.
  function boot() {
    Loader.show("Clearing", "");
    loadHyperspace();
    let finished = false;
    const done = () => { if (finished) return; finished = true; Loader.hide(MIN_BOOT_MS); };
    if (document.readyState === "complete") done(); else window.addEventListener("load", done, { once: true });
    setTimeout(done, 8000);   // never trap the page if a font or script hangs
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
