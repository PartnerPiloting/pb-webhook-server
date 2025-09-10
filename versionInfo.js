// versionInfo.js - lightweight helper to expose current git commit hash at runtime
// Tries, in order: environment variable GIT_COMMIT, `git rev-parse --short HEAD`, fallback 'unknown'

const { execSync } = require('child_process');

function getCommitHash() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.substring(0, 12);
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    return hash || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

module.exports = {
  commitHash: getCommitHash()
};
