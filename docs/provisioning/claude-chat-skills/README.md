# Claude Chat skills — per-client provisioning

Drop these into each client's Claude Chat when you set up their extension, so the
`/wg` muscle memory from LinkedIn is harmless in Claude instead of returning
"Unknown command: /wg".

## Why this exists

On LinkedIn, `/` is **Wingguy's** trigger character — the extension owns it.
In Claude, `/` is **Anthropic's** command prefix — a different parser you don't own.
Same keystroke, two systems. A client trained to lead with `/WG` on LinkedIn will
eventually type it in Claude and hit the raw "Unknown command" error, which reads
like something's broken even though nothing is.

The real interaction in Claude is **paste-and-go** (paste a LinkedIn blob → Wingguy
resolves the lead, finds the email, books the meeting), so the slash was never the
main path there. These skills just catch the habit and nudge the client toward paste.

## How registration works

A slash command is a folder containing a `SKILL.md`. **The folder name is what you
type** — so `wg/` registers `/wg` and `wingguy/` registers `/wingguy`. There are no
aliases; each name needs its own folder, which is why there are two here with
identical bodies.

`disable-model-invocation: true` means Claude will NOT auto-fire this nudge on its
own — it only runs when the client actually types `/wg` (or `/wingguy`). Exactly
what we want, since the nudge is a safety net, not real Wingguy behaviour.

## Install (per client)

Copy both folders into the client's **personal** skills dir so they work in every
folder the client opens (not just one project):

    ~/.claude/skills/wg/SKILL.md
    ~/.claude/skills/wingguy/SKILL.md

Works in the desktop Chat tab, the CLI, and Claude Code on the web. (The "some
commands only work in the terminal" message is only about Claude's built-in
commands — your own skills work everywhere.)

## Provisioning checklist

- [ ] Install the LinkedIn extension
- [ ] Copy `wg/` and `wingguy/` into the client's `~/.claude/skills/`
- [ ] Confirm `/wg` in their Claude Chat returns the nudge (not "Unknown command")
