import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";

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
    <html lang="en">
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