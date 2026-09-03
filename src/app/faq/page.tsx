import Link from "next/link";

const FAQS: { question: string; answer: string }[] = [
  {
    question: "What is StandUp?",
    answer:
      "A daily execution and reflection system: you plan tomorrow's goals, review today's, and close the loop each day. It's built around one rule — you can't plan tomorrow until you've reviewed today.",
  },
  {
    question: "How do I earn points?",
    answer:
      "Two ways each day: a small \"awareness\" bonus the first time you review a pending goal, and a larger \"closure\" bonus when you close out the day. The closure bonus scales up with your current streak, up to a cap — so a longer streak earns more per day.",
  },
  {
    question: "What happens if I miss a day?",
    answer:
      "Your streak resets, but you don't lose access to anything — the next day you close out still earns the base closure bonus. Missed days also show up clearly on your Points & Usage History page.",
  },
  {
    question: "Where can I see my points and activity history?",
    answer:
      "From your Profile, open \"Points & Usage History.\" It lists every day you earned points with the breakdown, plus an Activity Overview further down — days checked in, days missed, and days with completed goals, with a weekly or monthly bar chart.",
  },
  {
    question: "Can I reschedule a goal instead of completing it?",
    answer:
      "Yes — reschedule a goal to any future date from Review Today. It automatically appears as a goal on that date when it arrives, along with a note showing where it was rescheduled from and why.",
  },
  {
    question: "How does the streak work?",
    answer:
      "It counts consecutive days you've closed out, walking backward from today. Today itself doesn't break the streak while it's still in progress — it just doesn't count until you close it.",
  },
  {
    question: "What's the difference between \"Review Today\" and \"Plan Tomorrow\"?",
    answer:
      "Review Today is where you mark today's goals reviewed, update their status, add notes, and close out the day. Plan Tomorrow is where you set at least 3 goals for the next day — you can always draft and save it, but submitting it is locked until today is reviewed.",
  },
  {
    question: "Can I plan further ahead than just tomorrow?",
    answer:
      "Yes — click any date on the Calendar to draft goals for it, days or weeks out. Drafting and saving is always open on any date. Submitting (finalizing) a plan only unlocks the evening before that date arrives, once the day before it has been reviewed — the same rule that governs Plan Tomorrow.",
  },
  {
    question: "Can I go back and look at past days?",
    answer:
      "Yes — past dates on the Calendar open in a view-only summary: title, priority, status, and any notes, exactly as they were. You can't add or edit anything on a day that's already passed, but you can \"re-attempt\" any goal from it, which reschedules a fresh copy onto a future date of your choice.",
  },
  {
    question: "Can I use dark or light mode?",
    answer:
      "Yes — there's a theme switch in Settings under Appearance. Your choice is remembered on this device.",
  },
  {
    question: "Is my personal info required?",
    answer:
      "No. First/last name, date of birth, address, phone number, and a profile photo are all optional fields in Settings, kept separate from your display name.",
  },
  {
    question: "Can I delete my account?",
    answer:
      "Yes, from Settings under Danger Zone — it wipes your goals, plans, notes, and reschedule history, and resets your points to zero.",
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">Frequently Asked Questions</h1>
          <p className="text-lg text-white/70 max-w-2xl mx-auto">
            Everything you need to know about how StandUp works.
          </p>
        </div>

        <div className="card card-highlight">
          <div className="divide-y divide-white/10">
            {FAQS.map((item, idx) => (
              <details key={idx} className="group py-4 first:pt-0 last:pb-0">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-white">
                  {item.question}
                  <span className="text-white/40 transition-transform group-open:rotate-45 text-xl leading-none flex-shrink-0">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm text-white/70 leading-relaxed">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>

        <div className="text-center mt-10">
          <p className="text-sm text-white/60">
            Still have questions?{" "}
            <Link href="/contact" className="text-purple-300 hover:text-purple-200 underline">
              Contact us
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
