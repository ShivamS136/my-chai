/**
 * Every user-visible string on the page.
 *
 * Centralised to prepare for i18n (Hinglish first, v2) — but we are NOT building
 * i18n yet. Add keys here; do not add a translation layer.
 *
 * Copy rules that outrank style (PRD §8, ADR-006):
 *  - Never imply a payment completed. We have no confirmation channel and never
 *    will. "Payment happens in your UPI app" is the strongest claim available.
 *  - Never promise the deeplink works. It is a best-effort accelerator; QR and
 *    copy-VPA are the guaranteed paths.
 *
 * Two documented exceptions live outside this file (ADR-015):
 *  - `src/lib/upi.ts` and `src/config/*` are framework-free so they can be
 *    extracted to `packages/core` for the v1 widget. They emit stable error codes
 *    plus developer-facing English; UI copy is keyed off the code here.
 *  - `meta.title`'s `Buy {name} a chai` default is derived in the config schema,
 *    because it is needed before React mounts.
 *
 * Session 1 is scaffolding only — the page renders nothing yet, so this is a stub.
 * Sessions 2–4 fill it as components land.
 */

export const strings = {
  /** Fallback document title; the real one is derived from config `meta.title`. */
  documentTitle: 'Buy me a chai',
  /** Shown inside <noscript> — the page needs JS to build the QR client-side. */
  noscript:
    'This page needs JavaScript to generate the UPI QR code. You can still pay by copying the UPI ID shown above into any UPI app.',
} as const;

export type StringKey = keyof typeof strings;
