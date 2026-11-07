"use client";

import { useEffect } from "react";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Problem } from "@/components/Problem";
import { HowItWorks } from "@/components/HowItWorks";
import { Features } from "@/components/Features";
import { Demo } from "@/components/Demo";
import { Benefits } from "@/components/Benefits";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";

export default function LandingPage() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  function scrollToContact() {
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <Nav onRequestDemo={scrollToContact} />
      <Hero onRequestDemo={scrollToContact} />
      <main className="wrap">
        <Problem />
        <HowItWorks />
        <Features />
        <Demo />
        <Benefits />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
