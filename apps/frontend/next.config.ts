import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose RAPIDAPI_KEY to server-side API routes only (not the browser bundle)
  env: {
    RAPIDAPI_KEY: process.env.RAPIDAPI_KEY ?? "",
  },

  // Proxy /backend/* requests to the NestJS backend during development
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return [
      {
        source: "/backend/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },

  // Allow images from external sources used by the downloader
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "**.tiktokcdn.com" },
    ],
  },
};

export default nextConfig;
