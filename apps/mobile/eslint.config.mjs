import base from '@opd/config/eslint';

export default [
  ...base,
  {
    // Build-time Node scripts, not app code: CommonJS, running on Node, not Hermes.
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
