/**
 * The app's parsed-config singleton.
 *
 * Deliberately a separate module from `load.ts`: this one throws at *import* time
 * on an invalid config, which is right for the app (Vite's dev overlay renders the
 * formatted message) but impossible to catch from a build script. Build-time
 * callers use `parseConfig` / `parseConfigAndReport` from `load.ts` instead.
 *
 * Note this import alone does NOT make `vite build` fail on a bad config — a
 * bundler only bundles, it never executes. Build enforcement is the
 * `chai-config-validator` plugin in vite.config.ts.
 */

import rawConfig from '../../chai.config.ts';
import { parseConfigAndReport } from './load.ts';
import type { ChaiConfig } from './schema.ts';

export const config: ChaiConfig = parseConfigAndReport(rawConfig);
