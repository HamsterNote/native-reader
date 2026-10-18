const { default: config } = require('/work/playwright.pdf.config.ts');

module.exports = {
  ...config,
  testDir: '/work/tests/e2e',
  outputDir: '/work/test-results/pdf-webkit',
  webServer: {
    ...config.webServer,
    command: 'node /work/scripts/serve-pdf-export.mjs',
    cwd: '/work',
    timeout: 120000,
  },
};
