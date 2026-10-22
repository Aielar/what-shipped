// Proves capture.mjs stays read-only and fail-closed against a local fake product.
// Needs Google Chrome installed (the script drives the real browser, like in production).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture/server.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/capture.mjs');
let app, dir;

// Async on purpose: the fixture server lives in this process and must keep answering.
async function run(config, captures) {
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'captures.json'), JSON.stringify(captures));
  const child = spawn(process.execPath, [SCRIPT, 'captures.json', '--config', 'config.json', '--out', 'out'], { cwd: dir });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((done) => child.on('close', done));
  const reportFile = join(dir, 'out/report.json');
  const report = existsSync(reportFile) ? Object.fromEntries(JSON.parse(readFileSync(reportFile, 'utf8')).map((x) => [x.id, x])) : {};
  return { code, out, report };
}
const config = (capture) => ({ repo: 'larkwork/larkwork', capture: { baseUrl: app.url, profile: join(dir, 'profile'), ...capture } });
const LOCK = { selector: '[data-workspace]', text: 'Larkwork Demo' };
const RULES = { blocked: ['^/app/private'], allowRequests: ['/app/query$'] };

before(async () => { app = await startFixture(); dir = mkdtempSync(join(tmpdir(), 'ws-capture-')); });
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

test('captures only locked, safe pages and never opens a write-on-load page', async () => {
  const { code, out, report } = await run(config({ lock: LOCK, ...RULES }), [
    { id: 'home', url: '/app/home', waitFor: 'This week', steps: [{ tab: 'Week' }] },
    { id: 'via-link', url: '/app/home', steps: [{ link: 'Reports' }] },
    { id: 'blocked-direct', url: '/app/schedule/new' },
    { id: 'blocked-link', url: '/app/home', steps: [{ link: 'New schedule' }] },
    { id: 'offsite-direct', url: 'https://example.com/' },
    { id: 'offsite-link', url: '/app/home', steps: [{ link: 'Docs' }] },
    { id: 'query-link', url: '/app/home', steps: [{ link: 'Team report' }] },
    { id: 'encoded-query', url: '/app/home', steps: [{ link: 'Weekly template' }] },
    { id: 'encoded-path', url: '/app/home', steps: [{ link: 'Encoded new' }] },
    { id: 'extension-path', url: '/app/home', steps: [{ link: 'New as JSON' }] },
    { id: 'iframe', url: '/app/framed' },
    { id: 'offsite-frame', url: '/app/embedded' },
    { id: 'popup', url: '/app/popup' },
    { id: 'push-state', url: '/app/pushy', settleNav: 1200 },
    { id: 'hash-route', url: '/app/home#/schedule/new' },
    { id: 'post-on-load', url: '/app/writer' },
    { id: 'allowed-request', url: '/app/reader' },
    { id: 'config-pattern', url: '/app/private' },
    { id: 'lookalike-path', url: '/app/short' },
    { id: 'wrong-workspace', url: '/app/other' },
    { id: 'lookalike', url: '/app/lookalike' },
    { id: 'no-lock', url: '/app/nolock' },
    { id: 'drift', url: '/app/drift', steps: [{ wait: 2500 }] },
    { id: 'script-redirect', url: '/app/sneaky', settleNav: 1500 },
    { id: 'server-redirect', url: '/app/bounce' },
    { id: 'redirect-chain', url: '/app/chain' },
    { id: 'moved', url: '/app/moved' },
    { id: 'signed-out', url: '/app/expired' },
    { id: 'click-step', url: '/app/home', steps: [{ click: 'Save' }] },
    { id: '../escape', url: '/app/home' },
  ]);
  const status = Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.status]));
  assert.deepEqual(status, {
    home: 'ok', 'via-link': 'ok',
    'blocked-direct': 'BLOCKED', 'blocked-link': 'BLOCKED', 'offsite-direct': 'BLOCKED', 'offsite-link': 'BLOCKED', 'query-link': 'BLOCKED',
    'encoded-query': 'BLOCKED', 'encoded-path': 'BLOCKED', 'extension-path': 'BLOCKED', iframe: 'ok', 'offsite-frame': 'ok', popup: 'ok',
    'push-state': 'BLOCKED', 'hash-route': 'BLOCKED', 'post-on-load': 'ok', 'allowed-request': 'ok', 'config-pattern': 'BLOCKED', 'lookalike-path': 'MOVED',
    'wrong-workspace': 'LOCKED', lookalike: 'LOCKED', 'no-lock': 'LOCKED', drift: 'LOCKED',
    'script-redirect': 'BLOCKED', 'server-redirect': 'BLOCKED', 'redirect-chain': 'BLOCKED',
    moved: 'MOVED', 'signed-out': 'FAIL', 'click-step': 'FAIL', '../escape': 'FAIL',
  }, out);
  assert.equal(code, 1, 'a run with refusals exits non-zero');
  assert.deepEqual(readdirSync(join(dir, 'out')).sort(), ['allowed-request.png', 'home.png', 'iframe.png', 'offsite-frame.png', 'popup.png', 'post-on-load.png', 'report.json', 'via-link.png'], 'only the good captures were saved');
  assert.equal(app.hits['/app/save'], undefined, 'a POST fired on load never left the browser');
  assert.ok(report['post-on-load'].stopped.some((s) => s.startsWith('POST')), 'and the refused write is reported');
  assert.equal(app.hits['/app/query'], 1, 'a request listed in allowRequests goes through');
  assert.equal(app.hits['/app/private'], undefined, 'a capture.blocked pattern is never opened');
  assert.equal(app.hits['/embed/video'], 1, 'a frame from another site loads');
  assert.deepEqual(report['offsite-frame'].stopped, [], 'and is not reported as refused');
  assert.equal(report.iframe.stopped.length, 1, 'the write-on-load frame was left blank');
  assert.equal(report.popup.stopped.length >= 1, true, 'the popup was refused');
  for (const p of ['/app/schedule/new', '/app/schedule/%6Eew', '/app/schedule/new.json', '/app/reports?%74emplate=weekly']) {
    assert.equal(app.hits[p], undefined, `${p} was never requested`);
  }
  assert.equal(app.hits['/app/reports?invite=abc'], undefined, 'the invite link was never requested');
  assert.ok(app.hits['/app/reports'] >= 1, 'the Reports link was followed');
  assert.ok(app.hits['/app/framed'] === 1 && app.hits['/app/popup'] === 1, 'pages with a bad frame or popup still load once');
  assert.equal(app.clicks(), 0, 'links are followed by address, never clicked');
  const png = readFileSync(join(dir, 'out/home.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [2560, 1440], '1280x720 at 2x');
});

test('a role lock matches the exact name unless prefix matching is asked for', async () => {
  rmSync(join(dir, 'out'), { recursive: true, force: true });
  const exact = await run(config({ lock: { role: 'button', text: 'Larkwork Demo' } }), [
    { id: 'home', url: '/app/home' }, { id: 'lookalike', url: '/app/lookalike' }, { id: 'other', url: '/app/other' },
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(exact.report).map(([k, v]) => [k, v.status])), { home: 'ok', lookalike: 'LOCKED', other: 'LOCKED' }, exact.out);
  const prefix = await run(config({ lock: { role: 'button', text: 'Larkwork Demo', match: 'prefix' } }), [{ id: 'lookalike', url: '/app/lookalike' }]);
  assert.equal(prefix.report.lookalike.status, 'ok', prefix.out);
});

test('no lock in the config means nothing runs and nothing is requested', async () => {
  rmSync(join(dir, 'out'), { recursive: true, force: true });
  const before = JSON.stringify(app.hits);
  for (const capture of [{}, { lock: { text: 'Larkwork Demo' } }, { lock: { selector: '[data-workspace]' } }]) {
    const { code, out } = await run(config(capture), [{ id: 'home', url: '/app/home' }]);
    assert.equal(code, 2, out);
    assert.match(out, /Nothing captured/);
  }
  assert.equal(existsSync(join(dir, 'out')), false, 'no output folder, no files');
  assert.equal(JSON.stringify(app.hits), before, 'the server saw no requests');
});
