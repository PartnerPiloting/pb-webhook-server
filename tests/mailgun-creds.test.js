// tests/mailgun-creds.test.js
//
// services/mailgunCreds.js is the one place every server-sent email gets its Mailgun key,
// sending domain and From address. These tests pin the rule that matters: the key and the
// domain always change as a pair, and nothing goes out as the retired ASH domain once a
// knowaguy key exists - whatever order the env vars are changed in.
//
//   node tests/mailgun-creds.test.js

const assert = require('assert');
const path = require('path');

const MOD = path.join(__dirname, '..', 'services', 'mailgunCreds.js');
const KEYS = ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'FROM_EMAIL', 'KNOWAGUY_MAILGUN_API_KEY', 'SERIES_MAILGUN_API_KEY'];

function withEnv(env, fn) {
    const saved = {};
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    Object.assign(process.env, env);
    delete require.cache[MOD];
    try { return fn(require(MOD)); } finally {
        for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
        delete require.cache[MOD];
    }
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok - ${name}`); }

test('steady state: env points at knowaguy -> that key with that domain', () => {
    withEnv({ MAILGUN_API_KEY: 'kg-key', MAILGUN_DOMAIN: 'mg.knowaguy.com.au', SERIES_MAILGUN_API_KEY: 'series-key' }, (m) => {
        assert.deepStrictEqual(m.mailgunCreds(), { apiKey: 'kg-key', domain: 'mg.knowaguy.com.au', source: 'env' });
        assert.strictEqual(m.isConfigured(), true);
    });
});

test('bridge: env still says ASH but a knowaguy key exists -> knowaguy key + knowaguy domain, never mixed', () => {
    withEnv({ MAILGUN_API_KEY: 'ash-key', MAILGUN_DOMAIN: 'australiansidehustles.com.au', SERIES_MAILGUN_API_KEY: 'series-key' }, (m) => {
        assert.deepStrictEqual(m.mailgunCreds(), { apiKey: 'series-key', domain: 'mg.knowaguy.com.au', source: 'knowaguy-key' });
    });
    withEnv({ MAILGUN_API_KEY: 'ash-key', MAILGUN_DOMAIN: 'mail.australiansidehustles.com.au', KNOWAGUY_MAILGUN_API_KEY: 'kg-key', SERIES_MAILGUN_API_KEY: 'series-key' }, (m) => {
        assert.strictEqual(m.mailgunCreds().apiKey, 'kg-key', 'an explicit knowaguy key beats the series key');
        assert.strictEqual(m.mailgunCreds().domain, 'mg.knowaguy.com.au');
    });
});

test('bridge: no MAILGUN_DOMAIN at all but a knowaguy key -> knowaguy', () => {
    withEnv({ SERIES_MAILGUN_API_KEY: 'series-key' }, (m) => {
        assert.deepStrictEqual(m.mailgunCreds(), { apiKey: 'series-key', domain: 'mg.knowaguy.com.au', source: 'knowaguy-key' });
    });
});

test('legacy: only the old pair set -> used as-is (nothing better to do)', () => {
    withEnv({ MAILGUN_API_KEY: 'ash-key', MAILGUN_DOMAIN: 'australiansidehustles.com.au' }, (m) => {
        assert.deepStrictEqual(m.mailgunCreds(), { apiKey: 'ash-key', domain: 'australiansidehustles.com.au', source: 'legacy' });
    });
});

test('nothing set -> not configured, and sending rejects instead of throwing', async () => {
    await withEnv({}, async (m) => {
        assert.strictEqual(m.isConfigured(), false);
        await assert.rejects(() => m.sendMailgunMessage({ to: 'x@y.z' }), /Mailgun not configured/);
    });
});

test('From: default is guy@knowaguy.com.au, FROM_EMAIL wins unless it is a retired ASH address', () => {
    withEnv({}, (m) => {
        assert.strictEqual(m.fromEmail(), 'guy@knowaguy.com.au');
        assert.strictEqual(m.fromAddress('Wingguy'), 'Wingguy <guy@knowaguy.com.au>');
        assert.strictEqual(m.fromAddress(''), 'guy@knowaguy.com.au');
    });
    withEnv({ FROM_EMAIL: 'alerts@australiansidehustles.com.au' }, (m) => {
        assert.strictEqual(m.fromEmail(), 'guy@knowaguy.com.au', 'a retired From would fail DMARC alignment on the knowaguy signature');
    });
    withEnv({ FROM_EMAIL: 'hello@knowaguy.com.au' }, (m) => {
        assert.strictEqual(m.fromEmail(), 'hello@knowaguy.com.au');
        assert.strictEqual(m.fromAddress('Guy Wilson'), 'Guy Wilson <hello@knowaguy.com.au>');
    });
    withEnv({ FROM_EMAIL: 'Alerts <alerts@australiansidehustles.com.au>' }, (m) => {
        assert.strictEqual(m.fromEmail(), 'guy@knowaguy.com.au', 'retired address inside a display name is still retired');
    });
    withEnv({ FROM_EMAIL: 'Team <team@knowaguy.com.au>' }, (m) => {
        assert.strictEqual(m.fromAddress('Wingguy'), 'Team <team@knowaguy.com.au>', 'a display name already in FROM_EMAIL is kept');
    });
});

test('every sender reads through the helper - no file but the helper and the series mailer touches the raw env', () => {
    const { execSync } = require('child_process');
    const out = execSync('git grep -ln "process.env.MAILGUN_API_KEY\\|process.env.MAILGUN_DOMAIN\\|process.env.FROM_EMAIL" -- services routes utils', { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean);
    const allowed = new Set(['services/mailgunCreds.js', 'services/seriesMailer.js']);
    const strays = out.filter((f) => !allowed.has(f));
    assert.deepStrictEqual(strays, [], `these files read Mailgun env directly: ${strays.join(', ')}`);
});

Promise.resolve().then(() => {
    console.log(`\n${passed} passed`);
}).catch((e) => { console.error(e); process.exit(1); });
