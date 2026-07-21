import { describe, expect, it } from 'vitest';
import { contrastRatio, floorToOneDecimal, parseCssColor, type Rgb } from './css-color.ts';

const rgb = (r: number, g: number, b: number, a = 1): Rgb => ({ r, g, b, a });

const expectRgb = (input: string): Rgb => {
  const parsed = parseCssColor(input);
  if (parsed.kind !== 'rgb') throw new Error(`expected rgb, got ${parsed.kind} for "${input}"`);
  return parsed.rgb;
};

describe('parseCssColor — hex', () => {
  const cases: ReadonlyArray<readonly [string, Rgb]> = [
    ['#C4622D', rgb(196, 98, 45)],
    ['#c4622d — case-insensitive', rgb(196, 98, 45)],
    ['#fff', rgb(255, 255, 255)],
    ['#000', rgb(0, 0, 0)],
    ['#f00', rgb(255, 0, 0)],
  ];

  it.each(cases)('parses %s', (input, expected) => {
    expect(expectRgb(input.split(' ')[0] ?? input)).toEqual(expected);
  });

  it('expands 4-digit shorthand including alpha', () => {
    expect(expectRgb('#f00f')).toEqual(rgb(255, 0, 0, 1));
    expect(expectRgb('#f000')).toEqual(rgb(255, 0, 0, 0));
  });

  it('parses 8-digit hex alpha', () => {
    expect(expectRgb('#C4622D80').a).toBeCloseTo(128 / 255, 5);
  });

  const badHex = ['#GG1122', '#12345', '#1', '#1234567', '#'];
  it.each(badHex)('rejects %s', (input) => {
    const parsed = parseCssColor(input);
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind === 'invalid') expect(parsed.reason).toContain('hex digits');
  });
});

describe('parseCssColor — rgb()', () => {
  const cases: ReadonlyArray<readonly [string, Rgb]> = [
    ['rgb(196, 98, 45)', rgb(196, 98, 45)],
    ['rgb(196 98 45)', rgb(196, 98, 45)],
    ['rgba(196, 98, 45, 0.5)', rgb(196, 98, 45, 0.5)],
    ['rgb(196 98 45 / 0.5)', rgb(196, 98, 45, 0.5)],
    ['rgb(196 98 45 / 50%)', rgb(196, 98, 45, 0.5)],
    ['RGB(196,98,45)', rgb(196, 98, 45)],
    ['rgb( 196 , 98 , 45 )', rgb(196, 98, 45)],
  ];

  it.each(cases)('parses %s', (input, expected) => {
    const parsed = expectRgb(input);
    expect(parsed.r).toBeCloseTo(expected.r, 5);
    expect(parsed.g).toBeCloseTo(expected.g, 5);
    expect(parsed.b).toBeCloseTo(expected.b, 5);
    expect(parsed.a).toBeCloseTo(expected.a, 5);
  });

  it('accepts percentage channels', () => {
    const parsed = expectRgb('rgb(100%, 0%, 0%)');
    expect(parsed.r).toBeCloseTo(255, 5);
    expect(parsed.g).toBeCloseTo(0, 5);
  });

  const bad: ReadonlyArray<readonly [string, string]> = [
    ['rgb(300, 0, 0)', 'channels'],
    ['rgb(-1, 0, 0)', 'channels'],
    ['rgb(0, 0)', 'exactly 3'],
    ['rgb(0, 0, 0, 0, 0)', 'exactly 3'],
    ['rgb(a, b, c)', 'channels'],
    ['rgb(0 0 0 / 2)', 'alpha'],
    ['rgb(0 0 0 / -1)', 'alpha'],
    ['rgb(0 0 0 / x)', 'alpha'],
  ];

  it.each(bad)('rejects %s', (input, fragment) => {
    const parsed = parseCssColor(input);
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind === 'invalid') expect(parsed.reason).toContain(fragment);
  });
});

describe('parseCssColor — modern color spaces are accepted but not parsed', () => {
  const cases = [
    'oklch(0.7 0.15 40)',
    'oklab(0.5 0.1 0.1)',
    'lab(50% 40 30)',
    'lch(50% 40 30)',
    'hwb(30 20% 10%)',
    'color(display-p3 1 0 0)',
    'hsl(20 70% 47%)',
    'hsla(20, 70%, 47%, 0.5)',
  ];

  it.each(cases)('accepts %s as opaque syntax', (input) => {
    const parsed = parseCssColor(input);
    expect(parsed.kind).toBe('opaque-syntax');
  });

  it('reports which function it skipped', () => {
    const parsed = parseCssColor('oklch(0.7 0.15 40)');
    if (parsed.kind !== 'opaque-syntax') throw new Error('expected opaque-syntax');
    expect(parsed.fn).toBe('oklch');
  });
});

describe('parseCssColor — rejections', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['var(--accent)', 'cascade'],
    ['color-mix(in srgb, red, blue)', 'color-mix'],
    ['transparent', 'invisible'],
    ['currentColor', 'invisible'],
    ['inherit', 'invisible'],
    ['initial', 'invisible'],
    ['unset', 'invisible'],
    ['none', 'invisible'],
    ['', 'Empty'],
    ['   ', 'Empty'],
    // Named colors are deferred to Session 4 along with the rest of the theme work.
    ['chocolate', 'Named CSS colours'],
    ['not-a-color', 'Not a valid CSS color'], // has a hyphen, so not a bare word
  ];

  it.each(cases)('rejects %s', (input, fragment) => {
    const parsed = parseCssColor(input);
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind === 'invalid') expect(parsed.reason).toContain(fragment);
  });

  it('trims before parsing', () => {
    expect(parseCssColor('  #C4622D  ').kind).toBe('rgb');
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(21, 5);
  });

  it('is 1:1 for a color against itself', () => {
    expect(contrastRatio(rgb(196, 98, 45), rgb(196, 98, 45))).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const a = rgb(196, 98, 45);
    const b = rgb(255, 255, 255);
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('composites a translucent foreground over the backdrop', () => {
    // Fully transparent black over white is just white: ratio 1:1.
    expect(contrastRatio(rgb(0, 0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(1, 5);
  });

  it('scores the shipped default accent against both surfaces', () => {
    const accent = expectRgb('#C4622D');
    // Documented for the theme pass: the default accent does not clear AA against
    // white as body text. warnings.ts surfaces this rather than failing the build.
    expect(contrastRatio(accent, rgb(255, 255, 255))).toBeLessThan(4.5);
    expect(contrastRatio(accent, rgb(0x24, 0x1b, 0x14))).toBeGreaterThan(1);
  });
});

describe('floorToOneDecimal', () => {
  it('never rounds up, so we never overstate compliance', () => {
    expect(floorToOneDecimal(4.49)).toBe(4.4);
    expect(floorToOneDecimal(4.99)).toBe(4.9);
    expect(floorToOneDecimal(21)).toBe(21);
  });
});
