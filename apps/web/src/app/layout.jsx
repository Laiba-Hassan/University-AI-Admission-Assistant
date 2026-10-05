import { Lora, Inter } from "next/font/google";
import { getTenant } from "@/lib/content";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { WidgetEmbed } from "@/components/WidgetEmbed";
import "./globals.css";

// A serif for headings gives the site the collegiate, institutional feel real university sites use; Inter for body
// keeps long-form text (fees tables, policy pages) easy to read. Both self-host via next/font (no runtime request).
const heading = Lora({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["500", "600", "700"]
});
const body = Inter({
  subsets: ["latin"],
  variable: "--font-body"
});
export function generateMetadata() {
  const tenant = getTenant();
  return {
    title: `${tenant.name} — Admissions`,
    description: tenant.welcome_message
  };
}
export default function RootLayout({
  children
}) {
  const tenant = getTenant();
  return <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body style={{
      ["--color-primary"]: tenant.branding.primary,
      ["--color-accent"]: tenant.branding.accent
    }} className="min-h-screen bg-white font-body text-gray-900">
        <Nav tenant={tenant} />
        <main>{children}</main>
        <Footer tenant={tenant} />
        <WidgetEmbed />
      </body>
    </html>;
}