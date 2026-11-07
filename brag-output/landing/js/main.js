import { Nav } from "./components/Nav.js";
import { Hero } from "./components/Hero.js";
import { Problem } from "./components/Problem.js";
import { HowItWorks } from "./components/HowItWorks.js";
import { Features } from "./components/Features.js";
import { Demo } from "./components/Demo.js";
import { Benefits } from "./components/Benefits.js";
import { Contact } from "./components/Contact.js";
import { Footer } from "./components/Footer.js";
import { wireBehavior } from "./behavior.js";

function mount() {
  document.getElementById("app").innerHTML = `
    ${Nav()}
    ${Hero()}
    <main class="wrap">
      ${Problem()}
      ${HowItWorks()}
      ${Features()}
      ${Demo()}
      ${Benefits()}
      ${Contact()}
    </main>
    ${Footer()}
  `;
  wireBehavior();
}

mount();
