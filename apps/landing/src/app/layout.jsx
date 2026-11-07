import { Spectral, Work_Sans } from "next/font/google";
import "./globals.css";

// Same type pairing as apps/dashboard/src/app/layout.jsx: Spectral for headings (the product's
// own serif), Work Sans for body/UI -- self-hosted via next/font, no runtime Google Fonts request.
const spectral = Spectral({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
});
const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

export const metadata = {
  title: "Enrollium",
  description: "AI admissions assistant for universities — every fee, deadline and scholarship answer verified against a staff-approved record.",
  icons: {
    icon: "/assets/favicon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${spectral.variable} ${workSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
