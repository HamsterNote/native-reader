import { expect, test, type Frame, type Page } from '@playwright/test';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

async function publicationFrame(page: Page): Promise<Frame> {
  let publication: Frame | undefined;
  await expect
    .poll(() => {
      publication = page
        .frames()
        .find(
          (frame) =>
            frame.url().startsWith('blob:') &&
            frame.parentFrame()?.url().endsWith('/reader/reader.html'),
        );
      return Boolean(publication);
    })
    .toBe(true);
  return publication!;
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 0)),
        ),
      ),
  );
}

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
] as const) {
  test(`strict consumer opens the same source twice: ${name}`, async ({
    browserName,
    browser,
    page,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium',
      'Strict rendering acceptance requires embedded CSP support.',
    );
    const errors: string[] = [],
      failures: string[] = [],
      pageErrors: string[] = [],
      probes: string[] = [],
      sources: string[] = [];
    const styles: unknown[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('requestfailed', (request) =>
      failures.push(`${request.url()}: ${request.failure()?.errorText}`),
    );
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('hnCspProbe=') ||
        url.includes('__hn-csp-probe-') ||
        url.includes('/reader/probes/')
      )
        probes.push(url);
      if (url.startsWith('blob:') && request.frame() === page.mainFrame())
        sources.push(url);
    });
    await page.setViewportSize(viewport);
    await page.goto('/diagnostics-consumer.html');
    const initialDocument = await page.evaluate(() => performance.timeOrigin);
    await page
      .getByLabel('Publication file')
      .setInputFiles(path.resolve('fixtures/epub/inline-styles.epub'));
    for (let open = 1; open <= 2; open++) {
      if (open === 2)
        await page
          .getByRole('button', { name: 'Open same source', exact: true })
          .click();
      await expect(page.getByTestId('consumer-state')).toHaveText('ready', {
        timeout: 20000,
      });
      const frame = await publicationFrame(page);
      await test.step(`open ${open}: author and Foliate computed styles`, async () => {
        await expect
          .soft(frame.locator('#author-attribute'), 'author style attribute')
          .toHaveCSS('color', 'rgb(17, 34, 51)');
        await expect
          .soft(frame.locator('#author-rule'), 'author style element')
          .toHaveCSS('font-style', 'italic');
        await expect(frame.locator('html')).toHaveCSS(
          'overflow-wrap',
          'break-word',
        );
        const paginated = await frame.evaluate(() => {
          const root = document.documentElement,
            computed = getComputedStyle(root);
          return {
            authorColor: getComputedStyle(
              document.getElementById('author-attribute')!,
            ).color,
            authorFontStyle: getComputedStyle(
              document.getElementById('author-rule')!,
            ).fontStyle,
            declaredWrap: root.style.getPropertyValue('overflow-wrap'),
            priority: root.style.getPropertyPriority('overflow-wrap'),
            declaredColumn: root.style.getPropertyValue('column-width'),
            column: computed.columnWidth,
            height: root.getBoundingClientRect().height,
          };
        });
        expect(paginated.declaredWrap).toBe('break-word');
        expect(paginated.priority).toBe('important');
        expect(parseFloat(paginated.column)).toBeGreaterThan(0);
        expect(paginated.column).toBe(paginated.declaredColumn);
        await page
          .getByRole('button', { name: 'Use scrolled flow', exact: true })
          .click();
        await expect(frame.locator('html')).toHaveCSS('column-width', 'auto');
        await expect
          .poll(() =>
            frame.evaluate(
              () => document.documentElement.getBoundingClientRect().height,
            ),
          )
          .not.toBe(paginated.height);
        const scrolled = await frame.evaluate(() => ({
          column: getComputedStyle(document.documentElement).columnWidth,
          height: document.documentElement.getBoundingClientRect().height,
        }));
        styles.push({ open, paginated, scrolled });
      });
      if (open === 1) {
        const screenshot = testInfo.outputPath(`${name}-publication.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`${name}-publication.png`, {
          path: screenshot,
          contentType: 'image/png',
        });
      }
      await page
        .getByRole('button', { name: 'Close publication', exact: true })
        .click();
      await expect(page.locator('iframe')).toHaveCount(0);
      await settle(page);
    }
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      initialDocument,
    );
    expect(sources).toHaveLength(2);
    expect(new Set(sources).size).toBe(1);
    const report = {
      browser: browser.version(),
      errors,
      failures,
      pageErrors,
      probes,
      styles,
      sourceReads: sources.length,
    };
    const reportPath = testInfo.outputPath(
      'strict-diagnostics-and-styles.json',
    );
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach('strict-diagnostics-and-styles.json', {
      path: reportPath,
      contentType: 'application/json',
    });
    console.log(
      JSON.stringify({
        viewport: name,
        consoleError: errors.length,
        requestfailed: failures.length,
        pageerror: pageErrors.length,
        probes: probes.length,
        styles,
      }),
    );
    await test.step('unfiltered diagnostics across startup, both opens and teardown', async () => {
      expect.soft(errors).toEqual([]);
      expect.soft(failures).toEqual([]);
      expect.soft(pageErrors).toEqual([]);
      expect.soft(probes).toEqual([]);
    });
  });
}
