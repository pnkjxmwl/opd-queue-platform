/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared contract package ships TypeScript source; Next compiles it.
  transpilePackages: ['@opd/contracts'],
};

export default nextConfig;
