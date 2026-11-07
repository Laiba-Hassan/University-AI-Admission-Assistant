"use client";

import { useState } from "react";

const EMAIL = "laibahassanhere@gmail.com";

export function Contact() {
  const [copyState, setCopyState] = useState("idle"); // idle | copied | manual

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
    setTimeout(() => setCopyState("idle"), 1800);
  }

  const label = copyState === "copied" ? "Copied" : copyState === "manual" ? "Select the text above" : "Copy email";

  return (
    <section id="contact" className="reveal">
      <div className="kicker">Get in touch</div>
      <h2 className="section-title">Request a live walkthrough</h2>
      <p className="section-lead">
        I&rsquo;m happy to walk any university through the full product &mdash; the assistant, the dashboard, and
        the knowledge base &mdash; in a short call.
      </p>
      <div className="contact-card">
        <div className="contact-row">
          <span className="contact-email">{EMAIL}</span>
          <button className="copy-btn" data-copied={copyState === "copied"} onClick={copyEmail}>{label}</button>
        </div>
      </div>
    </section>
  );
}

export { EMAIL as CONTACT_EMAIL };
