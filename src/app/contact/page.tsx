import Link from "next/link";

const CONTACT_EMAIL = "support@standup.app";

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">Contact Us</h1>
          <p className="text-lg text-white/70">
            Questions, bug reports, or feature ideas — we'd like to hear them.
          </p>
        </div>

        <div className="card card-highlight text-center">
          <div className="p-2">
            <div className="text-sm text-white/60 mb-2">Reach us at</div>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-2xl font-semibold text-purple-300 hover:text-purple-200 transition"
            >
              {CONTACT_EMAIL}
            </a>
            <p className="mt-6 text-sm text-white/60">
              For a faster answer on how something works, check the{" "}
              <Link href="/faq" className="text-purple-300 hover:text-purple-200 underline">
                FAQ
              </Link>{" "}
              first.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
