const BENEFITS = [
  { num: "01", title: "Nothing invented.", body: "Every number a prospective student sees traces back to a record your staff approved, with the date it was checked." },
  { num: "02", title: "Answers around the clock.", body: "Fee and deadline questions get answered after hours, in the language the student is most comfortable in." },
  { num: "03", title: "Every conversation becomes visible.", body: "Leads, handoffs and unanswered questions all surface on one dashboard, instead of disappearing into an inbox." },
  { num: "04", title: "Staff stay in control.", body: "The Knowledge Base editor keeps every quoted fee and policy behind an explicit staff approval." },
];

export function Benefits() {
  return `
    <section id="benefits" class="reveal">
      <div class="kicker">Why it matters</div>
      <h2 class="section-title">Built for admissions offices, not generic support</h2>
      <div class="benefit-list">
        ${BENEFITS.map(BenefitRow).join("")}
      </div>
    </section>
  `;
}

function BenefitRow({ num, title, body }) {
  return `
    <div class="benefit-row">
      <div class="num">${num}</div>
      <div class="txt"><strong>${title}</strong><span>${body}</span></div>
    </div>
  `;
}
