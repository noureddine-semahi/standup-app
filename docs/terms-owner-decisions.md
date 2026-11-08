# Terms of Service: owner decisions and legal review (Phase 5.8.1)

The Terms of Service page (`/terms`, English and Spanish) is a **draft** prepared from what the app actually does. **It has not been reviewed by a lawyer**,
and the page says so until an effective date is published. Nothing in it was invented about the business: it names no company, address, jurisdiction,
support email or refund guarantee. The decisions below are the owner's to make, with legal advice, before the Terms take effect.

## How to publish
1. Make the decisions below and have the Terms (both languages) reviewed by a qualified lawyer for the places you will sell to.
2. Edit `src/lib/terms.ts`: set `TERMS_EFFECTIVE_DATE` to an ISO date (`"YYYY-MM-DD"`) and bump `TERMS_VERSION` (for example `"1.0"`). The page then
   shows "Version 1.0 · Effective <date>" and the draft notice disappears. A test fails if the draft notice and the effective date disagree.
3. Add any text the decisions require to the `terms.*` keys in `src/lib/i18n/en.ts` and `es.ts` (both languages, with the same numbers; a test checks parity).

## Open decisions (not in the Terms today)
| # | Decision | What the draft says now |
|---|---|---|
| 1 | **Operator identity**: legal name, entity type, registration number, registered address | "the operator of the Service"; contact via the Contact page |
| 2 | **Support contact and response time**: the Contact page shows `deandevsolutions@gmail.com` (set in `src/app/contact/page.tsx`); confirm it is the intended support address | "reply as soon as we can", no time promised |
| 3 | **Governing law, jurisdiction, venue, dispute resolution** (courts, arbitration, class-action terms) | Omitted |
| 4 | **Minimum age** and any rules for minors / children's data | "able to form a binding agreement where you live; otherwise a parent or guardian agrees" |
| 5 | **Refund policy**: any cooling-off period, pro-rata or goodwill refunds, and the statutory withdrawal rights that apply where you sell (for example EU/UK digital-content rules) | Cancel/delete stops future charges, no automatic refund, "contact us and we will review", statutory rights preserved |
| 6 | **Taxes**: whether VAT / sales tax is collected (Stripe Tax is not configured) and whether prices are tax-inclusive | "billed in US dollars… the exact amount is shown on Stripe's checkout page" |
| 7 | **Notice period for price or plan changes** | "reasonable notice… won't apply to a period already paid" |
| 8 | **Warranty disclaimer, limitation of liability, indemnity** | Deliberately omitted (only "nothing excludes what the law doesn't allow") |
| 9 | **Content ownership / licence wording** | "You keep your rights… you allow us to store, process and display it only as needed" |
| 10 | **Suspension and termination process** (reasons, notice, appeal) | "We may remove content, or restrict or close accounts, that break these Terms" |
| 11 | **How users accept the Terms**: signup currently shows only the Privacy consent; the Terms are linked from footers, the About/FAQ/Privacy pages and next to the Subscribe button. Decide on a signup agreement and how existing members are told | Linked, not required |
| 12 | **Automatic-renewal and checkout consent rules** for each place you sell (clear disclosure, affirmative consent, easy cancellation, renewal reminders). A Stripe Checkout consent checkbox needs the Terms URL set in the Stripe Dashboard | Renewal note beside the Subscribe button; cancel via Settings > Premium > Manage subscription |
| 13 | **Stripe account settings**: Terms/Privacy URLs in the Dashboard's public details and in the Customer Portal configuration (not changed in this milestone) | Not set by this work |
| 14 | **Data-protection basis and retention schedule** for billing records, the 24-month free-trial marker and audit records (and any Stripe data-processing terms) | Stated in the Privacy Policy and Terms as implemented |
| 15 | **Which language controls** if the English and Spanish texts ever differ, and a native-speaker or legal-translator review of the Spanish | Not stated |
| 16 | **Accessibility review** with real assistive technology on desktop and mobile | Automated structure checks only |

## What the Terms state that the app really does (kept in step by tests)
- Free limits: 3 active structured Goals, 3 routines, 10 notes; Premium: unlimited (from `src/lib/entitlements.ts`).
- One free Premium trial of 14 days per person; no payment details needed; ends on the Free plan; a keyed, non-reversible marker (never the email) is kept 24 months.
- Prices: **$5.99 / month** and **$49.99 / year**, in US dollars, shown on Stripe's checkout page before paying (from `PRICING`).
- Automatic renewal until canceled; failed renewals retried with a 7-day grace period, then the Free plan; nothing created is deleted.
- Cancel in Settings > Premium > Manage subscription (Stripe's portal): Premium until the end of the paid period, no further charges.
- Account deletion cancels any subscription immediately (and stops if that cannot be confirmed); no automatic refund; payment records kept as financial/legal rules require.
- Payments by Stripe; card details never reach StandUp.
- Paid plans are **not yet available** (the beta is free); the Terms say so.

## Review requirements
- Legal review of both languages before the effective date is set, including consumer-protection and automatic-renewal rules where you will sell.
- Re-review whenever pricing, the refund policy, deletion behaviour or the data the app keeps changes.
