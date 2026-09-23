import type { Metadata } from "next";
import { getTenant } from "@/lib/content";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { WidgetEmbed } from "@/components/WidgetEmbed";
import "./globals.css";

export function generateMetadata(): Metadata {
  const tenant = getTenant();
  return { title: `${tenant.name} — Admissions`, description: tenant.welcome_message };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = getTenant();
  return (
    <html lang="en">
      <body
        style={{ ["--color-primary" as string]: tenant.branding.primary, ["--color-accent" as string]: tenant.branding.accent }}
        className="min-h-screen text-gray-900"
      >
        <Nav tenant={tenant} />
        <main>{children}</main>
        <Footer tenant={tenant} />
        <WidgetEmbed />
      </body>
    </html>
  );
}
