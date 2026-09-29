/**
 * The client's Linked Helper machine, opened in a web browser - the Cloudflare side.
 *
 * WHY: until 29 Sep 2026 a client reached their machine through Tailscale on their own laptop
 * plus a Remote Desktop icon. Every step of that was theirs to get wrong, and on two calls in a
 * row it went wrong (Rick Wong: a work-email signup landed on a paid trial; Roland Illyes: picked
 * "Linux" for his Windows laptop, so it never joined). A link has no install and no account.
 *
 * The shape, per machine:
 *   https://<client>.<domain>  ->  Cloudflare Access (email + one-time code, allowed emails only)
 *                              ->  Cloudflare Tunnel (outbound from the machine, nothing opened)
 *                              ->  noVNC on the machine's 127.0.0.1 (lh-browser-access.sh)
 *
 * This file is the pure half (names, request bodies, who is allowed) plus a thin API caller.
 * scripts/machine-browser-link.js drives it. Guy's own way in (Tailscale + RDP) is untouched.
 */

const API = 'https://api.cloudflare.com/client/v4';
const POLICY_NAME = 'Allowed people';
const ORIGIN = 'http://127.0.0.1:6080';
// How long before the browser asks for a fresh emailed code. A month: long enough that a client
// topping up a campaign is not doing the email dance every time, short enough that a laptop
// someone walked off with stops working by itself.
const SESSION_DURATION = '720h';

/** "Roland-Illyes" -> "roland-illyes". Only what a hostname label may hold. */
function machineSlug(clientId) {
  const slug = String(clientId || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  if (!slug) throw new Error(`cannot make a web address from client id "${clientId}"`);
  return slug;
}

function cleanDomain(domain) {
  const d = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\.+|\.+$/g, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new Error(`MACHINE_LINK_DOMAIN does not look like a domain: "${domain}"`);
  return d;
}

function machineHostname(clientId, domain) {
  return `${machineSlug(clientId)}.${cleanDomain(domain)}`;
}

function machineLink(clientId, domain) {
  return `https://${machineHostname(clientId, domain)}`;
}

function tunnelName(clientId) {
  return `lh-${machineSlug(clientId)}`;
}

/**
 * Everyone who may open this machine: the client, Guy, and anyone extra (an assistant, or the
 * client's personal address when their work mail eats the code email). Lower-cased, de-duplicated,
 * anything that is not an email address dropped rather than sent to Cloudflare.
 */
function allowedEmails(...lists) {
  const seen = new Set();
  for (const list of lists) {
    const items = Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/);
    for (const item of items) {
      const email = String(item || '').trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) seen.add(email);
    }
  }
  return [...seen];
}

function accessAppBody({ clientId, hostname, otpIdpId }) {
  return {
    name: `Linked Helper machine - ${clientId}`,
    domain: hostname,
    type: 'self_hosted',
    session_duration: SESSION_DURATION,
    // One way in, and straight to it: no "choose how to sign in" page for the client to read.
    allowed_idps: [otpIdpId],
    auto_redirect_to_identity: true,
    app_launcher_visible: false,
  };
}

function accessPolicyBody(emails) {
  if (!emails.length) throw new Error('nobody on the allowed list - refusing to write an empty policy');
  return {
    name: POLICY_NAME,
    decision: 'allow',
    precedence: 1,
    include: emails.map((email) => ({ email: { email } })),
  };
}

/**
 * The tunnel's one route. `access.required` makes the machine's own end of the tunnel check the
 * sign-in too, so if the Access application were ever deleted or loosened by mistake the desktop
 * does not quietly become open to anyone with the address.
 */
function tunnelConfigBody({ hostname, teamName, aud }) {
  return {
    config: {
      ingress: [
        {
          hostname,
          service: ORIGIN,
          originRequest: { access: { required: true, teamName, audTag: [aud] } },
        },
        { service: 'http_status:404' },
      ],
    },
  };
}

function dnsRecordBody({ hostname, tunnelId }) {
  return { type: 'CNAME', name: hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true, comment: 'Linked Helper machine browser link' };
}

/** "guys-team.cloudflareaccess.com" -> "guys-team" */
function teamNameFromAuthDomain(authDomain) {
  const m = String(authDomain || '').match(/^([a-z0-9-]+)\.cloudflareaccess\.com$/i);
  if (!m) throw new Error(`could not read the Zero Trust team name from "${authDomain}"`);
  return m[1];
}

/** Thin caller. Throws with Cloudflare's own words, which are usually the whole diagnosis. */
function cloudflare({ token, fetchImpl = fetch }) {
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  return async function call(method, path, body) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch (_e) { /* reported below */ }
    if (!res.ok || !json || json.success === false) {
      const why = (json && Array.isArray(json.errors) && json.errors.map((e) => `${e.code || ''} ${e.message || ''}`.trim()).join('; ')) || `HTTP ${res.status}`;
      throw new Error(`Cloudflare ${method} ${path}: ${why}`);
    }
    return json.result;
  };
}

/**
 * Create, or bring up to date, everything Cloudflare needs for one machine. Every step looks
 * before it writes, so running it twice changes nothing and running it after adding an email
 * only changes the allowed list. Returns what the caller needs: the link and the tunnel token.
 */
async function ensureMachineLink({ call, accountId, clientId, domain, emails, log = () => {} }) {
  const hostname = machineHostname(clientId, domain);
  const acct = `/accounts/${accountId}`;

  const zones = await call('GET', `/zones?name=${encodeURIComponent(cleanDomain(domain))}`);
  if (!zones.length) throw new Error(`${cleanDomain(domain)} is not a domain in this Cloudflare account`);
  const zoneId = zones[0].id;

  const org = await call('GET', `${acct}/access/organizations`);
  const teamName = teamNameFromAuthDomain(org.auth_domain);

  const idps = await call('GET', `${acct}/access/identity_providers`);
  let otp = idps.find((p) => p.type === 'onetimepin');
  if (!otp) {
    otp = await call('POST', `${acct}/access/identity_providers`, { name: 'One-time code by email', type: 'onetimepin', config: {} });
    log('switched on sign-in by emailed code');
  }

  const name = tunnelName(clientId);
  const tunnels = await call('GET', `${acct}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`);
  let tunnel = tunnels.find((t) => t.name === name);
  if (!tunnel) {
    tunnel = await call('POST', `${acct}/cfd_tunnel`, { name, config_src: 'cloudflare' });
    log(`created tunnel ${name}`);
  }

  const apps = await call('GET', `${acct}/access/apps`);
  let app = apps.find((a) => a.domain === hostname);
  if (!app) {
    app = await call('POST', `${acct}/access/apps`, accessAppBody({ clientId, hostname, otpIdpId: otp.id }));
    log(`created the sign-in page for ${hostname}`);
  }

  const policies = await call('GET', `${acct}/access/apps/${app.id}/policies`);
  const policy = policies.find((p) => p.name === POLICY_NAME);
  const wanted = accessPolicyBody(emails);
  if (!policy) {
    await call('POST', `${acct}/access/apps/${app.id}/policies`, wanted);
    log(`allowed: ${emails.join(', ')}`);
  } else {
    const current = allowedEmails((policy.include || []).map((r) => r.email && r.email.email));
    const same = current.length === emails.length && emails.every((e) => current.includes(e));
    if (!same) {
      await call('PUT', `${acct}/access/apps/${app.id}/policies/${policy.id}`, wanted);
      log(`allowed list now: ${emails.join(', ')} (was: ${current.join(', ') || 'nobody'})`);
    }
  }

  await call('PUT', `${acct}/cfd_tunnel/${tunnel.id}/configurations`, tunnelConfigBody({ hostname, teamName, aud: app.aud }));

  const records = await call('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`);
  const wantedDns = dnsRecordBody({ hostname, tunnelId: tunnel.id });
  if (!records.length) {
    await call('POST', `/zones/${zoneId}/dns_records`, wantedDns);
    log(`pointed ${hostname} at the tunnel`);
  } else if (records[0].content !== wantedDns.content || records[0].type !== 'CNAME') {
    await call('PUT', `/zones/${zoneId}/dns_records/${records[0].id}`, wantedDns);
    log(`re-pointed ${hostname} at the tunnel`);
  }

  const tunnelToken = await call('GET', `${acct}/cfd_tunnel/${tunnel.id}/token`);
  return { link: `https://${hostname}`, hostname, tunnelId: tunnel.id, tunnelToken, emails };
}

// THE 50-PERSON CLIFF (29 Sep 2026). Cloudflare's free plan covers 50 people. A person counts
// from the first time they sign in until they are removed - being on an allowed list does not
// count. Past 50 it is not the extra people who are charged but EVERYONE (about US$7 each a
// month), so 51 people costs more than 350 dollars, not 7. Guy chose to stay on Cloudflare's
// check and be warned early rather than build our own lock now.
const FREE_PEOPLE = 50;
const WARN_AT = 40;

/** One line about how close the account is to the free limit. `warn` = time to act. */
function seatLine(count) {
  const n = Number(count) || 0;
  if (n > FREE_PEOPLE) return { warn: true, text: `${n} people have signed in - OVER the ${FREE_PEOPLE} that are free. Every one of them is now being charged for. Remove people who have left, today.` };
  if (n >= WARN_AT) return { warn: true, text: `${n} of ${FREE_PEOPLE} free places used. Past ${FREE_PEOPLE}, EVERY person is charged for, not just the extras - time to remove people who have left, and to build our own sign-in check.` };
  return { warn: false, text: `${n} of ${FREE_PEOPLE} free places used.` };
}

/** How many people currently hold a place. Best-effort: a failed count must never fail a build. */
async function countPeople({ call, accountId }) {
  try {
    const users = await call('GET', `/accounts/${accountId}/access/users?per_page=100`);
    // Only someone Cloudflare says holds NO place is left out. Anything unclear is counted:
    // warning a little early is harmless, a count that reads low is the whole danger.
    return users.filter((u) => u.access_seat !== false).length;
  } catch (_e) {
    return null;
  }
}

/** Take a machine's link away - the client has left. Leaves the machine itself alone. */
async function removeMachineLink({ call, accountId, clientId, domain, log = () => {} }) {
  const hostname = machineHostname(clientId, domain);
  const acct = `/accounts/${accountId}`;
  const zones = await call('GET', `/zones?name=${encodeURIComponent(cleanDomain(domain))}`);
  if (zones.length) {
    const records = await call('GET', `/zones/${zones[0].id}/dns_records?name=${encodeURIComponent(hostname)}`);
    for (const r of records) { await call('DELETE', `/zones/${zones[0].id}/dns_records/${r.id}`); log(`removed the address ${hostname}`); }
  }
  const apps = await call('GET', `${acct}/access/apps`);
  for (const a of apps.filter((x) => x.domain === hostname)) { await call('DELETE', `${acct}/access/apps/${a.id}`); log('removed the sign-in page'); }
  const name = tunnelName(clientId);
  const tunnels = await call('GET', `${acct}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`);
  for (const t of tunnels.filter((x) => x.name === name)) {
    await call('DELETE', `${acct}/cfd_tunnel/${t.id}/connections`).catch(() => {});
    await call('DELETE', `${acct}/cfd_tunnel/${t.id}`);
    log(`removed tunnel ${name}`);
  }
}

module.exports = {
  machineSlug, machineHostname, machineLink, tunnelName, allowedEmails,
  accessAppBody, accessPolicyBody, tunnelConfigBody, dnsRecordBody, teamNameFromAuthDomain,
  cloudflare, ensureMachineLink, removeMachineLink, seatLine, countPeople,
  POLICY_NAME, SESSION_DURATION, FREE_PEOPLE, WARN_AT,
};
