"use client";

import { useState } from "react";

const LINKS = [
  { href: "#problem", label: "Why" },
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#demo", label: "Demo" },
];

export function Nav({ onRequestDemo }) {
  const [menuOpen, setMenuOpen] = useState(false);

  function closeAnd(fn) {
    return (...args) => { setMenuOpen(false); fn?.(...args); };
  }

  return (
    <nav className="topbar">
      <div className="wrap inner">
        <div className="brand">
          <img src="/assets/enrollium-logo.png" alt="" /> Enrollium
        </div>
        <div className="nav-links">
          {LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </div>
        <button className="nav-cta nav-cta-wide" onClick={onRequestDemo}>Request a demo</button>
        <button
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
        <div className="nav-menu-sheet">
          {LINKS.map((l) => <a key={l.href} href={l.href} onClick={closeAnd(() => {})}>{l.label}</a>)}
          <button className="nav-menu-cta" onClick={closeAnd(onRequestDemo)}>Request a demo</button>
        </div>
      )}
    </nav>
  );
}
