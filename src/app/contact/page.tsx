import Link from "next/link";
import SocialShareButtons from "@/components/SocialShareButtons";

const CONTACT_EMAIL = "deandevsolutions@gmail.com";

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">Contact Us</h1>
          <p className="text-lg text-page-secondary">
            Questions, bug reports, or feature ideas — we'd like to hear them.
          </p>
        </div>

        <div className="card card-highlight text-center">
          <div className="p-2">
            <div className="text-sm text-white/60 mb-2">Reach us at</div>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-sm sm:text-2xl font-semibold text-amber-300 hover:text-amber-200 transition"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {CONTACT_EMAIL}
            </a>
            <p className="mt-6 text-sm text-white/60">
              For a faster answer on how something works, check the{" "}
              <Link href="/faq" className="text-amber-300 hover:text-amber-200 underline">
                FAQ
              </Link>{" "}
              first, or read more{" "}
              <Link href="/about" className="text-amber-300 hover:text-amber-200 underline">
                About
              </Link>{" "}
              StandUp.
            </p>

            <div className="mt-6 pt-6" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
              <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
                Spread the word
              </div>
              <SocialShareButtons />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
