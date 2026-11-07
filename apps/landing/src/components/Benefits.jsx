const BENEFITS = [
  { num: "01", title: "Nothing invented.", body: "Every number a prospective student sees traces back to a record your staff approved, with the date it was checked." },
  { num: "02", title: "Answers around the clock.", body: "Fee and deadline questions get answered after hours, in the language the student is most comfortable in." },
  { num: "03", title: "Every conversation becomes visible.", body: "Leads, handoffs and unanswered questions all surface on one dashboard, instead of disappearing into an inbox." },
  { num: "04", title: "Staff stay in control.", body: "The Knowledge Base editor keeps every quoted fee and policy behind an explicit staff approval." },
];

export function Benefits() {
  return (
    <section id="benefits" className="reveal">
      <div className="kicker">Why it matters</div>
      <h2 className="section-title">Built for admissions offices, not generic support</h2>
      <div className="benefit-list">
        {BENEFITS.map((b) => <BenefitRow key={b.num} {...b} />)}
      </div>
    </section>
  );
}

function BenefitRow({ num, title, body }) {
  return (
    <div className="benefit-row">
      <div className="num">{num}</div>
      <div className="txt"><strong>{title}</strong><span>{body}</span></div>
    </div>
  );
}
