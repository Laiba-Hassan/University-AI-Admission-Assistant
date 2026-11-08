"use client";

import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "#problem", label: "Why" },
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#demo", label: "Demo" },
];

export function Nav({ onRequestDemo }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef(null);
  const firstLinkRef = useRef(null);

  function closeAnd(fn) {
    return (...args) => { setMenuOpen(false); fn?.(...args); };
  }

  // Dialog behavior for the mobile menu: Escape closes it, and focus moves into the panel on
  // open and back to the toggle button on close, so keyboard users aren't dropped on the floor.
  useEffect(() => {
    if (!menuOpen) return;
    firstLinkRef.current?.focus();
    function onKeyDown(e) {
      if (e.key === "Escape") { setMenuOpen(false); toggleRef.current?.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <>
      <nav className="topbar">
        <div className="wrap inner">
          <div className="brand">
            <img src="/assets/enrollium-logo.png" alt="" width="36" height="36" /> Enrollium
          </div>
          <div className="nav-links">
            {LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
          </div>
          <button className="nav-cta nav-cta-wide" onClick={onRequestDemo}>Request a demo</button>
          <button
            ref={toggleRef}
            className="nav-menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>}
            </svg>
          </button>
        </div>
        {menuOpen && (
          <div className="nav-menu-sheet" role="dialog" aria-modal="true" aria-label="Site menu">
            {LINKS.map((l, i) => (
              <a key={l.href} href={l.href} ref={i === 0 ? firstLinkRef : undefined} onClick={closeAnd(() => {})}>{l.label}</a>
            ))}
            <button className="nav-menu-cta" onClick={closeAnd(onRequestDemo)}>Request a demo</button>
          </div>
        )}
      </nav>
      {/* Rendered as a sibling of <nav>, not inside it: nav has backdrop-filter, which creates a
         containing block for position:fixed descendants in every major browser -- a fixed-position
         backdrop nested inside it gets trapped to nav's own ~70px box instead of covering the
         viewport (confirmed: its rendered height was exactly nav's height, not the screen's). */}
      {menuOpen && (
        <div className="nav-menu-backdrop" onClick={() => { setMenuOpen(false); toggleRef.current?.focus(); }} aria-hidden="true" />
      )}
    </>
  );
}
