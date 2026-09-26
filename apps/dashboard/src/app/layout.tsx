import type { Metadata } from "next";
import { Spectral, Work_Sans } from "next/font/google";
import "./globals.css";

// Spectral: the small set of serif moments (wordmark, page titles, card/section titles). Everything else,
// including KPI numbers, is Work Sans -- see references/Enrollium_Design_Documentation.pdf, section 03.
const spectral = Spectral({ subsets: ["latin"], weight: ["600"], variable: "--font-heading" });
const workSans = Work_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Enrollium",
  description: "Admissions AI dashboard",
};

// Reads the persisted theme choice before paint, so there is no light-then-dark flash on load.
const THEME_BOOTSTRAP = `
(function () {
  try {
    var t = localStorage.getItem("enrollium-theme");
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spectral.variable} ${workSans.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="font-body">{children}</body>
    </html>
  );
}
