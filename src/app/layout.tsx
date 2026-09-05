import type { Metadata, Viewport } from "next";
import { Space_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import RegisterSW from "@/components/RegisterSW";

// One monospace/LCD-adjacent voice app-wide — the seven-segment-display
// world's typography (see .impeccable/surfaces/src-app-page-tsx.md), not a
// "technical" costume on top of an unrelated sans pairing. 400 for body,
// 700 for headings/emphasis.
const ledFont = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "StandUp - Daily Execution & Accountability",
  description: "Plan tomorrow. Review today. Build consistency.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StandUp",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

// themeColor lives in a separate `viewport` export as of Next.js 14+ —
// putting it in `metadata` (as the older API did) now just logs a
// deprecation warning at build time and is ignored.
export const viewport: Viewport = {
  themeColor: "#0B0A12",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={ledFont.variable}>
      <head>
        {/* Runs before paint so the stored theme applies immediately —
            avoids a flash of the wrong theme on load. Reads directly from
            localStorage since this executes before React (or theme.ts)
            hydrates. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
              var t = localStorage.getItem("standup-theme");
              if (t === "light") document.documentElement.setAttribute("data-theme", "light");
            } catch (e) {}`,
          }}
        />
      </head>
      <body>
        <RegisterSW />
        <div className="app-shell">
          <div className="app-bg" />
          <Header />
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
