/**
 * Deploy-time guard: refuses to publish a page that still carries the example
 * creator identity (ROADMAP Session 1).
 *
 * Deliberately NOT wired into `pnpm build`. The canonical repo and every
 * contributor fork must be able to build the shipped example green in CI — that is
 * how we know the example is valid. So:
 *
 *   pnpm build         → pure Vite build, example builds fine
 *   pnpm build:deploy  → this guard, then the build (used by the Pages workflow)
 *
 * The canonical repo's own CI asserts this guard *rejects* the shipped example
 * (a negative test), which is what proves the guard is actually wired up.
 *
 * Escape hatch: CHAI_ALLOW_PLACEHOLDER=1 downgrades the failure to a warning, for
 * previewing a deploy before you have a UPI ID to hand.
 */

import process from 'node:process';
import { findPlaceholders } from './placeholder-detect.mjs';
import { readChaiConfigRaw } from './read-config.mts';

const config = readChaiConfigRaw();

const findings = findPlaceholders(config);

if (findings.length === 0) {
  console.log('✓ chai.config.yaml: no placeholder values — safe to deploy.');
  process.exit(0);
}

const allowed = process.env.CHAI_ALLOW_PLACEHOLDER === '1';
const lines = findings.map((f) => `  ${f.path.padEnd(14)} → ${f.message}`).join('\n');

if (allowed) {
  console.warn(
    `⚠ chai.config.yaml still has placeholder values (CHAI_ALLOW_PLACEHOLDER=1):\n${lines}`,
  );
  process.exit(0);
}

console.error(
  `✖ Refusing to deploy: chai.config.yaml still has the example values.\n${lines}\n\n` +
    '  Edit chai.config.yaml, commit, and push again. See docs/SETUP.md step 2.\n' +
    '  To preview a deploy anyway: CHAI_ALLOW_PLACEHOLDER=1 pnpm build:deploy\n',
);
process.exit(1);
