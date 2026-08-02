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
