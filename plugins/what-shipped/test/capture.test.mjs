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

before(async () => { app = await startFixture(); dir = mkdtempSync(join(tmpdir(), 'ws-capture-')); });
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

test('captures only locked, safe pages and never opens a write-on-load page', async () => {
  const { code, out, report } = await run(config({ lock: LOCK }), [
    { id: 'home', url: '/app/home', waitFor: 'This week', steps: [{ tab: 'Week' }] },
    { id: 'via-link', url: '/app/home', steps: [{ link: 'Reports' }] },
    { id: 'blocked-direct', url: '/app/schedule/new' },
    { id: 'blocked-link', url: '/app/home', steps: [{ link: 'New schedule' }] },
    { id: 'offsite-direct', url: 'https://example.com/' },
    { id: 'offsite-link', url: '/app/home', steps: [{ link: 'Docs' }] },
    { id: 'query-link', url: '/app/home', steps: [{ link: 'Team report' }] },
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
    'wrong-workspace': 'LOCKED', lookalike: 'LOCKED', 'no-lock': 'LOCKED', drift: 'LOCKED',
    'script-redirect': 'BLOCKED', 'server-redirect': 'BLOCKED', 'redirect-chain': 'BLOCKED',
    moved: 'MOVED', 'signed-out': 'FAIL', 'click-step': 'FAIL', '../escape': 'FAIL',
  }, out);
  assert.equal(code, 1, 'a run with refusals exits non-zero');
  assert.deepEqual(readdirSync(join(dir, 'out')).sort(), ['home.png', 'report.json', 'via-link.png'], 'only the two good captures were saved');
  assert.equal(app.hits['/app/schedule/new'], undefined, 'the write-on-load page was never requested');
  assert.equal(app.hits['/app/reports?invite=abc'], undefined, 'the invite link was never requested');
  assert.ok(app.hits['/app/reports'] >= 1, 'the Reports link was followed');
  assert.equal(app.clicks(), 0, 'links are followed by address, never clicked');
  const png = readFileSync(join(dir, 'out/home.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [2560, 1440], '1280x720 at 2x');
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
