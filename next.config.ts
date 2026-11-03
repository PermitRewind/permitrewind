import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the Property Appraiser permit shards with the server functions that read them.
  outputFileTracingIncludes: {
    "/search": ["./data/pa/**/*"],
    "/api/search": ["./data/pa/**/*"],
  },
};

export default nextConfig;
