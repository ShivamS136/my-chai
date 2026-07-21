/**
 * Ambient declarations for the build-time seams the app depends on: the analytics
 * flag Vite injects with `define`, and the virtual config module the `chai-config`
 * plugin serves. Neither has a real file to import types from.
 */

/**
 * Whether `chai.config.yaml` declares an `analytics` block (ADR-028).
 *
 * Injected by the `chai-config` plugin's `config()` hook in vite.config.ts. Guarding
 * the dynamic `import('./posthog.ts')` with a literal `false` is what lets Rollup
 * drop the PostHog chunk entirely from a default build.
 */
declare const __CHAI_ANALYTICS__: boolean;

/**
 * Whether this is the canonical public *demo* build (ADR-034): the example config
 * published past the placeholder guard (ADR-013) with `CHAI_ALLOW_PLACEHOLDER=1`.
 *
 * Injected by the `chai-config` plugin's `config()` hook in vite.config.ts. A literal
 * `false` in every real creator build — and in dev, tests and CI — so Rollup drops
 * `DemoBanner` from their bundle, and the "example only" bar shows on the demo alone.
 */
declare const __CHAI_DEMO__: boolean;

/**
 * The validated creator config, served by the `chai-config` plugin as a plain object
 * (ADR-030). This ambient module is the only place `ChaiConfig` reaches the browser:
 * the plugin has already run Zod in Node, so nothing here imports the schema at
 * runtime — the `import type` is erased.
 */
declare module 'virtual:chai-config' {
  import type { ChaiConfig } from './config/schema.ts';

  const config: ChaiConfig;
  export default config;
}
