/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "sidebar-bg": "var(--sidebar-bg)",
        tint: "var(--tint)",
        panel: "var(--panel)",
        line: "var(--line)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        "series-blue": "var(--series-blue)",
        "series-orange": "var(--series-orange)",
        "series-aqua": "var(--series-aqua)",
      },
      fontFamily: {
        heading: ["var(--font-heading)", "Georgia", "serif"],
        body: ["var(--font-body)", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
