/**
 * Generates `chai.schema.json` from the Zod schema (ADR-030).
 *
 * Since the config moved to YAML, the creator lost `defineConfig`'s TypeScript
 * autocomplete — so this JSON Schema, referenced by the `# yaml-language-server:`
 * comment at the top of `chai.config.yaml`, is now their only editor help: field
 * names, descriptions, enums, and (via `additionalProperties: false`) typo-catching,
 * in VS Code and in GitHub's web editor alike.
 *
 * The schema is generated from the *input* side of `chaiConfigSchema`, because that
 * is what a creator writes — defaults optional. Fields built on `z.custom` (the
 * rupee validators) are not representable in JSON Schema, so they collapse to "any";
 * their `.describe()` carries the real constraint, and Zod still enforces it at build.
 *
 * Run `node scripts/gen-schema.mts` to (re)write the file, or with `--check` to fail
 * when the committed file is stale — the CI drift guard, so the autocomplete can
 * never quietly lie about a schema that has moved on.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { chaiConfigSchema } from '../src/config/schema.ts';

const SCHEMA_PATH = (() => {
  try {
    return fileURLToPath(new URL('../chai.schema.json', import.meta.url));
  } catch {
    return resolve(process.cwd(), 'chai.schema.json');
  }
})();

const jsonSchema = z.toJSONSchema(chaiConfigSchema, {
  // What the creator writes: defaults optional.
  io: 'input',
  // The rupee fields use `z.custom`, which has no JSON Schema representation; emit
  // `{}` (any) for them rather than throwing. Zod still enforces them at build.
  unrepresentable: 'any',
});

const serialized = `${JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...jsonSchema }, null, 2)}\n`;

const check = process.argv.includes('--check');

if (check) {
  let current = '';
  try {
    current = readFileSync(SCHEMA_PATH, 'utf8');
  } catch {
    // falls through to the mismatch branch
  }
  if (current !== serialized) {
    console.error(
      '✖ chai.schema.json is out of date with src/config/schema.ts.\n' +
        '  Run `pnpm gen:schema` and commit the result.',
    );
    process.exit(1);
  }
  console.log('✓ chai.schema.json is in sync with the Zod schema.');
} else {
  writeFileSync(SCHEMA_PATH, serialized);
  console.log(`✓ wrote ${SCHEMA_PATH}`);
}
