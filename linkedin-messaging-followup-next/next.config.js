/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable ESLint during build to avoid deployment issues
  eslint: {
    ignoreDuringBuilds: true
  },
  // Only consider TS/TSX files for app/pages to avoid duplicate .js/.tsx route warnings
  pageExtensions: ['ts', 'tsx']
};

module.exports = nextConfig; 