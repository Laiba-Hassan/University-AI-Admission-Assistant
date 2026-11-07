const FEATURES = [
  {
    icon: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
    title: "Multilingual AI assistant",
    body: "Embeds on your existing site. Answers programs, fees, deadlines, eligibility and scholarships in English, Roman Urdu, or Urdu.",
  },
  {
    icon: `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`,
    title: "Verify-then-reveal",
    body: "Facts and language generation are separated in the pipeline &mdash; the model never computes or infers a fee or a date itself.",
  },
  {
    icon: `<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>`,
    title: "Staff dashboard",
    body: "Live conversation analytics, lead capture, and a handoff inbox for anything the assistant can&rsquo;t answer on its own.",
  },
  {
    icon: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
    title: "Knowledge Base governance",
    body: "Staff review and approve every fee and program record before the assistant is ever allowed to quote it.",
  },
];

export function Features() {
  return `
    <section id="features" class="reveal">
      <div class="kicker">What&rsquo;s included</div>
      <h2 class="section-title">One assistant. A full admissions operations layer behind it.</h2>
      <div class="feature-grid">
        ${FEATURES.map(Feature).join("")}
      </div>
    </section>
  `;
}

function Feature({ icon, title, body }) {
  return `
    <div class="feature">
      <div class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg></div>
      <h3>${title}</h3>
      <p>${body}</p>
    </div>
  `;
}
