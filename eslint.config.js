// Flat ESLint config (ESLint v9+) for cf-jacred-fbd
// See: https://eslint.org/docs/latest/use/configure/configuration-files-new
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import unicorn from 'eslint-plugin-unicorn';

export default [
  // Base JS recommended ruleset
  js.configs.recommended,

  // Generic JS (apply browser + service worker style globals by default for this project)
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      // Allow empty catch blocks (often used for optional storages / feature detection)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Relax unused vars for legacy JS scripts
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_|^e$|^event$',
          varsIgnorePattern: '^_$',
          caughtErrors: 'none',
        },
      ],
    },
  },

  // Public frontend scripts (jQuery present via <script> tag)
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        $: 'readonly',
        jQuery: 'readonly',
      },
    },
  },

  // Node based build / helper scripts
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // TypeScript overlay (Cloudflare Worker environment behaves like service worker + browser)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: 'module', ecmaVersion: 'latest' },
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        // Cloudflare specific worker additions (ExecutionContext etc.) are provided via types package
        // Provide a loose definition here to silence no-undef (which we disable anyway for TS)
        ExecutionContext: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin, unicorn },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TS already knows undefined identifiers; disable base rule to avoid false positives on global types
      'no-undef': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': ['warn', { ignoreRestArgs: true }],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Treat unused vars as warnings; ignore parameters starting with _ or common event param names
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_|^e$|^event$',
          varsIgnorePattern: '^_$',
          caughtErrors: 'none',
        },
      ],
      // Disabled: incompatible with ESLint 10 flat config (context.getScope removed)
      // 'unicorn/catch-error-name': ['warn', { name: 'err' }],
      // Disallow completely empty catch with no comment marker (we allow empty by config above;
      // this supplemental rule encourages a comment for intentional swallowing)
      '@typescript-eslint/no-empty-function': [
        'warn',
        { allow: ['arrowFunctions', 'functions', 'methods'] },
      ],
    },
  },

  // Prettier – turn off formatting-related rules
  prettier,

  // Ignore patterns
  {
    ignores: ['dist/', 'node_modules/', 'public/js/jquery.quicksearch.min.js'],
  },
];
