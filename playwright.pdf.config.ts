import { defineConfig } from '@playwright/test';
const port = Number(process.env.PDF_TEST_PORT ?? 8182);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PDF_TEST_PORT must be an integer from 1 to 65535');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['pdf-reader.spec.ts', 'pdf-lifecycle.spec.ts'],
  workers: 1,
  fullyParallel: false,
  outputDir: 'test-results/pdf',
  timeout: 30000,
  use: {
    baseURL,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm --filter @hamster-note/native-reader-demo run build:web && python3 -m http.server ${port} --directory apps/demo/dist`,
    url: baseURL,
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
