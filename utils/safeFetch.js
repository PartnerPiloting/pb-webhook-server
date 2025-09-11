// utils/safeFetch.js
// Provides a fetch function that works across Node versions and module systems.
// Preference order:
// 1) Node 18+ global fetch
// 2) undici's fetch (CommonJS-friendly)
// 3) dynamic ESM import of node-fetch (if installed)

let cached;

function getFetch() {
  if (cached) return cached;
  // 1) Global fetch (Node 18+)
  if (typeof global.fetch === 'function') {
    cached = global.fetch.bind(global);
    return cached;
  }
  // 2) undici (recommended polyfill)
  try {
    const { fetch } = require('undici');
    cached = fetch;
    return cached;
  } catch (_) {}
  // 3) Dynamic import of node-fetch (ESM-only v3)
  cached = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
  return cached;
}

module.exports = { getFetch };
