// Builds the Larkwork example end to end without a voice: scaffold, synthetic timing
// (one word every 0.36 s), assemble, then HyperFrames lint. Keeps the example and the
// templates honest with each other. Needs ffmpeg and the repo's node_modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = join(PLUGIN, 'examples/larkwork');
const NODE_MODULES = join(dirname(createRequire(import.meta.url).resolve('hyperframes/package.json')), '..');

test('the Larkwork example assembles and lints clean', () => {
  const home = mkdtempSync(join(tmpdir(), 'ws-example-'));
  try {
    // A workspace whose dependencies are already in place, so scaffold skips npm install.
    const deps = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).dependencies;
    writeFileSync(join(home, 'package.json'), JSON.stringify({ name: 'what-shipped-videos', private: true, type: 'module', dependencies: deps }));
    symlinkSync(NODE_MODULES, join(home, 'node_modules'));
    cpSync(join(EXAMPLE, 'config.json'), join(home, 'config.json'));
    execFileSync(process.execPath, [join(PLUGIN, 'scripts/scaffold.mjs'), 'example', '--home', home], { stdio: 'pipe' });

    const v = join(home, 'example');
    for (const f of ['lines.json', 'scenes.json', 'prs.json']) cpSync(join(EXAMPLE, f), join(v, f));
    cpSync(join(EXAMPLE, 'scenes'), join(v, 'scenes'), { recursive: true });

    // Synthetic voice: the caption text, word by word.
    const lines = JSON.parse(readFileSync(join(v, 'lines.json'), 'utf8'));
    const timing = { lines: [], scenes: {} }, words = [];
    let t = 0.6;
    lines.forEach((l, i) => {
      const start = t;
      for (const w of l.text.split(/\s+/)) { words.push({ text: w, start: +t.toFixed(3), end: +(t + 0.3).toFixed(3), line: l.id, scene: l.scene }); t += 0.36; }
      timing.lines.push({ id: l.id, scene: l.scene, start: +start.toFixed(3), end: +t.toFixed(3), text: l.text });
      const s = (timing.scenes[l.scene] ||= { start: +start.toFixed(3) });
      s.end = +t.toFixed(3);
      t += !lines[i + 1] ? 3.2 : lines[i + 1].scene === l.scene ? 0.34 : 0.8;
    });
    timing.total = +t.toFixed(3);
    writeFileSync(join(v, 'timing.json'), JSON.stringify(timing));
    writeFileSync(join(v, 'words.json'), JSON.stringify(words));
    const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { cwd: v });
    ff('-f', 'lavfi', '-t', String(timing.total), '-i', 'anullsrc=r=48000:cl=stereo', 'narration.wav');
    ff('-f', 'lavfi', '-t', String(timing.total), '-i', 'anullsrc=r=48000:cl=stereo', 'assets/bed.wav');
    mkdirSync(join(v, 'assets/captures'), { recursive: true });
    ff('-f', 'lavfi', '-i', 'color=c=0xe9e7df:s=2560x1440', '-frames:v', '1', 'assets/captures/hours.png');

    const out = execFileSync(process.execPath, ['assemble.mjs'], { cwd: v, encoding: 'utf8' });
    assert.match(out, /captions/);
    const comps = readdirSync(join(v, 'compositions')).sort();
    assert.deepEqual(comps, ['captions.html', 's01-open.html', 's02-swaps.html', 's03-hours.html', 's04-fixes.html', 's05-close.html']);
    for (const c of comps) assert.doesNotMatch(readFileSync(join(v, 'compositions', c), 'utf8'), /\{\{/, `${c} has an unresolved token`);

    const lint = JSON.parse(execFileSync(join(NODE_MODULES, '.bin/hyperframes'), ['lint', '--json'], {
      cwd: v, encoding: 'utf8', env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_TELEMETRY: '1' },
    }));
    assert.equal(lint.errorCount, 0, JSON.stringify(lint.findings).slice(0, 2000));
    assert.equal(lint.warningCount, 0, JSON.stringify(lint.findings).slice(0, 2000));
    assert.ok(existsSync(join(v, 'index.html')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
