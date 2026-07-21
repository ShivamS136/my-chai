/**
 * Build-time constants injected by Vite `define`. Ambient because they are
 * replaced with literals before TypeScript's output ever runs — there is no module
 * to import them from.
 */

/**
 * Whether `chai.config.ts` declares an `analytics` block (ADR-028).
 *
 * Injected by the `chai-analytics-flag` plugin in vite.config.ts. Guarding the
 * dynamic `import('./posthog.ts')` with a literal `false` is what lets Rollup drop
 * the PostHog chunk entirely from a default build.
 */
declare const __CHAI_ANALYTICS__: boolean;
