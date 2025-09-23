/* ESLint configuration for cf-jacred-fbd */
module.exports = {
  root: true,
  env: {
    es2023: true,
    browser: true,
    worker: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 'latest',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: ['dist/', 'node_modules/', 'public/js/jquery.quicksearch.min.js'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-explicit-any': ['warn', { ignoreRestArgs: true }],
    '@typescript-eslint/consistent-type-imports': 'warn',
  },
};
