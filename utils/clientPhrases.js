/**
 * Client phrases - the sentences a client is told to type, stamped into the tool that answers them.
 *
 * The registry is content/client-phrases.json. This module does two things with it:
 *
 *   applyClientPhrases(TOOL_DEFS)  - called once per tool module, right before its exports. Appends
 *                                    a "CLIENT PHRASES THAT ROUTE HERE" block to the description of
 *                                    every tool the registry names, quoting each phrase verbatim.
 *                                    Idempotent. A tool the registry does not mention is untouched.
 *   phrasesFor(toolName)           - the registry entries for one tool (the test uses this).
 *   normalise(text)                - how phrases are compared everywhere: lower case, straight
 *                                    quotes, no trailing punctuation, single spaces.
 *
 * Why the description and not just the docs: a tool is chosen by the model reading its description
 * against everything else it knows and remembers. On 19 Sep 2026 wingguy_learn's description
 * claimed "networking, outreach, LinkedIn, meetings, follow-up", so "help me set up my Linked
 * Helper machine" - the sentence an email had just told a client to type - matched nothing, and
 * the model answered from its own memory of Windows laptops instead. Correct in general, wrong for
 * this client, and indistinguishable from right. Quoting the phrase in the description is the
 * strongest routing signal there is, and generating it from the registry means an email can never
 * again promise a sentence the tool has not been told about.
 *
 * What this cannot do: watch a client's Claude decide NOT to call us. If it never calls, we never
 * see it. So the registry's last rule stands - every phrase gets typed into a fresh chat once.
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', 'content', 'client-phrases.json');
const SENTINEL = 'CLIENT PHRASES THAT ROUTE HERE';

let cache = null;

function load() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const phrases = Array.isArray(raw.phrases) ? raw.phrases : [];
  for (const p of phrases) {
    if (!p || typeof p.phrase !== 'string' || !p.phrase.trim()) throw new Error('client-phrases.json: every entry needs a phrase');
    if (typeof p.tool !== 'string' || !p.tool.trim()) throw new Error(`client-phrases.json: "${p.phrase}" needs a tool`);
  }
  cache = { phrases };
  return cache;
}

/** Lower case, straight quotes, no trailing ?/./!, collapsed whitespace. Used on both sides of every comparison. */
function normalise(text) {
  return String(text || '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?.!]+$/g, '')
    .trim();
}

function phrasesFor(toolName) {
  return load().phrases.filter((p) => p.tool === toolName);
}

/** One block per tool, quoting every phrase verbatim. Empty string when the registry has none for it. */
function phraseBlock(toolName) {
  const list = phrasesFor(toolName);
  if (!list.length) return '';
  const quoted = list.map((p) => `"${p.phrase}"`).join(', ');
  return ` ${SENTINEL} - a client has been told, in writing, to type these exact words; when you see them, call this tool rather than answering from memory or general knowledge: ${quoted}.`;
}

/**
 * Mutates each def's description in place. Safe to call more than once - the sentinel stops a
 * second stamp. Returns the names it stamped, for logging or tests.
 */
function applyClientPhrases(toolDefs) {
  const stamped = [];
  for (const def of toolDefs || []) {
    if (!def || typeof def.name !== 'string') continue;
    const block = phraseBlock(def.name);
    if (!block) continue;
    if (typeof def.description === 'string' && def.description.includes(SENTINEL)) continue;
    def.description = `${def.description || ''}${block}`;
    stamped.push(def.name);
  }
  return stamped;
}

module.exports = { load, normalise, phrasesFor, phraseBlock, applyClientPhrases, SENTINEL, REGISTRY_PATH };
