/**
 * Validates chai.config.yaml against the Zod schema and exits non-zero on failure.
 *
 * `pnpm build` already fails on an invalid config via the `chai-config-validator`
 * plugin in vite.config.ts (a bundler never executes app code, so an import alone
 * would not do it — see ADR-016). This script exists so CI has a dedicated step
 * whose failure output is *only* the config error, with no bundler stack wrapped
 * around it — which is what a non-expert creator reading their Actions log needs.
 *
 * Run with plain `node scripts/check-config.mts`: Node 24 strips TypeScript types
 * natively, so there is no ts-node/tsx dependency.
 */

import process from 'node:process';
import { ChaiConfigError, formatIssues, parseConfig } from '../src/config/load.ts';
import { readChaiConfigRaw } from './read-config.mts';

// `load.ts` is deliberately side-effect-free, so this try/catch can actually reach
// the error. Importing the app's config singleton instead would throw during import.
try {
  // envSubstituted: false — this validates the YAML's shape, not the analytics wiring;
  // the build-time key injection is the plugin's concern (see vite.config.ts).
  const { warnings } = parseConfig(readChaiConfigRaw(), { envSubstituted: false });
  if (warnings.length > 0) {
    console.error(formatIssues(warnings, 'warning'));
  }
  console.log('✓ chai.config.yaml is valid.');
} catch (error) {
  if (error instanceof ChaiConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
