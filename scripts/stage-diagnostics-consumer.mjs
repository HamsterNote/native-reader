import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

// Share the Expo bootstrap document, while selecting an independent public-API consumer entry.
const document = await readFile('apps/demo/dist/index.html', 'utf8');
await writeFile(
  'apps/demo/dist/diagnostics-consumer.html',
  document
    .replace(
      '<title>Native Reader Demo</title>',
      '<title>Reader Diagnostics Consumer</title>',
    )
    .replace('</head>', '<link rel="icon" href="data:," /></head>'),
);

if (process.env.HN_DIAGNOSTICS_WITHOUT_INLINE === '1') {
  const target = 'apps/demo/dist-without-publication-inline';
  await mkdir(target, { recursive: true });
  await cp('apps/demo/dist', target, { recursive: true });
  const source = JSON.parse(
    await readFile(
      'packages/native-reader/src/foliate-csp-policy.json',
      'utf8',
    ),
  );
  const serialize = (directives) =>
    source.directiveOrder
      .map((name) => `${name} ${directives[name].join(' ')}`)
      .join('; ');
  const publication = source.policies.publication.directives;
  const original = `export const FOLIATE_PUBLICATION_CSP = ${JSON.stringify(serialize(publication))};`;
  const withoutInline = {
    ...publication,
    'style-src': publication['style-src'].filter(
      (value) => value !== "'unsafe-inline'",
    ),
  };
  const replacement = `export const FOLIATE_PUBLICATION_CSP = ${JSON.stringify(serialize(withoutInline))};`;
  const bootstrapPath = `${target}/reader/bootstrap.js`;
  const bootstrap = await readFile(bootstrapPath, 'utf8');
  if (bootstrap.split(original).length !== 2)
    throw new Error('Expected exactly one exported publication policy');
  await writeFile(bootstrapPath, bootstrap.replace(original, replacement));
  console.log(
    `Differential runtime: only publication style-src changed in ${target}`,
  );
}
