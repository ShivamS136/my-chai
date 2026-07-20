import { describe, expect, it } from 'vitest';
import {
  formatRupees,
  MAX_AMOUNT_INPUT_DIGITS,
  parseRupees,
  presetAmount,
  sanitizeAmountInput,
} from './amount.ts';

describe('sanitizeAmountInput', () => {
  const cases: ReadonlyArray<readonly [label: string, input: string, expected: string]> = [
    ['plain digits', '150', '150'],
    ['empty', '', ''],
    ['strips a pasted rupee sign', '₹150', '150'],
    ['strips Indian digit grouping', '1,00,000', '100000'],
    ['strips western digit grouping', '100,000', '100000'],
    ['truncates decimals rather than rounding', '1.99', '199'],
    ['strips whitespace', ' 1 5 0 ', '150'],
    ['strips letters', '150abc', '150'],
    ['strips a leading minus, so negatives cannot be typed', '-150', '150'],
    ['collapses leading zeros', '007', '7'],
    ['keeps a lone zero as an intermediate typing state', '0', '0'],
    ['keeps a zero that precedes nothing else', '000', '0'],
    ['caps the digit count', '1'.repeat(20), '1'.repeat(MAX_AMOUNT_INPUT_DIGITS)],
  ];

  it.each(cases)('%s', (_label, input, expected) => {
    expect(sanitizeAmountInput(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const [, input] of cases) {
      expect(sanitizeAmountInput(sanitizeAmountInput(input))).toBe(sanitizeAmountInput(input));
    }
  });
});

describe('parseRupees', () => {
  const cases: ReadonlyArray<readonly [label: string, input: string, expected: number | null]> = [
    ['a typical amount', '150', 150],
    ['the minimum', '1', 1],
    ['an empty field is not a mistake, just nothing yet', '', null],
    ['zero is not payable', '0', null],
    ['a sign-only entry', '-', null],
    ['reads the number out of a pasted string', '₹1,500.00', 150000],
  ];

  it.each(cases)('%s', (_label, input, expected) => {
    expect(parseRupees(input)).toBe(expected);
  });

  it('never returns a fractional value, whatever is typed', () => {
    for (const input of ['1.5', '0.99', '10.001']) {
      const parsed = parseRupees(input);
      expect(parsed === null || Number.isInteger(parsed)).toBe(true);
    }
  });
});

describe('presetAmount', () => {
  it.each([
    [1, 50, 50],
    [3, 50, 150],
    [5, 20, 100],
  ])('%i chai at ₹%i is ₹%i', (count, basePrice, expected) => {
    expect(presetAmount(count, basePrice)).toBe(expected);
  });
});

describe('formatRupees', () => {
  it.each([
    [50, '50'],
    [150, '150'],
    [1000, '1,000'],
    // The lakh grouping is the whole reason this is not `toLocaleString()`
    // with a default locale: ₹1,00,000, never ₹100,000.
    [100000, '1,00,000'],
    [10000000, '1,00,00,000'],
  ])('formats %i as ₹%s', (rupees, expected) => {
    expect(formatRupees(rupees)).toBe(expected);
  });
});
