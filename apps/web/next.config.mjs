/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  serverExternalPackages: ["mongodb"],
  experimental: {
    // App Router default; nothing required here yet
  },
  env: {
    GIT_COMMIT: process.env.GIT_COMMIT ?? "local-dev",
  },
};

export default nextConfig;
