/**
 * The buffer that sits between the page and a lazily-imported provider.
 *
 * The provider arrives over the network (a dynamic `import()`), but `page_view`
 * fires before the first paint and a donor can copy a UPI ID a beat later. Without
 * a buffer the first — and most important — events of every session would be lost.
 *
 * Framework-free and provider-free on purpose: it knows nothing about PostHog, so
 * the tricky part (ordering, failure, back-pressure) is testable without a network
 * or an SDK. Loading the provider is somebody else's job; this only decides what
 * happens to events in the meantime.
 *
 * Failure is silent and terminal. If the chunk fails to load — offline, adblocker,
 * CSP — the buffer is dropped and every later event is discarded. Analytics must
 * never retry-loop or surface an error on a page whose one job is taking a payment.
 */

import type { AnalyticsAdapter, ChaiEvent, EventSink } from './types.ts';

/**
 * How many events survive the load window. A page emits ~3 in that time; the cap
 * exists so a pathological session (a donor scrubbing the amount field for a minute
 * on a dead connection) cannot grow an unbounded array in memory.
 */
export const MAX_BUFFERED_EVENTS = 20;

export function createDeferredAdapter(load: () => Promise<EventSink>): AnalyticsAdapter {
  let sink: EventSink | null = null;
  let abandoned = false;
  let buffered: ChaiEvent[] = [];

  const flush = (loaded: EventSink): void => {
    sink = loaded;
    const pending = buffered;
    // Cleared *before* draining: a sink that tracks re-entrantly must not
    // re-observe events that are already on their way out.
    buffered = [];
    for (const event of pending) loaded(event);
  };

  const abandon = (): void => {
    abandoned = true;
    buffered = [];
  };

  // `load()` may throw synchronously as well as reject.
  try {
    void load().then(flush, abandon);
  } catch {
    abandon();
  }

  return {
    track: (event: ChaiEvent): void => {
      if (abandoned) return;
      if (sink !== null) {
        sink(event);
        return;
      }
      if (buffered.length < MAX_BUFFERED_EVENTS) buffered.push(event);
    },
  };
}
