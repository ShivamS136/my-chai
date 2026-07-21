/**
 * Picks the adapter once, at startup, and exposes the page's only way to record
 * anything (P0.11).
 *
 * Call sites import `track` — a plain function, not the adapter — so no component
 * can reach past the contract, and so a test can replace the whole surface with one
 * `vi.mock`. `track` never throws and never returns anything: a payment path that
 * could be broken by analytics would be a worse trade than having no analytics.
 *
 * ## The two gates
 *
 * `__CHAI_ANALYTICS__` is a build-time boolean injected by the `chai-analytics-flag`
 * plugin (vite.config.ts): true only when `chai.config.ts` declares an `analytics`
 * block. It is a literal by the time Rollup sees it, so on a default config the
 * `import('./posthog.ts')` below sits in an `if (false)` branch and the entire
 * PostHog chunk is tree-shaken out of `dist` (ADR-028).
 *
 * `config.analytics` is the runtime gate. `load.ts` has already dropped the object
 * entirely when `VITE_POSTHOG_KEY` is unset, so a fork that copies a config but not
 * the environment variable lands on the noop adapter rather than a half-initialised
 * SDK. Both gates must pass; neither is redundant — the first controls bytes, the
 * second controls behaviour.
 */

import { config } from '../config/config.ts';
import type { ChaiAnalytics } from '../config/schema.ts';
import { createDeferredAdapter } from './deferred.ts';
import { noopAnalytics } from './noop.ts';
import type { AnalyticsAdapter, ChaiEvent, EventSink } from './types.ts';

/**
 * Pure, and exported for tests: the config arrives as an argument so every branch
 * is reachable without rebuilding the bundle or mutating a singleton.
 */
export function selectAdapter(
  settings: ChaiAnalytics | undefined,
  load: (apiKey: string, settings: ChaiAnalytics) => Promise<EventSink>,
): AnalyticsAdapter {
  if (settings === undefined) return noopAnalytics;

  const apiKey = settings.apiKey?.trim() ?? '';
  if (apiKey.length === 0) return noopAnalytics;

  return createDeferredAdapter(() => load(apiKey, settings));
}

/**
 * The flag has to gate the `import()` *lexically*, not as an argument.
 *
 * An earlier shape passed it into `selectAdapter` alongside a loader closure — which
 * reads better and does not work: the closure is constructed unconditionally, so
 * Rollup cannot prove the import is unreachable and emits the 220 kB PostHog chunk
 * into every build regardless. Keeping `import()` inside a branch that folds to
 * `false` is the whole mechanism. The CI grep on `dist/` exists because this is easy
 * to regress and invisible when you do.
 */
const adapter: AnalyticsAdapter = __CHAI_ANALYTICS__
  ? selectAdapter(config.analytics, async (apiKey, settings) => {
      const { createPostHogSink } = await import('./posthog.ts');
      return createPostHogSink(apiKey, settings);
    })
  : noopAnalytics;

/** Record an event. Fire-and-forget by design — see the module doc. */
export const track = (event: ChaiEvent): void => {
  adapter.track(event);
};
