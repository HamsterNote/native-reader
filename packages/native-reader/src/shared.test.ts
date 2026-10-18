import {
  buildPublicationModel,
  buildSpine,
  canLoadNavigationTarget,
  categorizeOpenError,
  extractErrorMessage,
  findSpineIndex,
  flattenToc,
  isPublicationHref,
  normalizeArchivePath,
  normalizeCanonicalArchivePath,
  normalizePublicationTarget,
  mapPublicationErrorCode,
  parseNativeBridgeEvent,
  validatePublication,
  validateSource,
  sameReaderLoadState,
  type PublicationPreparedEvent,
  type ReaderPublicationModel,
} from './shared';

test('does not collapse distinct category-only errors during load notification de-duplication', () => {
  expect(
    sameReaderLoadState(
      { status: 'error', error: { category: 'invalid', message: 'Invalid' } },
      { status: 'error', error: { category: 'drm', message: 'Invalid' } },
    ),
  ).toBe(false);
  expect(
    sameReaderLoadState(
      { status: 'error', error: { category: 'invalid', message: 'Invalid' } },
      { status: 'error', error: { category: 'invalid', message: 'Invalid' } },
    ),
  ).toBe(true);
});

const model: ReaderPublicationModel = {
  spine: [
    {
      id: '0:one',
      idref: 'one',
      href: 'text/one.xhtml',
      archiveKey: 'text/one.xhtml',
      label: 'One',
      engineIndex: 0,
    },
    {
      id: '1:two',
      idref: 'two',
      href: 'text/two.xhtml',
      archiveKey: 'text/two.xhtml',
      label: 'Two',
      engineIndex: 1,
    },
    {
      id: '2:three',
      idref: 'three',
      href: 'text/three.xhtml',
      archiveKey: 'text/three.xhtml',
      label: 'Three',
      engineIndex: 2,
    },
  ],
  toc: [],
};

const supportedEvent = (): PublicationPreparedEvent => ({
  type: 'publicationPrepared',
  version: 2,
  packagePath: 'EPUB/package/content.opf',
  navigationPath: 'EPUB/navigation/toc.xhtml',
  title: 'Nested publication',
  spine: [
    {
      idref: 'before',
      href: '../text/before.xhtml',
      archiveKey: 'EPUB/text/before.xhtml',
      linear: true,
      engineIndex: 0,
      properties: [],
    },
    {
      idref: 'skip',
      href: '../text/repeat.xhtml',
      archiveKey: 'EPUB/text/repeat.xhtml',
      linear: false,
      engineIndex: 1,
      properties: [],
    },
    {
      idref: 'repeat',
      href: '../text/repeat.xhtml',
      archiveKey: 'EPUB/text/repeat.xhtml',
      linear: true,
      engineIndex: 2,
      properties: [],
    },
    {
      idref: 'repeat',
      href: '../text/repeat.xhtml',
      archiveKey: 'EPUB/text/repeat.xhtml',
      linear: true,
      engineIndex: 3,
      properties: [],
    },
  ],
  toc: [
    {
      id: 'repeat',
      href: '../text/repeat.xhtml#part',
      archiveKey: 'EPUB/text/repeat.xhtml',
      targetEngineIndex: 2,
      label: 'Repeated',
    },
  ],
  profile: {
    packageLayouts: ['reflowable'],
    spineLayouts: [],
    iBooksDisplayOptions: { state: 'absent' },
    mediaOverlayItemIds: [],
    encryption: { state: 'absent' },
  },
});

test('accepts only platform-local source URI schemes', () => {
  expect(
    validateSource({ kind: 'uri', uri: 'blob:local' }, 'web'),
  ).toBeUndefined();
  expect(
    validateSource({ kind: 'uri', uri: 'file:///book.epub' }, 'native'),
  ).toBeUndefined();
  expect(
    validateSource({ kind: 'uri', uri: 'content://book' }, 'native'),
  ).toBeUndefined();
  expect(
    validateSource(
      { kind: 'uri', uri: 'https://example.test/book.epub' },
      'web',
    )?.code,
  ).toBe('UNSUPPORTED_SOURCE');
  expect(
    validateSource({ kind: 'uri', uri: 'javascript:alert(1)' }, 'web')?.code,
  ).toBe('UNSUPPORTED_SOURCE');
});

test('normalizes nested TOC targets and preserves fragments', () => {
  expect(
    normalizePublicationTarget(
      '../text/two.xhtml#target',
      'EPUB/navigation/toc.xhtml',
    ),
  ).toEqual({
    document: 'EPUB/text/two.xhtml',
    fragment: 'target',
  });
  const spine = [
    {
      id: '1:two',
      idref: 'two',
      href: '../text/two.xhtml',
      archiveKey: 'EPUB/text/two.xhtml',
      label: 'Two',
      engineIndex: 1,
    },
  ];
  expect(
    flattenToc(
      [
        {
          href: '../text/two.xhtml#target',
          archiveKey: 'EPUB/text/two.xhtml',
          targetEngineIndex: 1,
          label: 'Two',
        },
      ],
      'EPUB/navigation/toc.xhtml',
      0,
      spine,
    ),
  ).toEqual([
    {
      id: '0-0-../text/two.xhtml#target',
      href: '../text/two.xhtml#target',
      archiveKey: 'EPUB/text/two.xhtml',
      targetEngineIndex: 1,
      targetFragment: 'target',
      targetHref: '../text/two.xhtml',
      label: 'Two',
      depth: 0,
    },
  ]);
  expect(
    normalizePublicationTarget('#target', 'EPUB/navigation/toc.xhtml'),
  ).toEqual({
    document: 'EPUB/navigation/toc.xhtml',
    fragment: 'target',
  });
  expect(normalizePublicationTarget('chapter.xhtml#target%20id')).toEqual({
    document: 'chapter.xhtml',
    fragment: 'target%20id',
  });
  expect(normalizePublicationTarget('chapter.xhtml#note:1')).toEqual({
    document: 'chapter.xhtml',
    fragment: 'note:1',
  });
  expect(normalizePublicationTarget('chapter.xhtml#note%3A1')).toEqual({
    document: 'chapter.xhtml',
    fragment: 'note%3A1',
  });
  expect(normalizePublicationTarget('chapter.xhtml?note=a:b#note:1')).toEqual({
    document: 'chapter.xhtml',
    fragment: 'note:1',
  });
  expect(
    normalizePublicationTarget('#target%20id', 'EPUB/navigation/toc.xhtml'),
  ).toEqual({
    document: 'EPUB/navigation/toc.xhtml',
    fragment: 'target%20id',
  });
});

test('keeps full engine indices while filtering non-linear and unsafe spine items', () => {
  const event = supportedEvent();
  const initialSpine = buildSpine(event.spine, [], event.packagePath);
  const toc = flattenToc(event.toc, event.navigationPath, 0, initialSpine);
  const spine = buildSpine(event.spine, toc, event.packagePath);
  expect(
    spine.map(({ id, archiveKey, engineIndex, label }) => ({
      id,
      archiveKey,
      engineIndex,
      label,
    })),
  ).toEqual([
    {
      id: '0:before',
      archiveKey: 'EPUB/text/before.xhtml',
      engineIndex: 0,
      label: 'Chapter 1',
    },
    {
      id: '2:repeat',
      archiveKey: 'EPUB/text/repeat.xhtml',
      engineIndex: 2,
      label: 'Repeated',
    },
    {
      id: '3:repeat',
      archiveKey: 'EPUB/text/repeat.xhtml',
      engineIndex: 3,
      label: 'Repeated',
    },
  ]);
});

test('uses engine identity for duplicate hrefs and never falls back for a filtered index', () => {
  const publication = buildPublicationModel(supportedEvent());
  expect(publication).toBeDefined();
  const spine = publication?.spine ?? [];
  expect(findSpineIndex(spine, '../text/repeat.xhtml', 3)).toBe(2);
  expect(findSpineIndex(spine, '../text/repeat.xhtml', 1)).toBe(-1);
  expect(
    findSpineIndex(
      spine,
      '../text/repeat.xhtml',
      undefined,
      'EPUB/package/content.opf',
    ),
  ).toBe(1);
});

test('accepts parent-relative archive targets only when they remain inside the archive', () => {
  expect(
    normalizeArchivePath(
      '../text/chapter.xhtml#part',
      'EPUB/package/package.opf',
    ),
  ).toBe('EPUB/text/chapter.xhtml');
  expect(
    normalizeArchivePath('../../text/chapter.xhtml', 'EPUB/nav/toc.xhtml'),
  ).toBe('text/chapter.xhtml');
  expect(
    normalizeArchivePath('../../../escape.xhtml', 'EPUB/nav/toc.xhtml'),
  ).toBeUndefined();
  expect(
    normalizeArchivePath('../chapter.xhtml', 'package.opf'),
  ).toBeUndefined();
  expect(isPublicationHref('https://attacker.invalid/chapter.xhtml')).toBe(
    false,
  );
  expect(isPublicationHref('%2f%2fattacker.invalid/chapter.xhtml')).toBe(false);
  expect(isPublicationHref('text/%00chapter.xhtml')).toBe(false);
  expect(isPublicationHref('text/%0d%0achapter.xhtml')).toBe(false);
  expect(isPublicationHref('text/%E0%A4%A.xhtml')).toBe(false);
  expect(canLoadNavigationTarget(model, 'text/two.xhtml#target')).toBe(true);
});

test('keeps canonical percent identity stable and collision-free', () => {
  const encodedBase = normalizeArchivePath('EPUB%252Fnested/package.opf');
  expect(encodedBase).toBe('EPUB%2Fnested/package.opf');
  expect(normalizeCanonicalArchivePath(encodedBase!)).toBe(encodedBase);
  expect(normalizeArchivePath('chapter.xhtml', encodedBase)).toBe(
    'EPUB%2Fnested/chapter.xhtml',
  );
  expect(normalizeArchivePath('chapter.xhtml', 'EPUB/nested/package.opf')).toBe(
    'EPUB/nested/chapter.xhtml',
  );
  expect(normalizeArchivePath('%2525.xhtml')).toBe('%25.xhtml');
  expect(normalizeArchivePath('%25.xhtml')).toBe('%.xhtml');
  expect(normalizeArchivePath('EPUB%252Fdir%253Fid/package.opf')).toBe(
    'EPUB%2Fdir%3Fid/package.opf',
  );
  expect(
    normalizeArchivePath('chapter.xhtml', 'EPUB%2Fdir%3Fid/package.opf'),
  ).toBe('EPUB%2Fdir%3Fid/chapter.xhtml');
});

test('keeps whitespace-significant ZIP entry identities distinct', () => {
  expect(normalizeArchivePath(' chapter.xhtml')).toBe(' chapter.xhtml');
  expect(normalizeArchivePath('chapter.xhtml')).toBe('chapter.xhtml');
  expect(normalizeArchivePath('chapter.xhtml ')).toBe('chapter.xhtml ');

  const spine = buildSpine(
    [
      { href: ' chapter.xhtml', linear: true, engineIndex: 0 },
      { href: 'chapter.xhtml', linear: true, engineIndex: 1 },
    ],
    [],
  );
  expect(spine.map(({ href, archiveKey }) => ({ href, archiveKey }))).toEqual([
    { href: ' chapter.xhtml', archiveKey: ' chapter.xhtml' },
    { href: 'chapter.xhtml', archiveKey: 'chapter.xhtml' },
  ]);
});

test('keeps a first-segment colon as ZIP identity instead of a URL scheme', () => {
  // `chapter:1.xhtml` 是合法的 ZIP entry 名称；canonical 身份不再是 URL。
  expect(normalizeCanonicalArchivePath('chapter:1.xhtml')).toBe(
    'chapter:1.xhtml',
  );
  // rootfile EPUB/package.opf 通过 ../chapter:1.xhtml 到达归档根的 entry。
  expect(normalizeArchivePath('../chapter:1.xhtml', 'EPUB/package.opf')).toBe(
    'chapter:1.xhtml',
  );
  expect(
    normalizePublicationTarget(
      '../chapter:1.xhtml#colon-anchor',
      'EPUB/package.opf',
    ),
  ).toEqual({ document: 'chapter:1.xhtml', fragment: 'colon-anchor' });
  expect(
    normalizePublicationTarget('#colon-anchor', 'chapter:1.xhtml'),
  ).toEqual({ document: 'chapter:1.xhtml', fragment: 'colon-anchor' });
  // scheme 只在 raw document component 的起始位置判定：直接以 `chapter:` 开头
  // 的相对引用仍按 URL scheme 拒绝，避免把首段冒号误当成普通文件名。
  expect(normalizeArchivePath('chapter:1.xhtml')).toBeUndefined();
  expect(
    normalizeArchivePath('chapter:1.xhtml', 'EPUB/package.opf'),
  ).toBeUndefined();
  expect(normalizePublicationTarget('chapter:1.xhtml#part')).toBeUndefined();
});

test('builds and validates a spine whose canonical identity has a first-segment colon', () => {
  const spineInputs: PublicationPreparedEvent['spine'] = [
    {
      idref: 'colon',
      href: '../chapter:1.xhtml',
      archiveKey: 'chapter:1.xhtml',
      linear: true,
      engineIndex: 0,
      properties: [],
    },
  ];
  expect(buildSpine(spineInputs, [], 'EPUB/package.opf')).toEqual([
    {
      id: '0:colon',
      idref: 'colon',
      href: '../chapter:1.xhtml',
      archiveKey: 'chapter:1.xhtml',
      label: 'Chapter 1',
      engineIndex: 0,
    },
  ]);

  const event: PublicationPreparedEvent = {
    type: 'publicationPrepared',
    version: 2,
    packagePath: 'EPUB/package.opf',
    navigationPath: 'EPUB/nav.xhtml',
    title: 'First Segment Colon',
    spine: spineInputs,
    toc: [
      {
        id: 'colon',
        href: '../chapter:1.xhtml#colon-anchor',
        archiveKey: 'chapter:1.xhtml',
        targetEngineIndex: 0,
        label: 'Colon Chapter',
      },
    ],
    profile: {
      packageLayouts: [],
      spineLayouts: [],
      iBooksDisplayOptions: { state: 'absent' },
      mediaOverlayItemIds: [],
      encryption: { state: 'absent' },
    },
  };
  expect(parseNativeBridgeEvent(event)).toBe(event);
  expect(validatePublication(event)).toBeUndefined();

  const publication = buildPublicationModel(event);
  expect(
    publication?.spine.map(({ archiveKey, label }) => ({
      archiveKey,
      label,
    })),
  ).toEqual([{ archiveKey: 'chapter:1.xhtml', label: 'Colon Chapter' }]);
  expect(publication?.toc).toEqual([
    {
      id: 'colon',
      href: '../chapter:1.xhtml#colon-anchor',
      archiveKey: 'chapter:1.xhtml',
      targetEngineIndex: 0,
      targetHref: '../chapter:1.xhtml',
      targetFragment: 'colon-anchor',
      label: 'Colon Chapter',
      depth: 0,
    },
  ]);
});

test('fails the complete spine closed while filtering valid non-linear UI items', () => {
  const invalid = supportedEvent();
  invalid.spine[0]!.href = 'https:invalid.example/chapter.xhtml';
  expect(buildSpine(invalid.spine, [], invalid.packagePath)).toEqual([]);

  expect(
    buildSpine(supportedEvent().spine, [], supportedEvent().packagePath),
  ).toHaveLength(3);
});

test.each([
  '\tchapter.xhtml',
  'chapter.xhtml\r',
  `chapter.xhtml${String.fromCharCode(0x7f)}`,
  `chapter.xhtml${String.fromCharCode(0x85)}`,
  'chapter.xhtml%7F',
  'chapter.xhtml%C2%85',
  'chapter.xhtml#%00',
  'chapter.xhtml#%2500',
  String.raw`chapter.xhtml#\evil`,
  'chapter.xhtml?value=%00',
  'chapter.xhtml?value=%2500',
  String.raw`chapter.xhtml?value=\evil`,
  'chapter.xhtml?value=%ZZ',
  ' https:attacker.invalid',
  'chapter.xhtml?next=/absolute',
  'chapter.xhtml?next= /absolute',
  'chapter.xhtml?next=%2Fabsolute',
  'chapter.xhtml#/absolute',
] as const)(
  'rejects unsafe complete archive target %p before parsing',
  (href) => {
    expect(normalizeArchivePath(href)).toBeUndefined();
    expect(normalizePublicationTarget(href)).toBeUndefined();
  },
);

test('limits archive target percent decoding to eight layers', () => {
  const encodeLayers = (value: string, count: number) => {
    let encoded = value;
    for (let index = 0; index < count; index += 1) {
      encoded = encodeURIComponent(encoded);
    }
    return encoded;
  };

  expect(normalizeArchivePath(encodeLayers('chapter name.xhtml', 8))).toBe(
    encodeLayers('chapter name.xhtml', 7),
  );
  expect(
    normalizeArchivePath(encodeLayers('chapter name.xhtml', 9)),
  ).toBeUndefined();
});

test.each([
  [
    'package fixed layout',
    (event: PublicationPreparedEvent) => {
      event.profile.packageLayouts = ['pre-paginated'];
    },
    'UNSUPPORTED_EPUB',
  ],
  [
    'spine fixed layout',
    (event: PublicationPreparedEvent) => {
      event.profile.spineLayouts = [
        { engineIndex: 0, value: 'rendition:layout-pre-paginated' },
      ];
    },
    'UNSUPPORTED_EPUB',
  ],
  [
    'iBooks fixed layout',
    (event: PublicationPreparedEvent) => {
      event.profile.iBooksDisplayOptions = {
        state: 'parsed',
        fixedLayouts: ['true'],
      };
    },
    'UNSUPPORTED_EPUB',
  ],
  [
    'media overlay',
    (event: PublicationPreparedEvent) => {
      event.profile.mediaOverlayItemIds = ['overlay'];
    },
    'UNSUPPORTED_EPUB',
  ],
  [
    'encryption',
    (event: PublicationPreparedEvent) => {
      event.profile.encryption = {
        state: 'parsed',
        algorithms: ['urn:algo'],
        resourceUris: ['font.otf'],
      };
    },
    'UNSUPPORTED_EPUB',
  ],
  [
    'malformed encryption',
    (event: PublicationPreparedEvent) => {
      event.profile.encryption = { state: 'malformed' };
    },
    'INVALID_EPUB',
  ],
  [
    'malformed iBooks display options',
    (event: PublicationPreparedEvent) => {
      event.profile.iBooksDisplayOptions = { state: 'malformed' };
    },
    'INVALID_EPUB',
  ],
  [
    'malformed profile shape',
    (event: PublicationPreparedEvent) => {
      event.profile.iBooksDisplayOptions = {
        state: 'parsed',
      } as PublicationPreparedEvent['profile']['iBooksDisplayOptions'];
    },
    'INVALID_EPUB',
  ],
  [
    'unknown spine layout engine index',
    (event: PublicationPreparedEvent) => {
      event.profile.spineLayouts = [
        { engineIndex: 99, value: 'rendition:layout-reflowable' },
      ];
    },
    'INVALID_EPUB',
  ],
  [
    'duplicate engine index',
    (event: PublicationPreparedEvent) => {
      event.spine[3]!.engineIndex = 2;
    },
    'INVALID_EPUB',
  ],
  [
    'no linear spine',
    (event: PublicationPreparedEvent) => {
      event.spine.forEach((item) => {
        item.linear = false;
      });
    },
    'INVALID_EPUB',
  ],
] as const)('classifies %s structurally', (_name, mutate, code) => {
  const event = supportedEvent();
  mutate(event);
  expect(validatePublication(event)?.code).toBe(code);
});

test.each([
  [
    'package reflowable',
    (event: PublicationPreparedEvent) => {
      event.profile.packageLayouts = ['reflowable'];
    },
  ],
  [
    'spine reflowable',
    (event: PublicationPreparedEvent) => {
      event.profile.spineLayouts = [
        { engineIndex: 0, value: 'rendition:layout-reflowable' },
      ];
    },
  ],
  [
    'unprefixed spine reflowable',
    (event: PublicationPreparedEvent) => {
      event.profile.spineLayouts = [
        { engineIndex: 0, value: 'layout-reflowable' },
      ];
    },
  ],
  [
    'iBooks false',
    (event: PublicationPreparedEvent) => {
      event.profile.iBooksDisplayOptions = {
        state: 'parsed',
        fixedLayouts: ['false'],
      };
    },
  ],
  [
    'iBooks no',
    (event: PublicationPreparedEvent) => {
      event.profile.iBooksDisplayOptions = {
        state: 'parsed',
        fixedLayouts: ['no'],
      };
    },
  ],
] as const)('accepts supported %s declaration', (_name, mutate) => {
  const event = supportedEvent();
  mutate(event);
  expect(validatePublication(event)).toBeUndefined();
});

test('normalizes profile declarations only for comparison', () => {
  const event = supportedEvent();
  event.profile.packageLayouts = [' ReFlOwAbLe '];
  event.profile.spineLayouts = [
    { engineIndex: 0, value: ' RENDITION:LAYOUT-REFLOWABLE ' },
  ];
  event.profile.iBooksDisplayOptions = {
    state: 'parsed',
    fixedLayouts: [' No '],
  };
  const originalProfile = JSON.stringify(event.profile);

  expect(parseNativeBridgeEvent(event)).toBe(event);
  expect(validatePublication(event)).toBeUndefined();
  expect(JSON.stringify(event.profile)).toBe(originalProfile);
});

test.each([
  ['package pre-paginated', 'package', 'pre-paginated'],
  ['package fixed', 'package', 'fixed'],
  ['package unknown', 'package', 'unknown-layout'],
  ['spine pre-paginated', 'spine', 'rendition:layout-pre-paginated'],
  ['spine fixed', 'spine', 'fixed'],
  ['spine unknown', 'spine', 'unknown-layout'],
  ['iBooks true', 'iBooks', 'true'],
  ['iBooks yes', 'iBooks', 'yes'],
  ['iBooks unknown', 'iBooks', 'maybe'],
] as const)('rejects unsupported %s declaration', (_name, source, value) => {
  const event = supportedEvent();
  if (source === 'package') event.profile.packageLayouts = [value];
  if (source === 'spine') {
    event.profile.spineLayouts = [{ engineIndex: 0, value }];
  }
  if (source === 'iBooks') {
    event.profile.iBooksDisplayOptions = {
      state: 'parsed',
      fixedLayouts: [value],
    };
  }
  expect(validatePublication(event)?.code).toBe('UNSUPPORTED_EPUB');
});

test.each(['package', 'spine', 'iBooks'] as const)(
  'rejects blank %s declaration as invalid',
  (source) => {
    const event = supportedEvent();
    if (source === 'package') event.profile.packageLayouts = ['   '];
    if (source === 'spine') {
      event.profile.spineLayouts = [{ engineIndex: 0, value: '   ' }];
    }
    if (source === 'iBooks') {
      event.profile.iBooksDisplayOptions = {
        state: 'parsed',
        fixedLayouts: ['   '],
      };
    }
    expect(validatePublication(event)?.code).toBe('INVALID_EPUB');
  },
);

test.each([
  [
    'duplicate package values',
    (event: PublicationPreparedEvent) => {
      event.profile.packageLayouts = ['reflowable', 'reflowable'];
    },
  ],
  [
    'supported and unsupported package values',
    (event: PublicationPreparedEvent) => {
      event.profile.packageLayouts = ['reflowable', 'pre-paginated'];
    },
  ],
  [
    'duplicate spine engine index',
    (event: PublicationPreparedEvent) => {
      event.profile.spineLayouts = [
        { engineIndex: 0, value: 'rendition:layout-reflowable' },
        { engineIndex: 0, value: 'rendition:layout-reflowable' },
      ];
    },
  ],
  [
    'supported and unsupported values on one spine engine index',
    (event: PublicationPreparedEvent) => {
      event.profile.spineLayouts = [
        { engineIndex: 0, value: 'rendition:layout-reflowable' },
        { engineIndex: 0, value: 'rendition:layout-pre-paginated' },
      ];
    },
  ],
  [
    'duplicate iBooks values',
    (event: PublicationPreparedEvent) => {
      event.profile.iBooksDisplayOptions = {
        state: 'parsed',
        fixedLayouts: ['false', 'false'],
      };
    },
  ],
  [
    'supported and unsupported iBooks values',
    (event: PublicationPreparedEvent) => {
      event.profile.iBooksDisplayOptions = {
        state: 'parsed',
        fixedLayouts: ['false', 'true'],
      };
    },
  ],
] as const)(
  'rejects %s as invalid before allowlist classification',
  (_name, mutate) => {
    const event = supportedEvent();
    mutate(event);
    expect(validatePublication(event)?.code).toBe('INVALID_EPUB');
  },
);

test('accepts prepared v2 and rejects old or future prepared versions', () => {
  const event = supportedEvent();
  expect(parseNativeBridgeEvent(event)).toEqual(event);
  expect(validatePublication(event)).toBeUndefined();
  expect(parseNativeBridgeEvent({ ...event, version: 1 })).toBeUndefined();
  expect(parseNativeBridgeEvent({ ...event, version: 3 })).toBeUndefined();
  expect(
    parseNativeBridgeEvent({
      ...event,
      spine: [{ href: 'missing-identity.xhtml' }],
    }),
  ).toBeUndefined();
});

test.each([
  {
    type: 'publicationLocation',
    version: 1,
    engineIndex: 0,
    href: 'chapter.xhtml',
  },
  { type: 'publicationError', version: 1, phase: 'parse' },
  { type: 'publicationNavigationError', version: 1 },
] as const)('keeps $type on bridge protocol v1', (event) => {
  expect(parseNativeBridgeEvent(event)).toBe(event);
  expect(parseNativeBridgeEvent({ ...event, version: 2 })).toBeUndefined();
});

test('parses publication navigation errors without changing the event', () => {
  const withoutReason = {
    type: 'publicationNavigationError',
    version: 1,
  } as const;
  const withReason = {
    type: 'publicationNavigationError',
    version: 1,
    reason: '  target unavailable  ',
  } as const;

  expect(parseNativeBridgeEvent(withoutReason)).toBe(withoutReason);
  expect(parseNativeBridgeEvent(withReason)).toBe(withReason);
  expect(withReason.reason).toBe('  target unavailable  ');
});

test.each([
  [
    'an extra field',
    {
      type: 'publicationNavigationError',
      version: 1,
      reason: 'failed',
      extra: true,
    },
  ],
  ['the wrong version', { type: 'publicationNavigationError', version: 2 }],
  [
    'a non-string reason',
    { type: 'publicationNavigationError', version: 1, reason: 42 },
  ],
] as const)('rejects publication navigation errors with %s', (_name, event) => {
  expect(parseNativeBridgeEvent(event)).toBeUndefined();
});

test('uses stable compatibility error categories', () => {
  expect(categorizeOpenError(new Error('permission denied')).code).toBe(
    'READ_FAILED',
  );
  expect(categorizeOpenError(new Error('fixed-layout publication')).code).toBe(
    'UNSUPPORTED_EPUB',
  );
  expect(categorizeOpenError(new Error('bad zip')).code).toBe('INVALID_EPUB');
  expect(categorizeOpenError({ message: 'display failed' }).code).toBe(
    'RENDER_FAILED',
  );
  expect(extractErrorMessage({ message: 'plain object' })).toBe('plain object');
  expect(mapPublicationErrorCode('render', 'anything')).toBe('RENDER_FAILED');
  expect(mapPublicationErrorCode('parse', 'display failed')).toBe(
    'INVALID_EPUB',
  );
  expect(mapPublicationErrorCode('profile', 'UNSUPPORTED_EPUB')).toBe(
    'UNSUPPORTED_EPUB',
  );
});
