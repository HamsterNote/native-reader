import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNativeExportSources } from './verify-native-export.mjs';

for (const platform of ['ios', 'android']) {
  test(`${platform} export rejects Web fallback and missing private native host`, () => {
    const root = '/packages/native-reader/';
    const sources = [
      'src/index.native.ts',
      'src/NativeReader.native.tsx',
      'src/NativeReaderImplementation.native.tsx',
      'src/nativeCapability.ts',
      'src/nativeFoliateProtocol.ts',
      'src/NativePdfReader.native.tsx',
      `src/pdf/PdfReader.${platform}.tsx`,
      platform === 'ios' ? 'src/pdf/pdfKitHost.ts' : 'src/pdf/androidHost.ts',
      `secure-webview/src/HNSecureWebView.${platform}.tsx`,
      'secure-webview/src/HNSecureWebViewNativeComponent.ts',
      'secure-webview/src/NativeHNSecureWebViewModule.ts',
    ].map((file) => root + file);
    assert.doesNotThrow(() => assertNativeExportSources(sources, platform));
    assert.throws(
      () =>
        assertNativeExportSources(
          sources.filter(
            (source) => !source.endsWith(`PdfReader.${platform}.tsx`),
          ),
          platform,
        ),
      /PdfReader/,
    );
    assert.throws(
      () =>
        assertNativeExportSources(
          [...sources, '/node_modules/pdfjs-dist/build/pdf.mjs'],
          platform,
        ),
      /must not embed/,
    );
    // Reproduce the successful-but-Web-only native export observed in this task.
    assert.throws(
      () =>
        assertNativeExportSources(
          [root + 'src/index.web.ts', root + 'src/NativeReader.web.tsx'],
          platform,
        ),
      /missing/,
    );
    assert.throws(
      () => assertNativeExportSources(sources.slice(0, -1), platform),
      /NativeHNSecureWebViewModule/,
    );
    assert.throws(
      () =>
        assertNativeExportSources(
          [...sources, root + 'src/NativeReader.web.tsx'],
          platform,
        ),
      /Web reader/,
    );
  });
}
