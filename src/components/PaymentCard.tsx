import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { track } from '../analytics/index.ts';
import type { ChaiConfig } from '../config/schema.ts';
import { useUpiIntent } from '../hooks/useUpiIntent.ts';
import { formatRupees, parseRupees, sanitizeAmountInput } from '../lib/amount.ts';
import { MAX_NOTE_LENGTH } from '../lib/upi.ts';
import { strings } from '../strings.ts';
import { PayZone } from './PayZone.tsx';

/**
 * The payment card — amount selection (P0.3) and donor message (P0.4) above the
 * tear; everything payable below it (P0.5, P0.6, P0.7) is delegated to `PayZone`,
 * which branches by device between the QR, deeplink and copy-VPA paths (all peers
 * by hard rule 3).
 *
 * Self-contained at 480px because it becomes `<chai-widget>` in v1 (DESIGN.md).
 *
 * The preset chips are real `<input type="radio">`s in a `<fieldset>`, visually
 * hidden behind styled labels. DESIGN.md asks for a radiogroup with arrow-key
 * support, and the platform already implements that contract exactly — arrow
 * keys, selection-follows-focus, roving tab stop and the accessibility tree all
 * come free. A `role="radiogroup"` of `<button>`s would be ~40 lines of keyboard
 * code reimplementing it, worse.
 */

/** Emoji detection for the "some apps drop emojis" nudge. Non-global: no lastIndex state. */
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/**
 * How long a custom amount must hold still before it counts as chosen
 * (docs/ANALYTICS.md). Typing "150" is three keystrokes, not three decisions —
 * without this the "popular amounts" chart would be a histogram of prefixes.
 */
const CUSTOM_AMOUNT_DEBOUNCE_MS = 800;

/**
 * A preset is identified by its amount, not its index: the schema guarantees the
 * amounts are distinct (ADR-035), and keying off the value means a config edit
 * that reorders the chips cannot silently move the selection to a different tier.
 */
type Selection = { readonly kind: 'preset'; readonly amount: number } | { readonly kind: 'custom' };

export interface PaymentCardProps {
  readonly config: ChaiConfig;
}

export function PaymentCard({ config }: PaymentCardProps): JSX.Element {
  const { creator, chai } = config;
  const presets = chai.presets;

  // Defaults to the cheapest chip (PRD §9 resolves the open question this way —
  // the presets are sorted ascending by the schema). `presets` is schema-guaranteed
  // to hold 1–4 entries; the fallback satisfies the compiler.
  const [selection, setSelection] = useState<Selection>(() => ({
    kind: 'preset',
    amount: presets[0]?.amount ?? 1,
  }));
  const [customInput, setCustomInput] = useState('');
  const [message, setMessage] = useState('');

  const amount = selection.kind === 'preset' ? selection.amount : parseRupees(customInput);

  const { intent, errors, qr } = useUpiIntent({
    vpa: creator.vpa,
    name: creator.name,
    amount,
    note: message,
    defaultNote: chai.defaultNote,
    softCapRupees: chai.maxAmountWarning,
  });

  const selectPreset = (presetAmount: number): void => {
    setSelection({ kind: 'preset', amount: presetAmount });
    // Clearing avoids two competing numbers on screen — a filled custom field
    // next to a selected chip reads as ambiguous about what is actually payable.
    setCustomInput('');
    // A chip is one deliberate act, so it reports immediately — unlike the custom
    // field below, which has to wait for the donor to stop typing.
    track({ name: 'amount_selected', amount: presetAmount, preset: true });
  };

  // A custom amount is only "selected" once the donor stops typing. The effect keys
  // off the parsed rupee value rather than the raw string, so "0150" and "150" are
  // the same decision and deleting back to an unpayable value reports nothing.
  const customRupees = selection.kind === 'custom' ? parseRupees(customInput) : null;
  useEffect(() => {
    if (customRupees === null) return;
    const timer = setTimeout(() => {
      track({ name: 'amount_selected', amount: customRupees, preset: false });
    }, CUSTOM_AMOUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [customRupees]);

  const handleCustomChange = (raw: string): void => {
    setCustomInput(sanitizeAmountInput(raw));
    setSelection({ kind: 'custom' });
  };

  const handleMessageChange = (raw: string): void => {
    // Clip by code point, never by UTF-16 unit: slicing mid-surrogate would hand
    // `encodeURIComponent` a lone surrogate, which throws (see upi.ts).
    const points = Array.from(raw);
    setMessage(points.length > MAX_NOTE_LENGTH ? points.slice(0, MAX_NOTE_LENGTH).join('') : raw);
  };

  const messageLength = Array.from(message).length;

  return (
    <section
      aria-labelledby="chai-payment-heading"
      className="mx-auto w-full max-w-[480px] rounded-[28px] bg-chai-surface p-6 shadow-[0_2px_4px_rgb(43_29_20/0.04),0_24px_60px_-18px_rgb(120_60_20/0.24)] ring-1 ring-chai-line sm:p-7"
    >
      <p className="text-balance text-[11px] font-semibold uppercase tracking-[0.16em] text-chai-accent">
        {strings.disclosure}
      </p>
      <h2
        id="chai-payment-heading"
        className="mt-2 text-[27px] font-bold leading-none tracking-[-0.02em]"
      >
        {strings.paymentCardTitle}
      </h2>

      {/* ── Amount (P0.3) ─────────────────────────────────────────────── */}
      <fieldset className="mt-6 border-0 p-0">
        <legend className="sr-only">{strings.amountGroupLabel}</legend>
        <div className="flex items-stretch gap-2">
          {presets.map((preset) => {
            const checked = selection.kind === 'preset' && selection.amount === preset.amount;
            return (
              <label key={preset.amount} className="flex-1">
                <input
                  type="radio"
                  name="chai-amount"
                  className="peer sr-only"
                  value={preset.amount}
                  checked={checked}
                  onChange={() => selectPreset(preset.amount)}
                  aria-label={strings.presetChipLabel(preset.label, formatRupees(preset.amount))}
                />
                {/*
                 * Selected state is a tint plus a 2px accent border, not a solid
                 * accent fill: the brand accent is 4.09:1 against white, which
                 * fails AA for label-sized text placed on top of it. Ink on the
                 * soft tint is 13.9:1.
                 */}
                {/*
                 * `h-full` + `items-stretch` on the row keeps the chips the same
                 * height when one label wraps to two lines — a tier name is the
                 * creator's prose, so wrapping is the normal case, not the edge.
                 * The label takes the slack (`flex-1`) and the price sits at the
                 * bottom, so the amounts read as one row however the names wrap.
                 */}
                <span className="flex h-full min-h-16 cursor-pointer flex-col items-center rounded-2xl border-2 border-chai-line bg-chai-surface px-1.5 py-2 text-chai-ink transition-all duration-150 hover:border-chai-line-strong peer-checked:-translate-y-0.5 peer-checked:border-chai-accent peer-checked:bg-chai-accent-soft peer-checked:shadow-[0_8px_18px_-8px_rgb(120_60_20/0.3)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-chai-accent">
                  {/*
                   * Decoration only — the accessible name is label + amount, so a
                   * screen reader never reads out "coffee coffee fries". Tracking
                   * is tightened because stacked glyphs ship with wide side
                   * bearings and read as three separate icons otherwise.
                   */}
                  {preset.emoji !== undefined && (
                    <span aria-hidden="true" className="text-[15px] leading-none tracking-tighter">
                      {preset.emoji}
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    className="mt-1 flex flex-1 items-center text-balance text-center text-[12px] leading-tight text-chai-muted"
                  >
                    {preset.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="chai-numeral mt-1 text-[15px] font-bold leading-none"
                  >
                    {strings.presetChipPrice(formatRupees(preset.amount))}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {chai.allowCustomAmount && (
        <div className="mt-3">
          <label
            htmlFor="chai-custom-amount"
            className="block text-[13px] font-medium text-chai-muted"
          >
            {strings.customAmountLabel}
          </label>
          <div className="mt-1.5 flex items-center gap-1.5 rounded-2xl border-2 border-chai-line px-3.5 focus-within:border-chai-accent">
            <span aria-hidden="true" className="text-[15px] font-semibold text-chai-muted">
              ₹
            </span>
            <input
              id="chai-custom-amount"
              // `inputMode` + `pattern` give mobile a numeric keypad without
              // `type="number"`, whose spinners and locale parsing cause more
              // trouble than they solve for a whole-rupee field.
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder={strings.customAmountPlaceholder}
              value={customInput}
              onChange={(event) => handleCustomChange(event.target.value)}
              // The focus ring lives on the wrapper, so the input drops its own.
              className="min-h-12 w-full bg-transparent text-[15px] font-semibold outline-none placeholder:font-normal placeholder:text-chai-muted"
            />
          </div>
        </div>
      )}

      {/* Warn, never block (P0.3). */}
      {intent?.exceedsSoftCap === true && (
        <p className="mt-2 text-[13px] text-chai-warn">{strings.largeAmountWarning}</p>
      )}

      {/* ── Message (P0.4) ────────────────────────────────────────────── */}
      {chai.allowDonorMessage && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="chai-message" className="text-[13px] font-medium text-chai-muted">
              {strings.messageLabel}
            </label>
            <span aria-hidden="true" className="chai-numeral text-[11px] text-chai-muted">
              {strings.messageCounter(messageLength, MAX_NOTE_LENGTH)}
            </span>
          </div>
          <input
            id="chai-message"
            type="text"
            autoComplete="off"
            aria-describedby="chai-message-hint"
            placeholder={chai.defaultNote}
            value={message}
            onChange={(event) => handleMessageChange(event.target.value)}
            className="mt-1.5 min-h-12 w-full rounded-2xl border-2 border-chai-line bg-transparent px-3.5 text-[15px] outline-none placeholder:text-chai-muted focus:border-chai-accent"
          />
          <p id="chai-message-hint" className="mt-1.5 text-[12px] text-chai-muted">
            {strings.messageHint}
          </p>
          {EMOJI_RE.test(message) && (
            <p className="mt-1 text-[12px] text-chai-warn">{strings.messageEmojiWarning}</p>
          )}
        </div>
      )}

      {/* ── Pay zone (P0.5, P0.6, P0.7) ───────────────────────────────── */}
      {/* The tear bleeds to the card edges, so it needs the padding cancelled. */}
      <div className="chai-tear -mx-6 mt-7 sm:-mx-7" aria-hidden="true" />

      <PayZone intent={intent} errors={errors} qr={qr} />

      {/* Never a success state — the limitation is the pitch (DESIGN.md). */}
      <p className="mt-7 text-balance text-center text-[12px] leading-relaxed text-chai-muted">
        {strings.noConfirmationNote}
      </p>
    </section>
  );
}
