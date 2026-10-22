# what-shipped

A Claude Code plugin marketplace with one plugin. The plugin lives in `plugins/what-shipped/`
(skill, scripts, scene templates, design); everything outside it (README, docs, tools, CI)
is for the repo and never ships with an install.

- The plugin knows nothing about any product. Anything product-specific belongs in the
  user's `config.json`. Examples use the made-up product Larkwork, never a real company.
- `SKILL.md` and its references are prompts: normal voice, the reason behind each rule,
  one short instruction over a checklist, and a `<smaller_model_fallback>` block at the end.
- English everywhere, no em dashes.
- The capture script is read-only and fail-closed. Any change to it ships with a test in
  `plugins/what-shipped/test/` against the local fixture app.
- Before a commit, run `npm run gate`. It needs the private word list (see `tools/scan-words.mjs`).
