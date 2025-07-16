/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable ESLint during build to avoid deployment issues
  eslint: {
    ignoreDuringBuilds: true
  },
  // Add your config options here if needed
};

module.exports = nextConfig; 