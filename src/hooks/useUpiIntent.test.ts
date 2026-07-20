import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type UseUpiIntentInput, useUpiIntent } from './useUpiIntent.ts';

const BASE: UseUpiIntentInput = {
  vpa: 'shivam@okaxis',
  name: 'Shivam Sharma',
  amount: 150,
};

const render = (overrides: Partial<UseUpiIntentInput> = {}) =>
  renderHook((props: UseUpiIntentInput) => useUpiIntent(props), {
    initialProps: { ...BASE, ...overrides },
  });

describe('useUpiIntent', () => {
  it('builds a payable intent with a QR', () => {
    const { result } = render();
    expect(result.current.intent?.uri).toBe(
      'upi://pay?pa=shivam@okaxis&pn=Shivam%20Sharma&am=150.00&cu=INR',
    );
    expect(result.current.errors).toEqual([]);
    expect(result.current.qr?.svgDataUrl.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('treats a missing amount as nothing-yet, not an error', () => {
    // This is the state every donor sees before typing. Surfacing "amount must
    // be a number" on first paint would be scolding them for not having started.
    const { result } = render({ amount: null });
    expect(result.current.intent).toBeNull();
    expect(result.current.errors).toEqual([]);
    expect(result.current.qr).toBeNull();
  });

  it('reports errors and withholds the QR when the inputs are unpayable', () => {
    const { result } = render({ vpa: 'not a vpa' });
    expect(result.current.intent).toBeNull();
    expect(result.current.qr).toBeNull();
    expect(result.current.errors.map((e) => e.code)).toEqual(['VPA_INVALID_FORMAT']);
  });

  it('falls back to the configured default note when the donor writes nothing (P0.4)', () => {
    const { result } = render({ note: '', defaultNote: 'Chai for your work' });
    expect(result.current.intent?.note).toBe('Chai for your work');
    expect(result.current.intent?.uri).toContain('&tn=Chai%20for%20your%20work');
  });

  it("prefers the donor's note over the default", () => {
    const { result } = render({ note: 'Great post!', defaultNote: 'Chai for your work' });
    expect(result.current.intent?.note).toBe('Great post!');
  });

  it('omits tn entirely when neither note is set', () => {
    const { result } = render({ note: '', defaultNote: '' });
    expect(result.current.intent?.uri).not.toContain('tn=');
  });

  it('flags the soft cap as a warning, never an error (P0.3)', () => {
    const { result } = render({ amount: 200_000, softCapRupees: 100_000 });
    expect(result.current.intent?.exceedsSoftCap).toBe(true);
    expect(result.current.errors).toEqual([]);
    // Still fully payable — we warn, we do not block.
    expect(result.current.qr).not.toBeNull();
  });

  it('regenerates the QR when the amount changes (P0.5)', () => {
    const { result, rerender } = render();
    const first = result.current.qr?.svgDataUrl;
    rerender({ ...BASE, amount: 500 });
    expect(result.current.qr?.svgDataUrl).not.toBe(first);
    expect(result.current.intent?.uri).toContain('am=500.00');
  });

  it('regenerates the QR when the note changes (P0.5)', () => {
    const { result, rerender } = render({ note: 'one' });
    const first = result.current.qr?.svgDataUrl;
    rerender({ ...BASE, note: 'two' });
    expect(result.current.qr?.svgDataUrl).not.toBe(first);
  });

  it('keeps the same QR object across re-renders with identical inputs', () => {
    // Memoisation matters: the QR re-encodes on every keystroke otherwise.
    const { result, rerender } = render();
    const first = result.current.qr;
    rerender({ ...BASE });
    expect(result.current.qr).toBe(first);
  });

  it('encodes the PNG lazily and caches it across calls', () => {
    const { result } = render();
    const qr = result.current.qr;
    if (!qr) throw new Error('expected a QR');
    const png = qr.toPngDataUrl();
    expect(png.startsWith('data:image/png;base64,')).toBe(true);
    // Same object identity proves the second call did not re-encode.
    expect(qr.toPngDataUrl()).toBe(png);
  });

  it('still produces a QR for the largest payload the builder can emit', () => {
    // The hook's "no QR" branch is defensive, and this test is why it stays
    // unreachable: every field is at its cap, filled with 4-byte characters that
    // cost 12 encoded chars each — the worst case `buildUpiUri` can construct.
    // It must stay inside QR version 40's byte capacity at error-correction M.
    // If a future change raises MAX_NOTE_LENGTH or moves to level H (whose
    // capacity is roughly half), this is the test that catches it.
    const { result } = render({
      vpa: `${'a'.repeat(49)}@${'b'.repeat(50)}`,
      name: '🙏'.repeat(50),
      note: '🙏'.repeat(60),
      amount: 10_000_000,
    });
    expect(result.current.errors).toEqual([]);
    expect(result.current.qr).not.toBeNull();
  });
});
