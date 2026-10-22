# Script and scenes

## lines.json

One entry per spoken line: `id`, `scene`, `text` (what captions show, exact product spelling)
and optional `tts` (what the voice reads, when it differs). `"cap": false` drops the caption
when the scene already shows the words. Keep each scene's lines together. Aim for 90 to 120
seconds, about 230 to 300 words.

The shape that works:

- **Open**, two lines. "Here's what shipped in Larkwork since yesterday." Then the count in
  words that match the stats on screen: "Twenty-three changes merged. Four you should know."
- **One block per theme.** The number and a short headline ("Two. Shift swaps without the
  back and forth."), then before, then after, in a customer's words. Name the real button or
  page so people can find it. Two to four lines per theme.
- **Not live yet says so out loud**: "This one is merged, and ships with the next release."
  The close repeats it as a note.
- **Close**, two lines. "That's the day. Three of these are live now." Then the outro from
  config ("Questions? Reply in the thread.").

Fix pronunciation in `tts` only, or once for every video in `config.voice.pronounce`:

| Write in `text` | Write in `tts` |
| --- | --- |
| SDK, MCP, KPIs | S D K, M C P, K P I's |
| supabase.com/kb | supabase dot com slash K B |
| v2.14 | version two point fourteen |
| OAuth | oh auth |
| AI | AI, with a comma after it when a noun follows ("Ask AI, now answers") |

After `node voice.mjs`, read `words.json` line by line. If Whisper heard a different word, a
viewer will too: rephrase and run it again (unchanged lines are reused).

## scenes.json

Each entry: `id` (also the composition name), `file` (template in `scenes/`), `scene`
(matches `lines.json`), `tokens`. Scenes run back to back; each opens 0.45 s before its first
word. Anchors: a token value `"t:two words"` becomes the time those spoken words start inside
the scene; `[word]` picks a later word (`"t:click [save]"`). Copy anchor words from
`words.json`, as spoken ("twenty three", not "23"). A phrase the voice never said stops
`assemble.mjs` and prints what was said.

| Type | File | Use it for | Tokens |
| --- | --- | --- | --- |
| Open | `open.html` | Always first. The day on a 24 hour rail, featured PRs lit. | TITLE, MARK, A_TITLE, A_RAIL, STATS, COVER |
| Rows | `rows.html` | A theme as a short ledger, one row per spoken line, up to 5. | NUM, KICKER, TITLE, MARK, A_TITLE, ROWS, NOTE, BG, COVER |
| Real screen | `capture.html` | A change you can see on a page you captured. | NUM, KICKER, TITLE, MARK, URL, IMG, PRS, STATUS, FOCI, ENTER, BG, COVER |
| Close | `close.html` | Always last. Not-live notes, who shipped, the outro. | NUM, TITLE, MARK, A_TITLE, A_ASK, NOTES, NAMES |
| Custom | copy a template | Flows a screenshot can't show: before and after, a rename, a setting. | your own |

Shapes: `STATS` is `[{ "v": 36, "k": "changes merged", "at": "t:thirty six" }]` (add
`"lit": true` to color one). `ROWS` is `[{ "pr": 52128, "label": "...", "sub": "...", "status": "live", "at": "t:..." }]`.
`PRS` is a list of PR numbers; every PR named in any scene's `PRS` or `ROWS` lights up on the
open rail, so list them all. `NOTES` is `[{ "status": "next release", "text": "..." }]`.
`status` is `live`, `next release` or `merged`, taken from `prs.json` or from your own check.
The full example is `examples/larkwork/scenes.json` in the plugin.

Grounds alternate so every wipe reads: open on `ink`, themes alternate `paper` and `tint`,
close on `ink`. A scene's `COVER` is the next scene's `BG`.

A custom scene starts from the nearest template: keep the `ws-scene` root, `WS.scope`,
`WS.brand`, the `ws-wipe` cover and `WS.wipe(tl, q, SLOT)`, and register the timeline under
the scene id. `examples/larkwork/scenes/before-after.html` is one, built for a settings change.

## Design rules

Ledger, from `assets/ledger.css`: square corners, hairline rules, no shadows, no gradients.
One marked phrase per headline carries the accent. Status shows as fill, not color: solid is
live, dashed is not live yet, outline is merged. Every claim on screen carries its PR number.
No em dashes on screen. People and records in custom scenes are invented and generic.

## Checks before the final

`npx hyperframes lint` (0 errors). `npx hyperframes snapshot . --at <one time per scene>` at
each scene's busiest moment, then look at every frame for overflow, a row wrapping to three
lines, a focus box off its target, captions covering the thing being pointed at. Then a draft
render (`--quality draft`) and a frame at every scene boundary
(`ffmpeg -ss <t> -i renders/draft.mp4 -frames:v 1 frames/<t>.png`): the wipe should be
mid-flight, never a black frame.
