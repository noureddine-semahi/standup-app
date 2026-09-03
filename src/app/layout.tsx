import type { Metadata } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";

// Calmer, more standard productivity-tool pairing: Inter for body copy
// (clean, highly legible), Sora for headings (a little character without
// tipping into the neon-gaming look the rest of the theme is moving away from).
const inter = Inter({ subsets: ["latin"], variable: "--font-body" });
const sora = Sora({ subsets: ["latin"], variable: "--font-heading" });

export const metadata: Metadata = {
  title: "StandUp - Daily Execution & Accountability",
  description: "Plan tomorrow. Review today. Build consistency.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
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
        <div className="app-shell">
          <div className="app-bg" />
          <Header />
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
