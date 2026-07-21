/**
 * The default adapter: analytics off (P0.11, ADR-007).
 *
 * Zero imports beyond a type, zero state, zero network — hard rule 4 says a build
 * with analytics disabled must make no network calls at all, and the cheapest way
 * to prove that is an adapter with nothing in it to audit.
 *
 * `src/analytics/contract.test.ts` asserts this file stays that way.
 */

import type { AnalyticsAdapter } from './types.ts';

export const noopAnalytics: AnalyticsAdapter = {
  track: (): void => {},
};
