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
