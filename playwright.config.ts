import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/playwright',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  retries: process.env.CI ? 2 : 0,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: 'http://127.0.0.1:8181',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    ...(process.env.HN_EDGE_EXECUTABLE
      ? [
          {
            name: 'edge',
            use: {
              ...devices['Desktop Edge'],
              browserName: 'chromium' as const,
              launchOptions: { executablePath: process.env.HN_EDGE_EXECUTABLE },
            },
          },
        ]
      : []),
    {
      name: 'chromium',
      // Use the full Chrome for Testing executable, not headless-shell.
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      // Firefox is only a fail-closed browser check. It is not Safari/iOS
      // evidence and it never claims publication rendering support.
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command:
      'pnpm --filter @hamster-note/native-reader-demo run foliate:web-runtime:sync && pnpm --filter @hamster-note/native-reader-demo run foliate:web-runtime:check && pnpm --filter @hamster-note/native-reader-demo run build:web && python3 -m http.server 8181 --directory apps/demo/dist',
    url: 'http://127.0.0.1:8181',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
