/**
 * Reads and parses `chai.config.yaml` — the one place the config file touches disk.
 *
 * Kept in `scripts/`, not `src/config/`, on purpose (ADR-030): the `src/config`
 * core is framework-free and browser-safe (ADR-004), and `node:fs` + a YAML parser
 * are neither. Everything that needs the *values* — the Vite plugins, the CI config
 * check, the deploy placeholder guard — goes through here; the browser never does,
 * because the `chai-config` plugin serves it a pre-validated plain object instead
 * (that is what keeps Zod and the YAML parser out of the bundle).
 *
 * The read is memoised so a single build parses the file once even though four
 * plugins ask for it (ADR-030 "reads the YAML once"). `resetChaiConfigCache` exists
 * for dev HMR: when the file changes, the plugin clears the cache so the next read
 * re-validates from disk.
 *
 * Returns `unknown`: this module only reads YAML into a plain JS value. Turning that
 * into a typed `ChaiConfig` is `parseConfig`'s job (Zod), kept separate so the fs
 * boundary and the validation boundary do not blur.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * Absolute path to the creator's config.
 *
 * Prefer resolving relative to this module (`../chai.config.yaml`), which is correct
 * no matter where the process was started. Under Vitest's jsdom environment, though,
 * `import.meta.url` is an `http:` URL that `fileURLToPath` rejects — so fall back to
 * the working directory, which every caller (Vite, the CI scripts, the test runner)
 * runs from the repo root.
 */
export const CHAI_CONFIG_YAML: string = (() => {
  try {
    return fileURLToPath(new URL('../chai.config.yaml', import.meta.url));
  } catch {
    return resolve(process.cwd(), 'chai.config.yaml');
  }
})();

let cache: unknown;
let cached = false;

/** Parsed YAML, read once per process (per build) and reused. */
export function readChaiConfigRaw(): unknown {
  if (!cached) {
    cache = parseYaml(readFileSync(CHAI_CONFIG_YAML, 'utf8'));
    cached = true;
  }
  return cache;
}

/** Drops the memoised read so the next call re-reads from disk (dev HMR). */
export function resetChaiConfigCache(): void {
  cache = undefined;
  cached = false;
}
