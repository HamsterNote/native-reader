import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'pdf-reader.spec.ts',
  workers: 1,
  fullyParallel: false,
  outputDir: 'test-results/pdf',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:8182',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'pnpm --filter @hamster-note/native-reader-demo run build:web && python3 -m http.server 8182 --directory apps/demo/dist',
    url: 'http://127.0.0.1:8182',
    timeout: 120000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 850 } },
    },
    {
      name: 'chromium-mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox', viewport: { width: 1280, height: 850 } },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit', viewport: { width: 1280, height: 850 } },
    },
  ],
});
