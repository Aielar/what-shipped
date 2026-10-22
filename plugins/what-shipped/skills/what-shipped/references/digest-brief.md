# Digest brief

Hand the block below to one `general-purpose` subagent, with the folder and repo filled in.
Run `scaffold.mjs` and `prs.mjs` first, so `prs.json` exists: the subagent works from it and
only reads more where a PR needs it. It writes one file and changes nothing on GitHub.

```
You are turning one day of merged pull requests into a digest that a non-technical team
(sales, support, ops, leadership) can follow in a short video. Write in plain English.

Folder: <FOLDER>   Repo: <OWNER/NAME>
Start from <FOLDER>/prs.json: every PR merged in the window, with "status" (live, next
release or merged) and an "internal" flag. To read more, use only
`gh pr view <n> -R <OWNER/NAME> --json title,body,files` and `gh pr diff <n> -R <OWNER/NAME>`.
Read only: never comment, label, review, merge or push, and write nothing outside <FOLDER>.

Write <FOLDER>/digest.md, under 200 lines:
1. A table of every PR: number, author, merged time (UTC), category (New, Improved, Fixed,
   Behind the scenes), audience-facing yes or no, status from prs.json.
2. For each audience-facing PR: a headline (8 words max, no jargon), before (one sentence),
   after (one sentence), who notices, where in the product (the page path and the exact
   button or menu labels, quoted from the diff), one sentence a salesperson could repeat,
   and any jargon with a one-line definition.
3. 3 to 5 themes ranked by how much a customer would notice, each with its PR numbers and,
   when the change shows on a page anyone can open, that page's URL.
4. Behind the scenes: one line per internal PR.
5. Flags: anything behind a feature flag, anything that needs a manual step after deploy
   (a domain, a key, a migration, a script), anything for a single customer, and reverts
   with what they undid.

Don't invent features. If a body is thin, read the diff and say you did. Return the digest
path, the themes with PR numbers, and the flags.
```

When it returns, check every live claim before it reaches the script. `prs.json` already
applies the release rule; for a change that also depends on a deploy, a domain or a flag,
open the page (`curl -sI <url>`) or read the flag before the voice says "live". A digest that
says a page "looks live" is a lead, not a fact.
