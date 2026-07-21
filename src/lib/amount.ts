/**
 * Donor-facing amount input rules (P0.3).
 *
 * Framework-free like the rest of `src/lib` (ADR-004). This module owns only the
 * *input* layer — turning what a donor types into a rupee integer. Whether that
 * integer is payable is `upi.ts`'s call, and it stays the single authority on
 * minimums, ceilings and `am` formatting.
 */

import { MIN_AMOUNT_RUPEES } from './upi.ts';

/**
 * Digits a donor may type. ₹1 crore is 8 digits (upi.ts's HARD_MAX_AMOUNT_RUPEES),
 * so 9 lets an over-limit value be typed and rejected with a real message rather
 * than silently swallowed mid-keystroke.
 */
export const MAX_AMOUNT_INPUT_DIGITS = 9;

/**
 * Normalises raw input to the digits we accept.
 *
 * Everything non-numeric is dropped rather than rejected: donors paste "₹150",
 * "150.00" and "1,500" constantly, and refusing the keystroke is a worse
 * experience than quietly reading the number out of it. Decimals are truncated,
 * not rounded — fractional rupees are rejected outright (ADR-011) and rounding
 * ₹1.50 up to ₹2 would charge more than the donor typed.
 *
 * Leading zeros collapse so "007" reads back as "7", but a lone "0" survives:
 * it is a legitimate intermediate state while typing, and `parseRupees` is what
 * decides it is not payable.
 */
export const sanitizeAmountInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, MAX_AMOUNT_INPUT_DIGITS);
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed;
};

/**
 * Parses sanitised input to rupees. `null` means "not a payable number yet" —
 * an empty field or a zero — which the UI shows as a disabled pay state rather
 * than an error, because it is what every donor sees before typing.
 */
export const parseRupees = (raw: string): number | null => {
  const sanitized = sanitizeAmountInput(raw);
  if (sanitized.length === 0) return null;
  const value = Number.parseInt(sanitized, 10);
  return value >= MIN_AMOUNT_RUPEES ? value : null;
};

/**
 * Indian digit grouping (₹1,00,000 — not ₹100,000). `Intl` handles this with
 * `en-IN`; hand-rolling the 2-3-2 lakh/crore pattern is a classic source of bugs.
 */
export const formatRupees = (rupees: number): string =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees);
