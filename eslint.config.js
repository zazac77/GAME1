import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The engine is pure and deterministic: all randomness goes through ctx.rng,
    // no wall clock, no DOM, no UI framework.
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use ctx.rng (seeded) instead.' },
        { object: 'Date', property: 'now', message: 'The engine must not read the clock.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'The engine must not read the clock.' },
        { name: 'window', message: 'No DOM in the engine.' },
        { name: 'document', message: 'No DOM in the engine.' },
        { name: 'localStorage', message: 'No DOM in the engine.' },
        { name: 'performance', message: 'The engine must not read the clock.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: 'No UI code in the engine.' },
            { group: ['node:*', 'fs', 'path', 'crypto'], message: 'The engine is platform-free.' },
            { group: ['@game/web', '@game/web/*'], message: 'The engine never imports the UI.' },
          ],
        },
      ],
    },
  },
  prettier,
);
