import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./core/tests/setup/vitest.setup.ts'],
    // plugins/tools subdirectories are hub-owned (see .gitignore); only the
    // top-level core-owned tool test files run.
    exclude: [
      '.stryker-tmp/**',
      '**/node_modules/**',
      'koris-hub/**',
      'artifacts/**',
      'plugins/channels/*/**',
      'plugins/tools/*/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.config.ts',
        // Hub-owned bundles pulled into plugins/* are gitignored vendor code
        // (see .gitignore) and are already skipped by test.exclude above —
        // keep them out of coverage too, or their bundled size swamps the
        // global thresholds.
        'plugins/channels/*/**',
        'plugins/tools/*/**',
      ],
    },
    onConsoleLog(log: string, type: 'stdout' | 'stderr'): boolean | void {
      return false;  // NO console.log() statements will be printed!
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './core/src'),
    },
  },
});
