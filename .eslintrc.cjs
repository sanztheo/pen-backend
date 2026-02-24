module.exports = {
  root: true,
  env: { node: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'coverage'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // --- WARNINGS (displayed, not blocking CI) ---
    // TODO: upgrade these to 'error' progressively as code is cleaned up
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],
    '@typescript-eslint/no-require-imports': 'warn',
    '@typescript-eslint/no-var-requires': 'warn',
    '@typescript-eslint/no-namespace': 'warn',
    '@typescript-eslint/ban-types': 'warn',
    'no-case-declarations': 'warn',
    'no-useless-escape': 'warn',
    'no-control-regex': 'warn',
    'no-empty': 'warn',
    'no-inner-declarations': 'warn',
    'no-constant-condition': 'warn',
    'no-var': 'warn',

    // --- OFF ---
    'no-console': 'off',
  },
};
