import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

// `defineConfig` is imported from `vitest/config`, not `vite`: Vite's own
// `UserConfigExport` has no `test` key and rejects the block at typecheck.

/**
 * Fails the build when chai.config.ts is invalid (P0.1).
 *
 * This has to be a plugin, not just an import in main.tsx: a bundler only *bundles*
 * modules, it never executes them, so a module-scope `throw` in the app code never
 * fires during `vite build`. Running the parse in `buildStart` is what makes a bad
 * VPA or a zero base price stop the build — on Vercel, on Pages, and locally.
 *
 * The config is imported dynamically so a parse failure surfaces as a Rollup build
 * error with our formatted message rather than a config-loading crash.
 */
function chaiConfigValidator(): Plugin {
  return {
    name: 'chai-config-validator',
    // Build only. Without this guard the plugin also runs in serve mode, which
    // means (a) Vitest — which spins up a Vite server — aborts the entire test
    // suite when the config is invalid, and (b) `pnpm dev` hard-exits instead of
    // rendering Vite's error overlay. Dev-time validation is already covered by
    // src/config/config.ts throwing at module load, which is what the overlay shows.
    apply: 'build',
    async buildStart() {
      const [{ default: raw }, { parseConfig, ChaiConfigError, formatIssues }] = await Promise.all([
        import('./chai.config.ts'),
        import('./src/config/load.ts'),
      ]);
      try {
        // envSubstituted: false — this import goes through plain Node, so
        // `import.meta.env` is undefined here and the analytics key is invisible.
        const { warnings } = parseConfig(raw, { envSubstituted: false });
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

export default defineConfig({
  // GitHub Pages subpath (hard rule 7). The deploy workflow sets
  // BASE_PATH=/${repo-name}/ so renamed forks work untouched.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), chaiConfigValidator()],
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
      include: ['src/lib/upi.ts', 'src/config/schema.ts', 'src/config/css-color.ts'],
      thresholds: {
        'src/lib/upi.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/config/schema.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/config/css-color.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
