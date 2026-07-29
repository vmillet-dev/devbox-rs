// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  {
    // Sorties de build, rapports générés et dépendances : jamais analysés.
    ignores: [
      'dist/**',
      'out-tsc/**',
      'node_modules/**',
      'src-tauri/target/**',
      'coverage/**',
      // Maquette statique de référence, ni compilée ni importée.
      'docs/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],

      // Le projet est zoneless : un composant sans OnPush est un bug de perf silencieux.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',

      // Les inputs/outputs passent par les fonctions signal, pas par les décorateurs.
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',

      // `_` en préfixe est la convention retenue pour les signaux inscriptibles privés
      // d'un store, exposés en lecture seule (voir notes.store.ts).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      // L'app est intégralement clavier-navigable : ces règles ne doivent pas être des warnings.
      '@angular-eslint/template/click-events-have-key-events': 'error',
      '@angular-eslint/template/interactive-supports-focus': 'error',
      '@angular-eslint/template/label-has-associated-control': 'error',
      '@angular-eslint/template/valid-aria': 'error',
      '@angular-eslint/template/role-has-required-aria': 'error',
    },
  },
  {
    // Les specs ont le droit d'être moins strictes (accès à des internes, doubles partiels).
    files: ['**/*.spec.ts', 'src/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
