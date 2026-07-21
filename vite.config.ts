import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig, type Plugin } from 'vitest/config';
import { readChaiConfigRaw, resetChaiConfigCache } from './scripts/read-config.mts';
import {
  ChaiConfigError,
  declaresAnalytics,
  formatIssues,
  parseConfig,
} from './src/config/load.ts';

// `defineConfig` is imported from `vitest/config`, not `vite`: Vite's own
// `UserConfigExport` has no `test` key and rejects the block at typecheck.

// ── shared config plumbing ───────────────────────────────────────────────────
//
// Every plugin below reads `chai.config.yaml` through `readChaiConfigRaw()` — one
// memoised parse per build (ADR-030), not one per plugin. `src/config/load.ts` then
// turns that plain object into a validated `ChaiConfig`; it stays framework-free,
// while the `node:fs`/YAML read lives in `scripts/read-config.mts`.

const VIRTUAL_ID = 'virtual:chai-config';
// The `\0` (NUL) prefix is Rollup's "this is not a real file" marker: it makes Vite's
// fs resolver, node_modules resolution and the public/ copier all skip the id, so
// nothing tries to read a file called "virtual:chai-config" off disk.
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;

const CHAI_YAML_PATH = new URL('./chai.config.yaml', import.meta.url).pathname;

/**
 * The analytics key, read from the environment at build time and injected into the
 * config here rather than written into `chai.config.yaml` by the creator. That is
 * what removes the `import.meta.env?.VITE_POSTHOG_KEY` line — and its `?.` typecheck
 * footgun — from the creator's file (ADR-030). Set once in `config()`, before any
 * `buildStart`/`load` runs, so both can read it.
 */
let injectedApiKey = '';

/** Returns the raw config with the build-time analytics key folded in, if declared. */
const withInjectedKey = (raw: unknown): unknown => {
  if (raw === null || typeof raw !== 'object') return raw;
  const analytics = (raw as { analytics?: unknown }).analytics;
  if (analytics === null || typeof analytics !== 'object') return raw;
  return { ...raw, analytics: { ...(analytics as object), apiKey: injectedApiKey } };
};

/**
 * The `chai-config` plugin: serves the validated config to the browser as a plain
 * object (`virtual:chai-config`) and injects the build-time analytics flag.
 *
 * Serving a pre-validated object is what keeps Zod *and* the YAML parser out of the
 * browser bundle (ADR-030): the browser imports `virtual:chai-config` and receives
 * serialized data, never the schema or the parser.
 *
 * `config()` also injects `__CHAI_ANALYTICS__` (ADR-028) — the build-time gate that
 * lets Rollup drop the PostHog chunk from a disabled build. It reads `declaresAnalytics`
 * off the *raw* YAML (before the key is folded in), so the bytes gate answers "did the
 * creator declare analytics", independent of whether this build's environment holds a
 * key. No `apply` gate: `resolveId`/`load` must run in dev and under Vitest too, or the
 * virtual import would not resolve there.
 */
function chaiConfig(): Plugin {
  return {
    name: 'chai-config',
    config(_userConfig, { mode }) {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      injectedApiKey = env.VITE_POSTHOG_KEY ?? process.env.VITE_POSTHOG_KEY ?? '';
      let declared = false;
      try {
        declared = declaresAnalytics(readChaiConfigRaw());
      } catch {
        // An unparseable config is chai-config-validator's error to report. Failing
        // closed here is the safe default: no flag, no analytics, no bytes.
      }
      // The canonical public demo (ADR-034): CHAI_ALLOW_PLACEHOLDER=1 is the deliberate
      // "publish the example past the placeholder guard" signal (ADR-013), and the one
      // build that should carry the "example only — don't send money" banner. It is set
      // only by the demo repo's own repository variable (never inherited by a fork, never
      // set in dev or CI), so a real creator build is always false and Rollup drops the
      // DemoBanner from their bundle.
      const isDemo = process.env.CHAI_ALLOW_PLACEHOLDER === '1';
      return {
        define: {
          __CHAI_ANALYTICS__: JSON.stringify(declared),
          __CHAI_DEMO__: JSON.stringify(isDemo),
        },
      };
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return undefined;
      // envSubstituted: true — the key was injected above, so `normalizeAnalytics`
      // drops analytics when it is empty. A parse failure throws the formatted
      // ChaiConfigError, which surfaces as Vite's dev overlay and (in build) via the
      // chai-config-validator's prettier report. The serialized object carries no
      // undefined values (JSON.stringify omits them), so `analytics: undefined`
      // simply vanishes — absent means disabled, exactly as intended.
      const { config } = parseConfig(withInjectedKey(readChaiConfigRaw()), {
        envSubstituted: true,
      });
      return `export default ${JSON.stringify(config)};`;
    },
    handleHotUpdate(ctx) {
      if (ctx.file !== CHAI_YAML_PATH) return undefined;
      // The YAML is read through node:fs, so Vite never saw it as a dependency of the
      // virtual module — wire the reload by hand. A full reload (not a partial HMR
      // update) is right because the config also drives transformIndexHtml below
      // (title/theme/VPA), which Vite re-runs on the next request.
      resetChaiConfigCache();
      const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
      if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      ctx.server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

/**
 * Fails the build when chai.config.yaml is invalid (P0.1), with a clean per-field
 * report and any warnings.
 *
 * Kept separate from `chai-config` and `apply: 'build'` on purpose: if validation
 * threw in serve mode, Vitest (which boots a Vite server) would abort the whole test
 * suite and `pnpm dev` would hard-exit instead of rendering Vite's overlay. The dev
 * overlay comes for free from `chai-config`'s `load` throwing when the app imports
 * the virtual module. This plugin is what turns a bad VPA or a zero base price into a
 * failed `vite build` on Vercel and Pages.
 */
function chaiConfigValidator(): Plugin {
  return {
    name: 'chai-config-validator',
    apply: 'build',
    buildStart() {
      try {
        // envSubstituted: true — the key was injected in chai-config's config() hook,
        // so the analytics warnings ("no network calls will be made" vs "cannot see
        // the key") reflect the real build environment rather than a plain-Node guess.
        const { warnings } = parseConfig(withInjectedKey(readChaiConfigRaw()), {
          envSubstituted: true,
        });
        for (const warning of warnings) {
          this.warn(`${warning.path} → ${warning.message}`);
        }
      } catch (error) {
        if (error instanceof ChaiConfigError) {
          // Rollup prefixes plugin errors; the formatted block stays readable.
          this.error(`\n${formatIssues(error.issues, 'error')}`);
        }
        throw error;
      }
    },
  };
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/**
 * Injects the creator's real VPA into the `<noscript>` block (P0.7).
 *
 * The copy-UPI-ID path is the one guaranteed way to pay (ADR-006), and with JS off
 * it is the *only* one — so the served HTML must carry the actual UPI ID, not a
 * generic "copy the ID" sentence. React can't help here: it never mounts without
 * JS, and its output is not in the served document anyway. So the VPA is baked into
 * index.html at build time instead.
 *
 * The noscript copy lives here rather than in `src/strings.ts` for the same reason
 * `meta.title`'s default lives in the schema (ADR-015): it is needed before — or
 * entirely without — a React mount, so it cannot depend on the UI string layer.
 *
 * Any failure leaves the static fallback noscript from index.html untouched.
 */
function chaiNoscript(): Plugin {
  return {
    name: 'chai-noscript',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        try {
          // envSubstituted: false — we read only creator/meta fields, which do not
          // depend on the analytics key.
          const { config } = parseConfig(readChaiConfigRaw(), { envSubstituted: false });
          const vpa = escapeHtml(config.creator.vpa);
          const title = escapeHtml(config.meta.title);

          const block = `<noscript>
      <div style="max-width:480px;margin:40px auto;padding:24px;font-family:system-ui,-apple-system,sans-serif;text-align:center;color:#2b1d14;">
        <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;color:#c4622d;">0% commission &middot; straight to UPI</p>
        <h1 style="margin:8px 0 12px;font-size:22px;">${title}</h1>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#6b5647;">This page builds the UPI QR with JavaScript, which is turned off. You can still pay &mdash; open any UPI app and send to this UPI ID:</p>
        <p style="margin:16px 0;padding:12px 16px;border-radius:12px;background:#fbeadf;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:16px;font-weight:700;word-break:break-all;">${vpa}</p>
        <p style="margin:0;font-size:12px;color:#6b5647;">Payments go directly to the creator's UPI. No middleman, no fees.</p>
      </div>
    </noscript>`;

          return html.replace(/<noscript>[\s\S]*?<\/noscript>/, block);
        } catch {
          // Keep the static fallback in index.html.
          return html;
        }
      },
    },
  };
}

/**
 * Bakes the `meta` config into the served `<head>` (P0.2, ADR-022).
 *
 * OG/Twitter cards and the document title must be in the *served* HTML: social
 * crawlers and search bots do not run the bundle, so setting them from React would
 * be invisible to exactly the consumers that need them. `theme.mode` is stamped as
 * `data-theme` here too, so a forced light/dark page paints correctly before any JS
 * (no flash). The accent stays a runtime concern (main.tsx) — it is purely visual
 * and crawlers do not care.
 *
 * String replacement over the `tags` API because `<title>` and the description must
 * be *replaced*, not appended (a second `<title>` is ignored by browsers). Any
 * failure leaves the static `index.html` head untouched, same contract as
 * chai-noscript.
 */
function chaiHead(): Plugin {
  const base = process.env.BASE_PATH ?? '/';
  const resolveOg = (path: string): string =>
    /^https?:\/\//i.test(path) ? path : `${base}${path.replace(/^\//, '')}`;

  return {
    name: 'chai-head',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        try {
          const { config } = parseConfig(readChaiConfigRaw(), { envSubstituted: false });
          const { creator, meta, theme } = config;

          const title = escapeHtml(meta.title);
          const description = escapeHtml(
            meta.description ??
              creator.tagline ??
              `Support ${creator.name} — payments go straight to their UPI. 0% commission, no middleman.`,
          );
          const lang = escapeHtml(meta.language);
          const themeAttr =
            theme.mode === 'light' || theme.mode === 'dark' ? ` data-theme="${theme.mode}"` : '';
          const ogImage =
            meta.ogImage === undefined ? undefined : escapeHtml(resolveOg(meta.ogImage));
          const twitterCard = ogImage === undefined ? 'summary' : 'summary_large_image';

          const head = [
            `<meta property="og:type" content="website" />`,
            `<meta property="og:title" content="${title}" />`,
            `<meta property="og:description" content="${description}" />`,
            ...(ogImage === undefined ? [] : [`<meta property="og:image" content="${ogImage}" />`]),
            `<meta name="twitter:card" content="${twitterCard}" />`,
            `<meta name="twitter:title" content="${title}" />`,
            `<meta name="twitter:description" content="${description}" />`,
            ...(ogImage === undefined
              ? []
              : [`<meta name="twitter:image" content="${ogImage}" />`]),
            `<meta name="theme-color" content="#faf8f4" media="(prefers-color-scheme: light)" />`,
            `<meta name="theme-color" content="#1a130e" media="(prefers-color-scheme: dark)" />`,
          ]
            .map((tag) => `    ${tag}`)
            .join('\n');

          return html
            .replace(/<html\b[^>]*>/, `<html lang="${lang}"${themeAttr}>`)
            .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
            .replace(
              /<meta\s+name="description"[\s\S]*?\/>/,
              `<meta name="description" content="${description}" />`,
            )
            .replace('</head>', `${head}\n  </head>`);
        } catch {
          // Keep the static head from index.html.
          return html;
        }
      },
    },
  };
}

export default defineConfig({
  // GitHub Pages subpath (hard rule 7). The deploy workflow sets
  // BASE_PATH=/${repo-name}/ so renamed forks work untouched.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    chaiConfig(),
    chaiConfigValidator(),
    chaiNoscript(),
    chaiHead(),
  ],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // This list is load-bearing: it scopes the 100% thresholds below. Widening
      // it starts applying those bars to components and will break CI.
      include: [
        'src/lib/upi.ts',
        'src/lib/qr.ts',
        'src/lib/amount.ts',
        'src/config/schema.ts',
        'src/config/css-color.ts',
      ],
      thresholds: {
        'src/lib/upi.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/lib/qr.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/lib/amount.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/config/schema.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/config/css-color.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
