import type { Metadata } from "next";
import { Lora, Inter } from "next/font/google";
import { getTenant } from "@/lib/content";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { WidgetEmbed } from "@/components/WidgetEmbed";
import "./globals.css";

// A serif for headings gives the site the collegiate, institutional feel real university sites use; Inter for body
// keeps long-form text (fees tables, policy pages) easy to read. Both self-host via next/font (no runtime request).
const heading = Lora({ subsets: ["latin"], variable: "--font-heading", weight: ["500", "600", "700"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export function generateMetadata(): Metadata {
  const tenant = getTenant();
  return { title: `${tenant.name} — Admissions`, description: tenant.welcome_message };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = getTenant();
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body
        style={{ ["--color-primary" as string]: tenant.branding.primary, ["--color-accent" as string]: tenant.branding.accent }}
        className="min-h-screen bg-white font-body text-gray-900"
      >
        <Nav tenant={tenant} />
        <main>{children}</main>
        <Footer tenant={tenant} />
        <WidgetEmbed />
      </body>
    </html>
  );
}
