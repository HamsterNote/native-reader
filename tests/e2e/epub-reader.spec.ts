import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixtures = path.resolve(process.cwd(), 'fixtures/epub');

async function openFixture(page: Page, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('select-epub').click();
  await (await chooser).setFiles(path.join(fixtures, file));
}

test.beforeEach(async ({ page }) => {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  (page as Page & { externalRequests?: string[] }).externalRequests =
    externalRequests;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).hostname === '127.0.0.1')
      pageErrors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) &&
      !['blob:', 'data:'].includes(url.protocol)
    ) {
      externalRequests.push(request.url());
    }
  });
  await page.route(/.*/, async (route) => {
    const url = new URL(route.request().url());
    if (
      ['127.0.0.1', 'localhost'].includes(url.hostname) ||
      ['blob:', 'data:'].includes(url.protocol)
    ) {
      await route.continue();
    } else {
      await route.abort('blockedbyclient');
    }
  });
  const response = await page.goto('/');
  await expect(
    page.getByTestId('select-epub'),
    `Demo failed to boot (${response?.status()}, ${await page.title()}): ${pageErrors.join('; ')}`,
  ).toBeVisible();
  await page.context().setOffline(true);
});

test.afterEach(async ({ page }) => {
  expect(
    (page as Page & { externalRequests?: string[] }).externalRequests,
  ).toEqual([]);
});

test('opens EPUB 3 offline and navigates chapters and TOC', async ({
  page,
}) => {
  await openFixture(page, 'valid-epub3.epub');
  await expect(page.getByText('EPUB 3 Garden Almanac')).toBeVisible();
  const publication = page.frameLocator('iframe');
  await expect(publication.getByText('Morning', { exact: true })).toBeVisible();
  await expect(
    publication.getByAltText('Green hills under a blue sky'),
  ).toBeVisible();

  await page
    .getByLabel('Table of contents')
    .getByRole('button', { name: 'Night', exact: true })
    .click();
  await expect(
    publication.getByText('The final observation was written under the stars.'),
  ).toBeVisible();
});

test('opens EPUB 2 NCX navigation and local media', async ({ page }) => {
  await openFixture(page, 'valid-epub2.epub');
  await expect(page.getByText('EPUB 2 Field Notes')).toBeVisible();
  const publication = page.frameLocator('iframe');
  await expect(
    publication.getByText('Mara arrived at the observatory before sunrise.'),
  ).toBeVisible();
  await page.getByRole('button', { name: /next/i }).click();
  await expect(
    publication.getByText(
      'The map marked a quiet path through Hamster Valley.',
    ),
  ).toBeVisible();
});

test('chapter controls skip every page in a long chapter and honor boundaries', async ({
  page,
}) => {
  await openFixture(page, 'large-representative.epub');
  const publication = page.frameLocator('iframe');
  const previous = page.getByRole('button', { name: 'Previous chapter' });
  const next = page.getByRole('button', { name: 'Next chapter' });

  await expect(previous).toBeDisabled();
  await next.click();
  await expect(
    publication.getByText('Survey 02', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Chapter position')).toHaveText(
    'Chapter 2 of 48',
  );

  await page
    .getByLabel('Table of contents')
    .getByRole('button', { name: 'Survey 48', exact: true })
    .click();
  await expect(
    publication.getByText('Survey 48', { exact: true }),
  ).toBeVisible();
  await expect(next).toBeDisabled();
});

test('opens nested OPF and navigation parent-relative paths', async ({
  page,
}) => {
  await openFixture(page, 'nested-relative-paths.epub');
  await expect(page.getByText('Nested Relative Paths')).toBeVisible();
  const publication = page.frameLocator('iframe');
  await expect(
    publication.getByText('Nested One', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('Table of contents')
      .getByRole('button', { name: 'Nested Two', exact: true }),
  ).toBeVisible();
});

test('navigates the linear package spine without a TOC', async ({ page }) => {
  await openFixture(page, 'no-toc-spine.epub');
  await expect(page.getByText('No TOC Spine')).toBeVisible();
  await expect(page.getByLabel('Table of contents')).toHaveCount(0);
  const publication = page.frameLocator('iframe');
  await expect(
    publication.getByText('First Linear', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: /next/i }).click();
  await expect(
    publication.getByText('Second Linear', { exact: true }),
  ).toBeVisible();
  await expect(
    publication.getByText('Non Linear', { exact: true }),
  ).toHaveCount(0);
});

test('reports malformed EPUB without crashing the host', async ({ page }) => {
  await openFixture(page, 'malformed.epub');
  await expect(page.getByRole('alert')).toContainText(
    /invalid|malformed|could not open/i,
  );
  await expect(page.getByTestId('select-epub')).toBeVisible();
});

test('rejects unsupported fixed-layout EPUB explicitly', async ({ page }) => {
  await openFixture(page, 'fixed-layout.epub');
  await expect(page.getByRole('alert')).toContainText(/UNSUPPORTED_EPUB/);
});

test('does not execute scripts or fetch external EPUB resources', async ({
  page,
}) => {
  await openFixture(page, 'scripted-external.epub');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.frameLocator('iframe').locator('body')).toBeVisible();
  const publication = page.frameLocator('iframe');
  await expect
    .poll(() =>
      publication.locator('body').evaluate(() => ({
        script: Reflect.get(globalThis, '__EPUB_SCRIPT_EXECUTED__'),
        refresh: document.querySelector('meta[http-equiv="refresh" i]'),
        externalHref: document
          .querySelector('#external-link')
          ?.getAttribute('href'),
        encodedHref: document
          .querySelector('#encoded-external-link')
          ?.getAttribute('href'),
        topHref: document.querySelector('#top-link')?.getAttribute('href'),
        popupHandler: document.querySelector('#popup')?.getAttribute('onclick'),
        style: document.querySelector('style')?.textContent,
      })),
    )
    .toEqual({
      script: undefined,
      refresh: null,
      externalHref: null,
      encodedHref: null,
      topHref: null,
      popupHandler: null,
      style: expect.not.stringContaining('example.invalid'),
    });
  await publication.locator('#external-link').click();
  await publication.locator('#encoded-external-link').click();
  await publication.locator('#top-link').click();
  await publication.locator('#popup').click();
  await expect(page).toHaveURL('/');
  expect(page.context().pages()).toHaveLength(1);
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(globalThis, '__EPUB_TOP_NAV_EXECUTED__')),
    )
    .toBeUndefined();
});

test('opens the representative large fixture and records browser timing', async ({
  page,
}, testInfo) => {
  const started = Date.now();
  await openFixture(page, 'large-representative.epub');
  await expect(page.getByText('Large Valley Survey')).toBeVisible();
  await expect(
    page.frameLocator('iframe').getByText('Survey 01', { exact: true }),
  ).toBeVisible();
  const report = {
    fixture: 'large-representative.epub',
    openMilliseconds: Date.now() - started,
  };
  await testInfo.attach('large-epub-web-smoke.json', {
    body: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    contentType: 'application/json',
  });
});
