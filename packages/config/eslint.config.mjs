// Shared flat ESLint config. Apps extend this and add their own framework plugins.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/.expo/**', '**/node_modules/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // docs/Rules.md 7: no silently swallowed errors.
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `const { omitted, ...rest } = obj` is the idiomatic way to drop a key.
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // docs/Rules.md 1.5: no secrets, no stray debugging in committed code.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
