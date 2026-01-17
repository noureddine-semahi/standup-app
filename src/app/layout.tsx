import "./globals.css";
import Header from "@/components/Header";
import Providers from "@/components/Providers";

export const metadata = {
  title: "StandUp",
  description: "Meet yourself. Daily.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <div className="app-shell">
            <div className="app-bg" aria-hidden="true" />
            <Header />
            <main className="app-main">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
