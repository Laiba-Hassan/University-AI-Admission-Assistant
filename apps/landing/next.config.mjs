/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  async headers() {
    // The CDN cached a pre-viewport-fix build and kept serving it past the next deploy. Force
    // revalidation on every request for the page itself so a future fix can't get stuck like this again.
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};
