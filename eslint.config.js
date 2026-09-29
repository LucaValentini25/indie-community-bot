// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'preview/**', '.wrangler/**', 'worker/.build/**', 'worker/.wrangler/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts', 'worker/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Unused args are common in event signatures; allow the _ convention.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The non-null assertions in this codebase are all guarded by an
      // `inGuild()` check in the interaction router.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['warn', { allow: ['error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },

  {
    // CLI scripts print to stdout by design — that is their output. The Worker
    // logs with console too: stdout is what `wrangler tail` reads.
    files: ['src/scripts/**/*.ts', 'worker/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    // The smoke test drives the Worker with hand-built payloads, where `any`
    // is the honest type for a fake Discord's JSON.
    files: ['worker/tools/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  {
    // Build tooling runs on plain Node without the TS project.
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
);
