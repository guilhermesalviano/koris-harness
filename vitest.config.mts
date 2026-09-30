import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./core/tests/setup/vitest.setup.ts'],
    // Keep vendor bundles out, but run the built-in tools tracked in .gitignore.
    exclude: [
      '.stryker-tmp/**',
      '**/node_modules/**',
      'koris-hub/**',
      'artifacts/**',
      'plugins/channels/*/**',
      'plugins/tools/!(delete-beat|list-beats|set-beat|update-beat|send-message)/**',
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
        '**/*.config.{ts,mts}',
        // Hub-owned bundles pulled into plugins/* are gitignored vendor code
        // (see .gitignore) and are already skipped by test.exclude above —
        // keep them out of coverage too, or their bundled size swamps the
        // global thresholds.
        'plugins/channels/*/**',
        'plugins/tools/!(delete-beat|list-beats|set-beat|update-beat|send-message)/**',
      ],
    },
    onConsoleLog(): boolean {
      return false;
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './core/src'),
    },
  },
});
