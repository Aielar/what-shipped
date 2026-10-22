#!/usr/bin/env node
// Read-only screenshots of the live product, taken in real Google Chrome with a
// dedicated profile that keeps the capture login.
//
//   node capture.mjs login              headed Chrome: sign in, open the locked workspace, done
//   node capture.mjs [captures.json]    headless, writes assets/captures/<id>.png per entry
//   flags: --config <path>  --out <dir>
//
// Fail-closed by design. Every address is vetted before the browser opens it, and the
// browser is also stopped from navigating anywhere else on its own (a redirect from
// script, a meta refresh). Links are followed by reading their href, never clicked.
// The only other actions are tab clicks, hover, scroll and waits: no buttons, no typing.
//
// The workspace lock (config.capture.lock) names the element that proves the browser is
// in the right account or workspace. It is checked after load, after the steps, and
// again after the screenshot is taken; the PNG is written only if all three pass.
// No lock in the config means nothing runs at all.
//
// captures.json entries:
//   { "id": "schedule", "page": "schedule" }                    a page from config.capture.pages
//   { "id": "reports", "url": "/reports", "waitFor": "This week",
//     "steps": [{ "tab": "Monthly" }, { "link": "Export history" }, { "hover": "text=Due" },
//               { "scroll": 400 }, { "wait": 800 }, { "waitFor": "Loaded" }],
//     "mask": ["text=jane@customer.com"], "hide": ["text=We use cookies"], "viewport": [1280, 720] }
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from './config.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : dflt; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

let cfg;
try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(2); }
const cap = cfg.capture || {};
const lock = cap.lock;
if (!cap.baseUrl) { console.error('capture.baseUrl is missing from config.json. Nothing captured.'); process.exit(2); }
if (!lock || !lock.text || !(lock.selector || lock.role)) {
  console.error('capture.lock is missing or incomplete (needs "text" plus "selector" or "role"). Nothing captured.\n'
    + 'The lock is what proves the browser sits in the right workspace. See references/capture.md.');
  process.exit(2);
}

const BASE = new URL(cap.baseUrl);
const PROFILE = (cap.profile || join(homedir(), '.what-shipped/chrome-profile')).replace(/^~(?=\/)/, homedir());
const OUT = resolve(flag('--out', 'assets/captures'));
const CHANNEL = process.env.WHAT_SHIPPED_BROWSER || cap.channel || 'chrome';
const MASK = cfg.brand.colors.rule;
const SIGNED_OUT = new RegExp(cap.signedOut || '/(sign-?in|log-?in|auth)(/|$)', 'i');

// Path segments that commonly write on load: creating, deleting, signing out,
// connecting accounts, accepting invites, deploying. Always on; config adds more.
const RISKY_SEGMENTS = new Set(['new', 'create', 'delete', 'remove', 'destroy', 'logout', 'log-out', 'signout', 'sign-out',
  'oauth', 'oauth2', 'authorize', 'callback', 'connect', 'disconnect', 'install', 'uninstall', 'accept', 'decline',
  'invite', 'join', 'deploy', 'publish', 'checkout', 'purchase', 'unsubscribe', 'confirm', 'verify', 'reset',
  'api', 'graphql', 'webhook', 'webhooks']);
const RISKY_KEYS = new Set(['template', 'install', 'invite', 'token', 'code', 'state', 'action', 'accept', 'confirm']);
const EXTRA = (cap.blocked || []).map((p) => new RegExp(p, 'i'));

// Decode until stable, so "%6Eew" and "%256Eew" are read as "new", the way a server might.
const decode = (s) => { let x = s; for (let i = 0; i < 3; i++) { const d = decodeURIComponent(x); if (d === x) break; x = d; } return x; };
function vet(raw) {
  let u;
  try { u = new URL(raw, BASE); } catch { return { ok: false, why: 'not a valid address' }; }
  if (!/^https?:$/.test(u.protocol) || u.origin !== BASE.origin) return { ok: false, why: `off-site address ${u.origin}` };
  let path, keys;
  try {
    path = decode(u.pathname);
    keys = [...new URLSearchParams(u.search).keys()].map((k) => decode(k).toLowerCase());
  } catch { return { ok: false, why: 'address that does not decode cleanly' }; }
  // Each segment is checked by name, without matrix params (";x") or an extension (".json").
  const seg = path.toLowerCase().split('/').map((p) => p.split(';')[0].replace(/\.[a-z0-9]+$/, '')).find((p) => RISKY_SEGMENTS.has(p));
  if (seg) return { ok: false, why: `"/${seg}" pages can change data on load` };
  const key = keys.find((k) => RISKY_KEYS.has(k));
  if (key) return { ok: false, why: `"?${key}=" can change data on load` };
  const hit = EXTRA.find((re) => re.test(path + decode(u.search)));
  if (hit) return { ok: false, why: `matches blocked pattern ${hit.source}` };
  return { ok: true, href: u.href };
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
async function lockHolds(page) {
  const want = norm(lock.text);
  const loc = lock.role ? page.getByRole(lock.role, { name: want }) : page.locator(lock.selector);
  const n = Math.min(await loc.count().catch(() => 0), 25);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const text = norm(await el.innerText().catch(() => '')) || norm(await el.getAttribute('aria-label').catch(() => ''));
    if (text === want || (lock.match === 'prefix' && text.startsWith(want + ' '))) return true;
  }
  return false;
}

const launch = (headless, vp = cap.viewport || [1280, 720]) => chromium.launchPersistentContext(PROFILE, {
  channel: CHANNEL,
  headless,
  viewport: { width: vp[0], height: vp[1] },
  deviceScaleFactor: cap.scale || 2,
  colorScheme: cap.colorScheme || 'light',
  locale: 'en-US',
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
});
mkdirSync(PROFILE, { recursive: true });

if (positional[0] === 'login') {
  const ctx = await launch(false);
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(BASE.href);
  console.log(`Sign in to ${BASE.origin} in the Chrome window and open "${lock.text}". Waiting up to 15 minutes...`);
  const deadline = Date.now() + 15 * 60_000;
  let okSince = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const here = new URL(page.url());
    const good = here.origin === BASE.origin && !SIGNED_OUT.test(here.pathname) && (await lockHolds(page));
    okSince = good ? okSince || Date.now() : 0;
    if (okSince && Date.now() - okSince > 3000) break;
  }
  await ctx.close();
  console.log(okSince ? `Signed in and locked to "${lock.text}". Session saved in ${PROFILE}` : 'Timed out before the lock showed up.');
  process.exit(okSince ? 0 : 1);
}

const file = positional[0] || 'captures.json';
if (!existsSync(file)) { console.error(`No ${file}. Write one first (see the header of this script).`); process.exit(2); }
const pages = Object.fromEntries((cap.pages || []).map((p) => [p.id, p]));
const entries = JSON.parse(readFileSync(file, 'utf8')).map((c) => ({ ...(c.page ? pages[c.page] : {}), ...c }));
mkdirSync(OUT, { recursive: true });

const report = [];
const note = (id, status, detail, extra = {}) => { report.push({ id, status, detail, ...extra }); console.log(`${status.padEnd(7)} ${id}  ${detail}`); };
let ctx = null, ctxView = '', strayNav = null, current = null;
const stopped = []; // frames and popups refused while capturing the current entry

// A fresh tab per entry, so a refused navigation can't spill into the next one.
async function pageFor(vp) {
  if (ctxView !== vp.join('x')) {
    if (ctx) await ctx.close();
    ctx = await launch(true, vp);
    ctxView = vp.join('x');
    // Every document request in every tab and frame is vetted, popups included. A refused
    // top-level navigation fails the entry; a refused frame or popup is only left blank.
    await ctx.route('**/*', (route) => {
      const req = route.request();
      if (req.isNavigationRequest()) {
        const v = vet(req.url());
        if (!v.ok) {
          // A popup's first request has no frame yet, which is how it is told apart.
          let top = false;
          try { top = req.frame().page() === current && !req.frame().parentFrame(); } catch {}
          if (top) strayNav = `${req.url()} (${v.why})`; else stopped.push(req.url());
          return route.abort('blockedbyclient');
        }
      }
      return route.continue();
    });
  }
  const page = current = await ctx.newPage();
  // A tab the page opens by itself is closed on sight; its first request was vetted above.
  page.on('popup', (pop) => { stopped.push(`popup ${pop.url()}`); pop.close().catch(() => {}); });
  // Redirect hops never reach a route handler, so the tab also gets Chrome's Fetch domain:
  // it pauses every document request and every redirect response, in the page and its
  // same-site frames, before the browser follows it.
  const cdp = await ctx.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  cdp.on('Fetch.requestPaused', (e) => {
    let bad = null;
    if (e.resourceType === 'Document') {
      if (e.responseStatusCode === undefined) {
        const v = vet(e.request.url);
        if (!v.ok) bad = `${e.request.url} (${v.why})`;
      } else if (e.responseStatusCode >= 300 && e.responseStatusCode < 400) {
        const loc = (e.responseHeaders || []).find((h) => h.name.toLowerCase() === 'location')?.value;
        const v = loc ? vet(new URL(loc, e.request.url).href) : { ok: true };
        if (!v.ok) bad = `${loc} (${v.why})`;
      }
    }
    if (bad && e.frameId !== frameTree.frame.id) { stopped.push(bad); bad = null; cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return; }
    if (bad) { strayNav = bad; cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
    else cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {});
  });
  await cdp.send('Fetch.enable', { patterns: [
    { urlPattern: '*', resourceType: 'Document', requestStage: 'Request' },
    { urlPattern: '*', resourceType: 'Document', requestStage: 'Response' },
  ] });
  return page;
}

for (const c of entries) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(c.id || '')) { note(String(c.id), 'FAIL', 'id must be letters, digits, - or _'); continue; }
  if (!c.url) { note(c.id, 'FAIL', `no url (unknown page "${c.page}"?)`); continue; }
  const target = vet(c.url);
  if (!target.ok) { note(c.id, 'BLOCKED', `${c.url}: ${target.why}. Never opened.`); continue; }
  let p = null;
  try {
    p = await pageFor(c.viewport || cap.viewport || [1280, 720]);
    strayNav = null;
    stopped.length = 0;
    const guard = () => { if (strayNav) throw Object.assign(new Error(`page tried to open ${strayNav}`), { blocked: true }); };
    await p.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e) => { guard(); throw e; });
    await p.waitForTimeout(c.settleNav ?? 2000); // client-side redirects and app shells land here
    guard();
    const here = new URL(p.url());
    if (SIGNED_OUT.test(here.pathname)) throw new Error('signed out: run `node capture.mjs login` first');
    const want = new URL(target.href).pathname.replace(/\/$/, '');
    if (!here.pathname.replace(/\/$/, '').startsWith(want)) { note(c.id, 'MOVED', `asked ${want}, landed on ${here.pathname}. Not saved.`); continue; }
    if (!(await lockHolds(p))) { note(c.id, 'LOCKED', `"${lock.text}" not found on the page. Nothing done, nothing saved.`); continue; }

    if (c.waitFor) await p.getByText(c.waitFor, { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 });
    for (const s of c.steps || []) {
      if (s.tab) await p.getByRole('tab', { name: s.tab, exact: true }).first().click();
      else if (s.link) {
        const href = await p.getByRole('link', { name: s.link, exact: true }).first().getAttribute('href', { timeout: 10_000 });
        if (!href) throw new Error(`link "${s.link}" has no address`);
        const v = vet(new URL(href, p.url()).href);
        if (!v.ok) throw Object.assign(new Error(`link "${s.link}" -> ${href}: ${v.why}. Never opened.`), { blocked: true });
        await p.goto(v.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await p.waitForTimeout(2000);
      }
      else if (s.hover) await p.locator(s.hover).first().hover();
      else if (s.scroll) await p.mouse.wheel(0, s.scroll);
      else if (s.wait) await p.waitForTimeout(s.wait);
      else if (s.waitFor) await p.getByText(s.waitFor, { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 });
      else throw new Error(`step not allowed (read-only): ${JSON.stringify(s)}`);
      await p.waitForTimeout(500);
      guard();
    }
    await p.waitForTimeout(c.settle ?? 1200); // fonts, images and live data settle
    guard();
    // "hide": floating things that aren't the product (cookie banners, chat bubbles). Only
    // this tab's rendering changes: the nearest fixed or sticky box around a match goes
    // transparent (opacity, which children can't override the way they can visibility).
    for (const h of c.hide || []) {
      await p.locator(h).first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {}); // banners often arrive late
      await p.waitForTimeout(400);
      for (const el of await p.locator(h).elementHandles()) {
        await el.evaluate((n) => {
          const up = (x) => x.parentElement || x.getRootNode?.().host || null;
          let box = n;
          while (box && box !== document.body && !['fixed', 'sticky'].includes(getComputedStyle(box).position)) box = up(box);
          const target = box && box !== document.body ? box : n;
          target.style.setProperty('transition', 'none', 'important'); // or it fades out mid-shot
          target.style.setProperty('opacity', '0', 'important');
          target.style.setProperty('pointer-events', 'none', 'important');
        });
      }
    }
    if (!(await lockHolds(p))) { note(c.id, 'LOCKED', `left "${lock.text}" during the steps. Not saved.`); continue; }
    const png = await p.screenshot({ mask: (c.mask || []).map((m) => p.locator(m)), maskColor: MASK });
    guard();
    if (!(await lockHolds(p))) { note(c.id, 'LOCKED', `left "${lock.text}" while shooting. Not saved.`); continue; }
    const out = join(OUT, `${c.id}.png`);
    writeFileSync(out, png);
    note(c.id, 'ok', `${out}  (${new URL(p.url()).pathname})${stopped.length ? `  left blank: ${stopped.join(', ')}` : ''}`, { file: out, stopped: [...stopped] });
  } catch (e) {
    note(c.id, e.blocked ? 'BLOCKED' : 'FAIL', e.message.split('\n')[0]);
  } finally {
    await p?.close().catch(() => {});
  }
}
if (ctx) await ctx.close();
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
process.exit(report.every((r) => r.status === 'ok') ? 0 : 1);
