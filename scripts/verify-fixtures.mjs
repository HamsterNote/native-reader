import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildFixtureCorpus, makeManifest } from './generate-fixtures.mjs';
import { crc32 } from './epub-fixture-recipes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = process.env.FIXTURE_ROOT
  ? path.resolve(process.env.FIXTURE_ROOT)
  : path.join(root, 'fixtures');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function inspectStoredZip(bytes) {
  const entries = [];
  let offset = 0;
  while (
    offset + 30 <= bytes.length &&
    bytes.readUInt32LE(offset) === 0x04034b50
  ) {
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const checksum = bytes.readUInt32LE(offset + 14);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const end = start + size;
    if (method !== 0 || end > bytes.length)
      throw new Error('ZIP entry is not a deterministic stored entry');
    const content = bytes.subarray(start, end);
    if (crc32(content) !== checksum) throw new Error('ZIP entry CRC mismatch');
    entries.push({
      encrypted: (flags & 1) !== 0,
      name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString(),
      content,
    });
    offset = end;
  }
  const eocd = bytes.lastIndexOf(Buffer.from('PK\x05\x06'));
  if (!entries.length || eocd < 0 || eocd + 22 > bytes.length)
    throw new Error('Invalid stored ZIP');
  const count = bytes.readUInt16LE(eocd + 10);
  let centralOffset = bytes.readUInt32LE(eocd + 16);
  if (count !== entries.length)
    throw new Error('ZIP central entry count mismatch');
  for (const entry of entries) {
    if (
      centralOffset + 46 > bytes.length ||
      bytes.readUInt32LE(centralOffset) !== 0x02014b50
    )
      throw new Error('ZIP central directory is invalid');
    const flags = bytes.readUInt16LE(centralOffset + 8);
    const nameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const name = bytes
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString();
    if (name !== entry.name || ((flags & 1) !== 0) !== entry.encrypted)
      throw new Error('ZIP local and central encryption flags differ');
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inspectMobi(bytes, fixture) {
  if (bytes.subarray(60, 68).toString() !== 'BOOKMOBI')
    throw new Error(`${fixture.file}: missing PalmDB magic`);
  const recordCount = bytes.readUInt16BE(76);
  const record0 = bytes.readUInt32BE(78);
  if (
    recordCount < 2 ||
    record0 + 56 > bytes.length ||
    bytes.subarray(record0 + 16, record0 + 20).toString() !== 'MOBI'
  )
    throw new Error(`${fixture.file}: invalid MOBI record zero`);
  const foliateVersion = bytes.readUInt32BE(record0 + 36);
  const detectorVersion = bytes.readUInt32BE(record0 + 52);
  const encryption = bytes.readUInt16BE(record0 + 12);
  if (foliateVersion !== detectorVersion)
    throw new Error(`${fixture.file}: MOBI version dual-write mismatch`);
  if (fixture.format === 'mobi' && foliateVersion !== 6)
    throw new Error(`${fixture.file}: expected MOBI6`);
  if (fixture.format === 'kf8-azw3' && foliateVersion < 8)
    throw new Error(`${fixture.file}: expected KF8 version`);
  if (fixture.expected.behaviors.includes('rejects-drm') && encryption === 0)
    throw new Error(`${fixture.file}: expected PalmDOC encryption flag`);
  if (
    fixture.format === 'mobi' &&
    fixture.expected.behaviors.includes('toc-navigation') &&
    !bytes.includes(Buffer.from('<reference type="toc"'))
  )
    throw new Error(`${fixture.file}: missing MOBI guide TOC`);
  if (
    fixture.format === 'mobi' &&
    fixture.expected.behaviors.includes('renders-multiple-chapters') &&
    !bytes.includes(Buffer.from('<mbp:pagebreak'))
  )
    throw new Error(`${fixture.file}: missing MOBI chapter separators`);
}

function inspectFormat(bytes, fixture) {
  if (fixture.expected.behaviors.includes('rejects-with-readable-error'))
    return;
  if (fixture.format === 'epub') {
    const entries = inspectStoredZip(bytes);
    if (
      entries[0]?.name !== 'mimetype' ||
      entries[0].content.toString() !== 'application/epub+zip' ||
      !entries.some(({ name }) => name === 'META-INF/container.xml') ||
      !entries.some(({ name }) => name.endsWith('.opf'))
    )
      throw new Error(`${fixture.file}: invalid EPUB structure`);
  } else if (fixture.format === 'fb2') {
    if (!bytes.toString().includes('<FictionBook'))
      throw new Error(`${fixture.file}: missing FictionBook root`);
  } else if (fixture.format === 'fbz') {
    const entries = inspectStoredZip(bytes);
    if (!entries.some(({ name }) => name.endsWith('.fb2')))
      throw new Error(`${fixture.file}: missing FB2 member`);
  } else if (fixture.format === 'cbz') {
    const entries = inspectStoredZip(bytes);
    const images = entries.filter(({ name }) =>
      /\.(?:avif|bmp|gif|jpe?g|jxl|png|svg|webp)$/i.test(name),
    );
    if (fixture.expected.behaviors.includes('opens') && images.length < 3)
      throw new Error(`${fixture.file}: expected three image pages`);
    if (
      fixture.expected.behaviors.includes('rejects-drm') &&
      !entries.some(({ encrypted }) => encrypted)
    )
      throw new Error(`${fixture.file}: expected ZIP encryption flags`);
  } else if (fixture.format === 'mobi' || fixture.format === 'kf8-azw3') {
    inspectMobi(bytes, fixture);
  } else if (
    fixture.format === 'pdf' &&
    !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
  ) {
    throw new Error(`${fixture.file}: missing PDF rejection signature`);
  }
}

async function actualFixtureFiles(relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(fixtureRoot, relative), {
    withFileTypes: true,
  })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await actualFixtureFiles(child)));
    else if (entry.isFile()) {
      if (
        child !== 'manifest.json' &&
        child !== 'README.md' &&
        !child.endsWith('/README.md')
      )
        files.push(child);
    } else {
      throw new Error(`Unsupported fixture tree entry: ${child}`);
    }
  }
  return files.sort();
}

export async function verifyFixtures() {
  const manifest = JSON.parse(
    await readFile(path.join(fixtureRoot, 'manifest.json'), 'utf8'),
  );
  const expectedManifest = makeManifest(buildFixtureCorpus());
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest))
    throw new Error(
      'Manifest is not deterministically generated from the fixture recipes',
    );
  if (
    manifest.schemaVersion !== 2 ||
    manifest.license?.expression !== 'CC0-1.0'
  )
    throw new Error('Invalid format-neutral manifest schema');
  const declared = new Set();
  for (const fixture of manifest.fixtures) {
    if (
      !fixture.file ||
      declared.has(fixture.file) ||
      fixture.provenance?.kind !== 'generated' ||
      fixture.license?.expression !== 'CC0-1.0' ||
      !Array.isArray(fixture.expected?.behaviors) ||
      !Array.isArray(fixture.limitations)
    )
      throw new Error('Manifest fixture entry is incomplete');
    declared.add(fixture.file);
    const bytes = await readFile(path.join(fixtureRoot, fixture.file));
    if (bytes.length !== fixture.bytes || sha256(bytes) !== fixture.sha256)
      throw new Error(`${fixture.file}: checksum or byte count mismatch`);
    inspectFormat(bytes, fixture);
  }
  const actual = await actualFixtureFiles();
  if (JSON.stringify(actual) !== JSON.stringify([...declared].sort()))
    throw new Error(
      'Fixture directory and manifest do not declare the same file set',
    );
  console.log(
    `Integrity, deterministic recipes, manifests, and structures verified for ${manifest.fixtures.length} fixtures.`,
  );
}

async function validateFoliateMobi() {
  const { chromium } = await import('playwright');
  const server = createServer(async (request, response) => {
    const relative = decodeURIComponent(
      new URL(request.url, 'http://fixture.invalid').pathname,
    ).replace(/^\/+/, '');
    if (!relative) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end('<!doctype html><title>fixture validation</title>');
    }
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`))
      return response.writeHead(403).end();
    const bytes = await readFile(target).catch(() => null);
    if (!bytes) return response.writeHead(404).end();
    response
      .writeHead(200, {
        'Content-Type': target.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : 'application/octet-stream',
      })
      .end(bytes);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const open = async (file) =>
      page.evaluate(async (file) => {
        const { MOBI } = await import('/vendor/foliate-js/mobi.js');
        const bytes = await fetch(`/fixtures/${file}`).then((response) =>
          response.arrayBuffer(),
        );
        const book = new MOBI({
          unzlib: async () => {
            throw new Error('unexpected compression');
          },
        });
        let opened;
        try {
          opened = await book.open(new File([bytes], file));
        } catch (error) {
          throw new Error(
            `${error.message}; headers=${JSON.stringify({
              exthFlag: book.headers?.mobi?.exthFlag,
              hasExth: Boolean(book.headers?.exth),
              mobiLength: book.headers?.mobi?.length,
            })}`,
            { cause: error },
          );
        }
        const firstReadableIndex = opened.sections.findIndex(
          (section) => typeof section?.load === 'function',
        );
        const first =
          await opened.sections[firstReadableIndex].createDocument();
        const loaded = await opened.sections[firstReadableIndex].load();
        const tocTargets = await Promise.all(
          (opened.toc ?? []).map(async (item) => {
            const target = await opened.resolveHref(item.href);
            const document =
              await opened.sections[target.index].createDocument();
            return {
              href: item.href,
              index: target.index,
              anchor: Boolean(target.anchor?.(document)),
            };
          }),
        );
        return {
          sections: opened.sections.length,
          firstReadableIndex,
          loaded: typeof loaded === 'string' && loaded.length > 0,
          toc: opened.toc?.length ?? 0,
          tocTargets,
          landmarks: opened.landmarks ?? [],
          anchors: first.querySelectorAll('a[filepos]').length,
        };
      }, file);
    const result = await open('mobi/valid-mobi6.mobi');
    if (result.sections < 3 || result.toc < 1 || !result.loaded)
      throw new Error(
        `Foliate did not expose MOBI6 sections and TOC: ${JSON.stringify(result)}`,
      );
    assertMobiTocTargets(result.tocTargets);
    console.log(
      `Foliate MOBI6 parser verified ${result.sections} sections and ${result.toc} TOC entries.`,
    );
    const parsedFormats = await page.evaluate(async () => {
      const { makeBook } = await import('/vendor/foliate-js/view.js');
      const open = async (file, type = '') => {
        const bytes = await fetch(`/fixtures/${file}`).then((response) =>
          response.arrayBuffer(),
        );
        const book = await makeBook(new File([bytes], file, { type }));
        return {
          file,
          sections: book.sections.length,
          toc: book.toc?.length ?? 0,
          fixed: book.rendition?.layout === 'pre-paginated',
        };
      };
      return Promise.all([
        open('epub/valid-epub3.epub', 'application/epub+zip'),
        open('fb2/valid-navigation.fb2', 'application/x-fictionbook+xml'),
        open('fbz/valid-navigation.fbz', 'application/x-zip-compressed-fb2'),
        open('cbz/valid-fixed.cbz', 'application/vnd.comicbook+zip'),
      ]);
    });
    for (const result of parsedFormats) {
      if (result.sections < 3 || result.toc < 3)
        throw new Error(`Foliate did not expose navigation for ${result.file}`);
    }
    if (!parsedFormats[3].fixed)
      throw new Error('Foliate did not expose fixed layout for CBZ');
    console.log(
      'Foliate EPUB, FB2, FBZ, and CBZ parsers verified three sections and TOC entries.',
    );
    const fixedLayout = await page.evaluate(async () => {
      const { makeBook } = await import('/vendor/foliate-js/view.js');
      const bytes = await fetch('/fixtures/epub/fixed-layout.epub').then(
        (response) => response.arrayBuffer(),
      );
      const book = await makeBook(
        new File([bytes], 'fixed-layout.epub', {
          type: 'application/epub+zip',
        }),
      );
      const loaded = await book.sections[0]?.load();
      return {
        layout: book.rendition?.layout,
        sections: book.sections.length,
        loaded: typeof loaded === 'string' && loaded.length > 0,
      };
    });
    if (
      fixedLayout.layout !== 'pre-paginated' ||
      fixedLayout.sections < 1 ||
      !fixedLayout.loaded
    )
      throw new Error(
        `Foliate did not open fixed-layout EPUB: ${JSON.stringify(fixedLayout)}`,
      );
    console.log(
      'Foliate fixed-layout EPUB verified pre-paginated layout and section load.',
    );
    const kf8 = await open('kf8/valid-navigation.azw3');
    if (
      kf8.sections < 1 ||
      kf8.firstReadableIndex < 0 ||
      !kf8.loaded ||
      kf8.toc < 1 ||
      !kf8.tocTargets.every(
        ({ index, anchor }) => index === kf8.firstReadableIndex && anchor,
      )
    )
      throw new Error(
        `Foliate KF8 fixture is incomplete: ${JSON.stringify(kf8)}`,
      );
    console.log(
      `Foliate KF8 parser verified one readable section and ${kf8.toc} TOC anchor entry.`,
    );
  } finally {
    await browser.close();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function assertMobiTocTargets(targets) {
  const expected = [0, 1, 2];
  if (
    targets.length !== expected.length ||
    !targets.every(
      ({ index, anchor }, position) => index === expected[position] && anchor,
    )
  )
    throw new Error(
      `Foliate MOBI6 TOC targets are invalid: ${JSON.stringify(targets)}`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await verifyFixtures();
  if (process.argv.includes('--foliate')) await validateFoliateMobi();
}
