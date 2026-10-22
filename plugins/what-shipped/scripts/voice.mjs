#!/usr/bin/env node
// Builds the narration from lines.json with local Kokoro TTS: one clip per line, joined
// with pauses, plus timing.json (line and scene windows), words.json (every spoken word
// on the joined timeline, from Whisper) and a music bed sized to the video.
//
//   node voice.mjs [--no-words]
//
// lines.json: [{ "id": "l01", "scene": "open", "text": "Shown in captions.", "tts": "Optional, what the voice reads." }]
// Without "tts" the voice reads "text" with config.voice.pronounce applied
// ({ "Larkwork": "Lark work" }). Unchanged lines reuse their clip on the next run.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';

const cfg = loadConfig();
const LEAD_IN = 0.6;   // silence before the first line
const GAP_LINE = 0.34; // pause between lines in one scene
const GAP_SCENE = 0.8; // pause when the scene changes
const TAIL = 3.2;      // hold after the last line for the end card
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// Kokoro needs a Python with kokoro-onnx and soundfile. Use one that has them, or make one.
function python() {
  const ok = (py) => { try { run(py, ['-c', 'import kokoro_onnx, soundfile']); return true; } catch { return false; } };
  const candidates = [process.env.HYPERFRAMES_PYTHON, join(homedir(), '.cache/hyperframes/tts-venv/bin/python'),
    join(homedir(), '.cache/what-shipped/tts-venv/bin/python'), 'python3'].filter(Boolean);
  const found = candidates.find((p) => (p === 'python3' || existsSync(p)) && ok(p));
  if (found) return found;
  const venv = join(homedir(), '.cache/what-shipped/tts-venv');
  console.log(`Setting up Kokoro TTS in ${venv} (one time, about a minute)...`);
  run('python3', ['-m', 'venv', venv], { stdio: 'inherit' });
  run(join(venv, 'bin/pip'), ['install', '--quiet', 'kokoro-onnx', 'soundfile'], { stdio: 'inherit' });
  return join(venv, 'bin/python');
}

const lines = JSON.parse(readFileSync('lines.json', 'utf8'));
const ids = new Set();
for (const l of lines) {
  if (!l.id || !l.scene || !l.text) throw new Error(`Every line needs id, scene and text: ${JSON.stringify(l)}`);
  if (ids.has(l.id)) throw new Error(`Duplicate line id ${l.id}`);
  ids.add(l.id);
}
const say = (l) => l.tts || Object.entries(cfg.voice.pronounce || {})
  .reduce((t, [from, to]) => t.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), to), l.text);

const env = { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_TELEMETRY: '1' };
mkdirSync('vo-lines', { recursive: true });
let py = null;
for (const l of lines) {
  const wav = `vo-lines/${l.id}.wav`, txt = `vo-lines/${l.id}.txt`;
  const spoken = say(l);
  if (existsSync(wav) && existsSync(txt) && readFileSync(txt, 'utf8') === spoken) continue;
  env.HYPERFRAMES_PYTHON = py ||= python();
  writeFileSync(txt, spoken);
  console.log(`tts ${l.id}: ${spoken}`);
  run('npx', ['hyperframes', 'tts', txt, '--voice', cfg.voice.voice, '--speed', String(cfg.voice.speed), '--output', wav], { env });
}

// One timeline: lead-in, each clip, a pause sized by whether the scene changes.
const dur = (f) => parseFloat(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]));
const timing = { voice: cfg.voice.voice, speed: cfg.voice.speed, lines: [], scenes: {} };
const parts = [{ silence: LEAD_IN }];
let t = LEAD_IN;
lines.forEach((l, i) => {
  const d = dur(`vo-lines/${l.id}.wav`);
  timing.lines.push({ id: l.id, scene: l.scene, start: +t.toFixed(3), end: +(t + d).toFixed(3), text: l.text });
  const s = (timing.scenes[l.scene] ||= { start: +t.toFixed(3) });
  if (s.closed) throw new Error(`Scene "${l.scene}" comes back after another scene. Keep each scene's lines together.`);
  s.end = +(t + d).toFixed(3);
  parts.push({ file: `vo-lines/${l.id}.wav` });
  const next = lines[i + 1];
  if (next && next.scene !== l.scene) s.closed = true;
  const gap = !next ? TAIL : next.scene === l.scene ? GAP_LINE : GAP_SCENE;
  parts.push({ silence: gap });
  t += d + gap;
});
for (const s of Object.values(timing.scenes)) delete s.closed;
timing.total = +t.toFixed(3);

const ff = ['-y', '-loglevel', 'error'];
parts.forEach((p) => p.file ? ff.push('-i', p.file) : ff.push('-f', 'lavfi', '-t', String(p.silence), '-i', 'anullsrc=r=24000:cl=mono'));
const chains = parts.map((_, i) => `[${i}:a]aresample=24000,aformat=channel_layouts=mono[a${i}]`).join(';');
ff.push('-filter_complex', `${chains};${parts.map((_, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`, '-map', '[out]', '-ar', '48000', 'narration.wav');
run('ffmpeg', ff);
writeFileSync('timing.json', JSON.stringify(timing, null, 2) + '\n');

// Music bed: a slow two-chord pad (A major 9 to F sharp minor 9), soft and low-passed,
// that sits under the voice and fades at both ends.
mkdirSync('assets', { recursive: true });
const T = Math.ceil(timing.total) + 1;
// Commas inside a filter expression must be escaped, or ffmpeg reads them as filter separators.
const chord = (a, b) => a.map((f, i) => `0.16*sin(2*PI*if(lt(mod(t\\,16)\\,8)\\,${f}\\,${b[i]})*t)`).join('+');
const pad = chord([110, 164.81, 277.18, 415.3, 493.88], [92.5, 138.59, 220, 329.63, 415.3]);
run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc=${pad}:s=48000:d=${T}`,
  '-af', `lowpass=f=1400,tremolo=f=0.12:d=0.3,aecho=0.6:0.5:120|240:0.25|0.15,afade=t=in:d=3,afade=t=out:st=${T - 4}:d=4,volume=0.5`,
  '-ac', '2', 'assets/bed.wav']);

// Word hits: transcribe each clip on its own and shift it onto the joined timeline.
if (!process.argv.includes('--no-words')) {
  const words = [];
  for (const l of timing.lines) {
    const dir = `vo-lines/w-${l.id}`;
    const src = readFileSync(`vo-lines/${l.id}.txt`, 'utf8');
    if (!existsSync(`${dir}/transcript.json`) || !existsSync(`${dir}/.src`) || readFileSync(`${dir}/.src`, 'utf8') !== src) {
      mkdirSync(dir, { recursive: true });
      run('npx', ['hyperframes', 'transcribe', `vo-lines/${l.id}.wav`, '--dir', dir, '--model', process.env.WHAT_SHIPPED_WHISPER || 'small.en'], { env });
      writeFileSync(`${dir}/.src`, src);
    }
    const tr = JSON.parse(readFileSync(`${dir}/transcript.json`, 'utf8'));
    for (const w of Array.isArray(tr) ? tr : tr.words || []) {
      words.push({ text: w.text ?? w.word, start: +(l.start + w.start).toFixed(3), end: +(l.start + w.end).toFixed(3), line: l.id, scene: l.scene });
    }
  }
  writeFileSync('words.json', JSON.stringify(words, null, 1) + '\n');
}

console.log(`narration.wav ${timing.total}s, ${timing.lines.length} lines`);
for (const [k, v] of Object.entries(timing.scenes)) console.log(`${k.padEnd(16)} ${v.start.toFixed(2).padStart(7)} -> ${v.end.toFixed(2)}`);
