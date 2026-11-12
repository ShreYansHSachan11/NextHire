import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  images: {
    // `images.domains` is deprecated in Next 15; remotePatterns is the
    // supported form and is narrower (scheme + path are pinned too).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
    formats: ["image/webp", "image/avif"],
  },

  serverExternalPackages: ["@prisma/client"],

  // Logo.dev's publishable key is public by design (it rides in every logo
  // URL), so it is exposed to the browser under a NEXT_PUBLIC_ name.
  env: {
    NEXT_PUBLIC_LOGO_DEV_KEY: process.env.LOGO_DEV_PUBLISHABLE_KEY ?? "",
  },

  // Security headers. The app previously sent none.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Never let an API response be cached by a shared proxy: most of them
        // are now user-scoped.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
