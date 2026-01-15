import "./globals.css";
import Header from "@/components/Header";
import Providers from "@/components/Providers";

export const metadata = {
  title: "StandUp",
  description: "Meet yourself. Daily.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white">
        <Providers>
          <Header />
          <main className="px-6 py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
