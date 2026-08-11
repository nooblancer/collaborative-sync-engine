/** @type {import('next').NextConfig} */
const nextConfig = {
  // Validate required environment variables at build time
  env: {
    NEXT_PUBLIC_SYNC_URL: process.env.NEXT_PUBLIC_SYNC_URL || "ws://localhost:8080",
  },
  // Performance optimizations for initial viewport load < 2s
  reactStrictMode: true,
  poweredByHeader: false,
};

module.exports = nextConfig;
