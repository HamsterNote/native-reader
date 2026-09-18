import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/lib/**',
      '**/dist/**',
      '**/.expo/**',
      '**/coverage/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,jsx,cjs,mjs}'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: globals.node,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ...config.languageOptions,
      globals: { ...globals.browser, ...globals.node, ...globals.jest },
    },
  })),
];
