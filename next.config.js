/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Don't fail the build on ESLint warnings — configure separately if needed
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Suppress "Module not found: Can't resolve 'leaflet'" warnings.
  // MapView loads Leaflet via <script> injection (window.L), never via import,
  // so these are false-positive warnings from webpack's static analysis.
  webpack(config, { isServer }) {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        leaflet: false,
        'leaflet-draw': false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
