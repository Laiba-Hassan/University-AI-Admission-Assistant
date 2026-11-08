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
  const closeRef = useRef(null);

  function closeAnd(fn) {
    return (...args) => { setMenuOpen(false); fn?.(...args); };
  }

  // Dialog behavior for the full-screen mobile menu: Escape closes it, focus moves into the panel
  // on open and back to the toggle on close, and the page can't scroll behind a full-screen panel.
  useEffect(() => {
    if (!menuOpen) return;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e) {
      if (e.key === "Escape") { setMenuOpen(false); toggleRef.current?.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
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
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Full-screen takeover, solid background: no page content visible behind it at all, so
         there's nothing to "mix up" with. Rendered as a sibling of <nav>, not inside it: nav has
         backdrop-filter, which creates a containing block for position:fixed descendants in every
         major browser and trapped an earlier version of this menu inside nav's own ~70px height. */}
      {menuOpen && (
        <div className="nav-menu-fullscreen" role="dialog" aria-modal="true" aria-label="Site menu">
          <div className="nav-menu-fullscreen-head">
            <span>Menu</span>
            <button ref={closeRef} className="nav-menu-close" aria-label="Close menu" onClick={() => { setMenuOpen(false); toggleRef.current?.focus(); }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="nav-menu-fullscreen-links">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={closeAnd(() => {})}>
                {l.label}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </a>
            ))}
          </div>
          <button className="nav-menu-fullscreen-cta" onClick={closeAnd(onRequestDemo)}>Request a demo</button>
        </div>
      )}
    </>
  );
}
