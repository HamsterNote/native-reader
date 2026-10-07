import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildCorpus as buildEpubCorpus,
  crc32,
} from './epub-fixture-recipes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = process.env.FIXTURE_ROOT
  ? path.resolve(process.env.FIXTURE_ROOT)
  : path.join(root, 'fixtures');
const encoder = new TextEncoder();
const text = (value) => Buffer.from(encoder.encode(value));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** A deterministic, stored-only ZIP writer used by independent EPUB/FBZ/CBZ recipes. */
export function storedZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, bytes: input, encrypted = false } of entries) {
    const nameBytes = text(name);
    const bytes = Buffer.from(input);
    const flags = 0x0800 | (encrypted ? 1 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, bytes);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt32LE(crc32(bytes), 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += local.length + nameBytes.length + bytes.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

const fb2Document = ({
  external = false,
} = {}) => `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description><title-info><book-title>CC0 Valley Notes</book-title><author><first-name>Mara</first-name><last-name>Vale</last-name></author><lang>en</lang></title-info></description>
  <body>
    <section id="chapter-one"><title><p>Arrival</p></title><p>The observatory opened before sunrise.</p></section>
    <section id="chapter-two"><title><p>The Map</p></title><p>The path crossed Hamster Valley.</p>${external ? '<p><a l:href="https://example.invalid/tracker">External canary</a></p><image l:href="https://example.invalid/image.svg"/>' : ''}</section>
    <section id="chapter-three"><title><p>Homeward</p></title><p>The field notes returned at dusk.</p></section>
  </body>
</FictionBook>
`;

const fbzDocument = () => `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>CC0 FBZ Notes</book-title><lang>en</lang></title-info></description><body><section id="fbz-one"><title><p>Arrival</p></title><p>The archive opened before sunrise.</p></section><section id="fbz-two"><title><p>The Map</p></title><p>The archive kept a local route.</p></section><section id="fbz-three"><title><p>Homeward</p></title><p>The archive closed at dusk.</p></section></body></FictionBook>
`;

const mislabelledEpub = () =>
  storedZip([
    { name: 'mimetype', bytes: text('application/epub+zip') },
    {
      name: 'META-INF/container.xml',
      bytes: text(
        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
    },
    {
      name: 'book.opf',
      bytes: text(
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Mislabelled EPUB</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
      ),
    },
    {
      name: 'chapter.xhtml',
      bytes: text('<!doctype html><title>Mislabelled EPUB</title><p>CC0.</p>'),
    },
  ]);

const svgPage = (label, padding = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200"><rect width="800" height="1200" fill="#e8dcc0"/><path d="M0 900L260 490l190 260 170-190 180 340v300H0z" fill="#4f7750"/><text x="72" y="160" font-family="serif" font-size="56" fill="#243223">${label}</text>${padding}</svg>`;

function mobiText() {
  const draft = `<!DOCTYPE html><html><head><title>CC0 Palm Notes</title></head><body><guide><reference type="toc" title="Contents" filepos="000000"></reference></guide><p><a filepos="000000">Arrival</a></p><p><a filepos="000000">The Map</a></p><p><a filepos="000000">Homeward</a></p><h1 data-fixture="arrival">Arrival</h1><p>The observatory opened before sunrise.</p><mbp:pagebreak/><h1 data-fixture="map">The Map</h1><p>The path crossed Hamster Valley.</p><mbp:pagebreak/><h1 data-fixture="homeward">Homeward</h1><p>The field notes returned at dusk.</p></body></html>`;
  const arrival = draft.indexOf('<h1 data-fixture="arrival">');
  const map = draft.indexOf('<h1 data-fixture="map">');
  const homeward = draft.indexOf('<h1 data-fixture="homeward">');
  const positions = [arrival, arrival, map, homeward];
  if (positions.some((position) => position < 0))
    throw new Error('MOBI filepos recipe is incomplete');
  return draft.replaceAll('000000', () =>
    String(positions.shift()).padStart(6, '0'),
  );
}

/** Builds a no-compression PalmDB MOBI fixture understood by Foliate's MOBI parser. */
function mobi({ version, encrypted = false }) {
  const record0 = Buffer.alloc(384, 0);
  record0.writeUInt16BE(1, 0); // PalmDOC: no compression.
  record0.writeUInt16BE(1, 8); // One text record contains three pagebreak-delimited sections.
  record0.writeUInt16BE(4096, 10);
  record0.writeUInt16BE(encrypted ? 1 : 0, 12);
  record0.write('MOBI', 16, 'ascii');
  record0.writeUInt32BE(264, 20);
  record0.writeUInt32BE(2, 24);
  record0.writeUInt32BE(65001, 28);
  record0.writeUInt32BE(0x43433030, 32);
  record0.writeUInt32BE(version, 36); // Foliate MOBI_HEADER.version.
  record0.writeUInt32BE(version, 52); // Detector compatibility: historical detector offset.
  record0.writeUInt32BE(320, 84);
  record0.writeUInt32BE(13, 88);
  record0.writeUInt32BE(2, 108);
  record0.writeUInt32BE(0xffffffff, 244);
  record0.write('CC0 Palm Notes', 320, 'utf8');
  const chapter = text(mobiText());
  const record0Offset = 78 + 16;
  const textOffset = record0Offset + record0.length;
  const pdb = Buffer.alloc(record0Offset, 0);
  pdb.write('CC0 Deterministic Palm Book', 0, 'ascii');
  pdb.write('BOOK', 60, 'ascii');
  pdb.write('MOBI', 64, 'ascii');
  pdb.writeUInt16BE(2, 76);
  pdb.writeUInt32BE(record0Offset, 78);
  pdb.writeUInt32BE(textOffset, 86);
  return Buffer.concat([pdb, record0, chapter]);
}

const kf8VarLen = (value) => {
  if (!Number.isInteger(value) || value < 0 || value >= 0x80)
    throw new Error(
      `KF8 fixture value must fit a single varint byte: ${value}`,
    );
  return Buffer.from([value | 0x80]);
};

const kf8Tags = {
  skel: [
    [1, 1, 0x01, 0],
    [6, 2, 0x02, 0],
  ],
  frag: [
    [2, 1, 0x01, 0],
    [4, 1, 0x02, 0],
    [6, 2, 0x04, 0],
  ],
  ncx: [
    [3, 1, 0x01, 0],
    [4, 1, 0x02, 0],
    [6, 2, 0x04, 0],
  ],
};

function kf8MainIndex(tags, { cncxs = 0 } = {}) {
  const headerLength = 56;
  const tagxLength = 12 + tags.length * 4;
  const record = Buffer.alloc(headerLength + tagxLength, 0);
  record.write('INDX', 0, 'ascii');
  record.writeUInt32BE(headerLength, 4);
  record.writeUInt32BE(1, 24);
  record.writeUInt32BE(65001, 28);
  record.writeUInt32BE(cncxs, 52);
  record.write('TAGX', headerLength, 'ascii');
  record.writeUInt32BE(tagxLength, headerLength + 4);
  record.writeUInt32BE(1, headerLength + 8);
  tags.forEach(([tag, values, mask, end], index) => {
    record.set([tag, values, mask, end], headerLength + 12 + index * 4);
  });
  return record;
}

function kf8EntryIndex(name, control, values) {
  const nameBytes = text(name);
  const data = Buffer.concat([
    Buffer.from([nameBytes.length]),
    nameBytes,
    Buffer.from([control]),
    ...values.map(kf8VarLen),
  ]);
  const headerLength = 56;
  const idxt = headerLength + data.length;
  const record = Buffer.alloc(idxt + 6, 0);
  record.write('INDX', 0, 'ascii');
  record.writeUInt32BE(headerLength, 4);
  record.writeUInt32BE(idxt, 20);
  record.writeUInt32BE(1, 24);
  record.writeUInt32BE(65001, 28);
  data.copy(record, headerLength);
  record.write('IDXT', idxt, 'ascii');
  record.writeUInt16BE(headerLength, idxt + 4);
  return record;
}

function kf8Cncx(value) {
  const bytes = text(value);
  return Buffer.concat([kf8VarLen(bytes.length), bytes]);
}

function palmDatabase(records) {
  const headerLength = 78 + records.length * 8;
  const header = Buffer.alloc(headerLength, 0);
  header.write('CC0 Deterministic KF8 Book', 0, 'ascii');
  header.write('BOOK', 60, 'ascii');
  header.write('MOBI', 64, 'ascii');
  header.writeUInt16BE(records.length, 76);
  let offset = headerLength;
  records.forEach((record, index) => {
    header.writeUInt32BE(offset, 78 + index * 8);
    offset += record.length;
  });
  return Buffer.concat([header, ...records]);
}

/** Builds the minimal SKEL/FRAG/NCX record graph required by Foliate's KF8 parser. */
function kf8Mobi() {
  const fragment = text(
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="kf8">KF8 CC0 chapter.</p></body></html>',
  );
  const record0 = Buffer.alloc(384, 0);
  record0.writeUInt16BE(1, 0);
  record0.writeUInt16BE(1, 8);
  record0.writeUInt16BE(4096, 10);
  record0.write('MOBI', 16, 'ascii');
  record0.writeUInt32BE(264, 20);
  record0.writeUInt32BE(2, 24);
  record0.writeUInt32BE(65001, 28);
  record0.writeUInt32BE(0x43433038, 32);
  record0.writeUInt32BE(8, 36);
  record0.writeUInt32BE(8, 52);
  record0.writeUInt32BE(320, 84);
  record0.writeUInt32BE(14, 88);
  record0.writeUInt32BE(9, 108);
  record0.writeUInt32BE(0x40, 128);
  record0.writeUInt32BE(0xffffffff, 192);
  record0.writeUInt32BE(6, 244);
  record0.writeUInt32BE(4, 248);
  record0.writeUInt32BE(2, 252);
  record0.writeUInt32BE(0xffffffff, 260);
  record0.write('EXTH', 280, 'ascii');
  record0.writeUInt32BE(12, 284);
  record0.writeUInt32BE(0, 288);
  record0.write('CC0 KF8 Notes', 320, 'utf8');
  return palmDatabase([
    record0,
    fragment,
    kf8MainIndex(kf8Tags.skel),
    kf8EntryIndex('0', 0x03, [1, 0, 0]),
    kf8MainIndex(kf8Tags.frag),
    kf8EntryIndex('0', 0x07, [0, 0, 0, fragment.length]),
    kf8MainIndex(kf8Tags.ncx, { cncxs: 1 }),
    kf8EntryIndex('0', 0x07, [0, 0, 0, 0]),
    kf8Cncx('KF8 Chapter'),
  ]);
}

const fixture = ({
  file,
  format,
  recipe,
  behaviors,
  build,
  limitations = [],
}) => ({
  file,
  format,
  recipe,
  behaviors,
  build,
  limitations,
});

const legacyEpubFixtures = buildEpubCorpus().map((entry) =>
  fixture({
    file: `epub/${entry.file}`,
    format: 'epub',
    recipe: entry.description,
    behaviors:
      entry.file === 'fixed-layout.epub'
        ? ['opens', 'fixed-layout', 'no-reflow-flow']
        : entry.behaviors,
    build: entry.build,
    limitations:
      entry.file === 'scripted-external.epub'
        ? [
            'Browser canary and blocked-network evidence belongs to Chromium E2E.',
          ]
        : [],
  }),
);
const formatFixtures = [
  fixture({
    file: 'epub/mislabelled-as-mobi.mobi',
    format: 'epub',
    recipe: 'Valid EPUB 3 bytes intentionally carrying a MOBI filename.',
    behaviors: ['detects-by-content-not-extension', 'opens'],
    build: mislabelledEpub,
  }),
  fixture({
    file: 'fb2/valid-navigation.fb2',
    format: 'fb2',
    recipe:
      'Three-section UTF-8 FictionBook 2 document with local navigation anchors.',
    behaviors: [
      'opens',
      'renders-multiple-chapters',
      'toc-navigation',
      'works-offline',
    ],
    build: () => text(fb2Document()),
  }),
  fixture({
    file: 'fb2/malformed.fb2',
    format: 'fb2',
    recipe: 'Truncated FictionBook XML used for parser rejection.',
    behaviors: ['detects-fb2', 'rejects-with-readable-error'],
    build: () => text('<FictionBook><body><section>'),
  }),
  fixture({
    file: 'fb2/mislabelled-as-cbz.cbz',
    format: 'fb2',
    recipe: 'Valid FictionBook bytes intentionally carrying a CBZ filename.',
    behaviors: ['detects-by-content-not-extension', 'opens'],
    build: () => text(fb2Document()),
  }),
  fixture({
    file: 'fb2/scripted-external.fb2',
    format: 'fb2',
    recipe:
      'FictionBook link and image references to example.invalid security canaries.',
    behaviors: ['detects-fb2', 'blocks-external-network', 'works-offline'],
    build: () => text(fb2Document({ external: true })),
    limitations: [
      'Browser canary and blocked-network evidence belongs to Chromium E2E.',
    ],
  }),
  fixture({
    file: 'fbz/valid-navigation.fbz',
    format: 'fbz',
    recipe:
      'Stored ZIP containing the same three-section CC0 FictionBook document.',
    behaviors: [
      'opens',
      'renders-multiple-chapters',
      'toc-navigation',
      'works-offline',
    ],
    build: () => storedZip([{ name: 'book.fb2', bytes: text(fbzDocument()) }]),
  }),
  fixture({
    file: 'fbz/malformed.fbz',
    format: 'fbz',
    recipe: 'Stored ZIP with a deliberately truncated FictionBook payload.',
    behaviors: ['detects-fbz', 'rejects-with-readable-error'],
    build: () =>
      storedZip([{ name: 'broken.fb2', bytes: text('<FictionBook>') }]),
  }),
  fixture({
    file: 'fbz/mislabelled-as-epub.epub',
    format: 'fbz',
    recipe: 'Valid FBZ bytes intentionally carrying an EPUB filename.',
    behaviors: ['detects-by-content-not-extension', 'opens'],
    build: () => storedZip([{ name: 'book.fb2', bytes: text(fbzDocument()) }]),
  }),
  fixture({
    file: 'cbz/valid-fixed.cbz',
    format: 'cbz',
    recipe: 'Stored ZIP with three CC0 SVG image pages in reading order.',
    behaviors: [
      'opens',
      'fixed-layout',
      'renders-multiple-chapters',
      'toc-navigation',
      'works-offline',
    ],
    build: () =>
      storedZip(
        ['01-arrival', '02-map', '03-homeward'].map((label) => ({
          name: `${label}.svg`,
          bytes: text(svgPage(label)),
        })),
      ),
  }),
  fixture({
    file: 'cbz/malformed.cbz',
    format: 'cbz',
    recipe: 'Stored ZIP without image entries for parser rejection.',
    behaviors: ['rejects-with-readable-error', 'does-not-crash'],
    build: () => storedZip([{ name: 'notes.txt', bytes: text('not a comic') }]),
  }),
  fixture({
    file: 'cbz/encrypted-flag.cbz',
    format: 'cbz',
    recipe: 'Stored CC0 SVG archive with synthetic ZIP encryption flags only.',
    behaviors: ['rejects-drm', 'does-not-attempt-drm-bypass'],
    build: () =>
      storedZip([
        { name: '01.svg', bytes: text(svgPage('locked')), encrypted: true },
      ]),
    limitations: [
      'Synthetic ZIP encryption flag only; no encrypted payload or DRM bypass is supplied.',
    ],
  }),
  fixture({
    file: 'cbz/mislabelled-as-epub.epub',
    format: 'cbz',
    recipe:
      'Valid fixed-layout CC0 CBZ bytes intentionally carrying an EPUB filename.',
    behaviors: ['detects-by-content-not-extension', 'fixed-layout'],
    build: () =>
      storedZip([{ name: '01.svg', bytes: text(svgPage('mislabelled')) }]),
  }),
  fixture({
    file: 'cbz/large-fixed.cbz',
    format: 'cbz',
    recipe:
      'Representative stored fixed-layout CBZ with three large CC0 SVG pages.',
    behaviors: [
      'opens',
      'fixed-layout',
      'measured-large-smoke',
      'works-offline',
    ],
    build: () =>
      storedZip(
        ['01', '02', '03'].map((index) => ({
          name: `${index}.svg`,
          bytes: text(
            svgPage(`large ${index}`, `<!--${'cc0 '.repeat(90_000)}-->`),
          ),
        })),
      ),
  }),
  fixture({
    file: 'mobi/valid-mobi6.mobi',
    format: 'mobi',
    recipe:
      'Uncompressed PalmDB MOBI6 with three pagebreak sections and a guide TOC.',
    behaviors: [
      'opens',
      'renders-multiple-chapters',
      'toc-navigation',
      'works-offline',
    ],
    build: () => mobi({ version: 6 }),
  }),
  fixture({
    file: 'mobi/encrypted-flag.mobi',
    format: 'mobi',
    recipe:
      'PalmDOC encryption flag set on otherwise synthetic MOBI6 metadata.',
    behaviors: ['rejects-drm', 'does-not-attempt-drm-bypass'],
    build: () => mobi({ version: 6, encrypted: true }),
    limitations: [
      'Synthetic PalmDOC encryption flag only; no encrypted payload or DRM bypass is supplied.',
    ],
  }),
  fixture({
    file: 'mobi/malformed.mobi',
    format: 'mobi',
    recipe: 'Truncated BOOKMOBI signature without a PalmDB record table.',
    behaviors: ['rejects-with-readable-error', 'does-not-crash'],
    build: () => text('BOOKMOBI malformed'),
  }),
  fixture({
    file: 'mobi/mislabelled-as-fb2.fb2',
    format: 'mobi',
    recipe: 'Valid MOBI6 bytes intentionally carrying an FB2 filename.',
    behaviors: ['detects-by-content-not-extension', 'opens'],
    build: () => mobi({ version: 6 }),
  }),
  fixture({
    file: 'kf8/valid-navigation.azw3',
    format: 'kf8-azw3',
    recipe:
      'PalmDB KF8 with SKEL, FRAG, NCX, and CNCX records plus one local XHTML fragment.',
    behaviors: [
      'opens',
      'single-readable-section',
      'toc-navigation',
      'works-offline',
    ],
    build: kf8Mobi,
    limitations: [
      'This fixture proves one readable section and TOC anchor navigation only; it must not be used for cross-chapter Previous/Next acceptance.',
    ],
  }),
  fixture({
    file: 'kf8/mislabelled-as-fb2.fb2',
    format: 'kf8-azw3',
    recipe: 'Valid KF8 bytes intentionally carrying an FB2 filename.',
    behaviors: ['detects-by-content-not-extension', 'opens'],
    build: kf8Mobi,
    limitations: [
      'This fixture proves one readable section and TOC anchor navigation only; it must not be used for cross-chapter Previous/Next acceptance.',
    ],
  }),
  fixture({
    file: 'kf8/malformed.azw3',
    format: 'kf8-azw3',
    recipe: 'Truncated BOOKMOBI signature without a PalmDB record table.',
    behaviors: ['rejects-with-readable-error', 'does-not-crash'],
    build: () => text('BOOKMOBI malformed'),
  }),
  fixture({
    file: 'pdf/rejected.pdf',
    format: 'pdf',
    recipe: 'Minimal PDF signature bytes for pre-render rejection.',
    behaviors: ['rejects-unsupported-before-renderer-import'],
    build: () => text('%PDF-1.7\n% CC0 rejection fixture\n'),
    limitations: ['PDF is intentionally outside the supported format set.'],
  }),
];

export function buildFixtureCorpus() {
  return [...legacyEpubFixtures, ...formatFixtures].map((entry) => ({
    ...entry,
    bytes: Buffer.from(entry.build()),
  }));
}

export function makeManifest(corpus = buildFixtureCorpus()) {
  return {
    schemaVersion: 2,
    generatedBy: 'scripts/generate-fixtures.mjs',
    determinism:
      'Recipes are pure. Stored ZIP entries use zeroed DOS timestamps in recipe order.',
    license: {
      expression: 'CC0-1.0',
      notice:
        'Synthetic repository fixtures; no third-party books or downloads.',
    },
    fixtures: corpus.map(
      ({ file, format, recipe, behaviors, limitations, bytes }) => ({
        file,
        format,
        provenance: {
          kind: 'generated',
          recipe,
          generator: 'scripts/generate-fixtures.mjs',
        },
        license: { expression: 'CC0-1.0' },
        bytes: bytes.length,
        sha256: sha256(bytes),
        expected: { behaviors },
        limitations,
      }),
    ),
  };
}

async function fixtureFiles(directory = fixtureRoot) {
  const files = [];
  const visit = async (relative = '') => {
    for (const entry of await readdir(path.join(directory, relative), {
      withFileTypes: true,
    })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
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
  };
  await visit();
  return files.sort();
}

export async function generateFixtures({ check = false } = {}) {
  const corpus = buildFixtureCorpus();
  const manifest = `${JSON.stringify(makeManifest(corpus), null, 2)}\n`;
  const expected = new Map(corpus.map(({ file, bytes }) => [file, bytes]));
  expected.set('manifest.json', Buffer.from(manifest));
  if (!check) await mkdir(fixtureRoot, { recursive: true });
  const actualFiles = await fixtureFiles().catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const expectedFiles = [...expected.keys()]
    .filter((file) => file !== 'manifest.json')
    .sort();
  const differences = [];
  for (const [file, bytes] of expected) {
    const target = path.join(fixtureRoot, file);
    const actual = await readFile(target).catch(() => undefined);
    if (check) {
      if (!actual?.equals(bytes)) differences.push(file);
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  for (const file of actualFiles)
    if (!expectedFiles.includes(file)) differences.push(file);
  if (differences.length) {
    if (!check)
      await Promise.all(
        differences
          .filter((file) => !expected.has(file))
          .map((file) => rm(path.join(fixtureRoot, file))),
      );
    else
      throw new Error(
        `Fixture corpus is stale, missing, or undocumented: ${[...new Set(differences)].join(', ')}`,
      );
  }
  console.log(
    `${check ? 'Verified' : 'Generated'} ${corpus.length} deterministic multi-format fixtures.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await generateFixtures({ check: process.argv.includes('--check') });
}
