// Runtime seed URL management for LH manual crawler
let runtimeSeeds = [];

function setRuntimeSeeds(list) {
  if (!Array.isArray(list)) throw new Error('Seeds must be array');
  runtimeSeeds = list.map(s => String(s).trim()).filter(Boolean);
  return runtimeSeeds;
}

function getRuntimeSeeds() { return runtimeSeeds.slice(); }

module.exports = { setRuntimeSeeds, getRuntimeSeeds };
