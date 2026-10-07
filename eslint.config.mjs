import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      // Deepwork state and isolated verification workspaces are generated outside
      // product source; their own commands validate generated artifacts directly.
      '**/.slim/**',
      '**/node_modules/**',
      '**/lib/**',
      '**/foliate-runtime/**',
      '**/public/reader/**',
      'vendor/foliate-js/**',
      '**/dist/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      // Release staging 与 Gradle 报告均由受控脚本生成；它们会接受独立的
      // 完整性/编译验证，不应按仓库手写 TypeScript/JavaScript 规则 lint。
      '**/secure-webview/**',
      // 覆盖 android-fault-matrix 下 harness 与 pnpm test:package 实际生成的
      // build/reports（Gradle dependency-verification 报告）。
      '**/android-fault-matrix/**/build/**',
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
