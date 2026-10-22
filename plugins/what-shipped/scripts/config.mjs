// Shared by every script: finds config.json and fills defaults.
// Lookup order: --config <path>, WHAT_SHIPPED_CONFIG, ../config.json (the usual
// what-shipped/<video>/ layout), ./config.json.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULTS = {
  branch: null, // null means the repo's default branch
  windowHours: 24,
  release: { mode: 'none' },
  skip: [
    '^(test|tests|ci|chore|refactor|build|style|perf|docs|deps)(\\(.+\\))?!?:',
    '^(bump|update|upgrade) .*(dependenc|version|to v?\\d)',
    'renovate|dependabot|\\[bot\\]',
  ],
  brand: {
    name: null,
    logo: null,
    colors: { ink: '#111110', paper: '#F4F3EE', tint: '#E9E7DF', muted: '#6A6962', rule: '#D8D6CE', accent: '#D9420B' },
    fonts: { display: 'Newsreader', mono: 'JetBrains Mono' },
  },
  voice: { voice: 'af_heart', speed: 1.0, pronounce: {} },
  outro: 'Questions? Reply in the thread.',
};

export function configPath(argv = process.argv) {
  const i = argv.indexOf('--config');
  const candidates = [i > -1 ? argv[i + 1] : null, process.env.WHAT_SHIPPED_CONFIG, '../config.json', 'config.json'];
  for (const c of candidates) if (c && existsSync(c)) return resolve(c);
  return null;
}

export function loadConfig(argv = process.argv) {
  const path = configPath(argv);
  if (!path) throw new Error('No config.json found. Run scaffold.mjs first, or pass --config <path>.');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const cfg = { ...DEFAULTS, ...raw, path };
  cfg.brand = {
    ...DEFAULTS.brand,
    ...raw.brand,
    colors: { ...DEFAULTS.brand.colors, ...raw.brand?.colors },
    fonts: { ...DEFAULTS.brand.fonts, ...raw.brand?.fonts },
  };
  cfg.voice = { ...DEFAULTS.voice, ...raw.voice };
  if (!cfg.brand.name && cfg.repo) cfg.brand.name = cfg.repo.split('/')[1];
  return cfg;
}
