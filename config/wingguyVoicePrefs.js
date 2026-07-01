// config/wingguyVoicePrefs.js
// Per-tenant VOICE preferences for Wingguy drafting — the greeting + sign-off house style.
//
// THE SEAM (mirrors config/wingguyBookingPrefs.js): Guy's values are the defaults NOW; per-tenant
// overrides + client self-editing land later (Airtable/Postgres record + the rules write-door). Nothing
// tenant-specific is hardcoded in the drafting code — it all reads from here. Split per the doc's
// "code vs rule vs variable" model:
//   - VARIABLE (per tenant): signoffName, signoffTagline  — identity; differs for every tenant.
//   - RULE (shipped default, tunable):  greetWithFirstName — a behaviour, same shape for all tenants.
//   - CODE (all tenants): choosing WHICH sign-off to use + substituting these values — lives in
//     services/wingguyChat.js and only ever reads these prefs.
//
// Multi-tenant = fill in each tenant's values (below, then their record); the behaviour stays generic,
// so there's no rework — just wiring the values to a per-tenant source.

const DEFAULT_VOICE_PREFS = {
  greetWithFirstName: true,     // open every message with a warm greeting using the lead's first name
  signoffName: 'Guy',           // the name to sign off with
  signoffTagline: '(I know a)', // optional prefix for the "full" sign-off ("(I know a) Guy"); '' = none
};

// Per-client overrides. Single-tenant today → Guy uses the defaults, so this is empty. When a second
// tenant arrives, add their values here (e.g. { signoffName: 'Jane', signoffTagline: '' }), then migrate
// to their per-tenant record. No code changes needed.
const PER_CLIENT = {
  // 'Some-Other-Client': { signoffName: 'Jane', signoffTagline: '', greetWithFirstName: true },
};

function getVoicePrefs(clientId) {
  return { ...DEFAULT_VOICE_PREFS, ...(PER_CLIENT[clientId] || {}) };
}

module.exports = { getVoicePrefs, DEFAULT_VOICE_PREFS };
