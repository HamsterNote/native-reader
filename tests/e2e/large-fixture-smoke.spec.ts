import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { resolveBrowserRuntimeEvidence } from './browserRuntimeEvidence';

type Fixture = {
  file: string;
  format: string;
  bytes: number;
  sha256: string;
  expected: { behaviors: string[] };
};

test('large multi-format publications record real open and navigation outcomes', async ({
  browser,
  browserName,
  page,
  launchOptions,
  channel,
  connectOptions,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'Rendering requires the Chromium CSP gate.',
  );
  // A bounded run timeout is operational; elapsed measurements have no pass threshold.
  test.setTimeout(240_000);
  const corpus = path.resolve('fixtures');
  const manifest = JSON.parse(
    readFileSync(path.join(corpus, 'manifest.json'), 'utf8'),
  ) as { fixtures: Fixture[] };
  const fixtures = manifest.fixtures.filter(({ expected }) =>
    expected.behaviors.includes('measured-large-smoke'),
  );
  expect(fixtures.map(({ format }) => format).sort()).toEqual([
    'cbz',
    'epub',
    'fb2',
    'fbz',
    'kf8-azw3',
    'mobi',
  ]);
  const results = [];
  for (const fixture of fixtures) {
    const result = {
      fixture: fixture.file,
      format: fixture.format,
      bytes: fixture.bytes,
      sha256: fixture.sha256,
      openOutcome: 'not-attempted',
      navigationOutcome: 'not-attempted',
      openMilliseconds: null as number | null,
      navigationMilliseconds: null as number | null,
      elapsedMilliseconds: 0,
      positionBefore: null as string | null,
      positionAfter: null as string | null,
      failureStage: null as string | null,
    };
    const started = performance.now();
    let stage = 'integrity';
    let stageStarted = started;
    try {
      const bytes = readFileSync(path.join(corpus, fixture.file));
      expect(bytes.length).toBe(fixture.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        fixture.sha256,
      );
      stage = 'demo-load';
      await page.goto('/');
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('select-epub').click();
      stage = 'open';
      stageStarted = performance.now();
      result.openOutcome = 'failed';
      await (await chooser).setFiles(path.join(corpus, fixture.file));
      await expect(page.getByTestId('reader-status')).toHaveText(
        `Now reading: ${path.basename(fixture.file)}`,
        { timeout: 30_000 },
      );
      result.openMilliseconds = Math.round(performance.now() - stageStarted);
      result.openOutcome = 'ready';
      result.positionBefore = await page
        .getByLabel('Chapter position')
        .textContent();
      const previous = page.getByRole('button', { name: /^Previous/ });
      await expect(previous).toBeDisabled();
      stage = 'navigation';
      stageStarted = performance.now();
      result.navigationOutcome = 'failed';
      const next = page.getByRole('button', {
        name: 'Next chapter',
        exact: true,
      });
      if (await next.isDisabled()) {
        // The generated MOBI6/KF8 samples contain one readable section. The
        // section contract has no next destination, even if it spans pages.
        await expect(page.getByLabel('Chapter position')).toHaveText(
          'Chapter 1 of 1',
        );
        await expect(previous).toBeDisabled();
        result.navigationOutcome = 'single-section-boundary';
      } else {
        await next.click();
        await expect(previous).toBeEnabled({ timeout: 15_000 });
        result.navigationOutcome = 'advanced';
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
      result.navigationMilliseconds = Math.round(
        performance.now() - stageStarted,
      );
      result.positionAfter = await page
        .getByLabel('Chapter position')
        .textContent();
    } catch {
      // Keep one deterministic record per input, including failures. Do not
      // serialize source URLs or hide a failed open behind another success.
      result.failureStage = stage;
      if (stage === 'open')
        result.openMilliseconds = Math.round(performance.now() - stageStarted);
      if (stage === 'navigation')
        result.navigationMilliseconds = Math.round(
          performance.now() - stageStarted,
        );
    } finally {
      result.elapsedMilliseconds = Math.round(performance.now() - started);
      results.push(result);
    }
  }
  const report = {
    schemaVersion: 2,
    evidence: 'exported-demo-browser-rendering',
    browser: resolveBrowserRuntimeEvidence({
      browserName,
      version: browser.version(),
      launchOptions,
      channel,
      hasConnectOptions: connectOptions != null,
      readRegistryExecutablePath: () => browser.browserType().executablePath(),
    }),
    memoryObservation: 'not collected; no portable browser memory metric',
    navigationScope:
      'One readable-linear-section step per fixture, or disabled boundary for a single-section book. No page, device or throughput claim.',
    fixtures: results,
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/large-fixture-smoke.json', body);
  await testInfo.attach('large-fixture-smoke.json', {
    body: Buffer.from(body),
    contentType: 'application/json',
  });
  expect(
    results
      .filter(({ failureStage }) => failureStage !== null)
      .map(({ fixture, failureStage }) => ({ fixture, failureStage })),
  ).toEqual([]);
});
