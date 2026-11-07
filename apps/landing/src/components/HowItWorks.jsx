const STEPS = [
  { num: "01", title: "A student asks", body: "On your site’s widget, in English, Roman Urdu, or Urdu, whichever they type in." },
  { num: "02", title: "Enrollium looks it up", body: "Fees, dates and eligibility are pulled from your staff-approved records, never computed or guessed by the model." },
  { num: "03", title: "A verified answer, or a handoff", body: "The student gets a cited figure, or the assistant says it doesn’t know and routes them to your team." },
];

export function HowItWorks() {
  return (
    <section id="how" className="reveal">
      <div className="kicker">How it works</div>
      <h2 className="section-title">Three steps, every time</h2>
      <div className="steps">
        {STEPS.map((step) => <Step key={step.num} {...step} />)}
      </div>
    </section>
  );
}

function Step({ num, title, body }) {
  return (
    <div className="step">
      <div className="step-num">{num}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
