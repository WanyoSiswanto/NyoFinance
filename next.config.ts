import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Fase 1 memakai pola SSR Supabase klasik: matikan cacheComponents
     karena halaman sesi harus dirender dinamis per-request. */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
