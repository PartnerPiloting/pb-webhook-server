#!/usr/bin/env node
/**
 * SessionStart hook for Claude Code in this repo (wired in .claude/settings.json).
 *
 * Claude Chat files jobs for Claude Code on the Wingguy connector (wingguy_code_jobs). Guy will not
 * remember to ask for them, so every session in this repo starts by checking. The hook cannot read
 * the list itself - this PC has no database login, and the connector already holds Guy's link - so
 * it tells Claude Code to call the tool before answering. Prints nothing else and never fails.
 */
const text = [
  'CLAUDE CODE JOBS CHECK (from the Wingguy repo start-up hook):',
  'Before answering Guy\'s first message, call the Wingguy connector tool wingguy_code_jobs with action "list".',
  '- If jobs are waiting: put them at the top of your first reply as a short list (number, title, one line on what it is), then answer what he asked. Offer to start on them; do not start without his yes.',
  '- If none are waiting: say nothing about it.',
  '- If the tool is not available in this session: say in one line that you could not check the Claude Code jobs list.',
  'When you finish a job, mark it with action "done", id, and note = what changed and where (commit, PR, piece name), so Claude Chat can tell Guy.',
].join('\n');

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
