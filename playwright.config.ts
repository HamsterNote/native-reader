import { defineConfig, devices } from '@playwright/test';

const serverDirectory =
  process.env.HN_DIAGNOSTICS_WITHOUT_INLINE === '1'
    ? 'apps/demo/dist-without-publication-inline'
    : 'apps/demo/dist';
const port = Number(process.env.READER_E2E_PORT ?? 8181);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid READER_E2E_PORT');

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
    baseURL: `http://127.0.0.1:${port}`,
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
    command: `pnpm --filter @hamster-note/native-reader-demo run foliate:web-runtime:sync && pnpm --filter @hamster-note/native-reader-demo run foliate:web-runtime:check && pnpm --filter @hamster-note/native-reader-demo run build:web && node scripts/stage-diagnostics-consumer.mjs && node scripts/serve-e2e.mjs ${serverDirectory}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
