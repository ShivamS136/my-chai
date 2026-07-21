import { describe, expect, it, vi } from 'vitest';
import { createDeferredAdapter, MAX_BUFFERED_EVENTS } from './deferred.ts';
import type { ChaiEvent, EventSink } from './types.ts';

const PAGE_VIEW: ChaiEvent = { name: 'page_view' };
const AMOUNT: ChaiEvent = { name: 'amount_selected', amount: 150, preset: true };
const PAY: ChaiEvent = { name: 'pay_clicked', method: 'copy_vpa', amount: 150 };

/** A sink plus the resolve/reject handles for the load promise it belongs to. */
const deferredSink = () => {
  const sink = vi.fn<EventSink>();
  let resolve!: (value: EventSink) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<EventSink>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    sink,
    promise,
    resolve: () => resolve(sink),
    reject: () => reject(new Error('offline')),
  };
};

describe('createDeferredAdapter', () => {
  it('replays events buffered before the provider loaded, in order', async () => {
    const { sink, promise, resolve } = deferredSink();
    const adapter = createDeferredAdapter(() => promise);

    adapter.track(PAGE_VIEW);
    adapter.track(AMOUNT);
    expect(sink).not.toHaveBeenCalled();

    resolve();
    await promise;

    expect(sink.mock.calls.map(([event]) => event)).toEqual([PAGE_VIEW, AMOUNT]);
  });

  it('passes events straight through once loaded', async () => {
    const { sink, promise, resolve } = deferredSink();
    const adapter = createDeferredAdapter(() => promise);
    resolve();
    await promise;

    adapter.track(PAY);

    expect(sink).toHaveBeenCalledExactlyOnceWith(PAY);
  });

  it('stops buffering at the cap so a dead connection cannot grow memory', async () => {
    const { sink, promise, resolve } = deferredSink();
    const adapter = createDeferredAdapter(() => promise);

    for (let i = 0; i < MAX_BUFFERED_EVENTS + 5; i++) {
      adapter.track({ name: 'amount_selected', amount: i + 1, preset: false });
    }
    resolve();
    await promise;

    expect(sink).toHaveBeenCalledTimes(MAX_BUFFERED_EVENTS);
    // The cap drops the newest, not the oldest: the first events of a session are
    // the ones that carry the funnel.
    expect(sink.mock.calls[0]?.[0]).toEqual({ name: 'amount_selected', amount: 1, preset: false });
  });

  it('drops everything, silently, when the provider fails to load', async () => {
    const { sink, promise, reject } = deferredSink();
    const adapter = createDeferredAdapter(() => promise);

    adapter.track(PAGE_VIEW);
    reject();
    await expect(promise).rejects.toThrow();
    // Let the rejection handler settle before asserting.
    await Promise.resolve();

    adapter.track(PAY);
    expect(sink).not.toHaveBeenCalled();
  });

  it('survives a loader that throws synchronously', () => {
    const adapter = createDeferredAdapter(() => {
      throw new Error('import failed');
    });

    expect(() => adapter.track(PAGE_VIEW)).not.toThrow();
  });

  it('does not re-deliver buffered events to a sink that tracks re-entrantly', async () => {
    const seen: ChaiEvent[] = [];
    let resolve!: (value: EventSink) => void;
    const promise = new Promise<EventSink>((res) => {
      resolve = res;
    });
    const adapter = createDeferredAdapter(() => promise);

    adapter.track(PAGE_VIEW);
    resolve((event) => {
      seen.push(event);
      // A sink that itself tracks — the buffer must already be drained, or this
      // would replay the queue and loop.
      if (event.name === 'page_view') adapter.track(PAY);
    });
    await promise;

    expect(seen).toEqual([PAGE_VIEW, PAY]);
  });
});
