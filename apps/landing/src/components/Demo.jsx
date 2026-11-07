export function Demo() {
  return (
    <section id="demo" className="reveal">
      <div className="kicker">See it working</div>
      <h2 className="section-title">A real conversation, a real dashboard</h2>
      <p className="section-lead">
        No staged mockups: this is the actual product, a student asking about fees and scholarships, the
        assistant answering with a verified figure, and the staff side that makes it trustworthy.
      </p>
      <div className="video-frame">
        <video controls preload="metadata" poster="/assets/poster.jpg">
          <source src="/assets/demo.mp4" type="video/mp4" />
        </video>
      </div>
    </section>
  );
}
