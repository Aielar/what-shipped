---
name: what-shipped
description: Make a narrated 90 to 120 second video of what a GitHub repo merged in the last day, for people who don't read PRs (sales, support, ops, leadership). Reads merged PRs with gh, decides what is live from the repo's release signal, groups the day into 3 to 5 plain-language themes, captures real product screens read-only, and renders an MP4 with HyperFrames and local Kokoro TTS. Use when someone asks for a "what shipped" video, a changelog or release video, a daily product update video, "explain yesterday's merges to the team", or a video of recent PRs, even if they never say "skill".
---

# What shipped

Produces one MP4 (1920x1080, 30 fps, 90 to 120 s) that a salesperson can watch once and repeat:
what changed, where to find it, what isn't live yet. Every claim on screen carries its PR
number. Narrated by local Kokoro TTS, captioned for mute viewing, written in plain English.

<judgment>
The audience doesn't read PRs. Each change becomes before, after, and the button they'd click,
in a customer's words. Group the day into 3 to 5 themes, lead with the one a customer would
notice first, and keep internal work (tests, CI, refactors, dependency bumps) out of the
narration; the open scene still counts it on the rail.

Say "live" only about what is live. `prs.json` applies the repo's release rule from
`config.json`; anything that also needs a domain, a key, a flag or a deploy step gets checked
(curl the page, read the flag) before it is scripted. When unsure, say merged and coming next.

Every spoken sentence traces to a PR title, body or diff. A thin PR body means read the diff
or leave the PR out. Don't name a customer, and don't guess at numbers.

Real screens beat drawn mocks: use the capture scene wherever a change shows on a page you can
open read-only, and look at every PNG before it goes in. Write a custom scene only for what a
screenshot can't show.
</judgment>

## Flow

Scripts, scenes and the design live in `${CLAUDE_PLUGIN_ROOT}`. Each step's details are in
`${CLAUDE_SKILL_DIR}/references/`; read the one for a step before doing it.

1. **Scaffold.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.mjs" [--repo owner/name]` creates
   `what-shipped/<today>/` in the current folder. The first run writes `what-shipped/config.json`
   from GitHub; check `release`, `capture` and `brand` against `config.md` with the user once.
2. **PRs.** In the video folder, `node prs.mjs`. It writes `prs.json`: every PR merged in the
   window, flagged internal or not, with its live status.
3. **Digest.** Hand `digest-brief.md` to one subagent with the folder path so it writes
   `digest.md`, and start `captures.json` meanwhile. Then verify every live claim yourself.
4. **Script.** Write `lines.json` (`script-and-scenes.md`), run `node voice.mjs`, and read
   `words.json`: anchors must quote what the voice actually said.
5. **Capture.** `node capture.mjs captures.json` (`capture.md`). Read every PNG and place the
   focus boxes. `MOVED`, `LOCKED` or `BLOCKED` means that theme becomes a rows scene.
6. **Build.** Write `scenes.json`, then `node assemble.mjs` and `npx hyperframes lint`.
7. **Check.** `npx hyperframes snapshot . --at <the busiest second of each scene>`, look at every
   frame, fix, repeat. Then a draft render and frames at every scene boundary.
8. **Final.** `npx hyperframes render --quality standard --output renders/raw.mp4`, then
   `ffmpeg -i renders/raw.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k renders/what-shipped.mp4`.
   Write `VERIFY.md` in under 30 lines: gates run, frames checked, each spoken claim with its
   PR, what wasn't checked.
9. **Hand back** the MP4 path, the not-live list, and any theme that fell back from a real screen.

## Out of scope

Posting or sending the video: the user shares it. Recording flows that change data (creating,
deploying, inviting): those stay rows or a custom scene. Switching accounts or workspaces from
the capture script: the lock refuses instead, and the user fixes it with `node capture.mjs login`.

<smaller_model_fallback>
Running on a smaller or faster model (Haiku, Sonnet, or a non-Claude model)? Follow these
literal steps instead of exercising judgment. Skip `capture.mjs` and custom scenes entirely.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.mjs"` (add `--repo owner/name` if the
   current folder isn't a clone). `cd` into the folder it prints.
2. Run `node prs.mjs`. Read `prs.json`.
3. Drop every PR with `"internal": true`. Group the rest into at most 4 themes of at most 4 PRs,
   by the words in their titles. Write the themes and PR numbers to `themes.md` and stop for the
   user's OK.
4. Write `lines.json` shaped like `${CLAUDE_PLUGIN_ROOT}/examples/larkwork/lines.json`: two lines
   for scene `open`, then per theme one headline line ("One. <theme>.") and one line per PR, then
   two lines for scene `close`. Use only words from PR titles and bodies. A PR whose `status` is
   not `live` gets "coming in the next release" in its line.
5. Run `node voice.mjs`.
6. Write `scenes.json` shaped like `${CLAUDE_PLUGIN_ROOT}/examples/larkwork/scenes.json`, keeping
   only `open.html`, one `rows.html` entry per theme and `close.html`. Every `"t:..."` value is
   two consecutive words copied exactly from `words.json` for that scene. Row `status` is the
   PR's `status` from `prs.json`. NUM counts up from `001`. BG alternates `paper` and `tint`;
   each COVER is the next scene's BG, and the last rows scene has COVER `ink`.
7. Run `node assemble.mjs`, then `npx hyperframes lint`.
8. If lint shows 0 errors, run `npx hyperframes render --quality draft --output renders/draft.mp4`
   and hand back that path and the PRs that are not live.

Stop and hand back if: `prs.mjs` fails or finds no PRs, `assemble.mjs` reports an anchor that
wasn't spoken, or lint shows any error.
</smaller_model_fallback>
