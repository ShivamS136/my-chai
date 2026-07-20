import { describe, expect, it } from 'vitest';
import {
  buildUpiUri,
  DEFAULT_SOFT_CAP_RUPEES,
  encodeUpiComponent,
  formatAmount,
  HARD_MAX_AMOUNT_RUPEES,
  resolveNote,
  sanitizeName,
  sanitizeNote,
  UPI_URI_PREFIX,
  type UpiErrorCode,
  type UpiIntent,
  type UpiResult,
  validateVpa,
} from './upi.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VPA = 'shivam@okaxis';
const NAME = 'Shivam Sharma';
const BASE = 'upi://pay?pa=shivam@okaxis&pn=Shivam%20Sharma&am=50.00&cu=INR';
const A60 = 'a'.repeat(60);
const B59 = 'b'.repeat(59);

/** Forbidden per ADR-002 — merchant/reference params break P2P intents. */
const FORBIDDEN_PARAMS = [
  'mc',
  'tr',
  'mode',
  'purpose',
  'orgid',
  'sign',
  'tid',
  'url',
  'mam',
  'minam',
];

const codesOf = (result: UpiResult<unknown>): UpiErrorCode[] =>
  result.ok ? [] : result.errors.map((e) => e.code);

const expectOk = <T>(result: UpiResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got errors: ${codesOf(result).join(', ')}`);
  return result.value;
};

const intent = (input: Partial<Parameters<typeof buildUpiUri>[0]> = {}): UpiResult<UpiIntent> =>
  buildUpiUri({ vpa: VPA, name: NAME, amount: 50, ...input });

// ── validateVpa ──────────────────────────────────────────────────────────────

describe('validateVpa', () => {
  const valid: ReadonlyArray<readonly [string, string]> = [
    ['valid lowercase', 'shivam@okaxis'],
    ['uppercase preserved verbatim', 'SHIVAM@OKAXIS'],
    ['mixed case preserved', 'Shivam@OKAxis'],
    ['dot in handle', 'shivam.sharma@okhdfcbank'],
    ['hyphen in handle', 'shivam-sharma@okaxis'],
    ['underscore in handle', 'shivam_sharma@okaxis'],
    ['all-numeric handle (phone VPA)', '9876543210@paytm'],
    ['digits in bank after first letter', 'shivam@paytm4'],
    ['handle at min length 2', 'ab@okaxis'],
    ['handle at max length 49', `${'x'.repeat(49)}@okaxis`],
    ['bank handle at min length 3', 'ab@oks'],
    ['bank handle at max length 50', `ab@o${'k'.repeat(49)}`],
  ];

  it.each(valid)('accepts %s', (_name, vpa) => {
    const result = validateVpa(vpa);
    // Case is never normalised: the creator's exact string comes back out.
    expect(expectOk(result)).toBe(vpa);
  });

  const invalidFormat: ReadonlyArray<readonly [string, string]> = [
    ['handle 1 char', 'a@okaxis'],
    ['handle 50 chars', `${'x'.repeat(50)}@okaxis`],
    ['bank handle 2 chars', 'ab@ok'],
    ['bank handle 51 chars', `ab@o${'k'.repeat(50)}`],
    ['missing @', 'shivamokaxis'],
    ['double @', 'shivam@@okaxis'],
    ['two @ separated', 'shivam@okaxis@x'],
    ['empty handle', '@okaxis'],
    ['empty bank handle', 'shivam@'],
    ['bank handle starts with a digit', 'shivam@4bank'],
    ['hyphen in bank handle', 'shivam@ok-axis'],
    ['dot in bank handle', 'shivam@ok.axis'],
    ['underscore in bank handle', 'shivam@ok_axis'],
    ['space inside handle', 'shivam sharma@okaxis'],
    ['space inside bank handle', 'shivam@ok axis'],
    ['leading space is NOT trimmed away', ' shivam@okaxis'],
    ['trailing space is NOT trimmed away', 'shivam@okaxis '],
    ['plus sign in handle', 'shivam+1@okaxis'],
    ['unicode handle', 'शिवम@okaxis'],
    ['emoji handle', '☕@okaxis'],
    ['newline injection attempt', 'shivam@okaxis\n&mc=1234'],
    ['ampersand injection attempt', 'shivam@okaxis&mc=1234'],
  ];

  it.each(invalidFormat)('rejects %s', (_name, vpa) => {
    expect(codesOf(validateVpa(vpa))).toEqual(['VPA_INVALID_FORMAT']);
  });

  const required: ReadonlyArray<readonly [string, unknown]> = [
    ['empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['number', 12345],
    ['object', {}],
  ];

  it.each(required)('reports VPA_REQUIRED for %s', (_name, vpa) => {
    expect(codesOf(validateVpa(vpa))).toEqual(['VPA_REQUIRED']);
  });

  it('quotes the offending value and tags the field', () => {
    const result = validateVpa('shivam okaxis');
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0]?.message).toContain('shivam okaxis');
    expect(result.errors[0]?.field).toBe('vpa');
  });
});

// ── formatAmount ─────────────────────────────────────────────────────────────

describe('formatAmount', () => {
  const ok: ReadonlyArray<readonly [string, number, string]> = [
    ['minimum ₹1', 1, '1.00'],
    ['typical ₹50', 50, '50.00'],
    ['3 chai at ₹50', 150, '150.00'],
    ['soft cap exactly is NOT an error', 100_000, '100000.00'],
    ['above the soft cap is NOT an error', 100_001, '100001.00'],
    ['hard max exactly', HARD_MAX_AMOUNT_RUPEES, '10000000.00'],
  ];

  it.each(ok)('accepts %s', (_name, rupees, expected) => {
    expect(expectOk(formatAmount(rupees))).toBe(expected);
  });

  const notInteger: ReadonlyArray<readonly [string, number]> = [
    ['1.5', 1.5],
    ['0.5 — the integer check wins over the minimum check', 0.5],
    ['-1.5 — the integer check wins over the minimum check', -1.5],
    ['floating-point artefact', 0.1 + 0.2],
    ['99.99', 99.99],
  ];

  it.each(notInteger)('rejects fractional rupees: %s', (_name, rupees) => {
    expect(codesOf(formatAmount(rupees))).toEqual(['AMOUNT_NOT_INTEGER']);
  });

  const belowMin: ReadonlyArray<readonly [string, number]> = [
    ['zero', 0],
    ['negative zero', -0],
    ['negative one', -1],
    ['large negative', -100_000],
  ];

  it.each(belowMin)('rejects %s', (_name, rupees) => {
    expect(codesOf(formatAmount(rupees))).toEqual(['AMOUNT_BELOW_MIN']);
  });

  const aboveMax: ReadonlyArray<readonly [string, number]> = [
    ['hard max + 1', HARD_MAX_AMOUNT_RUPEES + 1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['1e21 — would otherwise emit exponential notation', 1e21],
  ];

  it.each(aboveMax)('rejects %s', (_name, rupees) => {
    expect(codesOf(formatAmount(rupees))).toEqual(['AMOUNT_ABOVE_HARD_MAX']);
  });

  const notFinite: ReadonlyArray<readonly [string, number]> = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ];

  it.each(notFinite)('rejects %s', (_name, rupees) => {
    expect(codesOf(formatAmount(rupees))).toEqual(['AMOUNT_NOT_FINITE']);
  });

  it('always emits exactly 2 decimals', () => {
    for (const rupees of [1, 50, 100_000]) {
      expect(expectOk(formatAmount(rupees))).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('never emits exponential or grouped notation', () => {
    const value = expectOk(formatAmount(HARD_MAX_AMOUNT_RUPEES));
    expect(value).toBe('10000000.00');
    expect(value).not.toContain('e');
    expect(value).not.toContain(',');
  });

  it('tags the field', () => {
    const result = formatAmount(0);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0]?.field).toBe('amount');
  });
});

// ── sanitizeNote / sanitizeText ──────────────────────────────────────────────

describe('sanitizeNote', () => {
  const cases: ReadonlyArray<readonly [string, unknown, string]> = [
    ['plain text passes through', 'Thanks for the chai', 'Thanks for the chai'],
    ['empty string', '', ''],
    ['undefined', undefined, ''],
    ['null', null, ''],
    ['number', 42, ''],
    ['object', {}, ''],
    ['surrounding whitespace trimmed', '   hi   ', 'hi'],
    ['whitespace only becomes empty', '   ', ''],
    ['newline becomes a space', 'line1\nline2', 'line1 line2'],
    ['CRLF collapses to one space', 'a\r\nb', 'a b'],
    ['tab becomes a space', 'a\tb', 'a b'],
    ['NUL becomes a space', 'a\u0000b', 'a b'],
    ['DEL becomes a space', 'a\u007fb', 'a b'],
    ['C1 control becomes a space', 'a\u009bb', 'a b'],
    ['control-only becomes empty', '\n\n', ''],
    ['internal whitespace run collapses', 'a     b', 'a b'],
    ['zero-width space stripped', 'a\u200bb', 'ab'],
    ['BOM stripped', '\ufeffhi', 'hi'],
    ['RTL override stripped (bidi spoof)', 'a\u202eb', 'ab'],
    ['left-to-right mark stripped', 'a\u200eb', 'ab'],
    ['ampersand preserved', 'Chai & samosa', 'Chai & samosa'],
    ['hash preserved', '#chai', '#chai'],
    ['equals preserved', 'a=b', 'a=b'],
    ['literal plus preserved', '1+1 chai', '1+1 chai'],
    ['percent preserved', '50% off', '50% off'],
    ['slash and question mark preserved', 'a/b?c', 'a/b?c'],
    ['emoji preserved', 'Thanks ☕', 'Thanks ☕'],
    ['Devanagari preserved', 'चाय के लिए', 'चाय के लिए'],
    ['exactly 60 code points untouched', A60, A60],
    ['59 code points untouched', 'a'.repeat(59), 'a'.repeat(59)],
    ['61 code points truncated to 60', 'a'.repeat(61), A60],
    ['200 code points truncated to 60', 'a'.repeat(200), A60],
    ['lone high surrogate dropped', 'a\uD83Db', 'ab'],
    ['lone low surrogate dropped', 'a\uDC4Db', 'ab'],
    ['private-use char above the surrogate range kept', 'ab', 'ab'],
    ['invisibles do not consume the budget', '\u200b'.repeat(20) + A60, A60],
    ['whitespace collapses before truncation', `a${' '.repeat(30)}b`, 'a b'],
    ['truncation re-trims an exposed trailing space', `${B59}  ccc`, B59],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(sanitizeNote(input)).toBe(expected);
  });

  it('preserves ZWJ so family emoji stay intact', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(sanitizeNote(family)).toBe(family);
    expect(Array.from(sanitizeNote(family))).toHaveLength(5);
  });

  it('preserves ZWNJ so Devanagari conjuncts stay correct', () => {
    const conjunct = 'क्‌ष';
    expect(sanitizeNote(conjunct)).toBe(conjunct);
  });

  it('normalises to NFC', () => {
    expect(sanitizeNote('cafe\u0301')).toBe('café');
    expect(sanitizeNote('cafe\u0301')).toHaveLength(4);
  });

  it('keeps an astral emoji whole when it lands exactly on the limit', () => {
    const input = `${'a'.repeat(59)}👍`;
    expect(sanitizeNote(input)).toBe(input);
    expect(Array.from(sanitizeNote(input))).toHaveLength(60);
  });

  it('drops an astral emoji whole rather than splitting the surrogate pair', () => {
    const output = sanitizeNote(`${'a'.repeat(60)}👍`);
    expect(output).toBe(A60);
    // A split pair would leave a lone surrogate, which crashes encodeURIComponent.
    expect(() => encodeURIComponent(output)).not.toThrow();
  });

  it('is idempotent', () => {
    for (const [, input] of cases) {
      expect(sanitizeNote(sanitizeNote(input))).toBe(sanitizeNote(input));
    }
  });

  it('normalises AFTER stripping invisibles, so the output is NFC and stable', () => {
    // Regression: with NFC first, the ZWSP kept 'e' and the combining acute apart, so
    // normalisation was a no-op; stripping it then left decomposed 'e'+U+0301 in the
    // output. Result: non-NFC output, and a second pass produced a different string.
    for (const separator of ['\u200b', '\ufeff', '\u061c']) {
      const input = `e${separator}\u0301`;
      const output = sanitizeNote(input);
      expect(output).toBe('é');
      expect(output.normalize('NFC')).toBe(output);
      expect(sanitizeNote(output)).toBe(output);
    }
  });

  it('strips the Arabic Letter Mark and other invisible format characters', () => {
    // U+061C is a bidi control in exactly the way U+200E/200F are; omitting it left
    // an invisible character that could reorder the note shown in the payer's app.
    for (const invisible of ['\u061c', '\u00ad', '\u2060', '\u180e']) {
      expect(sanitizeNote(`a${invisible}b`)).toBe('ab');
    }
  });

  it('never returns a control character and never exceeds 60 code points', () => {
    for (const [, input] of cases) {
      const output = sanitizeNote(input);
      expect(/[\u0000-\u001f\u007f-\u009f]/.test(output)).toBe(false);
      expect(Array.from(output).length).toBeLessThanOrEqual(60);
    }
  });
});

describe('sanitizeName', () => {
  const cases: ReadonlyArray<readonly [string, unknown, string]> = [
    ['plain name', 'Shivam Sharma', 'Shivam Sharma'],
    ['padding and double spaces collapse', ' Shivam  Sharma ', 'Shivam Sharma'],
    ['ampersand preserved', 'Shivam & Co', 'Shivam & Co'],
    ['parens and apostrophe preserved', "Ravi O'Brien (dev)", "Ravi O'Brien (dev)"],
    ['Devanagari name', 'शिवम', 'शिवम'],
    ['exactly 50 untouched', 'A'.repeat(50), 'A'.repeat(50)],
    ['51 truncated to 50', 'A'.repeat(51), 'A'.repeat(50)],
    ['empty', '', ''],
    ['whitespace only', '   ', ''],
    ['non-string', undefined, ''],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(sanitizeName(input)).toBe(expected);
  });

  it('uses a 50-char budget, not the note budget of 60', () => {
    expect(sanitizeName('A'.repeat(60))).toHaveLength(50);
  });
});

// ── resolveNote ──────────────────────────────────────────────────────────────

describe('resolveNote', () => {
  const cases: ReadonlyArray<readonly [string, unknown, unknown, string]> = [
    ['donor note wins', 'Great work', 'Thanks ☕', 'Great work'],
    ['empty donor note falls back to the default', '', 'Thanks ☕', 'Thanks ☕'],
    ['undefined donor note falls back', undefined, 'Thanks ☕', 'Thanks ☕'],
    ['whitespace-only donor note falls back', '   ', 'Thanks ☕', 'Thanks ☕'],
    ['control-only donor note falls back', '\n\n', 'Thanks ☕', 'Thanks ☕'],
    ['both empty stays empty', '', '', ''],
    ['both undefined stays empty', undefined, undefined, ''],
    ['the default note is sanitised too', '', ' Thanks\n☕ ', 'Thanks ☕'],
    ['the default note is truncated too', '', 'a'.repeat(61), A60],
    ['a truncated donor note still wins', 'a'.repeat(61), 'Thanks', A60],
  ];

  it.each(cases)('%s', (_name, donor, fallback, expected) => {
    expect(resolveNote(donor, fallback)).toBe(expected);
  });
});

// ── encodeUpiComponent ───────────────────────────────────────────────────────

describe('encodeUpiComponent', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['space becomes %20, never +', 'Thanks for the chai', 'Thanks%20for%20the%20chai'],
    ['ampersand', 'Chai & samosa', 'Chai%20%26%20samosa'],
    ['hash', '#chai', '%23chai'],
    ['equals', 'a=b', 'a%3Db'],
    ['literal plus becomes %2B', '1+1 chai', '1%2B1%20chai'],
    ['percent becomes %25', '50% off', '50%25%20off'],
    ['slash and question mark', 'a/b?c', 'a%2Fb%3Fc'],
    ['apostrophe, parens and bang escaped', "O'Brien (dev)!", 'O%27Brien%20%28dev%29%21'],
    ['asterisk escaped', '*x*', '%2Ax%2A'],
    ['emoji becomes UTF-8 percent triples', 'Thanks ☕', 'Thanks%20%E2%98%95'],
    ['astral emoji', '👍', '%F0%9F%91%8D'],
    ['unreserved characters untouched', 'aZ0-_.~', 'aZ0-_.~'],
    ['empty string', '', ''],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(encodeUpiComponent(input)).toBe(expected);
  });

  it('encodes Devanagari', () => {
    expect(encodeUpiComponent('चाय के लिए')).toBe(
      '%E0%A4%9A%E0%A4%BE%E0%A4%AF%20%E0%A4%95%E0%A5%87%20%E0%A4%B2%E0%A4%BF%E0%A4%8F',
    );
  });

  it('round-trips through decodeURIComponent', () => {
    for (const [, input] of cases) {
      expect(decodeURIComponent(encodeUpiComponent(input))).toBe(input);
    }
  });

  it('never emits a literal +', () => {
    for (const [, input] of cases) {
      expect(encodeUpiComponent(input)).not.toContain('+');
    }
  });

  it('differs from URLSearchParams, which would emit + for a space (ADR-010 lock)', () => {
    expect(encodeUpiComponent('a b')).toBe('a%20b');
    expect(new URLSearchParams({ x: 'a b' }).toString()).toBe('x=a+b');
  });
});

// ── buildUpiUri ──────────────────────────────────────────────────────────────

describe('buildUpiUri', () => {
  it('builds the canonical URI with no note', () => {
    expect(expectOk(intent()).uri).toBe(BASE);
  });

  it('appends tn when a note is present', () => {
    expect(expectOk(intent({ note: 'Thanks for the chai' })).uri).toBe(
      `${BASE}&tn=Thanks%20for%20the%20chai`,
    );
  });

  it('emits params in exactly the order pa, pn, am, cu, tn', () => {
    const uri = expectOk(intent({ note: 'hi' })).uri;
    expect(uri.match(/[?&](\w+)=/g)).toEqual(['?pa=', '&pn=', '&am=', '&cu=', '&tn=']);
  });

  it('always uses the upi://pay? scheme and a literal INR currency', () => {
    const uri = expectOk(intent({ note: 'hi' })).uri;
    expect(uri.startsWith(UPI_URI_PREFIX)).toBe(true);
    expect(uri).toContain('&cu=INR');
  });

  it('emits pa verbatim — the @ is never percent-encoded', () => {
    const uri = expectOk(intent()).uri;
    expect(uri).toContain('pa=shivam@okaxis');
    expect(uri).not.toContain('%40');
  });

  it("preserves the creator's VPA casing in pa", () => {
    expect(expectOk(intent({ vpa: 'Shivam@OKAXIS' })).uri).toContain('pa=Shivam@OKAXIS');
  });

  it('emits am verbatim with an unencoded decimal point', () => {
    const uri = expectOk(intent({ amount: 1 })).uri;
    expect(uri).toContain('&am=1.00&');
    expect(uri).not.toContain('%2E');
  });

  it('omits tn entirely rather than leaving it dangling', () => {
    const value = expectOk(intent({ note: '   ' }));
    expect(value.uri).not.toContain('tn=');
    expect(value.note).toBe('');
    expect(value.uri.split('&')).toHaveLength(4);
  });

  it('emits 5 params when a note is present', () => {
    expect(expectOk(intent({ note: 'hi' })).uri.split('&')).toHaveLength(5);
  });

  it('does not default-fill an empty note — that is resolveNote’s job', () => {
    expect(expectOk(intent({ note: '' })).uri).toBe(BASE);
  });

  describe('never emits a forbidden merchant param (ADR-002)', () => {
    const uris = [
      expectOk(intent()).uri,
      expectOk(intent({ note: 'Thanks ☕' })).uri,
      expectOk(intent({ name: 'X&mc=1234' })).uri,
      expectOk(intent({ note: 'hi&tr=999&mc=1' })).uri,
    ];

    it.each(FORBIDDEN_PARAMS)('%s is absent', (param) => {
      for (const uri of uris) {
        expect(new RegExp(`[?&]${param}=`).test(uri)).toBe(false);
      }
    });
  });

  it('sanitises the name before encoding it', () => {
    const value = expectOk(intent({ name: ' Shivam  Sharma ' }));
    expect(value.name).toBe('Shivam Sharma');
    expect(value.uri).toContain('pn=Shivam%20Sharma');
  });

  it('encodes an ampersand in the name so it cannot inject a param', () => {
    const value = expectOk(intent({ name: 'Shivam & Co' }));
    expect(value.uri).toContain('pn=Shivam%20%26%20Co');
    expect(value.uri.split('&')).toHaveLength(4);
  });

  it('neutralises a param-injection attempt in the name', () => {
    const uri = expectOk(intent({ name: 'X&mc=1234' })).uri;
    expect(uri).toContain('pn=X%26mc%3D1234');
  });

  it('neutralises a param-injection attempt in the note', () => {
    const uri = expectOk(intent({ note: 'hi&tr=999&mc=1' })).uri;
    expect(uri.endsWith('&tn=hi%26tr%3D999%26mc%3D1')).toBe(true);
  });

  const noteCases: ReadonlyArray<readonly [string, string, string]> = [
    ['hash creates no fragment', '#chai', '&tn=%23chai'],
    ['equals is encoded', 'a=b', '&tn=a%3Db'],
    ['emoji is encoded', 'Thanks ☕', '&tn=Thanks%20%E2%98%95'],
    ['newline becomes an encoded space', 'line1\nline2', '&tn=line1%20line2'],
    ['control chars become an encoded space', 'a\u0000b', '&tn=a%20b'],
    ['exactly 60 chars survives', A60, `&tn=${A60}`],
    ['61 chars is truncated to 60', 'a'.repeat(61), `&tn=${A60}`],
  ];

  it.each(noteCases)('note: %s', (_name, note, suffix) => {
    expect(expectOk(intent({ note })).uri.endsWith(suffix)).toBe(true);
  });

  it('never produces a URIError from a truncated astral emoji', () => {
    expect(() => intent({ note: `${'a'.repeat(60)}👍` })).not.toThrow();
    expect(expectOk(intent({ note: `${'a'.repeat(60)}👍` })).uri.endsWith(`&tn=${A60}`)).toBe(true);
  });

  it('never produces a URIError from a lone surrogate', () => {
    expect(() => intent({ note: 'hi\uD83D' })).not.toThrow();
    expect(expectOk(intent({ note: 'hi\uD83D' })).uri.endsWith('&tn=hi')).toBe(true);
  });

  // ── error accumulation ─────────────────────────────────────────────────────

  const errorCases: ReadonlyArray<
    readonly [string, Parameters<typeof buildUpiUri>[0], UpiErrorCode[]]
  > = [
    ['invalid VPA only', { vpa: 'bad', name: NAME, amount: 50 }, ['VPA_INVALID_FORMAT']],
    ['empty name only', { vpa: VPA, name: '   ', amount: 50 }, ['NAME_REQUIRED']],
    ['invalid amount only', { vpa: VPA, name: NAME, amount: 0 }, ['AMOUNT_BELOW_MIN']],
    [
      'VPA and amount both bad, reported in order',
      { vpa: 'bad', name: NAME, amount: 0 },
      ['VPA_INVALID_FORMAT', 'AMOUNT_BELOW_MIN'],
    ],
    [
      'all three bad, reported in order',
      { vpa: '', name: '', amount: Number.NaN },
      ['VPA_REQUIRED', 'NAME_REQUIRED', 'AMOUNT_NOT_FINITE'],
    ],
    [
      'VPA and name bad, amount fine',
      { vpa: 'bad', name: '', amount: 50 },
      ['VPA_INVALID_FORMAT', 'NAME_REQUIRED'],
    ],
    [
      'name and amount bad, VPA fine',
      { vpa: VPA, name: '', amount: 1.5 },
      ['NAME_REQUIRED', 'AMOUNT_NOT_INTEGER'],
    ],
  ];

  it.each(errorCases)('%s', (_name, input, expected) => {
    expect(codesOf(buildUpiUri(input))).toEqual(expected);
  });

  it('returns no value key on failure', () => {
    const result = buildUpiUri({ vpa: 'bad', name: NAME, amount: 50 });
    expect('value' in result).toBe(false);
  });

  // ── soft cap ───────────────────────────────────────────────────────────────

  it('does not flag an amount below the soft cap', () => {
    expect(expectOk(intent({ amount: 99_999 })).exceedsSoftCap).toBe(false);
  });

  it('does not flag an amount exactly at the soft cap', () => {
    const value = expectOk(intent({ amount: DEFAULT_SOFT_CAP_RUPEES }));
    expect(value.exceedsSoftCap).toBe(false);
    expect(value.amount).toBe('100000.00');
  });

  it('flags an amount above the soft cap but still succeeds — we warn, we do not block', () => {
    const value = expectOk(intent({ amount: 100_001 }));
    expect(value.exceedsSoftCap).toBe(true);
    expect(value.amount).toBe('100001.00');
  });

  it('honours a caller-supplied soft cap', () => {
    expect(expectOk(intent({ amount: 600, softCapRupees: 500 })).exceedsSoftCap).toBe(true);
  });

  it('honours a soft cap of 0 rather than coercing it away', () => {
    // Locks `??` instead of `||`, which would fall back to the default on 0.
    expect(expectOk(intent({ amount: 1, softCapRupees: 0 })).exceedsSoftCap).toBe(true);
  });

  // ── value contract & invariants ────────────────────────────────────────────

  it('echoes the normalised parts on the value', () => {
    expect(expectOk(intent({ note: 'Thanks for the chai' }))).toMatchObject({
      vpa: VPA,
      name: 'Shivam Sharma',
      amount: '50.00',
      note: 'Thanks for the chai',
      exceedsSoftCap: false,
    });
  });

  it('is deterministic', () => {
    const uris = new Set(
      Array.from({ length: 100 }, () => expectOk(intent({ note: 'Thanks' })).uri),
    );
    expect(uris.size).toBe(1);
  });

  it('does not mutate a frozen input', () => {
    const input = Object.freeze({ vpa: VPA, name: NAME, amount: 50, note: 'hi' });
    expect(() => buildUpiUri(input)).not.toThrow();
    expect(input.name).toBe(NAME);
  });

  it('round-trips through a manual query parse', () => {
    const uri = expectOk(intent({ note: 'Thanks for the chai' })).uri;
    const parsed = Object.fromEntries(
      uri
        .slice(UPI_URI_PREFIX.length)
        .split('&')
        .map((pair) => {
          const [key = '', value = ''] = pair.split('=');
          return [key, decodeURIComponent(value)];
        }),
    );
    expect(parsed).toEqual({
      pa: VPA,
      pn: 'Shivam Sharma',
      am: '50.00',
      cu: 'INR',
      tn: 'Thanks for the chai',
    });
  });

  it('round-trips a Devanagari note', () => {
    const uri = expectOk(intent({ note: 'चाय के लिए' })).uri;
    const tn = uri.slice(uri.indexOf('&tn=') + 4);
    expect(decodeURIComponent(tn)).toBe('चाय के लिए');
  });

  it('never throws, whatever it is fed', () => {
    const junk: unknown[] = [undefined, null, '', 0, Number.NaN, {}, [], '👍', '\uD83D', -1, 1e21];
    for (const value of junk) {
      for (const field of ['vpa', 'name', 'amount'] as const) {
        const input = { vpa: VPA, name: NAME, amount: 50, [field]: value };
        expect(() => buildUpiUri(input as Parameters<typeof buildUpiUri>[0])).not.toThrow();
      }
    }
  });

  it('satisfies the URI shape invariants on every success', () => {
    const uris = [
      expectOk(intent()).uri,
      expectOk(intent({ note: 'Thanks ☕' })).uri,
      expectOk(intent({ amount: 1, note: 'चाय' })).uri,
    ];
    for (const uri of uris) {
      expect(uri).toMatch(/^upi:\/\/pay\?pa=[^&]+&pn=[^&]*&am=\d+\.\d{2}&cu=INR(&tn=[^&]*)?$/);
      expect(uri).not.toContain('+');
      expect(/\s/.test(uri)).toBe(false);
      expect(/[\u0000-\u001f]/.test(uri)).toBe(false);
      expect(uri.split('?')).toHaveLength(2);
      expect(uri).not.toContain('#');
      expect(new URL(uri).protocol).toBe('upi:');
    }
  });
});
