// Wires up the interactive behavior for the already-mounted components: nav/hero CTAs that scroll to
// Contact, the "copy email" button, and the scroll-reveal observer. Runs once after mount().
export function wireBehavior() {
  function scrollToContact() {
    document.getElementById("contact").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.getElementById("nav-cta").addEventListener("click", scrollToContact);
  document.getElementById("hero-cta").addEventListener("click", scrollToContact);

  const copyBtn = document.getElementById("copy-email");
  copyBtn.addEventListener("click", () => {
    const email = document.getElementById("email-text").textContent;
    function marked() {
      copyBtn.textContent = "Copied";
      copyBtn.dataset.copied = "true";
      setTimeout(() => {
        copyBtn.textContent = "Copy email";
        copyBtn.dataset.copied = "false";
      }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(email).then(marked).catch(() => {
        copyBtn.textContent = "Select the text above";
        setTimeout(() => { copyBtn.textContent = "Copy email"; }, 1800);
      });
    } else {
      copyBtn.textContent = "Select the text above";
      setTimeout(() => { copyBtn.textContent = "Copy email"; }, 1800);
    }
  });

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  }
}
