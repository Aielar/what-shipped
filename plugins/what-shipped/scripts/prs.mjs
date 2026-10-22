#!/usr/bin/env node
// Lists the PRs merged in the window and decides, per PR, whether it is live yet.
// Writes prs.json (the facts every later step is checked against) and prints a table.
//
//   node prs.mjs [--hours 24] [--until 2026-10-22T09:00:00Z]
//
// Release detection comes from config.json "release":
//   { "mode": "tag",    "match": "^v\\d" }      live once a published release contains the merge
//   { "mode": "commit", "match": "^\\d+\\.\\d+\\.0$", "author": "github-actions[bot]" }
//                                              live once a matching commit lands after the merge
//   { "mode": "merge" }                          merged means deployed (continuous delivery)
//   { "mode": "none" }                           never say live, only merged
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';

const cfg = loadConfig();
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : null; };
if (!cfg.repo) { console.error('config.json has no "repo".'); process.exit(2); }
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const api = (path) => JSON.parse(gh('api', '--paginate', '--slurp', path)).flat();

const until = flag('--until') ? new Date(flag('--until')) : new Date();
const hours = Number(flag('--hours') || cfg.windowHours || 24);
const since = new Date(until - hours * 3600e3);
const branch = cfg.branch || JSON.parse(gh('repo', 'view', cfg.repo, '--json', 'defaultBranchRef')).defaultBranchRef.name;
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');

const fields = 'number,title,body,author,mergedAt,url,labels,additions,deletions,changedFiles,mergeCommit';
const raw = JSON.parse(gh('pr', 'list', '-R', cfg.repo, '--state', 'merged', '--base', branch, '--limit', '500',
  '--search', `merged:>=${iso(since)}`, '--json', fields))
  .filter((p) => new Date(p.mergedAt) <= until)
  .sort((a, b) => new Date(a.mergedAt) - new Date(b.mergedAt));

const skip = (cfg.skip || []).map((s) => new RegExp(s, 'i'));
const isBot = (login = '') => /\[bot\]$|^(dependabot|renovate|github-actions)/i.test(login);

// Release detection.
const rel = cfg.release || { mode: 'none' };
const match = rel.match ? new RegExp(rel.match) : /.*/;
let releasesInWindow = 0;
let statusOf = () => ({ status: 'merged', version: null });
if (rel.mode === 'merge') statusOf = () => ({ status: 'live', version: null });
if (rel.mode === 'commit') {
  const commits = api(`repos/${cfg.repo}/commits?sha=${encodeURIComponent(branch)}&since=${iso(since)}&per_page=100`)
    .map((c) => ({ subject: c.commit.message.split('\n')[0], author: c.author?.login || '', at: new Date(c.commit.committer.date) }))
    .filter((c) => match.test(c.subject) && (!rel.author || c.author === rel.author))
    .sort((a, b) => a.at - b.at);
  releasesInWindow = commits.filter((c) => c.at <= until).length;
  statusOf = (p) => {
    const r = commits.find((c) => c.at > new Date(p.mergedAt));
    return r ? { status: 'live', version: r.subject } : { status: 'next release', version: null };
  };
}
if (rel.mode === 'tag') {
  const releases = JSON.parse(gh('release', 'list', '-R', cfg.repo, '--limit', '40', '--exclude-drafts', '--json', 'tagName,publishedAt,isPrerelease'))
    .filter((r) => (rel.prerelease || !r.isPrerelease) && match.test(r.tagName))
    .map((r) => ({ tag: r.tagName, at: new Date(r.publishedAt) }))
    .sort((a, b) => a.at - b.at);
  releasesInWindow = releases.filter((r) => r.at >= since && r.at <= until).length;
  const contains = new Map();
  const has = (tag, sha) => {
    const key = `${tag}:${sha}`;
    if (!contains.has(key)) {
      try { contains.set(key, ['behind', 'identical'].includes(JSON.parse(gh('api', `repos/${cfg.repo}/compare/${encodeURIComponent(tag)}...${sha}`, '--jq', '{status}')).status)); }
      catch { contains.set(key, false); }
    }
    return contains.get(key);
  };
  statusOf = (p) => {
    const sha = p.mergeCommit?.oid;
    const r = sha && releases.filter((x) => x.at > new Date(p.mergedAt)).slice(0, 3).find((x) => has(x.tag, sha));
    return r ? { status: 'live', version: r.tag } : { status: 'next release', version: null };
  };
}

const prs = raw.map((p) => {
  const login = p.author?.login || 'ghost';
  return {
    number: p.number,
    title: p.title,
    author: login,
    mergedAt: p.mergedAt,
    url: p.url,
    labels: (p.labels || []).map((l) => l.name),
    size: (p.additions || 0) + (p.deletions || 0),
    files: p.changedFiles,
    internal: isBot(login) || skip.some((re) => re.test(p.title)),
    ...statusOf(p),
    body: (p.body || '').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 2000),
  };
});

const span = until - since;
const out = {
  repo: cfg.repo,
  branch,
  since: iso(since),
  until: iso(until),
  release: rel,
  counts: {
    merged: prs.length,
    external: prs.filter((p) => !p.internal).length,
    builders: new Set(prs.map((p) => p.author).filter((a) => !isBot(a))).size,
    releases: releasesInWindow,
    live: prs.filter((p) => p.status === 'live').length,
  },
  authors: [...new Set(prs.map((p) => p.author).filter((a) => !isBot(a)))],
  merges: prs.map((p) => ({ n: p.number, x: +((new Date(p.mergedAt) - since) / span).toFixed(4), size: p.size, internal: p.internal })),
  prs,
};
writeFileSync('prs.json', JSON.stringify(out, null, 2) + '\n');

console.log(`${cfg.repo}@${branch}  ${out.since} -> ${out.until}  release mode: ${rel.mode}`);
for (const p of prs) console.log(`${String(p.number).padStart(7)}  ${p.status.padEnd(12)} ${p.internal ? 'internal ' : '         '}${p.title.slice(0, 90)}  (${p.author})`);
const k = out.counts;
console.log(`\n${k.merged} merged, ${k.external} audience candidates, ${k.builders} builders, ${k.releases} releases in window, ${k.live} live. Wrote prs.json`);
