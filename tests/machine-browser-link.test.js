/**
 * The client's machine in a web browser - the Cloudflare side (services/machineBrowserLink.js).
 * The API itself is faked here: what is under test is what we ASK Cloudflare for, and that a
 * second run asks for nothing new.
 *
 * Run: node tests/machine-browser-link.test.js
 */
const assert = require('assert');
const {
  machineSlug, machineHostname, machineLink, tunnelName, allowedEmails,
  accessAppBody, accessPolicyBody, tunnelConfigBody, teamNameFromAuthDomain,
  ensureMachineLink, removeMachineLink, seatLine, countPeople, POLICY_NAME,
} = require('../services/machineBrowserLink');

let failures = 0;
const pending = [];
const check = (name, fn) => {
  pending.push(Promise.resolve().then(fn).then(
    () => console.log(`  ✓ ${name}`),
    (e) => { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); },
  ));
};

check('a client id becomes a web address', () => {
  assert.strictEqual(machineSlug('Roland-Illyes'), 'roland-illyes');
  assert.strictEqual(machineSlug("Guy O'Brien"), 'guy-o-brien');
  assert.strictEqual(machineHostname('Roland-Illyes', 'Example.com'), 'roland-illyes.example.com');
  assert.strictEqual(machineLink('Roland-Illyes', 'https://example.com/'), 'https://roland-illyes.example.com');
  assert.strictEqual(tunnelName('Roland-Illyes'), 'lh-roland-illyes');
  assert.throws(() => machineSlug('---'));
  assert.throws(() => machineHostname('Roland-Illyes', 'not a domain'));
});

check('the allowed list is lower-cased, de-duplicated, and only holds emails', () => {
  assert.deepStrictEqual(
    allowedEmails('Roland@Example.com', 'guy@example.com', 'pa@example.com, roland@example.com; not-an-email', ['', null]),
    ['roland@example.com', 'guy@example.com', 'pa@example.com'],
  );
  assert.deepStrictEqual(allowedEmails('', undefined), []);
});

check('an empty allowed list is refused, never written', () => {
  assert.throws(() => accessPolicyBody([]));
  assert.deepStrictEqual(accessPolicyBody(['a@b.co']).include, [{ email: { email: 'a@b.co' } }]);
});

check('the sign-in page offers the emailed code and nothing else', () => {
  const body = accessAppBody({ clientId: 'Roland-Illyes', hostname: 'roland-illyes.example.com', otpIdpId: 'idp-1' });
  assert.strictEqual(body.domain, 'roland-illyes.example.com');
  assert.deepStrictEqual(body.allowed_idps, ['idp-1']);
  assert.strictEqual(body.auto_redirect_to_identity, true);
});

check('the tunnel reaches the machine only, checks the sign-in itself, and ends on a 404', () => {
  const { ingress } = tunnelConfigBody({ hostname: 'h.example.com', teamName: 'team', aud: 'aud-1' }).config;
  assert.strictEqual(ingress[0].service, 'http://127.0.0.1:6080');
  assert.deepStrictEqual(ingress[0].originRequest.access, { required: true, teamName: 'team', audTag: ['aud-1'] });
  assert.strictEqual(ingress[ingress.length - 1].service, 'http_status:404');
});

check('team name is read from the auth domain', () => {
  assert.strictEqual(teamNameFromAuthDomain('guys-team.cloudflareaccess.com'), 'guys-team');
  assert.throws(() => teamNameFromAuthDomain(''));
});

check('the free limit: quiet under 40, a warning from 40, louder past 50', () => {
  assert.strictEqual(seatLine(13).warn, false);
  assert.strictEqual(seatLine(39).warn, false);
  assert.strictEqual(seatLine(40).warn, true);
  assert.ok(/EVERY person/.test(seatLine(40).text));
  assert.strictEqual(seatLine(51).warn, true);
  assert.ok(/OVER/.test(seatLine(51).text));
});

check('people are counted generously, and a failed count is null - never zero', async () => {
  const some = async () => [{ access_seat: true }, { access_seat: false }, {}, { access_seat: true }];
  assert.strictEqual(await countPeople({ call: some, accountId: 'a' }), 3);
  const broken = async () => { throw new Error('no'); };
  assert.strictEqual(await countPeople({ call: broken, accountId: 'a' }), null);
});

/** A pretend Cloudflare that remembers what it was given. */
function fakeCloudflare() {
  const state = { idps: [], tunnels: [], apps: [], policies: [], dns: [], config: null, writes: [] };
  let n = 0;
  const id = (p) => `${p}-${++n}`;
  const call = async (method, path, body) => {
    if (method !== 'GET') state.writes.push(`${method} ${path.replace(/\?.*$/, '')}`);
    if (method === 'GET' && path.startsWith('/zones?')) return [{ id: 'zone-1' }];
    if (path.endsWith('/access/organizations')) return { auth_domain: 'team.cloudflareaccess.com' };
    if (path.endsWith('/access/identity_providers')) {
      if (method === 'GET') return state.idps;
      const made = { id: id('idp'), ...body }; state.idps.push(made); return made;
    }
    if (/\/cfd_tunnel\/[^/]+\/token$/.test(path)) return 'dG9rZW4=';
    if (/\/cfd_tunnel\/[^/]+\/configurations$/.test(path)) { state.config = body; return {}; }
    if (/\/cfd_tunnel\/[^/]+\/connections$/.test(path)) return {};
    if (/\/cfd_tunnel\/[^/]+$/.test(path) && method === 'DELETE') { state.tunnels = []; return {}; }
    if (/\/cfd_tunnel(\?|$)/.test(path)) {
      if (method === 'GET') return state.tunnels;
      const made = { id: id('tun'), ...body }; state.tunnels.push(made); return made;
    }
    if (/\/access\/apps\/[^/]+\/policies\/[^/]+$/.test(path)) { Object.assign(state.policies[0], body); return state.policies[0]; }
    if (/\/access\/apps\/[^/]+\/policies$/.test(path)) {
      if (method === 'GET') return state.policies;
      const made = { id: id('pol'), ...body }; state.policies.push(made); return made;
    }
    if (/\/access\/apps\/[^/]+$/.test(path) && method === 'DELETE') { state.apps = []; return {}; }
    if (path.endsWith('/access/apps')) {
      if (method === 'GET') return state.apps;
      const made = { id: id('app'), aud: 'aud-1', ...body }; state.apps.push(made); return made;
    }
    if (/\/dns_records\/[^/]+$/.test(path) && method === 'DELETE') { state.dns = []; return {}; }
    if (/\/dns_records/.test(path)) {
      if (method === 'GET') return state.dns;
      const made = { id: id('dns'), ...body }; state.dns.push(made); return made;
    }
    throw new Error(`fake Cloudflare has no answer for ${method} ${path}`);
  };
  return { state, call };
}

const job = { accountId: 'acct', clientId: 'Roland-Illyes', domain: 'example.com' };

check('first run builds everything and hands back the link and token', async () => {
  const cf = fakeCloudflare();
  const made = await ensureMachineLink({ ...job, call: cf.call, emails: ['roland@example.com', 'guy@example.com'] });
  assert.strictEqual(made.link, 'https://roland-illyes.example.com');
  assert.strictEqual(made.tunnelToken, 'dG9rZW4=');
  assert.strictEqual(cf.state.tunnels[0].name, 'lh-roland-illyes');
  assert.strictEqual(cf.state.apps[0].domain, 'roland-illyes.example.com');
  assert.strictEqual(cf.state.policies[0].name, POLICY_NAME);
  assert.strictEqual(cf.state.dns[0].content, `${cf.state.tunnels[0].id}.cfargotunnel.com`);
  assert.deepStrictEqual(cf.state.config.config.ingress[0].originRequest.access.audTag, ['aud-1']);
});

check('second run creates nothing new', async () => {
  const cf = fakeCloudflare();
  const emails = ['roland@example.com', 'guy@example.com'];
  await ensureMachineLink({ ...job, call: cf.call, emails });
  cf.state.writes.length = 0;
  await ensureMachineLink({ ...job, call: cf.call, emails });
  // The tunnel route is re-sent every run (cheap, and it carries the sign-in check); nothing else.
  assert.deepStrictEqual(cf.state.writes, [`PUT /accounts/acct/cfd_tunnel/${cf.state.tunnels[0].id}/configurations`]);
});

check('adding a person changes the allowed list and only that', async () => {
  const cf = fakeCloudflare();
  await ensureMachineLink({ ...job, call: cf.call, emails: ['roland@example.com'] });
  cf.state.writes.length = 0;
  await ensureMachineLink({ ...job, call: cf.call, emails: ['roland@example.com', 'pa@example.com'] });
  assert.ok(cf.state.writes.some((w) => /^PUT .*\/policies\//.test(w)));
  assert.strictEqual(cf.state.policies.length, 1);
  assert.deepStrictEqual(cf.state.policies[0].include.map((r) => r.email.email), ['roland@example.com', 'pa@example.com']);
  assert.strictEqual(cf.state.apps.length, 1);
  assert.strictEqual(cf.state.tunnels.length, 1);
});

check('remove takes the address, the sign-in page and the tunnel away', async () => {
  const cf = fakeCloudflare();
  await ensureMachineLink({ ...job, call: cf.call, emails: ['roland@example.com'] });
  await removeMachineLink({ ...job, call: cf.call });
  assert.strictEqual(cf.state.dns.length + cf.state.apps.length + cf.state.tunnels.length, 0);
});

Promise.all(pending).then(() => {
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
});
