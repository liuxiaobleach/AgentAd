const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

module.exports = (phase) => {
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    images: {
      domains: ["localhost"],
    },
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:8080/api/:path*",
        },
        {
          source: "/uploads/:path*",
          destination: "http://localhost:8080/uploads/:path*",
        },
      ];
    },
  };

  return nextConfig;
};
