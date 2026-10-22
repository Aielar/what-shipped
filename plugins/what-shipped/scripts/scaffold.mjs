#!/usr/bin/env node
// Sets up a what-shipped workspace and one video project inside it.
//
//   node scaffold.mjs [slug] [--repo owner/name] [--home what-shipped]
//
// The workspace (./what-shipped by default) holds config.json, one shared node_modules
// and a folder per video. The first run writes config.json from what GitHub knows about
// the repo; review it once (release, capture, brand) and later runs reuse it.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const HOME = resolve(flag('--home') || 'what-shipped');
const slug = positional[0] || new Date().toISOString().slice(0, 10);
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const say = (s) => console.log(s);

for (const [tool, probe] of [['node', ['--version']], ['gh', ['--version']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']]]) {
  try { sh(tool, probe); } catch { console.error(`Missing ${tool}. Install it, then run this again.`); process.exit(2); }
}
mkdirSync(HOME, { recursive: true });

// 1. config.json, written once from the repo's GitHub metadata.
const configFile = join(HOME, 'config.json');
if (!existsSync(configFile)) {
  const repoFlag = flag('--repo');
  let meta;
  try {
    meta = JSON.parse(sh('gh', ['repo', 'view', ...(repoFlag ? [repoFlag] : []), '--json', 'nameWithOwner,name,homepageUrl,defaultBranchRef']));
  } catch (e) {
    console.error(`Couldn't read the repo from GitHub (${e.stderr?.trim() || e.message}).\nRun inside a clone, or pass --repo owner/name. Check \`gh auth status\`.`);
    process.exit(2);
  }
  let releases = [];
  try { releases = JSON.parse(sh('gh', ['release', 'list', '-R', meta.nameWithOwner, '--limit', '5', '--json', 'tagName'])); } catch {}
  const config = {
    repo: meta.nameWithOwner,
    branch: meta.defaultBranchRef?.name || 'main',
    windowHours: 24,
    release: releases.length
      ? { mode: 'tag', match: '.*', note: 'A PR is live once a published GitHub release contains it.' }
      : { mode: 'none', note: 'No releases found, so nothing is called live. See references/config.md for commit and merge modes.' },
    capture: {
      baseUrl: meta.homepageUrl || null,
      lock: null,
      blocked: [],
      pages: [],
    },
    brand: { name: meta.name, logo: null },
    voice: { voice: 'af_heart', speed: 1.0, pronounce: {} },
    outro: 'Questions? Reply in the thread.',
  };
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  say(`Wrote ${configFile} for ${meta.nameWithOwner}. Review "release", "capture" and "brand" once; references/config.md explains each.`);
}
process.env.WHAT_SHIPPED_CONFIG = configFile;
const cfg = loadConfig([]);

// 2. One node_modules for every video in the workspace, pinned to the plugin's versions.
const want = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).dependencies;
const pkgFile = join(HOME, 'package.json');
const have = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, 'utf8')).dependencies : null;
if (JSON.stringify(have) !== JSON.stringify(want) || !existsSync(join(HOME, 'node_modules/hyperframes'))) {
  writeFileSync(pkgFile, JSON.stringify({ name: 'what-shipped-videos', private: true, type: 'module', dependencies: want }, null, 2) + '\n');
  say('Installing hyperframes, gsap and playwright into the workspace (first run only)...');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: HOME, stdio: 'inherit' });
}
if (!existsSync(join(HOME, '.gitignore'))) writeFileSync(join(HOME, '.gitignore'), 'node_modules/\n*/vo-lines/\n*/renders/\n*/snapshots/\n*/frames/\n');

// 3. The video project.
const dest = join(HOME, slug);
if (existsSync(dest)) { console.error(`Already exists: ${dest}. Pick another name: node scaffold.mjs ${slug}-b`); process.exit(1); }
for (const d of ['scenes', 'compositions', 'assets']) mkdirSync(join(dest, d), { recursive: true });
for (const f of ['config.mjs', 'prs.mjs', 'voice.mjs', 'assemble.mjs', 'capture.mjs']) copyFileSync(join(PLUGIN, 'scripts', f), join(dest, f));
cpSync(join(PLUGIN, 'scenes'), join(dest, 'scenes'), { recursive: true });
for (const f of ['ledger.css', 'ledger.js']) copyFileSync(join(PLUGIN, 'design', f), join(dest, 'assets', f));
copyFileSync(join(HOME, 'node_modules/gsap/dist/gsap.min.js'), join(dest, 'assets/gsap.min.js'));
writeFileSync(join(dest, 'meta.json'), JSON.stringify({ id: slug, name: `What shipped in ${cfg.brand.name}, ${slug}` }, null, 2) + '\n');

// Brand: colors and fonts become CSS tokens. Font names are written out literally so
// the HyperFrames compiler finds and embeds them from Google Fonts at render time.
const { colors: c, fonts: f } = cfg.brand;
const lum = (hex) => {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onAccent = lum(c.accent) > 0.36 ? c.ink : c.paper;
const gf = (name, axes) => `family=${name.trim().replace(/ /g, '+')}:wght@${axes}`;
writeFileSync(join(dest, 'assets/theme.css'), `/* Generated from config.json "brand" by scaffold.mjs. Change the config, then copy the
   values here or scaffold a new video; scenes only read these tokens. Fonts come from Google
   Fonts; HyperFrames fetches and embeds them at render time. */
@import url("https://fonts.googleapis.com/css2?${gf(f.display, '400;500;600;700')}&${gf(f.mono, '400;500')}&display=block");
:root {
  --ink: ${c.ink}; --paper: ${c.paper}; --tint: ${c.tint}; --muted: ${c.muted}; --rule: ${c.rule};
  --accent: ${c.accent}; --on-accent: ${onAccent};
  --display: "${f.display}", Georgia, serif; --mono: "${f.mono}", ui-monospace, monospace;
}
.ws-display { font-family: "${f.display}", Georgia, serif; }
.ws-mono { font-family: "${f.mono}", ui-monospace, monospace; }
`);
let logo = '';
if (cfg.brand.logo) {
  const src = resolve(dirname(configFile), cfg.brand.logo);
  if (!existsSync(src)) { console.error(`brand.logo not found: ${src}`); process.exit(1); }
  logo = `assets/logo${extname(src)}`;
  copyFileSync(src, join(dest, logo));
}
writeFileSync(join(dest, 'brand.json'), JSON.stringify({ name: cfg.brand.name, logo, repo: cfg.repo, outro: cfg.outro }, null, 2) + '\n');

// Sound design, generated rather than shipped: a soft air sweep for scene changes,
// a short tick for rows and a low knock for status stamps.
const sfx = {
  'sfx-wipe.wav': ['-f', 'lavfi', '-i', 'anoisesrc=d=0.7:c=pink:a=0.9', '-af', 'highpass=f=400,lowpass=f=6000,afade=t=in:d=0.32:curve=exp,afade=t=out:st=0.34:d=0.36,volume=3.2'],
  'sfx-tick.wav': ['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*1760*t)*exp(-70*t)+0.25*sin(2*PI*3520*t)*exp(-110*t):s=48000:d=0.14'],
  'sfx-stamp.wav': ['-f', 'lavfi', '-i', 'aevalsrc=0.8*sin(2*PI*96*t)*exp(-22*t)+0.2*sin(2*PI*240*t)*exp(-40*t):s=48000:d=0.3'],
};
for (const [name, input] of Object.entries(sfx)) sh('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-ar', '48000', '-ac', '2', join(dest, 'assets', name)]);

say(`Ready: ${dest}
Next, from that folder:
  node prs.mjs                 merged PRs and release status -> prs.json
  (write lines.json)           then: node voice.mjs
  (write scenes.json)          then: node assemble.mjs && npx hyperframes lint`);
