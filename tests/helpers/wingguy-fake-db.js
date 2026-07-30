/**
 * Shared in-memory fake Pool for the Wingguy rules tests — emulates just the SQL shapes
 * services/wingguyRulesStore.js issues, so the store and the MCP door can both be exercised
 * end-to-end without a real database.
 *
 * Extracted from tests/wingguy-rules-store.test.js (2026-07-31) when the door tests needed the
 * same fixture. ONE fake, so a schema change can only break it in one place.
 */

// ---------------------------------------------------------------------------
// In-memory fake pool — emulates just the SQL shapes the store issues.
// ---------------------------------------------------------------------------
class FakeDb {
  constructor() {
    this.rules = [];
    this.history = [];
    this.catalog = [];
    this.tenantVars = [];
    this.assets = [];
    this.nextId = 1;
  }
  connect() {
    return Promise.resolve({
      query: (sql, params) => this.query(sql, params || []),
      release() {},
    });
  }
  async query(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s) || /^(CREATE|ALTER|DROP|DO) /i.test(s)) return { rows: [] };

    // The commit-door's "what standard am I sitting on?" read, and getOverrideTenants. Both are
    // matched BEFORE the generic active-rules handler because they bind rule_key as $1.
    if (s.includes("layer = 'foundation'") && s.includes('rule_key = $1')) {
      const rows = this.rules.filter((r) => r.layer === 'foundation' && r.rule_key === params[0]
        && (r.campaign || '') === params[1] && r.status === 'active');
      return { rows: rows.map((r) => ({ version: r.version, tier: r.tier ?? null })) };
    }
    if (s.includes("layer = 'client'") && s.includes('rule_key = $1')) {
      const rows = this.rules.filter((r) => r.layer === 'client' && r.rule_key === params[0]
        && (r.campaign || '') === params[1] && r.status === 'active');
      return { rows: rows.map((r) => ({ tenant_id: r.tenant_id, version: r.version, standard_version: r.standard_version ?? null, created_at: r.created_at })) };
    }

    // The seed path's "all active foundation rules" read (no params).
    if (s.includes("layer = 'foundation'") && s.includes("status = 'active'") && !params.length) {
      return {
        rows: this.rules.filter((r) => r.layer === 'foundation' && r.status === 'active')
          .map((r) => ({ rule_key: r.rule_key, campaign: r.campaign || '', version: r.version, tier: r.tier ?? null })),
      };
    }

    if (s.includes('FOR UPDATE')) {
      const rows = this.rules
        .filter((r) => r.layer === params[0] && (r.tenant_id || '') === params[1] && r.rule_key === params[2]
          && (r.campaign || '') === params[3] && r.status === 'active')
        .map((r) => ({ id: r.id, version: r.version, tier: r.tier ?? null }));
      return { rows };
    }
    if (s.includes("SET status = 'retired'")) {
      const row = this.rules.find((r) => r.id === params[0]);
      if (row) { row.status = 'retired'; row.retired_at = 'now'; }
      return { rows: [] };
    }
    if (s.includes('INSERT INTO wingguy_rules')) {
      // Both insert paths (write-door and seed) bind every column as a parameter, so the column
      // list and params line up 1:1 — no positional guessing, and adding a column can't skew this.
      const cols = s.slice(s.indexOf('(') + 1, s.indexOf(')')).split(',').map((c) => c.trim());
      const row = { id: this.nextId++, tier: null, standard_version: null, created_at: 'now', retired_at: null };
      cols.forEach((c, i) => { row[c] = params[i]; });
      this.rules.push(row);
      return { rows: [{ id: row.id, version: row.version }] };
    }
    if (s.includes('INSERT INTO wingguy_rule_history')) {
      this.history.push({ id: this.nextId++, params });
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_rule_history')) {
      return { rows: this.history.slice().reverse().map((h) => ({ id: h.id, actor: h.params[0], action: h.params[1] })) };
    }
    if (s.includes('ORDER BY version DESC')) {
      const rows = this.rules
        .filter((r) => r.layer === params[0] && (r.tenant_id || '') === params[1] && r.rule_key === params[2]
          && (r.campaign || '') === params[3])
        .sort((a, b) => b.version - a.version);
      return { rows };
    }
    // getStoreStatus's per-layer/tenant rollup. Emulated for real (it used to return []) because
    // the tier/override audit script drives its tenant list from exactly these rows.
    if (s.includes('FROM wingguy_rules') && s.includes("status = 'active'") && s.includes('GROUP BY')) {
      const acc = new Map();
      for (const r of this.rules) {
        const k = `${r.layer}|${r.tenant_id || '(none)'}`;
        const cur = acc.get(k) || { layer: r.layer, tenant: r.tenant_id || '(none)', active: 0, total_versions: 0 };
        cur.total_versions++;
        if (r.status === 'active') cur.active++;
        acc.set(k, cur);
      }
      return { rows: [...acc.values()].sort((a, b) => a.layer.localeCompare(b.layer) || a.tenant.localeCompare(b.tenant)) };
    }
    if (s.includes('FROM wingguy_rules') && s.includes("status = 'active'")) {
      let idx = 0;
      let rows = this.rules.filter((r) => r.status === 'active');
      if (s.includes('layer = $1')) {
        const layer = params[idx++];
        rows = rows.filter((r) => r.layer === layer);
        if (layer === 'client') { const t = params[idx++]; rows = rows.filter((r) => r.tenant_id === t); }
      } else {
        const tenant = params[idx++];
        rows = rows.filter((r) => r.layer === 'foundation' || (r.layer === 'client' && r.tenant_id === tenant));
      }
      if (s.includes('context = ANY')) { const ctxs = params[idx++]; rows = rows.filter((r) => ctxs.includes(r.context)); }
      if (s.includes('campaign = $')) { const c = params[idx++]; rows = rows.filter((r) => r.campaign === c); }
      return { rows: rows.slice() };
    }
    if (s.includes('INSERT INTO wingguy_variable_catalog')) {
      const [var_key, description] = params;
      const existing = this.catalog.find((c) => c.var_key === var_key);
      if (existing) { if (description) existing.description = description; }
      else this.catalog.push({ var_key, description, required: false, example: null });
      return { rows: [] };
    }
    if (s.includes('SELECT value FROM wingguy_tenant_variables')) {
      const v = this.tenantVars.find((x) => x.tenant_id === params[0] && x.var_key === params[1]);
      return { rows: v ? [{ value: v.value }] : [] };
    }
    if (s.includes('INSERT INTO wingguy_tenant_variables')) {
      const [tenant_id, var_key, value] = params;
      const existing = this.tenantVars.find((x) => x.tenant_id === tenant_id && x.var_key === var_key);
      if (existing) existing.value = value;
      else this.tenantVars.push({ tenant_id, var_key, value });
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_variable_catalog c')) {
      const tenant = params[0];
      return {
        rows: this.catalog.map((c) => ({
          ...c,
          value: this.tenantVars.find((x) => x.tenant_id === tenant && x.var_key === c.var_key)?.value ?? null,
        })),
      };
    }
    if (s.includes('INSERT INTO wingguy_assets')) {
      const [tenant_id, asset_key, kind, url, status] = params;
      const existing = this.assets.find((a) => a.tenant_id === tenant_id && a.asset_key === asset_key);
      if (existing) Object.assign(existing, { kind: kind || existing.kind, url: url || existing.url, status });
      else this.assets.push({ tenant_id, asset_key, kind, url, status });
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_assets')) {
      return { rows: this.assets.filter((a) => a.tenant_id === params[0]) };
    }
    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 120)}`);
  }
}

module.exports = { FakeDb };
