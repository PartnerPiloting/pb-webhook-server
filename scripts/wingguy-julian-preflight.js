// One-off Julian go-live pre-flight. Read-only. Runs on prod (Render job) so it sees the live Master Clients Base + env.
// Confirms: Julian's record is complete + Active, his Portal Token round-trips to Julian-Davis (not Guy),
// the multi-tenant/allow-list flags are live, and BYO-key billing gate state. Guy path sanity too.
require('dotenv').config();
const cs = require('./../services/clientService');

const mask = (v) => (v ? `${String(v).slice(0, 4)}…(${String(v).length} chars)` : '(blank)');
const present = (v) => (v ? 'SET' : '(blank)');

(async () => {
  console.log('=== FLAGS (live prod env) ===');
  console.log('WINGGUY_CONNECTOR_MULTITENANT =', process.env.WINGGUY_CONNECTOR_MULTITENANT || '(unset)');
  console.log('WINGGUY_ENABLED_CLIENTS       =', process.env.WINGGUY_ENABLED_CLIENTS || '(unset)');
  console.log('WINGGUY_PLATFORM_KEY_CLIENTS  =', process.env.WINGGUY_PLATFORM_KEY_CLIENTS || '(unset)');
  console.log('WINGGUY_RULES_SOURCE          =', process.env.WINGGUY_RULES_SOURCE || '(unset)');

  console.log('\n=== JULIAN RECORD (getClientById) ===');
  const j = await cs.getClientById('Julian-Davis');
  if (!j) {
    console.log('!! NOT FOUND — no client with Client ID = Julian-Davis');
    process.exit(0);
  }
  console.log('clientName            =', j.clientName);
  console.log('status                =', j.status, j.status === 'Active' ? '✓' : '✗ NOT ACTIVE');
  console.log('portalToken           =', mask(j.portalToken));
  console.log('airtableBaseId (leads)=', present(j.airtableBaseId), j.airtableBaseId || '');
  console.log('timezone              =', j.timezone || '(blank)');
  console.log('managedClaudeKey      =', JSON.stringify(j.managedClaudeKey), '(blank/No => BYO, must add own key)');
  console.log('calendarProvider      =', j.calendarProvider || '(blank)');
  console.log('calendarProviderToken =', present(j.calendarProviderToken), '(Zoho connected once set)');
  console.log('nylasGrantId (email)  =', present(j.nylasGrantId));
  console.log('fathomApiKey          =', present(j.fathomApiKey));
  console.log('bookingZoom           =', present(j.bookingZoom));
  console.log('coachLinkedInUrl      =', present(j.coachLinkedInUrl));

  console.log('\n=== TOKEN ROUND-TRIP (getClientByPortalToken) ===');
  if (j.portalToken) {
    const back = await cs.getClientByPortalToken(j.portalToken);
    console.log('resolves to           =', back ? back.clientId : '(null)',
      back && back.clientId === 'Julian-Davis' ? '✓ correct' : '✗ WRONG');
    console.log('in ENABLED_CLIENTS    =',
      (process.env.WINGGUY_ENABLED_CLIENTS || '').split(',').map(s => s.trim()).includes('Julian-Davis') ? '✓' : '✗');
    console.log('connector URL         = https://pb-webhook-server.onrender.com/mcp2/' + j.portalToken);
  } else {
    console.log('!! No Portal Token on the record — cannot go live until minted (generate-portal-tokens.js)');
  }

  console.log('\n=== GUY SANITY (unchanged) ===');
  const g = await cs.getClientById('Guy-Wilson');
  console.log('Guy status            =', g ? g.status : '(null)');
  console.log('Guy managedClaudeKey  =', g ? JSON.stringify(g.managedClaudeKey) : '(null)');

  console.log('\n=== DONE ===');
  process.exit(0);
})().catch(e => { console.error('PREFLIGHT ERROR:', e); process.exit(1); });
