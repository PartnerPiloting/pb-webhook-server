/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable ESLint during build to avoid deployment issues
  eslint: {
    ignoreDuringBuilds: true
  },
  // Allow both JS and TS page files
  pageExtensions: ['js', 'jsx', 'ts', 'tsx']
};

module.exports = nextConfig; 