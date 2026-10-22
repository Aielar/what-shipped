# Capturing real product screens

`capture.mjs` drives real Google Chrome with its own profile (`capture.profile`, default
`~/.what-shipped/chrome-profile`) against `capture.baseUrl`. It writes 2560x1440 PNGs to
`assets/captures/` and a `report.json` next to them.

## What keeps it safe

- **Read-only.** Some pages write on load: `/new` creates a record, an invite link joins a
  team, `?template=` installs something. Every address is checked before it opens. Path
  segments like `new`, `create`, `delete`, `logout`, `oauth`, `callback`, `connect`, `install`,
  `accept`, `invite`, `deploy`, `checkout`, `unsubscribe`, `api` are always refused, as are
  `?template=`, `?invite=`, `?token=` and friends, read after decoding so `%6Eew` counts as
  `new`; `capture.blocked` adds your own patterns. Chrome is also stopped from going anywhere
  unvetted on its own: a script redirect, any hop of a server redirect, a frame or a popup
  aimed at a refused address is cut before the request leaves. A refused frame or popup is
  left blank and listed in the result; a refused page fails the entry. Frames from other
  sites (a video, a map) load, since they can't change the product.
- **Links are read, never clicked.** A `link` step reads the href, vets it, then navigates.
  The only other actions are tab clicks, hover, scroll and waits. No other clicks, no typing.
- **Writes never leave the browser.** Any request other than GET, HEAD or OPTIONS, to any
  site, is refused and listed in the result, so a page that saves something on load can't.
  A page that needs POST just to load its data (GraphQL, RPC) gets those URLs in
  `capture.allowRequests`. A client-side route change (`history.pushState`, a `#/` route) to a
  refused address fails the entry. Websocket messages are not filtered: lock to a test
  workspace for apps that write over sockets.
- **Workspace lock.** `capture.lock` names the element that proves the browser is in the right
  place: a workspace switcher that reads your test workspace, or, on a public site, the
  signed-out "Sign in" link that proves no account is loaded. It is checked after load, after
  the steps and again after the shot; the PNG is written only when all three pass. No lock in
  the config means nothing runs. Matching is exact unless `"match": "prefix"`.
- **Look before use.** Read every PNG before it goes in a scene. Real customer names, emails
  or records get a `mask` selector, or the theme uses rows instead.

The durable setup is a capture-only account that belongs to a test workspace and nothing else,
so customer data is unreachable even if a page misbehaves.

## Commands (from the video folder)

```bash
node capture.mjs login           # first time, or when it reports "signed out"
node capture.mjs captures.json   # headless, one PNG per entry
```

Statuses: `ok`; `MOVED` (the page redirected somewhere else, often a feature that's off);
`LOCKED` (the lock wasn't there, nothing saved); `BLOCKED` (refused address, never opened);
`FAIL` (timeout, signed out, a step that isn't allowed). Anything but `ok` keeps that theme
on rows.

## captures.json

```json
[
  { "id": "schedule", "page": "schedule" },
  { "id": "reports", "url": "/reports", "waitFor": "This week",
    "steps": [{ "tab": "Monthly" }, { "link": "Export history" }, { "scroll": 400 }],
    "mask": ["text=jane@customer.com"], "hide": ["text=We use cookies"], "settle": 2500 }
]
```

`page` pulls `url` and `waitFor` from `capture.pages` in config.json. `hide` makes the
floating box around a match transparent (cookie banners, chat bubbles); `mask` paints over a
match. Viewport is 1280x720 at 2x, which stays sharp at 2x zoom inside the video's frame.

## Placing the focus boxes

FOCI coordinates are fractions of the screenshot (0 to 1), read off the PNG: a box around what
the line talks about, `zoom` 1.5 to 2.2, `cursor: true` with `cx`/`cy` on the button when the
line says "click". One focus per spoken step; `at` is the phrase where the camera should start
moving, a beat before the word lands. Start with a wide view (no focus) so viewers see the
whole page once. A focus can also carry `img` and `url` to cut to another capture, with the
address bar following; two camera moves need about two seconds between them to read.
