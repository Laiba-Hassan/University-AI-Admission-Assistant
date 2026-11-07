export function Hero() {
  return `
    <section class="hero">
      <div class="hero-bg" aria-hidden="true">
        <img src="assets/campus/pk3.jpg" alt="" />
      </div>
      <div class="wrap hero-inner">
        <div>
          <div class="eyebrow"><span class="dot"></span> AI admissions assistant for universities</div>
          <h1>Every answer, verified. Never guessed.</h1>
          <p class="sub">Enrollium answers fee, deadline, eligibility and scholarship questions for your applicants &mdash; in English, Roman Urdu, or Urdu &mdash; and never states a figure your staff haven&rsquo;t approved.</p>
          <div class="ctas">
            <a class="btn btn-primary" href="#demo">Watch the demo</a>
            <button class="btn btn-secondary" id="hero-cta">Request a demo</button>
          </div>
        </div>
        ${ProofCard()}
      </div>
    </section>
  `;
}

function ProofCard() {
  return `
    <div class="proof">
      <div class="proof-head">
        <div class="mark">C</div>
        <div>
          <div class="who">Crescent Valley University</div>
          <div class="what">AI Admissions Assistant</div>
        </div>
      </div>
      <div class="proof-q-row"><span class="proof-q">Any scholarships for BSCS?</span></div>
      <div class="proof-a"><strong>Merit Scholarship:</strong> 50% tuition, 3.5+ GPA.</div>
      <div class="proof-fact">
        <div class="label">BS Computer Science &middot; Scholarship</div>
        <div class="value">Deadline March 15, 2027</div>
        <div class="asof">as of 2026-08-20</div>
      </div>
    </div>
  `;
}
