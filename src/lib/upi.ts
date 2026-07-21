/**
 * UPI P2P intent URI builder.
 *
 * Framework-free by contract: zero imports, zero DOM, zero network. This module is
 * extracted verbatim into `packages/core` when the v1 widget lands (ADR-004), so it
 * must never import React, Zod, `node:*`, or `src/strings.ts`.
 *
 * Emits P2P intent URIs per ADR-002 with exactly these params: pa, pn, am, cu, tn.
 * NEVER add mc, tr, mode, purpose, orgid, sign, tid, url, mam or minam — merchant
 * params trigger verification failures against unregistered VPAs.
 *
 * Copy exception (ADR-015): every user-visible string in this project lives in
 * `src/strings.ts`, but this module must stay import-free. It therefore emits a
 * stable `UpiErrorCode` plus a developer-facing English `message`; UI copy is keyed
 * off the code in `strings.ts`.
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const UPI_URI_PREFIX = 'upi://pay?' as const;
export const UPI_CURRENCY = 'INR' as const;

/**
 * Verbatim from CLAUDE.md. Case is preserved: VPAs are case-insensitive, but we
 * never normalise one — a silently mutated VPA is ADR-008's unrecoverable failure.
 * Declared here (not in the config schema) so there is one regex and one matrix.
 */
export const VPA_REGEX = /^[a-zA-Z0-9.\-_]{2,49}@[a-zA-Z][a-zA-Z0-9]{2,49}$/;

export const MIN_AMOUNT_RUPEES = 1;

/**
 * Numeric-integrity ceiling (ADR-011), not product policy: above ~1e21,
 * `Number.prototype.toFixed(2)` returns exponential notation ("1e+21"), which would
 * emit a malformed `am`. ₹1 crore is 100× the soft cap and far above any real chai.
 */
export const HARD_MAX_AMOUNT_RUPEES = 10_000_000;

/** Default UI warning threshold (P0.3). Overridable per call via `softCapRupees`. */
export const DEFAULT_SOFT_CAP_RUPEES = 100_000;

/** Decoded code points, not encoded bytes (ADR-012). */
export const MAX_NOTE_LENGTH = 60;

/** Matches CONFIG.md `creator.name` 1–50. */
export const MAX_NAME_LENGTH = 50;

// ── Types ────────────────────────────────────────────────────────────────────

export type UpiErrorCode =
  | 'VPA_REQUIRED'
  | 'VPA_INVALID_FORMAT'
  | 'NAME_REQUIRED'
  | 'AMOUNT_NOT_FINITE'
  | 'AMOUNT_NOT_INTEGER'
  | 'AMOUNT_BELOW_MIN'
  | 'AMOUNT_ABOVE_HARD_MAX';

export type UpiField = 'vpa' | 'name' | 'amount';

export interface UpiError {
  readonly code: UpiErrorCode;
  /** Developer-facing. User-facing copy is looked up by `code` in src/strings.ts. */
  readonly message: string;
  readonly field: UpiField;
}

export type UpiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly UpiError[] };

export interface UpiIntentInput {
  readonly vpa: string;
  readonly name: string;
  readonly amount: number;
  readonly note?: string;
  readonly softCapRupees?: number;
}

export interface UpiIntent {
  readonly uri: string;
  /** Verbatim, exactly as the creator typed it. */
  readonly vpa: string;
  /** Sanitised, pre-encoding. */
  readonly name: string;
  /** Formatted `am` value, e.g. "150.00". */
  readonly amount: string;
  /** Sanitised note, pre-encoding. Empty string means `tn` was omitted. */
  readonly note: string;
  /** P0.3 warning signal. NEVER an error — we warn, we don't block. */
  readonly exceedsSoftCap: boolean;
}

const err = (code: UpiErrorCode, field: UpiField, message: string): UpiError => ({
  code,
  field,
  message,
});

// ── Encoding ─────────────────────────────────────────────────────────────────

/**
 * RFC 3986 percent-encoding, unreserved characters only.
 *
 * NEVER use `URLSearchParams` here (ADR-010): it implements the WHATWG
 * x-www-form-urlencoded serializer, which encodes a space as `+`. UPI apps decode
 * `upi://` query strings with plain percent-decoders, so `+` would surface as
 * literal garbage in the donor's note and in the creator's displayed name.
 *
 * `encodeURIComponent` leaves `!'()*` unescaped; we escape them too so the payload
 * is unreserved-only (CLAUDE.md: "avoid special chars beyond spaces").
 *
 * Applied to `pn` and `tn` ONLY. `pa`, `am` and `cu` are emitted verbatim: every
 * character a valid VPA can contain is either RFC 3986 unreserved or `@`, and
 * percent-encoding the `@` would break naive parsers that don't decode `pa`.
 */
export const encodeUpiComponent = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// ── Sanitising ───────────────────────────────────────────────────────────────

/**
 * Invisible and bidi-spoofing characters. A bidi override inside `tn` can visually
 * reverse the note shown in the payer's app.
 *
 * U+200C ZWNJ and U+200D ZWJ are deliberately absent: ZWNJ is semantically required
 * in Devanagari conjuncts and ZWJ builds family/profession emoji. Blanket-stripping
 * zero-width characters would corrupt Hindi text.
 */
const INVISIBLE_RE =
  /[\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/** C0 + DEL + C1. Replaced with a space so words don't glue together. */
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;

const WHITESPACE_RUN_RE = /\s+/g;

const isLoneSurrogate = (ch: string): boolean =>
  ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff;

/**
 * Shared text pipeline. The order is load-bearing:
 * strip invisibles → controls to space → NFC → collapse runs → trim →
 * drop lone surrogates → truncate by code point → trim again (truncation can
 * expose a trailing space).
 *
 * NFC runs *after* the strip, not before. Removing a character can bring two others
 * together into a composable pair: "e" + U+200B + U+0301 normalises to itself while
 * the ZWSP separates them, but once the ZWSP is stripped the result is a decomposed
 * "e" + combining acute. Normalising first would emit non-NFC output and make the
 * function non-idempotent — sanitize(sanitize(x)) !== sanitize(x).
 *
 * Truncation slices code points via `Array.from`, never UTF-16 units: splitting a
 * surrogate pair yields a lone surrogate, and `encodeURIComponent` throws
 * `URIError` on one — which would crash the QR render path on a keystroke.
 */
export const sanitizeText = (raw: unknown, maxLength: number): string => {
  if (typeof raw !== 'string') return '';
  const collapsed = raw
    .replace(INVISIBLE_RE, '')
    .replace(CONTROL_RE, ' ')
    .normalize('NFC')
    .replace(WHITESPACE_RUN_RE, ' ')
    .trim();
  const points = Array.from(collapsed).filter((ch) => !isLoneSurrogate(ch));
  const clipped = points.length > maxLength ? points.slice(0, maxLength) : points;
  return clipped.join('').trim();
};

export const sanitizeNote = (raw: unknown): string => sanitizeText(raw, MAX_NOTE_LENGTH);

export const sanitizeName = (raw: unknown): string => sanitizeText(raw, MAX_NAME_LENGTH);

/**
 * P0.4: an empty donor message falls back to the config's `chai.defaultNote`.
 * When both are empty the caller gets `''` and `buildUpiUri` omits `tn` entirely.
 */
export const resolveNote = (donorNote: unknown, defaultNote: unknown): string => {
  const donor = sanitizeNote(donorNote);
  return donor.length > 0 ? donor : sanitizeNote(defaultNote);
};

// ── Validators ───────────────────────────────────────────────────────────────

export const validateVpa = (vpa: unknown): UpiResult<string> => {
  if (typeof vpa !== 'string' || vpa.length === 0) {
    return { ok: false, errors: [err('VPA_REQUIRED', 'vpa', 'UPI ID is required.')] };
  }
  if (!VPA_REGEX.test(vpa)) {
    return {
      ok: false,
      errors: [
        err(
          'VPA_INVALID_FORMAT',
          'vpa',
          `Invalid UPI ID "${vpa}". Expected format like name@bank. Double-check in your UPI app → profile.`,
        ),
      ],
    };
  }
  return { ok: true, value: vpa };
};

/**
 * Produces the `am` value: integers only (ADR-011), always 2 decimals.
 *
 * Fractional rupees are rejected rather than rounded — several UPI apps drop or
 * round the paise component of `am` on P2P intents, so ₹1.50 on our page and ₹1 in
 * the app is a trust break we have no confirmation channel to detect.
 */
export const formatAmount = (rupees: number): UpiResult<string> => {
  if (!Number.isFinite(rupees)) {
    return {
      ok: false,
      errors: [err('AMOUNT_NOT_FINITE', 'amount', 'Amount must be a finite number.')],
    };
  }
  if (!Number.isInteger(rupees)) {
    return {
      ok: false,
      errors: [err('AMOUNT_NOT_INTEGER', 'amount', 'Amount must be a whole number of rupees.')],
    };
  }
  if (rupees < MIN_AMOUNT_RUPEES) {
    return {
      ok: false,
      errors: [err('AMOUNT_BELOW_MIN', 'amount', `Amount must be at least ₹${MIN_AMOUNT_RUPEES}.`)],
    };
  }
  if (rupees > HARD_MAX_AMOUNT_RUPEES) {
    return {
      ok: false,
      errors: [
        err(
          'AMOUNT_ABOVE_HARD_MAX',
          'amount',
          `Amount must not exceed ₹${HARD_MAX_AMOUNT_RUPEES}.`,
        ),
      ],
    };
  }
  return { ok: true, value: rupees.toFixed(2) };
};

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Builds the payable intent. Returns a Result and never throws: this runs on every
 * keystroke of the custom-amount input, where transient invalid states ("", 0, "1.")
 * are normal and an exception in a React render path is not acceptable.
 *
 * All errors are accumulated (not fail-fast) in a fixed order — vpa, name, amount —
 * so a config with two problems reports both.
 *
 * Param order is fixed and deterministic: pa, pn, am, cu, tn. `tn` is omitted
 * entirely when the resolved note is empty, so there is never a dangling `&tn=`.
 */
export const buildUpiUri = (input: UpiIntentInput): UpiResult<UpiIntent> => {
  const vpaResult = validateVpa(input.vpa);
  const name = sanitizeName(input.name);
  const amountResult = formatAmount(input.amount);
  const nameErrors: readonly UpiError[] =
    name.length === 0 ? [err('NAME_REQUIRED', 'name', 'Creator name is required.')] : [];

  if (!vpaResult.ok || nameErrors.length > 0 || !amountResult.ok) {
    return {
      ok: false,
      errors: [
        ...(vpaResult.ok ? [] : vpaResult.errors),
        ...nameErrors,
        ...(amountResult.ok ? [] : amountResult.errors),
      ],
    };
  }

  const note = sanitizeNote(input.note);
  const softCap = input.softCapRupees ?? DEFAULT_SOFT_CAP_RUPEES;

  const params = [
    `pa=${vpaResult.value}`,
    `pn=${encodeUpiComponent(name)}`,
    `am=${amountResult.value}`,
    `cu=${UPI_CURRENCY}`,
  ];
  if (note.length > 0) params.push(`tn=${encodeUpiComponent(note)}`);

  return {
    ok: true,
    value: {
      uri: `${UPI_URI_PREFIX}${params.join('&')}`,
      vpa: vpaResult.value,
      name,
      amount: amountResult.value,
      note,
      exceedsSoftCap: input.amount > softCap,
    },
  };
};
