/**
 * Turns the donor's chosen amount and message into a payable UPI intent plus its
 * QR (P0.4, P0.5).
 *
 * This hook is the only place the page joins `lib/upi.ts` to `lib/qr.ts`. Both
 * stay framework-free for the v1 widget (ADR-004); the React binding lives here
 * so extraction stays mechanical.
 */

import { useMemo } from 'react';
import { createQrMatrix, qrPngDataUrl, qrSvgDataUrl, renderQrPng, renderQrSvg } from '../lib/qr.ts';
import { buildUpiUri, resolveNote, type UpiError, type UpiIntent } from '../lib/upi.ts';

export interface UseUpiIntentInput {
  readonly vpa: string;
  readonly name: string;
  /** `null` while the donor has not entered a payable amount yet. */
  readonly amount: number | null;
  /** What the donor typed. Empty falls back to `defaultNote`. */
  readonly note?: string;
  /** `chai.defaultNote` from config. */
  readonly defaultNote?: string;
  /** `chai.maxAmountWarning` from config. */
  readonly softCapRupees?: number;
}

export interface UpiQr {
  /** `data:` URI for an `<img src>`. */
  readonly svgDataUrl: string;
  /**
   * Builds the downloadable PNG on demand.
   *
   * Deliberately a function, not a value: the PNG is ~14KB of base64 and the
   * amount changes on every keystroke, so encoding it eagerly would burn work on
   * a file most donors never download. The result is cached per intent, so
   * repeated clicks on "Save QR" encode once.
   */
  readonly toPngDataUrl: () => string;
}

export interface UseUpiIntentResult {
  /** `null` when there is nothing payable yet, or when the inputs are invalid. */
  readonly intent: UpiIntent | null;
  readonly errors: readonly UpiError[];
  /** `null` whenever `intent` is — and also if the payload exceeds QR capacity. */
  readonly qr: UpiQr | null;
}

const EMPTY_ERRORS: readonly UpiError[] = [];

export function useUpiIntent(input: UseUpiIntentInput): UseUpiIntentResult {
  const { vpa, name, amount, note, defaultNote, softCapRupees } = input;

  return useMemo<UseUpiIntentResult>(() => {
    // No amount yet is the state every donor starts in — an empty field is not a
    // mistake, so it yields no errors and simply nothing to pay.
    if (amount === null) return { intent: null, errors: EMPTY_ERRORS, qr: null };

    const result = buildUpiUri({
      vpa,
      name,
      amount,
      note: resolveNote(note, defaultNote),
      ...(softCapRupees === undefined ? {} : { softCapRupees }),
    });

    if (!result.ok) return { intent: null, errors: result.errors, qr: null };

    const matrix = createQrMatrix(result.value.uri);
    if (matrix === null) {
      // Over QR capacity, or an empty payload. The copy-VPA and deeplink paths do
      // not depend on the QR, so this degrades rather than breaks (hard rule 3).
      return { intent: result.value, errors: EMPTY_ERRORS, qr: null };
    }

    let pngCache: string | null = null;
    return {
      intent: result.value,
      errors: EMPTY_ERRORS,
      qr: {
        svgDataUrl: qrSvgDataUrl(renderQrSvg(matrix)),
        toPngDataUrl: () => {
          pngCache ??= qrPngDataUrl(renderQrPng(matrix));
          return pngCache;
        },
      },
    };
  }, [vpa, name, amount, note, defaultNote, softCapRupees]);
}
