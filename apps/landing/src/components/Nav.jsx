"use client";

export function Nav({ onRequestDemo }) {
  return (
    <nav className="topbar">
      <div className="wrap inner">
        <div className="brand">
          <img src="/assets/enrollium-logo.png" alt="" /> Enrollium
        </div>
        <div className="nav-links">
          <a href="#problem">Why</a>
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#demo">Demo</a>
        </div>
        <button className="nav-cta" onClick={onRequestDemo}>Request a demo</button>
      </div>
    </nav>
  );
}
