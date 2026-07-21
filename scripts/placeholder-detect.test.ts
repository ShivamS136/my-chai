import { describe, expect, it } from 'vitest';
import { findPlaceholders, PLACEHOLDER_NAMES, PLACEHOLDER_VPAS } from './placeholder-detect.mjs';
import { readChaiConfigRaw } from './read-config.mts';

/** The creator's YAML as shipped — the exact object the deploy guard inspects. */
const shippedConfig = readChaiConfigRaw();

describe('findPlaceholders', () => {
  const edited = { creator: { name: 'Shivam Sharma', vpa: 'shivam@okaxis' } };

  it('passes a genuinely edited config', () => {
    expect(findPlaceholders(edited)).toEqual([]);
  });

  it.each(PLACEHOLDER_VPAS)('flags the placeholder VPA %s', (vpa) => {
    const findings = findPlaceholders({ creator: { ...edited.creator, vpa } });
    expect(findings.map((f) => f.path)).toContain('creator.vpa');
  });

  it.each(PLACEHOLDER_NAMES)('flags the placeholder name %s', (name) => {
    const findings = findPlaceholders({ creator: { ...edited.creator, name } });
    expect(findings.map((f) => f.path)).toContain('creator.name');
  });

  it('is case- and whitespace-insensitive', () => {
    // Changing only the capitalisation is not actually setting your UPI ID.
    const findings = findPlaceholders({ creator: { name: 'X', vpa: '  YourName@Bank ' } });
    expect(findings).toHaveLength(1);
  });

  it('reports both fields when both are unedited', () => {
    expect(findPlaceholders({ creator: { name: 'Your Name', vpa: 'yourname@bank' } })).toHaveLength(
      2,
    );
  });

  it('explains what to do about it', () => {
    const [finding] = findPlaceholders({ creator: { name: 'X', vpa: 'yourname@bank' } });
    expect(finding?.message).toContain('UPI ID');
  });

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['an object with no creator', {}],
    ['a null creator', { creator: null }],
    ['a creator with no fields', { creator: {} }],
    ['non-string fields', { creator: { name: 1, vpa: false } }],
  ];

  it.each(malformed)('returns no findings for %s rather than throwing', (_label, input) => {
    expect(() => findPlaceholders(input)).not.toThrow();
    expect(findPlaceholders(input)).toEqual([]);
  });
});

describe('the shipped chai.config.yaml', () => {
  it('IS flagged — this is the guard working as designed', () => {
    // The example must build green in CI (so we know it is valid) but must never
    // deploy. If this assertion ever fails, the guard has stopped protecting forks.
    const findings = findPlaceholders(shippedConfig);
    expect(findings.map((f) => f.path)).toEqual(['creator.vpa', 'creator.name']);
  });
});
