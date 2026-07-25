// Learn more about Vitest configuration options at https://vitest.dev/config
//
// Only options the Angular `unit-test` builder does not already set belong here:
// the builder owns the environment (jsdom), the file include pattern and the
// Angular-aware transform pipeline.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // No `include`: the builder instruments the files it bundles, and the
      // paths it reports do not match a source-relative glob. Narrowing is
      // done through `exclude` only.
      exclude: [
        '**/*.spec.ts',
        // Fixtures and doubles: measuring them would only inflate the numbers.
        'src/testing/**',
        // Bootstrap and wiring, exercised by running the app rather than by units.
        'src/main.ts',
        '**/app.config.ts',
        '**/app.routes.ts',
        '**/*.providers.ts',
        // Thin `invoke()` adapters: nothing to assert without a live Tauri runtime.
        '**/tauri-*-repository.ts',
        '**/ipc.service.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
