// Helpers shared by the scene templates. Loaded once by index.html, before any scene.
// Everything here runs synchronously at load, so timelines stay deterministic.
window.WS = {
  // Scoped query helpers for one composition.
  scope(id) {
    const pre = `[data-composition-id="${id}"] `;
    return { one: (s) => document.querySelector(pre + s), all: (s) => document.querySelectorAll(pre + s), sel: (s) => pre + s };
  },
  // Wrap each word of an element's text in a span, so words can enter one by one.
  words(el) {
    const text = el.textContent.trim();
    el.textContent = '';
    text.split(/\s+/).forEach((w, i) => {
      if (i) el.append(' ');
      const s = document.createElement('span');
      s.className = 'ws-w';
      s.textContent = w;
      el.append(s);
    });
    return el.querySelectorAll('.ws-w');
  },
  // Product mark in the top bar: the logo when config has one, else the name alone.
  brand(root) {
    const mark = root.querySelector('.ws-brand');
    const img = mark && mark.querySelector('img');
    if (!img) return;
    if (mark.dataset.logo) img.src = mark.dataset.logo; else img.remove();
  },
  // Status text and chip class for a PR status from prs.json.
  status(s) {
    const k = String(s || '').toLowerCase();
    if (k === 'live') return { cls: 'live', text: 'Live' };
    if (k.startsWith('next') || k.startsWith('not')) return { cls: 'next', text: s.length > 4 ? s : 'Next release' };
    if (k === 'merged') return { cls: 'merged', text: 'Merged' };
    return null;
  },
  chip(s) {
    const st = this.status(s);
    if (!st) return null;
    const el = document.createElement('span');
    el.className = `ws-chip ${st.cls}`;
    el.textContent = st.text;
    return el;
  },
  // The scene change: next ground slides in from the right, this scene drifts left.
  wipe(tl, q, slot) {
    tl.fromTo(q.sel('.ws-wipe'), { xPercent: 101 }, { xPercent: 0, duration: 0.6, ease: 'power3.inOut' }, slot - 0.6);
    tl.to(q.sel('.ws-frame'), { x: -110, duration: 0.6, ease: 'power3.in' }, slot - 0.6);
  },
};
