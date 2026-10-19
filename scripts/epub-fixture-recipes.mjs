const encoder = new TextEncoder();

const text = (value) => encoder.encode(value);

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, input] of entries) {
    const nameBytes = text(name);
    const bytes = typeof input === 'string' ? text(input) : input;
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const chapter = (
  title,
  body,
  extraHead = '',
) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>${extraHead}</head>
<body><h1>${title}</h1>${body}</body></html>
`;

function epub3({
  title,
  identifier,
  chapters,
  extraManifest = '',
  metadata = '',
  extraEntries = [],
  navigationLinks,
  direction,
}) {
  const chapterItems = chapters
    .map(
      (_, index) =>
        `<item id="c${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('');
  const spine = chapters
    .map((_, index) => `<itemref idref="c${index + 1}"/>`)
    .join('');
  const links = chapters
    .map(
      ([heading], index) =>
        `<li><a href="chapter-${index + 1}.xhtml">${heading}</a></li>`,
    )
    .join('');
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${title}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>${metadata}</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapterItems}${extraManifest}</manifest>
<spine${direction ? ` page-progression-direction="${direction}"` : ''}>${spine}</spine></package>
`;
  const nav = chapter(
    'Contents',
    `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${navigationLinks ?? links}</ol></nav>`,
  );
  return zip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', container],
    ['EPUB/package.opf', opf],
    ['EPUB/nav.xhtml', nav],
    ...chapters.map(([heading, body, extraHead], index) => [
      `EPUB/chapter-${index + 1}.xhtml`,
      chapter(heading, body, extraHead),
    ]),
    ...extraEntries,
  ]);
}

function epub2() {
  const chapters = [
    ['Arrival', '<p>Mara arrived at the observatory before sunrise.</p>'],
    ['The Map', '<p>The map marked a quiet path through Hamster Valley.</p>'],
    ['Homeward', '<p>At dusk, the field notes were complete.</p>'],
  ];
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:fixture:epub2</dc:identifier><dc:title>EPUB 2 Field Notes</dc:title><dc:language>en</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cover" href="cover.svg" media-type="image/svg+xml"/>${chapters.map((_, index) => `<item id="c${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine toc="ncx">${chapters.map((_, index) => `<itemref idref="c${index + 1}"/>`).join('')}</spine></package>
`;
  const points = chapters
    .map(
      ([title], index) =>
        `<navPoint id="n${index + 1}" playOrder="${index + 1}"><navLabel><text>${title}</text></navLabel><content src="chapter-${index + 1}.xhtml"/></navPoint>`,
    )
    .join('');
  const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:fixture:epub2"/></head><docTitle><text>EPUB 2 Field Notes</text></docTitle><navMap>${points}</navMap></ncx>`;
  const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480" viewBox="0 0 320 480"><rect width="320" height="480" fill="#d8c7a2"/><text x="30" y="220" font-size="28">Field Notes</text></svg>`;
  return zip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', container],
    ['EPUB/package.opf', opf],
    ['EPUB/toc.ncx', ncx],
    ['EPUB/cover.svg', cover],
    ...chapters.map(([heading, body], index) => [
      `EPUB/chapter-${index + 1}.xhtml`,
      chapter(heading, body),
    ]),
  ]);
}

function noTocSpine() {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:fixture:no-toc-spine</dc:identifier><dc:title>No TOC Spine</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="skip" href="skip.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="one"/><itemref idref="skip" linear="no"/><itemref idref="two"/></spine></package>
`;
  return zip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', container],
    ['EPUB/package.opf', opf],
    ['EPUB/one.xhtml', chapter('First Linear', '<p>First spine item.</p>')],
    ['EPUB/skip.xhtml', chapter('Non Linear', '<p>Must be skipped.</p>')],
    ['EPUB/two.xhtml', chapter('Second Linear', '<p>Second spine item.</p>')],
  ]);
}

function duplicateHrefSpine() {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:fixture:duplicate-href-spine</dc:identifier><dc:title>Duplicate Href Spine</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="before" href="before.xhtml" media-type="application/xhtml+xml"/><item id="repeat" href="repeat.xhtml" media-type="application/xhtml+xml"/><item id="between" href="between.xhtml" media-type="application/xhtml+xml"/><item id="after" href="after.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="before"/><itemref idref="repeat"/><itemref idref="between"/><itemref idref="repeat"/><itemref idref="after"/></spine></package>
`;
  return zip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', container],
    ['EPUB/package.opf', opf],
    ['EPUB/before.xhtml', chapter('Before', '<p>Before the repeats.</p>')],
    [
      'EPUB/repeat.xhtml',
      chapter('Repeated', '<p>Used twice in the spine.</p>'),
    ],
    ['EPUB/between.xhtml', chapter('Between', '<p>Between the repeats.</p>')],
    ['EPUB/after.xhtml', chapter('After', '<p>After the final repeat.</p>')],
  ]);
}

function nestedRelativePaths() {
  const nestedContainer = container.replace(
    'EPUB/package.opf',
    'EPUB/package/content.opf',
  );
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:fixture:nested-relative</dc:identifier><dc:title>Nested Relative Paths</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="../navigation/toc.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="../text/one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="../text/two.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="one"/><itemref idref="two"/></spine></package>`;
  const nav = chapter(
    'Contents',
    '<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="../text/one.xhtml">Nested One</a></li><li><a href="../text/two.xhtml">Nested Two</a></li></ol></nav>',
  );
  return zip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', nestedContainer],
    ['EPUB/package/content.opf', opf],
    ['EPUB/navigation/toc.xhtml', nav],
    [
      'EPUB/text/one.xhtml',
      chapter('Nested One', '<p>First nested chapter.</p>'),
    ],
    [
      'EPUB/text/two.xhtml',
      chapter('Nested Two', '<p>Second nested chapter.</p>'),
    ],
  ]);
}

/**
 * 构造用于验证 percent-encoded fragment 锚点的 EPUB：
 * - TOC 项 href 带 percent-encoded fragment（chapter-1.xhtml#target%20id）；
 * - 目标元素 id 含空格（"target id"），即 getElementById 必须先做 URI 解码；
 * - 目标之前放置大量正文，保证初始分页时目标不在 iframe viewport 内。
 */
function encodedFragmentAnchor() {
  const targetId = 'target id';
  const leadParagraphs = Array.from(
    { length: 90 },
    (_, index) =>
      `<p>Ledger entry ${String(index + 1).padStart(2, '0')}: wind held from the north, the water ran clear, the grass stayed dry, and the ridge path remained open for the next surveyor.</p>`,
  ).join('');
  const body = `<p id="chapter-start">The survey began at the trailhead before sunrise.</p>${leadParagraphs}<h2 id="${targetId}">Percent-encoded landmark</h2><p>The table of contents reaches this heading through a percent-encoded fragment.</p><p>The ledger closes on the page after the landmark.</p>`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:fixture:encoded-fragment-anchor</dc:identifier><dc:title>Encoded Fragment Anchor</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/></spine></package>
`;
  const nav = chapter(
    'Contents',
    `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="chapter-1.xhtml#${encodeURIComponent(targetId)}">Percent-encoded landmark</a></li></ol></nav>`,
  );
  return zip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', container],
    ['EPUB/package.opf', opf],
    ['EPUB/nav.xhtml', nav],
    ['EPUB/chapter-1.xhtml', chapter('Encoded Fragment Anchor', body)],
  ]);
}

/**
 * 构造 canonical ZIP 身份首段含冒号的 EPUB：
 * - rootfile 位于 EPUB/package.opf；
 * - manifest/spine/nav 通过 ../chapter:1.xhtml 引用 ZIP 根目录的 chapter:1.xhtml；
 * - 归一化后的 canonical key 是 chapter:1.xhtml：首段冒号属于 ZIP entry 名称，
 *   不是 URL scheme（scheme 只在原始 document component 的起始位置判定）；
 * - 相对引用本身必须以 `..` 开头；原始 document 若直接写 `chapter:1.xhtml`
 *   会被正确地按 scheme 拒绝。
 */
function firstSegmentColon() {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:fixture:first-segment-colon</dc:identifier><dc:title>First Segment Colon</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="../chapter:1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/></spine></package>
`;
  const nav = chapter(
    'Contents',
    '<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="../chapter:1.xhtml#colon-anchor">Colon Chapter</a></li></ol></nav>',
  );
  return zip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', container],
    ['EPUB/package.opf', opf],
    ['EPUB/nav.xhtml', nav],
    [
      'chapter:1.xhtml',
      chapter(
        'Colon Chapter',
        '<p id="colon-anchor">The canonical ZIP identity keeps its first-segment colon.</p>',
      ),
    ],
  ]);
}

const smallChapters = [
  [
    'Morning',
    '<p>A bell sounded across the garden.</p><img src="landscape.svg" alt="Green hills under a blue sky"/>',
  ],
  ['Evening', '<p>The lantern made a warm circle on the page.</p>'],
  ['Night', '<p>The final observation was written under the stars.</p>'],
];

const landscape = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#86bde8"/><path d="M0 300L190 120l120 130 110-90 220 140v60H0z" fill="#477a45"/></svg>`;

const largeParagraph =
  '<p>The survey team recorded wind, water, seed, stone, and starlight in a methodical field ledger. Each observation remained local to the book so the reading path could be exercised without a network connection.</p>';
const largeChapters = Array.from({ length: 48 }, (_, index) => [
  `Survey ${String(index + 1).padStart(2, '0')}`,
  Array.from({ length: 120 }, () => largeParagraph).join(''),
]);

export const recipes = [
  {
    file: 'css-network-denied.epub',
    description:
      'Adversarial inline CSS, scripts and handlers under publication CSP.',
    behaviors: ['blocks-script-execution', 'blocks-external-network'],
    build: () => {
      const origins = [
        'http://127.0.0.1:8181',
        'http://localhost:8181',
        'https://example.invalid',
      ];
      const imports = origins
        .map(
          (origin, index) =>
            `@import url("${origin}/__publication-canary/import-${index}.css");`,
        )
        .join('');
      const rules = origins
        .map(
          (origin, index) =>
            `@font-face { font-family: canary${index}; src: url("${origin}/__publication-canary/font-${index}.woff2"); } #canary-${index} { font-family: canary${index}; background-image: url("${origin}/__publication-canary/image-${index}.png"); }`,
        )
        .join('');
      return epub3({
        title: 'CSS Network Denial',
        identifier: 'urn:fixture:css-network-denied',
        chapters: [
          [
            'Adversarial Styles',
            `<p id="safe-marker">Static CSS canary.</p>${origins.map((_, index) => `<p id="canary-${index}">Font and image canary ${index}.</p>`).join('')}<button id="handler-canary" onclick="globalThis.__PUBLICATION_HANDLER_EXECUTED__ = true">Handler</button><script>globalThis.__PUBLICATION_INLINE_SCRIPT__ = true; parent.__PUBLICATION_HOST_SCRIPT__ = true;</script><script src="payload.js"></script>`,
            `<style>${imports}${rules}</style>`,
          ],
        ],
        extraManifest:
          '<item id="script" href="payload.js" media-type="application/javascript" properties="scripted"/>',
        extraEntries: [
          [
            'EPUB/payload.js',
            'globalThis.__PUBLICATION_EXTERNAL_SCRIPT__ = true;',
          ],
        ],
      });
    },
  },
  {
    file: 'inline-styles.epub',
    description:
      'Local author attribute and style-element CSS for computed-style acceptance.',
    behaviors: ['opens', 'author-inline-styles', 'works-offline'],
    build: () =>
      epub3({
        title: 'Publication Styles',
        identifier: 'urn:fixture:inline-styles',
        chapters: [
          [
            'Author Styles',
            '<p id="author-attribute" style="color: rgb(17, 34, 51)">Author attribute color.</p><p id="author-rule">Author stylesheet italic.</p>',
            '<style>#author-rule { font-style: italic; }</style>',
          ],
        ],
      }),
  },
  {
    file: 'valid-epub2.epub',
    description: 'Valid EPUB 2 with three chapters, NCX TOC, and an SVG cover.',
    behaviors: [
      'opens',
      'renders-multiple-chapters',
      'toc-navigation',
      'renders-local-media',
      'works-offline',
    ],
    build: epub2,
  },
  {
    file: 'valid-epub3.epub',
    description:
      'Valid EPUB 3 with three chapters, navigation document, and inline SVG media.',
    behaviors: [
      'opens',
      'renders-multiple-chapters',
      'toc-navigation',
      'renders-local-media',
      'works-offline',
    ],
    build: () =>
      epub3({
        title: 'EPUB 3 Garden Almanac',
        identifier: 'urn:fixture:epub3',
        chapters: smallChapters,
        extraManifest:
          '<item id="landscape" href="landscape.svg" media-type="image/svg+xml"/>',
        extraEntries: [['EPUB/landscape.svg', landscape]],
      }),
  },
  {
    file: 'malformed.epub',
    description: 'A deliberately non-ZIP payload carrying an EPUB extension.',
    behaviors: ['rejects-with-readable-error', 'does-not-crash'],
    build: () => text('This is intentionally not a ZIP or EPUB file.\n'),
  },
  {
    file: 'no-toc-spine.epub',
    description:
      'EPUB 3 without navigation and with a non-linear middle spine item.',
    behaviors: [
      'opens-without-toc',
      'chapter-navigation',
      'skips-non-linear-spine-items',
      'works-offline',
    ],
    build: noTocSpine,
  },
  {
    file: 'nested-relative-paths.epub',
    description:
      'Nested OPF and navigation documents with legal parent-relative package paths.',
    behaviors: [
      'opens',
      'parent-relative-opf-paths',
      'parent-relative-nav-paths',
      'chapter-navigation',
      'works-offline',
    ],
    build: nestedRelativePaths,
  },
  {
    file: 'encoded-fragment-anchor.epub',
    description:
      'EPUB 3 whose TOC links to a percent-encoded fragment (#target%20id) in a long chapter.',
    behaviors: [
      'opens',
      'toc-navigation',
      'percent-encoded-fragment-anchor',
      'anchor-enters-iframe-viewport',
      'works-offline',
    ],
    build: encodedFragmentAnchor,
  },
  {
    file: 'first-segment-colon.epub',
    description:
      'EPUB 3 whose rootfile EPUB/package.opf reaches the archive-root chapter:1.xhtml through ../chapter:1.xhtml.',
    behaviors: [
      'opens',
      'parent-relative-opf-paths',
      'first-segment-colon-identity',
      'toc-navigation',
      'works-offline',
    ],
    build: firstSegmentColon,
  },
  {
    file: 'duplicate-href-spine.epub',
    description:
      'EPUB 3 whose final repeated spine item has distinct previous and next neighbors.',
    behaviors: [
      'duplicate-href-spine',
      'previous-from-final-repeat',
      'next-from-final-repeat',
      'works-offline',
    ],
    build: duplicateHrefSpine,
  },
  {
    file: 'fixed-layout.epub',
    description:
      'Valid EPUB 3 declaring pre-paginated fixed layout, which is unsupported.',
    behaviors: [
      'rejects-unsupported-fixed-layout',
      'does-not-silently-render-as-reflowable',
    ],
    build: () =>
      epub3({
        title: 'Unsupported Fixed Layout',
        identifier: 'urn:fixture:fixed-layout',
        chapters: [['Fixed Page', '<p>This page declares fixed layout.</p>']],
        metadata: '<meta property="rendition:layout">pre-paginated</meta>',
      }),
  },
  {
    file: 'scripted-external.epub',
    description:
      'EPUB 3 with scripted content and a remote image reference for security rejection tests.',
    behaviors: [
      'blocks-script-execution',
      'blocks-external-network',
      'renders-sanitized-static-content',
    ],
    build: () =>
      epub3({
        title: 'Unsafe Content',
        identifier: 'urn:fixture:scripted-external',
        chapters: [
          [
            'Unsafe Chapter',
            '<p id="safe-marker">Static text remains inert.</p><img src="https://example.invalid/tracker.png" alt="Remote resource"/><a id="external-link" href="https://example.invalid/navigation">External</a><a id="encoded-external-link" href="https%3A%2F%2Fexample.invalid%2Fencoded">Encoded external</a><a id="top-link" href="https://example.invalid/top" target="_top">Top</a><button id="popup" onclick="window.open(\'https://example.invalid/popup\')">Popup</button><script src="payload.js"></script>',
            '<meta http-equiv="refresh" content="0;url=https://example.invalid/refresh"/><style>@import "https://example.invalid/import.css"; .escaped{background:url(\\68 ttps://example.invalid/escaped.png)}</style>',
          ],
        ],
        extraManifest:
          '<item id="script" href="payload.js" media-type="application/javascript" properties="scripted remote-resources"/>',
        extraEntries: [
          [
            'EPUB/payload.js',
            'globalThis.__EPUB_SCRIPT_EXECUTED__ = true; top.__EPUB_TOP_NAV_EXECUTED__ = true;',
          ],
        ],
      }),
  },
  {
    file: 'single-section-rtl.epub',
    description:
      'Single readable multi-page section with RTL page progression for confirmed page boundary acceptance.',
    behaviors: [
      'opens',
      'single-section-pages',
      'rtl-page-navigation',
      'works-offline',
    ],
    build: () =>
      epub3({
        title: 'RTL Single Section Notes',
        identifier: 'urn:fixture:single-section-rtl',
        direction: 'rtl',
        chapters: [
          [
            'Only Section',
            '<p>Deterministic CC0 page navigation notes with right-to-left page progression.</p>'.repeat(
              48,
            ) + '<p style="height:113px">Final partial viewport marker.</p>',
          ],
        ],
      }),
  },
  {
    file: 'reader-chrome-stress.epub',
    description:
      'Reader chrome stress: 120+ character title with an unbroken word, 63 navigable chapters and three nested TOC levels.',
    behaviors: [
      'opens',
      'toc-navigation',
      'chapter-navigation',
      'reader-chrome-stress',
      'works-offline',
    ],
    build: () => {
      const chapters = Array.from({ length: 63 }, (_, index) => [
        `Stress ${String(index + 1).padStart(2, '0')}`,
        '<p>Local CC0 reading notes for the reader chrome acceptance fixture.</p>'.repeat(
          24,
        ),
      ]);
      const link = (index) =>
        `<a href="chapter-${index + 1}.xhtml">${chapters[index][0]}</a>`;
      const navigationLinks = Array.from({ length: 21 }, (_, group) => {
        const index = group * 3;
        return `<li>${link(index)}<ol><li>${link(index + 1)}<ol><li>${link(index + 2)}</li></ol></li></ol></li>`;
      }).join('');
      return epub3({
        title: `Reader Chrome Field Notes: A Deterministic Long Title for Narrow Reading Surfaces ${'UnbrokenPublicationTitle'.repeat(5)}`,
        identifier: 'urn:fixture:reader-chrome-stress',
        chapters,
        navigationLinks,
      });
    },
  },
  {
    file: 'large-representative.epub',
    description:
      'Representative large reflowable EPUB 3 with 48 chapters and dense local text.',
    behaviors: [
      'opens',
      'toc-navigation',
      'chapter-navigation',
      'measured-large-smoke',
      'works-offline',
    ],
    build: () =>
      epub3({
        title: 'Large Valley Survey',
        identifier: 'urn:fixture:large',
        chapters: largeChapters,
      }),
  },
];

export function buildCorpus() {
  return recipes.map((recipe) => ({
    ...recipe,
    bytes: Buffer.from(recipe.build()),
  }));
}
