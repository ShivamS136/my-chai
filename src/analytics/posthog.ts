/**
 * The PostHog adapter (P0.11, ADR-007) — the only module in the project that
 * imports `posthog-js`, and the only one that talks to a network.
 *
 * It is reached exclusively through a dynamic `import()` from `./index.ts`, behind
 * the build-time `__CHAI_ANALYTICS__` flag. When a config has no `analytics` block
 * — the default, and what every fresh fork ships — that branch is dead code, so
 * Rollup never emits this chunk and `dist/` contains no PostHog bytes at all
 * (ADR-028). CI greps the build output to keep that true.
 *
 * ## Why so much of the SDK is switched off
 *
 * `posthog-js` is built for product analytics on apps that own their users. This
 * page is a payment surface for *someone else's* donors, and hard rule 5 says we
 * never collect donor data. So every feature that could observe a donor rather
 * than an interaction is disabled explicitly rather than left at its default:
 *
 *  - **autocapture** would send the text of clicked elements — including the
 *    creator's VPA and, from the message field's surroundings, context we have no
 *    business having.
 *  - **session recording** would replay the donor typing their message. This is
 *    the single most important line in the file.
 *  - heatmaps, dead clicks, rageclick, exceptions and web vitals are all extra
 *    events nobody asked for, on a page with a three-event contract.
 *  - surveys, web experiments and feature flags would each add a request, and the
 *    first two can render UI on top of a payment flow.
 *  - **external dependency loading** is off, so the SDK cannot pull further
 *    scripts from PostHog's CDN at runtime. What ships in the bundle is all that
 *    ever runs — which is the only way "audit every line" stays true.
 *
 * `before_send` is the belt to that braces: anything whose name is not one of our
 * three events is dropped at the wire, so an SDK upgrade that adds a new automatic
 * event cannot quietly widen the contract in docs/ANALYTICS.md.
 */

import { type CaptureResult, posthog } from 'posthog-js';
import type { ChaiAnalytics } from '../config/schema.ts';
import { type ChaiEvent, type EventSink, isChaiEventName } from './types.ts';

/**
 * Pins SDK behaviour to a dated defaults bundle so a patch upgrade cannot change
 * what the page does. Every default we actually care about is set explicitly below.
 */
const POSTHOG_DEFAULTS = '2026-06-25';

/**
 * Drops anything the SDK generated on its own. Exported for the contract test:
 * this is the last line of defence for "exactly three events, nothing else".
 */
export const onlyChaiEvents = (result: CaptureResult | null): CaptureResult | null =>
  result !== null && isChaiEventName(result.event) ? result : null;

/**
 * Initialises PostHog and returns the sink the deferred adapter drains into.
 *
 * `apiKey` is passed separately rather than read off `settings` because by the time
 * this runs it is known to be a non-empty string — `load.ts` drops the whole
 * analytics object when the key is missing, so an enabled build always has one.
 */
export function createPostHogSink(apiKey: string, settings: ChaiAnalytics): EventSink {
  posthog.init(apiKey, {
    api_host: settings.host,
    defaults: POSTHOG_DEFAULTS,

    // ── Nothing may observe the donor ──────────────────────────────────────
    autocapture: false,
    disable_session_recording: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,

    // ── Nothing may emit an event we did not declare ───────────────────────
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_performance: false,
    before_send: onlyChaiEvents,

    // ── Nothing may fetch more code, render UI, or add a request ───────────
    disable_external_dependency_loading: true,
    disable_surveys: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,

    // localStorage rather than the SDK's localStorage+cookie default: the anonymous
    // id is what makes "unique visitors" and the intent funnel mean anything, but
    // there is no reason to also attach it to every request as a cookie. See
    // ANALYTICS.md for the cookieless option and why it is not the default.
    persistence: 'localStorage',
  });

  return (event: ChaiEvent): void => {
    const { name, ...properties } = event;
    posthog.capture(name, properties);
  };
}
