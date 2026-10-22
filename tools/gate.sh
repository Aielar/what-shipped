#!/usr/bin/env bash
# The release gate. Checks what a stranger depends on, from scratch:
#   1. the marketplace and plugin manifests validate
#   2. a fresh clone (committed files only) installs into an isolated Claude config
#   3. the plugin folder alone, copied the way an install caches it, passes its tests
#      (capture safety against the fixture app, the Larkwork example build)
#   4. the private word list finds nothing in files or history
#   5. the README demo rebuilds end to end from docs/demo with the installed scripts:
#      PRs, live captures, voice, assembly, lint, a draft render, one frame per scene
# Usage: tools/gate.sh [--quick]   (--quick skips step 5, which needs gh, network and TTS)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/what-shipped-gate.XXXXXX")"
QUICK="${1:-}"
export HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_TELEMETRY=1
step() { printf '\n== %s\n' "$1"; }

step "1/5 Manifests"
claude plugin validate "$ROOT" | tail -1
claude plugin validate "$ROOT/plugins/what-shipped" | tail -1

step "2/5 Install from an empty folder"
git clone -q "$ROOT" "$WORK/clone"
mkdir -p "$WORK/empty" "$WORK/claude-config"
cd "$WORK/empty"
export CLAUDE_CONFIG_DIR="$WORK/claude-config"
claude plugin marketplace add "$WORK/clone" | tail -1
claude plugin install what-shipped@what-shipped | tail -1
claude plugin list | grep -A4 'what-shipped@what-shipped'
unset CLAUDE_CONFIG_DIR
PLUGIN="$WORK/clone/plugins/what-shipped"
test -f "$PLUGIN/skills/what-shipped/SKILL.md"

step "3/5 Plugin folder on its own: install deps, run tests"
cp -R "$PLUGIN" "$WORK/plugin-only"
(cd "$WORK/plugin-only" && npm install --no-audit --no-fund --loglevel=error >/dev/null && npm test 2>&1 | grep -E '^(✔|✖|ℹ (tests|pass|fail))')

step "4/5 Word scan (files and full history)"
node "$ROOT/tools/scan-words.mjs"

if [ "$QUICK" = "--quick" ]; then echo; echo "gate: quick pass, demo rebuild skipped. Work dir: $WORK"; exit 0; fi

step "5/5 Rebuild the README demo with the installed scripts"
DEMO="$ROOT/docs/demo"
mkdir -p "$WORK/empty/what-shipped"
# Same config, with the capture profile kept inside the work folder.
node -e 'const c=require(process.argv[1]); c.capture.profile=process.argv[2]; console.log(JSON.stringify(c,null,2))' "$DEMO/config.json" "$WORK/chrome-profile" > "$WORK/empty/what-shipped/config.json"
cd "$WORK/empty"
node "$PLUGIN/scripts/scaffold.mjs" demo | tail -1
cd what-shipped/demo
cp "$DEMO/lines.json" "$DEMO/scenes.json" "$DEMO/captures.json" .
node prs.mjs --until "$(cat "$DEMO/until.txt")" | tail -1
node capture.mjs captures.json | awk '{print $1, $2}'
node voice.mjs | grep narration
node assemble.mjs | tail -1
npx hyperframes lint --json | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(`lint: ${r.errorCount} errors, ${r.warningCount} warnings`); process.exit(r.errorCount ? 1 : 0)'
npx hyperframes render --quality draft --output renders/draft.mp4 2> "$WORK/render.log" | grep -E 'rendered in'
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 renders/draft.mp4)
node -e "const d=+process.argv[1]; console.log('duration', d.toFixed(1)+'s'); process.exit(d>=90&&d<=120?0:1)" "$DUR"
mkdir -p frames
node -e 'const t=require("./timing.json"); const s=require("./scenes.json"); console.log(s.map(x=>{const w=t.scenes[x.scene]; return ((w.start+w.end)/2).toFixed(2)}).join(" "))' | tr ' ' '\n' | while read -r t; do
  ffmpeg -y -loglevel error -ss "$t" -i renders/draft.mp4 -frames:v 1 "frames/at-$t.png"
done
ls frames
echo; echo "gate: pass. Draft: $PWD/renders/draft.mp4  Frames: $PWD/frames"
