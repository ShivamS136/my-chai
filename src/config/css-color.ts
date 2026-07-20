/**
 * Dependency-free CSS color validation for `theme.accent`.
 *
 * Framework-free by contract (ADR-004): no DOM, no `node:*`, no dependency. It has
 * to run inside a plain Node build check, so `document.createElement('div').style`
 * tricks are unavailable.
 *
 * Two tiers:
 *  - **Tier A** — parsed all the way to RGB (hex, `rgb()`/`rgba()`). These can be
 *    contrast-checked against the surface tokens.
 *  - **Tier B** — syntactically accepted but not parsed (`oklch()`, `lab()`, …).
 *    Tailwind v4 ships oklch natively, so rejecting these would be hostile; the
 *    contrast check is skipped and a warning says so.
 *
 * Named CSS colors and `hsl()` are deliberately NOT parsed in v0 — that needs a
 * 148-entry table and hue conversion, which belongs with the theme work in
 * Session 4. They currently fall into the invalid bucket with a message that says
 * to use a hex value.
 */

export interface Rgb {
  /** 0–255 */
  readonly r: number;
  /** 0–255 */
  readonly g: number;
  /** 0–255 */
  readonly b: number;
  /** 0–1 */
  readonly a: number;
}

export type ParsedColor =
  | { readonly kind: 'rgb'; readonly rgb: Rgb }
  | { readonly kind: 'opaque-syntax'; readonly fn: string }
  | { readonly kind: 'invalid'; readonly reason: string };

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const MODERN_COLOR_FN_RE = /^(oklch|oklab|lab|lch|color|hwb|hsl|hsla)\(\s*[^;{}]*\)$/i;
const KEYWORDS_REJECTED = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'none',
]);

/**
 * Expands #rgb / #rgba shorthand by doubling each digit.
 * Measured on the digits, not the whole string — `#f00f` is 4 digits, not 5 chars.
 */
const expandHex = (hex: string): string => {
  const digits = hex.slice(1);
  return digits.length <= 4
    ? digits
        .split('')
        .map((d) => d + d)
        .join('')
    : digits;
};

const parseHex = (input: string): Rgb => {
  const digits = expandHex(input);
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  const a = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
};

/** Accepts `0-255`, a float, or a `0-100%` string. Returns null when out of range. */
const parseChannel = (raw: string): number | null => {
  const isPercent = raw.endsWith('%');
  const numeric = Number.parseFloat(isPercent ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(numeric)) return null;
  const value = isPercent ? (numeric / 100) * 255 : numeric;
  if (value < 0 || value > 255) return null;
  return value;
};

/** Accepts `0-1` or a `0-100%` string. Returns null when out of range. */
const parseAlpha = (raw: string): number | null => {
  const isPercent = raw.endsWith('%');
  const numeric = Number.parseFloat(isPercent ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(numeric)) return null;
  const value = isPercent ? numeric / 100 : numeric;
  if (value < 0 || value > 1) return null;
  return value;
};

const parseRgbFunction = (input: string): ParsedColor => {
  const open = input.indexOf('(');
  const body = input.slice(open + 1, -1).trim();
  // Legacy `rgb(r, g, b, a)` and modern `rgb(r g b / a)` both reduce to
  // "components, then an optional alpha after a slash".
  const [componentPart = '', alphaPart] = body.split('/');
  const rawComponents = componentPart
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const hasCommaAlpha = alphaPart === undefined && rawComponents.length === 4;
  const componentTokens = hasCommaAlpha ? rawComponents.slice(0, 3) : rawComponents;
  const rawAlpha = alphaPart ?? (hasCommaAlpha ? rawComponents[3] : undefined);

  if (componentTokens.length !== 3) {
    return { kind: 'invalid', reason: 'rgb() needs exactly 3 channels, plus an optional alpha.' };
  }

  const channels = componentTokens.map(parseChannel);
  if (channels.some((c) => c === null)) {
    return { kind: 'invalid', reason: 'rgb() channels are 0–255 or 0–100%.' };
  }

  let alpha = 1;
  if (rawAlpha !== undefined) {
    const parsed = parseAlpha(rawAlpha);
    if (parsed === null) {
      return { kind: 'invalid', reason: 'rgb() alpha must be between 0 and 1 (or 0–100%).' };
    }
    alpha = parsed;
  }

  const [r, g, b] = channels as [number, number, number];
  return { kind: 'rgb', rgb: { r, g, b, a: alpha } };
};

/**
 * Parses a CSS color literal. Never throws.
 *
 * `var()` and `color-mix()` are rejected outright: there is no cascade at build
 * time, so we could never resolve them, and a broken accent means an invisible
 * button on the creator's live page.
 */
export const parseCssColor = (raw: string): ParsedColor => {
  const input = raw.trim();

  if (input.length === 0) {
    return { kind: 'invalid', reason: 'Empty — set a literal color like "#C4622D".' };
  }
  if (/var\(/i.test(input)) {
    return {
      kind: 'invalid',
      reason:
        'Cannot use var(...) — there is no CSS cascade at build time. Use a literal color like "#C4622D".',
    };
  }
  if (/color-mix\(/i.test(input)) {
    return {
      kind: 'invalid',
      reason: 'Cannot use color-mix() — use the resulting literal color instead.',
    };
  }
  if (KEYWORDS_REJECTED.has(input.toLowerCase())) {
    return {
      kind: 'invalid',
      reason: `Cannot be "${input}" — buttons and links would be invisible. Set a literal color like "#C4622D".`,
    };
  }
  if (input.startsWith('#')) {
    return HEX_RE.test(input)
      ? { kind: 'rgb', rgb: parseHex(input) }
      : {
          kind: 'invalid',
          reason: `Not a valid CSS color: "${input}". Hex colors need 3, 4, 6 or 8 hex digits, e.g. "#C4622D".`,
        };
  }
  if (/^rgba?\(/i.test(input) && input.endsWith(')')) {
    return parseRgbFunction(input);
  }
  const modernFn = MODERN_COLOR_FN_RE.exec(input)?.[1];
  if (modernFn !== undefined) {
    return { kind: 'opaque-syntax', fn: modernFn.toLowerCase() };
  }
  // A bare word is very likely a CSS named colour ("teal", "chocolate"). Say so
  // honestly: telling a creator that `teal` "is not a valid CSS color" is false, and
  // sends them hunting for a typo that isn't there.
  if (/^[a-z]+$/i.test(input)) {
    return {
      kind: 'invalid',
      reason: `Named CSS colours like "${input}" aren't supported yet — use a hex value such as "#C4622D", or "rgb(196 98 45)".`,
    };
  }
  return {
    kind: 'invalid',
    reason: `Not a valid CSS color: "${input}". Try a hex value like "#C4622D" or "rgb(196 98 45)".`,
  };
};

/** Composites a translucent color over an opaque backdrop. */
const composite = (fg: Rgb, bg: Rgb): Rgb => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const linearize = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (rgb: Rgb): number =>
  0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);

/**
 * WCAG 2.1 contrast ratio, 1–21. The foreground is composited over the background
 * first when translucent. Rounded down to one decimal by the caller so we never
 * overstate compliance.
 */
export const contrastRatio = (foreground: Rgb, background: Rgb): number => {
  const fg = foreground.a < 1 ? composite(foreground, background) : foreground;
  const a = relativeLuminance(fg);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
};

/** Truncates (never rounds up) to one decimal — 4.49 must not report as 4.5. */
export const floorToOneDecimal = (value: number): number => Math.floor(value * 10) / 10;
