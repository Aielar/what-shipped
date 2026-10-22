#!/usr/bin/env node
// Fails when any term from a private word list appears in this repo: file contents,
// file paths, refs, and the full history (git log -p, authors and messages included).
//
// The list never ships with the repo. It comes from, in order:
//   BANNED_WORDS        env var, one term per line (the CI secret)
//   BANNED_WORDS_FILE   path to a file with one term per line
//   ~/.config/what-shipped/banned-words.txt
// A term is a whole word ("cat" passes "concatenate"); prefix it with "anywhere:" to
// match inside words too. Lines starting with # are comments.
//
// Hits are reported by location and term number, never by the term itself, so a CI
// log on a public repo can't leak the list. No list found means failure, not a pass.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repo this script lives in, wherever it is run from.
const root = execFileSync('git', ['-C', dirname(fileURLToPath(import.meta.url)), 'rev-parse', '--show-toplevel']).toString().trim();
const fallback = join(homedir(), '.config/what-shipped/banned-words.txt');
const raw = process.env.BANNED_WORDS
  || (process.env.BANNED_WORDS_FILE && readFileSync(process.env.BANNED_WORDS_FILE, 'utf8'))
  || (existsSync(fallback) && readFileSync(fallback, 'utf8'))
  || '';
const terms = raw.split(/[\r\n,]+/).map((t) => t.trim()).filter((t) => t && !t.startsWith('#'));
if (!terms.length) {
  console.error('scan-words: no word list. Set BANNED_WORDS or BANNED_WORDS_FILE, or write ~/.config/what-shipped/banned-words.txt.');
  process.exit(2);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rules = terms.map((t, i) => {
  const anywhere = t.startsWith('anywhere:');
  const word = anywhere ? t.slice(9) : t;
  return { n: i + 1, re: new RegExp(anywhere ? esc(word) : `(?<![A-Za-z0-9])${esc(word)}(?![A-Za-z0-9])`, 'i') };
});

const hits = [];
function scan(label, text) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const r of rules) if (r.re.test(line)) hits.push(`${label}:${i + 1}  term #${r.n}`);
  });
}
const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 30 }).toString('latin1');

// Every file that would ship: tracked plus untracked-but-not-ignored. In a binary file
// (images, video) the readable runs of 8 or more characters are scanned: metadata, paths
// and embedded text show up there, while four random bytes of compressed pixels that
// happen to spell a word do not.
const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
let scanned = 0;
for (const f of new Set(files)) {
  scan(`path ${f}`, f);
  const p = join(root, f);
  if (!existsSync(p) || !statSync(p).isFile()) continue;
  const buf = readFileSync(p);
  const binary = buf.subarray(0, 8192).includes(0);
  scan(f, binary ? (buf.toString('latin1').match(/[\x20-\x7e]{8,}/g) || []).join('\n') : buf.toString('latin1'));
  scanned++;
}

// History: every commit on every ref, with patches, authors, committers and messages.
let commits = 0;
const hasHead = (() => { try { execFileSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' }); return true; } catch { return false; } })();
if (hasHead) {
  commits = Number(git('rev-list', '--all', '--count').trim());
  scan('git log', git('log', '--all', '-p', '--format=fuller'));
  scan('git refs', git('for-each-ref', '--format=%(refname) %(taggername) %(taggeremail) %(contents)'));
}

if (hits.length) {
  console.error(`scan-words: FAIL, ${hits.length} hit(s)`);
  for (const h of hits.slice(0, 200)) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`scan-words: clean. ${terms.length} terms, ${scanned} files, ${commits} commits (git log -p --all).`);
