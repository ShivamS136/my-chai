import { describe, expect, it, vi } from 'vitest';
import { readChaiConfigRaw } from '../../scripts/read-config.mts';
import { declaresAnalytics } from '../config/load.ts';
import type { ChaiAnalytics } from '../config/schema.ts';
import { selectAdapter, track } from './index.ts';
import type { EventSink } from './types.ts';

const settings = (overrides: Partial<ChaiAnalytics> = {}): ChaiAnalytics => ({
  provider: 'posthog',
  apiKey: 'phc_test',
  host: 'https://us.i.posthog.com',
  ...overrides,
});

describe('selectAdapter', () => {
  it('returns the noop adapter when the config declares no analytics', () => {
    const load = vi.fn<(apiKey: string, s: ChaiAnalytics) => Promise<EventSink>>();
    const adapter = selectAdapter(undefined, load);

    adapter.track({ name: 'page_view' });

    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('returns the noop adapter when the API key is %s', (_label, apiKey) => {
    const load = vi.fn<(apiKey: string, s: ChaiAnalytics) => Promise<EventSink>>();
    // `exactOptionalPropertyTypes` — an absent key is a different shape to `undefined`.
    const adapter = selectAdapter(
      apiKey === undefined ? settings({ apiKey: undefined }) : settings({ apiKey }),
      load,
    );

    adapter.track({ name: 'page_view' });

    expect(load).not.toHaveBeenCalled();
  });

  it('loads the provider with the trimmed key and reports through it', async () => {
    const sink = vi.fn<EventSink>();
    const load = vi.fn(async () => sink);
    const adapter = selectAdapter(settings({ apiKey: '  phc_real  ' }), load);

    adapter.track({ name: 'pay_clicked', method: 'deeplink', amount: 150 });
    await vi.waitFor(() => expect(sink).toHaveBeenCalled());

    expect(load).toHaveBeenCalledExactlyOnceWith('phc_real', settings({ apiKey: '  phc_real  ' }));
    expect(sink).toHaveBeenCalledExactlyOnceWith({
      name: 'pay_clicked',
      method: 'deeplink',
      amount: 150,
    });
  });
});

describe('track', () => {
  it('never throws — a broken analytics path must not break a payment path', () => {
    expect(() => track({ name: 'page_view' })).not.toThrow();
    expect(() => track({ name: 'amount_selected', amount: 50, preset: true })).not.toThrow();
  });
});

describe('the build-time flag', () => {
  it('is injected as a real boolean', () => {
    // A missing `define` would be a ReferenceError here rather than a silent
    // `undefined`, and would mean the tree-shake gate (ADR-028) is not wired up.
    expect(typeof __CHAI_ANALYTICS__).toBe('boolean');
  });

  /**
   * Asserts the *relationship* the gate promises — the flag tracks whether the config
   * declares an `analytics` block — rather than the example's particular value. That
   * keeps it true in a creator's repo, where enabling PostHog flips both sides
   * together, while still failing if the `define` in vite.config.ts stops matching
   * `declaresAnalytics` (ADR-028). The hardcoded `false` this replaces failed for
   * every creator who turned analytics on, and blocked the update path (ADR-037).
   */
  it('tracks whether the config declares an analytics block', () => {
    expect(__CHAI_ANALYTICS__).toBe(declaresAnalytics(readChaiConfigRaw()));
  });

  // Canonical only (ADR-037): the shipped example must declare no analytics, so a
  // fresh fork ships zero PostHog bytes by default.
  it.skipIf(process.env.CHAI_CANONICAL !== '1')(
    'is false for the shipped example config, which declares no analytics block',
    () => {
      expect(__CHAI_ANALYTICS__).toBe(false);
    },
  );
});
