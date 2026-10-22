# config.json

One file holds everything about the product; the plugin itself knows nothing about it.
`scaffold.mjs` writes `what-shipped/config.json` on first run from `gh repo view`, and every
script finds it at `../config.json` from a video folder (or `--config <path>`). A full
example for a made-up product is in the plugin, at `examples/larkwork/config.json`.

| Key | What it does |
| --- | --- |
| `repo` | `owner/name` on GitHub. Every `gh` call uses it, so the video folder can live anywhere. |
| `branch` | Branch PRs merge into. Defaults to the repo's default branch. |
| `windowHours` | How far back `prs.mjs` looks. 24 for a daily video, 168 for a weekly one. |
| `release` | How a merged PR becomes "live". See below. |
| `skip` | Regexes on PR titles that mark internal work (tests, CI, chores, bumps). Defaults cover conventional commits and bots. |
| `capture.baseUrl` | Where the product runs. Captures never leave this origin. |
| `capture.lock` | The element that proves the right workspace: `{ "selector": "[data-workspace]", "text": "Acme Test" }` or `{ "role": "link", "text": "Sign in" }`. Required for any capture. |
| `capture.lock.match` | `"prefix"` accepts a switcher that appends text after the name ("Acme Test  Pro"). Exact by default. |
| `capture.blocked` | Extra regexes for paths that write on load, on top of the built-in list. |
| `capture.allowRequests` | Regexes for URLs a page must POST to just to load (GraphQL, RPC). Every other write is refused. |
| `capture.pages` | The product map: `{ "id", "url", "waitFor" }` per page worth showing. |
| `capture.profile` | Chrome profile folder for the capture login. Default `~/.what-shipped/chrome-profile`. |
| `capture.signedOut` | Regex for sign-in paths, so a lapsed session is reported instead of captured. Default `/(sign-?in|log-?in|auth)(/|$)`. |
| `capture.viewport`, `scale`, `colorScheme`, `channel` | Browser size (default `[1280, 720]`), pixel ratio (2), `light` or `dark`, and the Chrome channel (`chrome`). |
| `brand.name`, `brand.logo` | Shown in every scene's top bar. The logo path is relative to config.json; PNG or SVG, about 36px tall on screen. |
| `brand.colors` | `ink`, `paper`, `tint`, `muted`, `rule`, `accent`. Keep `accent` readable on both `paper` and `ink` (3:1 or better); it carries every headline's marked words. |
| `brand.fonts` | `display` (headlines and captions) and `mono` (PR numbers, times, status). Any Google Fonts family; HyperFrames embeds it at render time. |
| `voice` | Kokoro voice id, speed, and `pronounce`: words the voice gets wrong, `{ "Larkwork": "Lark work" }`. |
| `outro` | The close scene's last line. |

Environment variables: `WHAT_SHIPPED_CONFIG` points every script at a config file,
`WHAT_SHIPPED_BROWSER` overrides the Chrome channel, `WHAT_SHIPPED_WHISPER` picks the Whisper
model (`small.en` by default), and `HYPERFRAMES_PYTHON` names a Python that already has
`kokoro-onnx` and `soundfile`.

## Release modes

Pick the one that matches how the product actually reaches users. When none fits cleanly
(a monorepo where the site deploys on merge but the app ships weekly), use `none` and mark a
row `live` only after checking the page yourself.

```json
{ "mode": "tag", "match": "^v\\d" }
{ "mode": "commit", "match": "^\\d+\\.\\d+\\.0$", "author": "github-actions[bot]" }
{ "mode": "merge" }
{ "mode": "none" }
```

- `tag`: live once a published GitHub release matching `match` contains the merge commit.
  Prereleases count only with `"prerelease": true`.
- `commit`: live once a commit matching `match` (and `author`, if set) lands on the branch
  after the merge. Fits release-please and semantic-release bots.
- `merge`: merged means deployed. Only for real continuous delivery.
- `none`: nothing is called live by default; rows say "merged".
