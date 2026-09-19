# Working in this repo

## There are several checkouts of this repo

`pb-webhook-server` (dev), `pb-webhook-server-dev`, `-hotfix`, `-release`, plus temporary worktrees
under the session scratchpad. They all share one `.git`. So "the file" is ambiguous: the copy in
front of you can be months behind `main`, and a feature branch usually is.

**Never judge a file's current state from the copy in your working tree.** Read it from the remote:

```
git fetch origin && git show origin/main:<path>
```

Local `main` in these checkouts is ancient and does not track reality. Always compare against
`origin/main`.

## The client playbook - docs/client-playbook.md

Client-facing content, served one topic at a time by the `wingguy_learn` MCP tool
(`services/wingguyGetStartedMcp.js`). Topics are `## ` headings; the tool splits on them and serves
the body verbatim as Guy's own words.

Before adding a topic:

```
git fetch origin && git show origin/main:docs/client-playbook.md | grep "^## "
```

- **Match on subject, not title.** A topic named something else that covers the same ground is a
  duplicate. Read the neighbouring topics before writing.
- **Edit it against `origin/main`**, in a temp worktree, then push to `main`. Topics added on a
  feature branch get stranded and later rewritten from scratch by someone reading a stale copy.
- **House style:** plain spaced short dash ` - `, never an em or en dash. Australian English.
  Client-facing wording is always "instructions", never "rules".
- **Show Guy the finished topic before committing** - this ships straight to clients on deploy.
- To review the playbook whole: `node scripts/build-playbook-page.js` renders every topic onto one
  page in journey order, with a word count per topic so thin coverage is visible. Output is
  git-ignored. Re-run it after any playbook edit.
- Voice is Guy in the first person, except claims about how good Wingguy is, which stay third
  person ("Guy reckons..."). The tool must never praise its own drafting.

## Sentences clients are told to type - content/client-phrases.json

Any sentence a client is told to type into their Claude - a tour beat's "say where are we up to", an
email's "open a chat and say help me set up my Linked Helper machine" - goes in
`content/client-phrases.json` **before** it goes into the email or topic. `utils/clientPhrases.js`
stamps each phrase into the description of the tool that answers it, so a tool can never be left not
knowing about a sentence we promised a client.

```
node tests/client-phrases.test.js
```

That checks the description quotes the phrase, the real matcher lands it on the right topic, and every
doc the registry names still contains it. **It cannot check whether a client's Claude will choose the
tool** - nothing can, from here - so every new phrase also gets typed into a fresh chat once before it
ships. On 19 Sep 2026 "help me set up my Linked Helper machine" got the August Windows-laptop answer
back from memory, confidently, because nobody had.

## "Wingguy first" - content/wingguy-first.json

Claude.ai answers from its own memory BEFORE it loads connector tools (proven with server logs, 19
Sep 2026), so a registered phrase is not enough - the client's Claude has to be told to ask Wingguy
first. On onboarding day that is a preferences paragraph, a memory line, an opener habit ("where are
we up to?") and a canary: new chat, "help me set up my Linked Helper machine", first line must read
"Loaded tools". The one copy of those words is `content/wingguy-first.json`. The concierge run sheet
mints them onto the page; the checklist and the connector install message repeat them.

```
node tests/wingguy-first.test.js
```

That fails when any copy drifts. Edit the JSON, run the test, bring the docs it names into line.
Never put the texts in a doc the test does not know about.

## Temporary worktrees

Use one whenever you need a clean copy of `main` while a checkout is dirty. Rules:

- Create it under the session scratchpad, never inside the repo.
- **Remove it in the same session:** `git worktree remove --force <dir>`
- Windows marks the worktree metadata read-only, so `git worktree remove` and `git worktree prune`
  both fail with "Permission denied" and the registrations silently pile up. When that happens, run
  `node scripts/prune-worktrees.js --delete`, which clears the read-only flag first.
- Never delete a worktree with uncommitted changes without showing Guy what is in it.

## Testing

There is no local dev loop. Changes are verified on cloud deploys - `main` is production, the
`staging` branch is staging. Do not tell Guy to run the server locally.

## The tour - docs/client-tour.md

The guided route through getting started, served by `wingguy_learn` tour mode ("where are we up
to?" = status, "continue" = next beat). Beats are `## ` headings; bookmarks are per-client BY BEAT
NAME (wingguyLearningStore, Postgres), so beats can be edited, reordered or inserted any time
without scrambling anyone's place. Same rules as the playbook: Guy's voice, altitude-controlled
(depth stays in the playbook topics - beats point down into them), show Guy before committing,
edit against origin/main.

## The browser extension - wingguy-extension/

Guy's own Chrome loads it **unpacked from `C:\Wingguy`**, NOT from any checkout. Editing
`wingguy-extension/` in a working tree changes nothing in his browser, and neither does editing it
in the repo he happens to have open. Every client machine has its own equivalent local folder.

**Always bump `manifest.json`'s version.** The updater compares versions and does nothing when they
match, so content changed without a bump reaches nobody - it is not a cosmetic field.

**After pushing an extension change, get it onto Guy's machine in the same session.** The scheduled
task runs once a day at 03:00, so otherwise the fix he just asked for is not in his browser when he
goes to test it - which is exactly how 2026-09-17 went. Wait for the Render deploy to finish (the
updater pulls from the deployed server, not from git), then:

```
cmd //c "%LOCALAPPDATA%\Wingguy\run-update.cmd"
```

Safe to run any time - it prints `server=x local=y`, and exits doing nothing when they match. It
holds Guy's portal token, which is why the command lives there and not in this repo. Then tell him
to hit reload on the Wingguy card in `chrome://extensions`: the files change on disk, but Chrome
keeps running the old copy until it is reloaded.

**`scripts/ship-extension.js` is NOT the fleet.** It covers only the OneDrive lane (2 clients). Most
machines are on the pull-updater lane and never appear in its output - reading it as coverage is
wrong. The real fleet is `public.wingguy_extension_checkins` in Postgres. Note `ship-extension.js`
copies from the WORKING TREE and `dotenv` reads `.env` from the CWD, so run it only from a clean
worktree at `origin/main` - from a stale checkout it ships an OLDER build and rolls clients back.
