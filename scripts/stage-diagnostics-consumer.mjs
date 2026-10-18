import { copyFile } from 'node:fs/promises';

// Share the Expo bootstrap document, while selecting an independent public-API consumer entry.
await copyFile(
  'apps/demo/dist/index.html',
  'apps/demo/dist/diagnostics-consumer.html',
);
