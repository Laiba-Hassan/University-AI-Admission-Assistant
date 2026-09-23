/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // This demo site reads /data/<tenant>/* from outside apps/web at build time (see src/lib/content.ts);
  // Next.js needs to know the monorepo root to trace those files correctly for standalone/production builds.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"),
};
