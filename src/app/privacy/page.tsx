import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">Privacy Policy</h1>
          <p className="text-lg text-page-secondary">Last updated September 2026</p>
        </div>

        <div className="card card-highlight space-y-6">
          <section>
            <h2 className="text-lg font-semibold text-white mb-2">What we collect</h2>
            <p className="text-sm text-white/70">
              An email and password for your account (handled by our authentication provider,
              Supabase). Everything you enter to use StandUp itself — goals, priorities, statuses,
              notes, reschedules, and your points/streak history. And, only if you choose to fill
              them in under Settings, optional personal info: first/last name, date of birth,
              address, phone number, and a profile photo.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Why we collect it</h2>
            <p className="text-sm text-white/70">
              Your goals, notes, and history power the app's core features — tracking, streaks,
              points, and levels. The optional personal info fields exist for possible future
              personalization, like more relevant goal suggestions — they're never required, and
              nothing is sold or shared with third-party advertisers. We don't run any third-party
              analytics or tracking scripts.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Homepage visits</h2>
            <p className="text-sm text-white/70">
              The first time you land on our homepage without being signed in, we log a timestamp
              so we can see how many people find the app — nothing that identifies you, no
              cookies, and no tracking across other sites. Your browser remembers locally that
              you've visited before (not sent to us) so repeat visits and refreshes aren't
              double-counted, and this stops entirely the moment you're signed in.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Referrals &amp; sharing</h2>
            <p className="text-sm text-white/70">
              If you invite someone with your referral link, we record who referred whom so we
              can credit the bonus once they complete their first day — nothing more. If you use
              the Share button, we only record that you shared once (to unlock the related
              achievement); we don't see or store what you actually posted.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Where it's stored</h2>
            <p className="text-sm text-white/70">
              In a Postgres database via Supabase, protected by row-level security — access is
              restricted so your data is only readable by your own account. A small amount of
              on-device storage (your browser's local storage) remembers preferences like your
              theme choice, entirely on your device.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Your control over it</h2>
            <p className="text-sm text-white/70">
              Every optional field can be left blank or cleared at any time in Settings. You can
              permanently delete your account and wipe all associated data from Settings under
              Danger Zone.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Questions</h2>
            <p className="text-sm text-white/70">
              Reach out any time via the{" "}
              <Link href="/contact" className="text-amber-300 hover:text-amber-200 underline">
                Contact
              </Link>{" "}
              page.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
