'use strict';
/* Shared page chrome: top nav, theme toggle, seed helpers, formatting. */
(function () {
  const PAGES = [
    ['/', 'Live market'],
    ['/simulator.html', 'Campaign simulator'],
    ['/market.html', 'Market simulator'],
    ['/publisher.html', 'Publisher game'],
    ['/docs.html', 'How it works'],
  ];

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch { /* private mode: theme just won't persist */ }
    return null;
  }

  const saved = storage('theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;

  function currentTheme() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function renderNav() {
    const slot = document.getElementById('topnav');
    if (!slot) return;
    const here = location.pathname === '/index.html' ? '/' : location.pathname;
    slot.className = 'topnav';
    slot.innerHTML = '<div class="topnav-inner">'
      + '<a class="brand" href="/"><span class="brand-mark">¢</span>CPI market</a>'
      + '<div class="navlinks">'
      + PAGES.map(([href, label]) => '<a href="' + href + '"' + (href === here ? ' aria-current="page"' : '') + '>' + label + '</a>').join('')
      + '</div>'
      + '<button class="theme-btn" id="themeBtn" title="Toggle light / dark"></button>'
      + '</div>';
    const btn = document.getElementById('themeBtn');
    const paint = () => { btn.textContent = currentTheme() === 'dark' ? '☀' : '☾'; };
    paint();
    btn.onclick = () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      storage('theme', next);
      paint();
      document.dispatchEvent(new CustomEvent('themechange'));
    };
  }

  /** A fresh random seed, 1 … 999 999. */
  function newSeed() {
    return 1 + Math.floor(Math.random() * 999999);
  }

  /** Fill every `[data-seed]` input and wire its 🎲 button (`[data-seed-roll="inputId"]`). */
  function wireSeeds() {
    for (const input of document.querySelectorAll('input[data-seed]')) {
      if (!input.value) input.value = newSeed();
    }
    for (const btn of document.querySelectorAll('[data-seed-roll]')) {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.seedRoll);
        input.value = newSeed();
        input.dispatchEvent(new Event('input'));
      });
    }
  }

  window.UI = {
    newSeed,
    $: (id) => document.getElementById(id),
    money: (n) => '$' + Math.round(Number(n)).toLocaleString(),
    cpi: (n) => '$' + Number(n).toFixed(2),
    count: (n) => Math.round(Number(n)).toLocaleString(),
    pct: (n) => Number(n).toFixed(0) + '%',
    stat(label, value, opts = {}) {
      return '<div class="stat' + (opts.cls ? ' ' + opts.cls : '') + '"' + (opts.title ? ' title="' + opts.title + '"' : '') + '>'
        + '<b>' + value + '</b><span>' + label + '</span>' + (opts.sub ? '<small>' + opts.sub + '</small>' : '') + '</div>';
    },
    hbars(rows, max) {
      const top = max || Math.max(...rows.map((r) => r.value || 0)) || 1;
      return '<div class="hbars">' + rows.map((r) =>
        '<div class="hbar"><span class="name">' + r.name + '</span>'
        + '<span class="rail"><div style="width:' + Math.min(100, ((r.value || 0) / top) * 100).toFixed(1) + '%;background:' + r.color + '"></div></span>'
        + '<span class="val">' + r.label + '</span></div>').join('') + '</div>';
    },
    async api(path, method = 'GET', body) {
      const res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'request failed');
      return data;
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    renderNav();
    wireSeeds();
  });
})();
