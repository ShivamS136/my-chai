/**
 * The app's config singleton.
 *
 * A thin re-export of `virtual:chai-config` — the plain, already-validated object the
 * `chai-config` Vite plugin builds from `chai.config.yaml` at build time (ADR-030).
 * Both the Zod validation and the YAML parse happen in the plugin, in Node, so the
 * browser bundle carries neither: it receives serialized data through this module.
 *
 * A separate module (rather than importing the virtual id in every consumer) keeps
 * the rest of the app decoupled from where the config comes from. An invalid config
 * fails earlier — at build in `chai-config-validator`, in dev as Vite's overlay when
 * the plugin's `load` hook throws — so this module no longer parses or throws itself.
 */

import config from 'virtual:chai-config';

export { config };
