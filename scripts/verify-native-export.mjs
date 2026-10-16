import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertNativeExportSources(sources, platform) {
  assert.ok(['ios', 'android'].includes(platform), 'Expected ios or android');
  assert.ok(Array.isArray(sources), 'Export source map must list sources');
  const normalized = sources.map((source) =>
    String(source).replaceAll('\\', '/'),
  );
  const required = [
    'src/index.native.ts',
    'src/NativeReader.native.tsx',
    'src/NativeReaderImplementation.native.tsx',
    'src/nativeCapability.ts',
    'src/nativeFoliateProtocol.ts',
    `secure-webview/src/HNSecureWebView.${platform}.tsx`,
    'secure-webview/src/HNSecureWebViewNativeComponent.ts',
    'secure-webview/src/NativeHNSecureWebViewModule.ts',
  ];
  for (const file of required) {
    assert.ok(
      normalized.some((source) => source.endsWith(`/native-reader/${file}`)),
      `Native export is missing ${file}`,
    );
  }
  assert.ok(
    !normalized.some((source) =>
      /\/native-reader\/src\/(?:index\.web\.ts|NativeReader\.web\.tsx|foliateWeb\.ts)$/.test(
        source,
      ),
    ),
    'Native export resolved the Web reader',
  );
}

export async function verifyNativeExport(outputRoot, platform) {
  assert.ok(['ios', 'android'].includes(platform), 'Expected ios or android');
  const metadata = JSON.parse(
    await readFile(path.join(outputRoot, 'metadata.json'), 'utf8'),
  );
  const bundle = metadata.fileMetadata?.[platform]?.bundle;
  assert.ok(
    typeof bundle === 'string' &&
      bundle.startsWith(`_expo/static/js/${platform}/`) &&
      !bundle.split('/').includes('..'),
    'Missing or invalid native bundle metadata',
  );
  const bundlePath = path.join(outputRoot, bundle);
  assert.ok((await stat(bundlePath)).size > 0, 'Native bundle is empty');
  const map = JSON.parse(await readFile(`${bundlePath}.map`, 'utf8'));
  assertNativeExportSources(map.sources, platform);
  console.log(
    `${platform} export includes the native reader and secure host (build evidence only).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [platform, outputRoot] = process.argv.slice(2);
  assert.ok(
    outputRoot,
    'Usage: verify-native-export.mjs <ios|android> <export-root>',
  );
  await verifyNativeExport(outputRoot, platform);
}
