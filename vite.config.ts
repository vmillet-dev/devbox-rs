/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

const abs = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    angular({
      // Le tsconfig racine est un fichier « solution » (que des `references`) :
      // il ne décrit aucun programme, le compilateur Angular a besoin d'un des
      // deux fichiers feuilles.
      tsconfig: mode === 'test' ? 'tsconfig.spec.json' : 'tsconfig.app.json',
      inlineStylesExtension: 'scss',
    }),
  ],

  // Vite ne lit pas les `paths` du tsconfig.
  resolve: {
    alias: {
      '@core': abs('./src/app/core'),
      '@shared': abs('./src/app/shared'),
      '@features': abs('./src/app/features'),
      '@layout': abs('./src/app/layout'),
      '@testing': abs('./src/testing'),
    },
    // Angular publie ses paquets en ESM sous `module`.
    mainFields: ['module'],
  },

  css: {
    preprocessorOptions: {
      // Ce qui rend `@use 'mixins' as *;` résoluble depuis n'importe quel
      // *.component.scss (ex-`stylePreprocessorOptions.includePaths`).
      scss: { loadPaths: [abs('./src/styles')] },
    },
  },

  // Les deux svg de `src/assets` sont copiés tels quels à la racine de la sortie.
  publicDir: abs('./src/assets'),

  server: {
    // Port figé : `devUrl` dans tauri.conf.json pointe dessus, un repli
    // silencieux sur 1421 laisserait la fenêtre Tauri sur une page blanche.
    port: 1420,
    strictPort: true,
    watch: {
      // Recompiler le front à chaque `cargo` intermédiaire n'a aucun intérêt.
      ignored: ['**/src-tauri/**'],
    },
  },

  // Tauri parle sur stdout ; effacer l'écran masquerait ses messages.
  clearScreen: false,

  build: {
    // Chemin attendu par `frontendDist` (tauri.conf.json) et par la CI.
    outDir: abs('./dist/devbox/browser'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: mode === 'development',
  },

  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        'src/test-setup.ts',
        // Doublures et fixtures : les mesurer ne ferait que gonfler les chiffres.
        'src/testing/**',
        // Amorçage et câblage, exercés en lançant l'app plutôt qu'en unitaire.
        'src/main.ts',
        '**/app.config.ts',
        '**/app.routes.ts',
        // Adaptateurs `invoke()` : rien à asserter sans runtime Tauri.
        '**/*.repository.ts',
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
}));
