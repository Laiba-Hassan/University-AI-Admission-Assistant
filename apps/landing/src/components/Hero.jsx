"use client";

export function Hero({ onRequestDemo }) {
  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden="true">
        <img src="/assets/campus/pk3.jpg" alt="" fetchPriority="high" />
      </div>
      <div className="wrap hero-inner">
        <div>
          <h1>Every answer, verified. Never guessed.</h1>
          <p className="sub">
            Enrollium answers fee, deadline, eligibility and scholarship questions for your applicants,
            in English, Roman Urdu, or Urdu, and never states a figure your staff haven&rsquo;t approved.
          </p>
          <div className="ctas">
            <a className="btn btn-primary" href="#demo">Watch the demo</a>
            <button className="btn btn-secondary" onClick={onRequestDemo}>Request a demo</button>
          </div>
        </div>
        <ProofCard />
      </div>
    </section>
  );
}

function ProofCard() {
  return (
    <div className="proof">
      <div className="proof-head">
        <div className="mark">C</div>
        <div>
          <div className="who">Crescent Valley University</div>
          <div className="what">AI Admissions Assistant</div>
        </div>
      </div>
      <div className="proof-q-row"><span className="proof-q">Any scholarships for BSCS?</span></div>
      <div className="proof-a"><strong>Merit Scholarship:</strong> 50% tuition, 3.5+ GPA.</div>
      <div className="proof-fact">
        <div className="label">BS Computer Science &middot; Scholarship</div>
        <div className="value">Deadline March 15, 2027</div>
        <div className="asof">as of 2026-08-20</div>
      </div>
    </div>
  );
}
