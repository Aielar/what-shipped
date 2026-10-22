#!/usr/bin/env node
// Turns scenes/*.html templates into compositions/<id>.html and writes index.html, all
// timed from the narration. Run after voice.mjs: node assemble.mjs
//
// Template tokens:
//   {{SLOT}} {{ID}}     the scene's duration and composition id
//   {{t:spoken words}}  seconds into the scene where those words start; "[word]" picks a
//                       later word: {{t:press [save]}}
//   {{KEY}}             a value from the scene's "tokens" in scenes.json, or a global
//                       (BRAND, REPO, DATE, MERGES, HOURS, HOT, COUNTS). Strings are
//                       HTML-escaped, arrays and objects become JSON for scripts.
//   {{KEY|fallback}}    with a default; {{{KEY}}} inserts a string unescaped.
// A token value "t:spoken words" becomes an anchor time, also inside arrays and objects.
// A phrase the voice never said stops the build, so timing can't silently drift.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const LEAD = 0.45;   // a scene opens this long before its first word
const CAP_MAX = 44;  // characters per caption card
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const timing = read('timing.json');
const words = read('words.json');
const lines = read('lines.json');
const scenes = read('scenes.json');
const brand = existsSync('brand.json') ? read('brand.json') : { name: 'Product' };
const prs = existsSync('prs.json') ? read('prs.json') : null;
const r3 = (n) => +n.toFixed(3);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Scene windows: back to back, each opening LEAD before its first word.
const ids = new Set();
scenes.forEach((s, i) => {
  if (!s.id || !s.file || !s.scene) throw new Error(`scenes.json entry ${i} needs id, file and scene`);
  if (ids.has(s.id)) throw new Error(`Duplicate scene id ${s.id}`);
  ids.add(s.id);
  const w = timing.scenes[s.scene];
  if (!w) throw new Error(`No narration for scene "${s.scene}" (check the scene names in lines.json)`);
  s.start = i === 0 ? 0 : r3(w.start - LEAD);
});
scenes.forEach((s, i) => { s.end = i < scenes.length - 1 ? scenes[i + 1].start : timing.total; s.dur = r3(s.end - s.start); });
const unused = Object.keys(timing.scenes).filter((k) => !scenes.some((s) => s.scene === k));
if (unused.length) console.warn(`warning: narration for ${unused.join(', ')} has no scene, it plays over the previous one`);

function anchor(scene, phrase) {
  const ws = words.filter((w) => w.scene === scene.scene);
  // Joined letters, so "sign-in" matches "sign in". A [bracketed] word picks its own time.
  const parts = phrase.trim().split(/\s+/);
  const target = parts.map(norm).join('');
  const bi = parts.findIndex((p) => p.startsWith('['));
  const before = bi > 0 ? parts.slice(0, bi).map(norm).join('').length : 0;
  for (let i = 0; i < ws.length; i++) {
    let acc = '', hit = i;
    for (let j = i; j < ws.length && acc.length < target.length; j++) {
      if (acc.length <= before) hit = j;
      acc += norm(ws[j].text);
    }
    if (acc === target) return r3(Math.max(0, ws[hit].start - scene.start));
  }
  const heard = ws.map((w) => w.text.trim()).join(' ');
  throw new Error(`Anchor "${phrase}" isn't spoken in scene "${scene.scene}". The voice said: ${heard}`);
}

// Globals every template can use.
const fmt = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const hot = [...new Set(scenes.flatMap((s) => (s.tokens?.PRS || []).map(Number)))];
const hours = [];
if (prs) {
  const a = new Date(prs.since), span = new Date(prs.until) - a;
  for (let h = 0; h <= span / 3600e3 + 1e-9; h += Math.max(1, Math.round(span / 3600e3 / 8))) {
    const d = new Date(+a + h * 3600e3);
    hours.push({ x: +((h * 3600e3) / span).toFixed(4), label: d.toISOString().slice(11, 16) });
  }
}
const globals = {
  BRAND: brand.name,
  REPO: brand.repo || prs?.repo || '',
  LOGO: brand.logo || '',
  DATE: prs ? `${fmt(prs.since)} to ${fmt(prs.until)}` : '',
  MERGES: (prs?.merges || []).map((m) => ({ ...m, hot: hot.includes(m.n) })),
  HOURS: hours,
  HOT: hot,
  COUNTS: prs?.counts || {},
  AUTHORS: prs?.authors || [],
};
if (brand.outro) globals.ASK = brand.outro;

const built = scenes.filter((s) => existsSync(`scenes/${s.file}`) || console.warn(`skip ${s.id}: scenes/${s.file} doesn't exist yet (black in the render)`));
for (const s of built) {
  const src = readFileSync(`scenes/${s.file}`, 'utf8');
  const resolve = (v) => typeof v === 'string' && v.startsWith('t:') ? anchor(s, v.slice(2))
    : Array.isArray(v) ? v.map(resolve)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]))
    : v;
  const value = (key, dflt) => {
    if (key === 'SLOT') return s.dur;
    if (key === 'ID') return s.id;
    if (key.startsWith('t:')) return anchor(s, key.slice(2));
    if (s.tokens && key in s.tokens) return resolve(s.tokens[key]);
    if (key in globals) return globals[key];
    if (dflt !== undefined) return dflt;
    throw new Error(`Unknown token {{${key}}} in scenes/${s.file} (scene ${s.id})`);
  };
  let out = src.replace(/\{\{\{([^}|]+)(?:\|([^}]*))?\}\}\}/g, (_, k, d) => String(value(k.trim(), d)));
  out = out.replace(/\{\{([^}|]+)(?:\|([^}]*))?\}\}/g, (_, k, d) => {
    const v = value(k.trim(), d);
    return typeof v === 'object' ? json(v) : typeof v === 'number' ? String(v) : esc(v);
  });
  writeFileSync(`compositions/${s.id}.html`, out);
}

// Captions for mute viewing: each line split at punctuation into short cards, timed by
// its words when the caption and the voice line up word for word.
const caps = [];
for (const l of timing.lines) {
  const src = lines.find((x) => x.id === l.id);
  if (src.cap === false) continue; // the scene already shows this line on screen
  const chunks = [];
  for (const part of src.text.match(/.+?(?:[,.:;?!]+(?=\s|$)|$)/g) || [src.text]) {
    let cur = '';
    for (const w of part.trim().split(/\s+/).filter(Boolean)) {
      if (cur && (cur + ' ' + w).length > CAP_MAX) { chunks.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) chunks.push(cur);
  }
  for (let i = 0; i < chunks.length - 1; i++) {
    if (chunks[i].length < 14 && (chunks[i] + ' ' + chunks[i + 1]).length <= CAP_MAX) { chunks.splice(i, 2, `${chunks[i]} ${chunks[i + 1]}`); i--; }
  }
  const spoken = words.filter((w) => w.line === l.id);
  const counts = chunks.map((c) => c.split(/\s+/).length);
  const aligned = counts.reduce((a, b) => a + b, 0) === spoken.length;
  const total = chunks.reduce((a, c) => a + c.length, 0);
  let t = l.start, wi = 0;
  chunks.forEach((c, i) => {
    let start = t, end;
    if (aligned) { start = i === 0 ? l.start : spoken[wi].start; wi += counts[i]; end = i === chunks.length - 1 ? l.end : spoken[wi].start; }
    else end = i === chunks.length - 1 ? l.end : t + (c.length / total) * (l.end - l.start);
    caps.push({ text: c.replace(/[,;:]$/, ''), start: r3(start), end: r3(end) });
    t = end;
  });
}
caps.forEach((c, i) => { const n = caps[i + 1]; c.end = n && n.start - c.end < 0.8 ? n.start : r3(c.end + 0.3); });

// Sound: a soft sweep under each scene change, a tick when a row or focus lands.
const cues = [];
scenes.slice(1).forEach((s) => cues.push({ src: 'sfx-wipe.wav', at: Math.max(0, s.start - 0.42), dur: 0.7, vol: 0.22 }));
for (const s of built) {
  const marks = [...(s.tokens?.ROWS || []), ...(s.tokens?.FOCI || [])].map((r) => r.at).filter((a) => typeof a === 'string' && a.startsWith('t:'));
  for (const a of marks) cues.push({ src: 'sfx-tick.wav', at: s.start + anchor(s, a.slice(2)) - 0.12, dur: 0.14, vol: 0.22 });
}
cues.sort((a, b) => a.at - b.at);

const layers = built.map((s, i) => `      <div id="scene-${i + 1}" class="scene-layer" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html"
        data-start="${s.start}" data-duration="${s.dur}" data-track-index="0" data-width="1920" data-height="1080"></div>`).join('\n');
const sfx = cues.map((c, i) => `      <audio id="sfx-${i + 1}" src="assets/${c.src}" data-start="${r3(c.at)}" data-duration="${c.dur}" data-track-index="${4 + (i % 8)}" data-volume="${c.vol}"></audio>`).join('\n');
const total = timing.total;
const title = existsSync('meta.json') ? read('meta.json').name : 'What shipped';

// Captions live in their own composition: one card per chunk, shown and hidden by its timeline.
writeFileSync('compositions/captions.html', `<template id="captions-template">
  <div data-composition-id="captions" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
${caps.map((c, i) => `    <div class="cap k${i}"><span class="ws-display">${esc(c.text)}</span></div>`).join('\n')}
    <style>
      [data-composition-id="captions"] { position: absolute; inset: 0; pointer-events: none; }
      [data-composition-id="captions"] .cap { position: absolute; left: 0; right: 0; bottom: 34px; display: flex; justify-content: center; opacity: 0; }
      [data-composition-id="captions"] .cap span { background: var(--ink); color: var(--paper); box-shadow: 0 0 0 1px rgba(255,255,255,.14); font-size: 38px; line-height: 1.2; font-weight: 500; padding: 12px 28px 14px; max-width: 1500px; text-align: center; }
    </style>
    <script>
      (() => {
        const CAPS = ${json(caps.map((c) => [c.start, c.end]))};
        const tl = gsap.timeline({ paused: true });
        CAPS.forEach(([a, b], i) => {
          const sel = \`[data-composition-id="captions"] .k\${i}\`;
          tl.fromTo(sel, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out", immediateRender: false }, a);
          tl.set(sel, { opacity: 0 }, b);
        });
        window.__timelines = window.__timelines || {};
        window.__timelines["captions"] = tl;
      })();
    </script>
  </div>
</template>
`);

writeFileSync('index.html', `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${esc(title)}</title>
    <script src="assets/gsap.min.js"></script>
    <script src="assets/ledger.js"></script>
    <link rel="stylesheet" href="assets/theme.css" />
    <link rel="stylesheet" href="assets/ledger.css" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--ink); }
      .scene-layer, .captions-layer { position: absolute; top: 0; left: 0; width: 1920px; height: 1080px; }
      .captions-layer { z-index: 100; pointer-events: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="what-shipped" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
${layers}
      <div id="captions" class="captions-layer" data-track-kind="captions" data-composition-id="captions" data-composition-src="compositions/captions.html"
        data-start="0" data-duration="${total}" data-track-index="3" data-width="1920" data-height="1080"></div>

      <audio id="narration" src="narration.wav" data-start="0" data-duration="${total}" data-track-index="1" data-volume="1"></audio>
      <audio id="bed" src="assets/bed.wav" data-start="0" data-duration="${total}" data-track-index="2" data-volume="0.3"></audio>
${sfx}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["what-shipped"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`);
for (const s of scenes) console.log(`${s.id.padEnd(18)} ${s.start.toFixed(2).padStart(7)}  ${s.dur.toFixed(2).padStart(6)}s`);
console.log(`${caps.length} captions, ${cues.length} sound cues, total ${total}s`);
