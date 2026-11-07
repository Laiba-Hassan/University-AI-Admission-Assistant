export function Problem() {
  return (
    <section id="problem" className="reveal">
      <div className="kicker">The problem</div>
      <h2 className="section-title">Admissions offices answer the same questions hundreds of times a week</h2>
      <p className="section-lead">
        Fee structures, deadlines, eligibility criteria &mdash; the same handful of questions, over email, over the
        phone, over and over. Generic AI chatbots promise to help, but they confidently invent a fee or a date when
        they don&rsquo;t actually know one, which is worse than no answer at all for a university.
      </p>
      <div className="ps-grid">
        <div className="ps-card problem">
          <div className="tag">What usually happens</div>
          <p>A chatbot is bolted onto the site. It answers fluently, sometimes correctly, sometimes not &mdash; and nobody can tell which until a prospective student acts on the wrong number.</p>
        </div>
        <div className="ps-card solution">
          <div className="tag">What Enrollium does instead</div>
          <p>Every fee, date or eligibility figure comes from a <strong>live, staff-approved database record</strong>, cited with the date it was last verified. If the data isn&rsquo;t there, the assistant says so and hands off to a person.</p>
        </div>
      </div>
    </section>
  );
}
