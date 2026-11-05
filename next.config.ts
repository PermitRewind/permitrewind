import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the Property Appraiser permit shards with the server functions that read them.
  outputFileTracingIncludes: {
    "/search": ["./data/pa/**/*", "./data/davenport-harvest.json"],
    "/api/search": ["./data/pa/**/*", "./data/davenport-harvest.json"],
  },
};

export default nextConfig;
