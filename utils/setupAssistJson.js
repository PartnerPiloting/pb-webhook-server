// Reading the setup-page helper's reply (routes/wingguyRoutes.js, /setup/assist).
//
// The model is asked for ONE JSON object, but a reply can carry prose, a code fence, or a second
// object as well. The old reader took everything from the first "{" to the last "}", so any extra
// object or stray brace made JSON.parse fail - Matthew Bulat's "never go around the person I'm
// talking to" instruction was lost that way on 2026-09-28. This reader tries each "{" in turn, walks
// it to its own matching "}" (ignoring braces inside strings), and returns the first object that
// parses.

function balancedEnd(s, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractFirstJsonObject(text) {
  const s = String(text || '');
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    const end = balancedEnd(s, start);
    if (end < 0) continue;
    try {
      const obj = JSON.parse(s.slice(start, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch (_) { /* not this one - try the next "{" */ }
  }
  throw new Error('the assistant did not return usable JSON');
}

module.exports = { extractFirstJsonObject };
