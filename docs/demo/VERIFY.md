# Demo check: supabase/supabase, 2026-10-21 20:42 to 2026-10-22 20:42 UTC

Made with the plugin from a clean install. 36 PRs merged in the window; the video covers 9.
Release mode `none`: nothing was called live until the page itself was checked.

| Line | What the voice says | PR | How it was checked |
| --- | --- | --- | --- |
| l02 | 36 changes merged, from 15 builders | all | `prs.json` from `gh pr list`, bots excluded from builders |
| l03, l04 | The knowledge base has a Search guides box that looks through every guide and troubleshooting article | #52089 | Box visible at supabase.com/kb; `/kb/api/search?q=password` returns troubleshooting articles, `?q=migrate` returns guides |
| l05 | Troubleshooting articles show notes and warnings as boxes | #52152 | Live article renders `role="alert"` callouts, no raw `[!NOTE]` text |
| l05b | Common questions get their own answer pages | #51795 | supabase.com/kb/topics/faqs returns 200 and lists three questions |
| l07, l08 | A Server SDK page, in public beta: users connect from Claude, Cursor or ChatGPT in developer mode, sign in with their existing account, work with their own records | #52128 | supabase.com/features/server-sdk returns 200; wording read off the page |
| l09 | A blog post walks through building one | #52119 | supabase.com/blog/give-your-supabase-app-its-own-mcp-server returns 200 |
| l11 | The OAuth integration guide no longer tells partners to ask for a database password | #52126 | Live guide: the old sentence is gone, the new one is there |
| l12 | Guides for calling Edge Functions from the database all use the secret key | #51990 | Database Webhooks guide has the new "Call an Edge Function" section |
| l13 | Support tickets only take supported files; merged, next dashboard release | #52086 | From the diff (.txt .log .png .jpg .jpeg .pdf .json .har). Dashboard is behind sign-in, so not called live |
| l15, l16 | Docs and website say social sign-in and phone sign-in; old links still work | #52102, #52109, #52111 | Docs page uses "Phone sign-in", website feature page says "social sign-in"; `/docs/guides/auth/social-login` answers 308 to the new page |

Left out on purpose: three pipeline wizard fixes (opt-in Feature Preview), the memory chart
and Advisors changes (behind flags), three reverts, and the internal work (tests, CI,
refactors, build and doc tooling).

Frames checked: one per scene at its busiest moment, every scene boundary, and the mid-point
of each camera move. Loudness: -16.0 LUFS integrated.
