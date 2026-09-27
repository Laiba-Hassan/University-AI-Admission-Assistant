"use client";
import { useEffect, useState } from "react";

const KEY = "enrollium-theme";

/** Reads/writes the `data-theme` attribute the design system's dark tokens key off (see globals.css) and
 * persists the choice to localStorage, matching the inline bootstrap script in layout.tsx that reads it back
 * before paint so there's no light-then-dark flash. The one UI to change it lives in Settings > Branding. */
export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch { /* private window, etc. -- theme just won't persist */ }
  }

  return { dark, toggle };
}
