import {
  getWebViewNativeHostSource,
  resolveWebViewSource,
  secureNativeHostProps,
  selectNativeWebViewComponent,
} from './HNSecureWebViewTypes';

describe('HNSecureWebView native host source', () => {
  test('accepts only the closed Foliate selector and never resolves it as an asset', () => {
    const resolveAssetSource = jest.fn();

    const resolved = resolveWebViewSource(
      { nativeHost: 'foliate' },
      resolveAssetSource,
    );

    expect(resolveAssetSource).not.toHaveBeenCalled();
    expect(resolved).toEqual({
      nativeHostSource: { nativeHost: 'foliate' },
      sourceResolved: { nativeHost: 'foliate' },
      newSource: { nativeHost: 'foliate' },
    });
  });

  test.each([
    { nativeHost: 'unknown' },
    { nativeHost: 'foliate', uri: 'file:///private/publication.epub' },
    { nativeHost: 'foliate', html: '<p>publication</p>' },
    { nativeHost: 'foliate', headers: { Authorization: 'secret' } },
    { nativeHost: 'foliate', body: 'publication' },
    { nativeHost: 'foliate', path: '/private/publication.epub' },
    { nativeHost: 'foliate', platform: 'ios' },
  ])('rejects unknown or mixed native selector %#', (source) => {
    expect(() => getWebViewNativeHostSource(source)).toThrow(
      /native host selector|unknown native host/i,
    );
  });

  test('native configuration cannot introduce a second source selector', () => {
    const nativeConfigProps = {
      source: { uri: 'file:///private/ios-publication.epub' },
      newSource: { uri: 'file:///private/ios-publication.epub' },
      nativeHost: 'none',
      testID: 'custom-webview',
    };

    expect(secureNativeHostProps(nativeConfigProps)).toEqual({
      testID: 'custom-webview',
    });
  });

  test('the host selector ignores nativeConfig.component on Android and iOS', () => {
    const callerComponent = { displayName: 'UnreviewedWebView' };

    expect(
      selectNativeWebViewComponent(callerComponent, { nativeHost: 'foliate' }),
    ).toBeUndefined();
    expect(selectNativeWebViewComponent(callerComponent, undefined)).toBe(
      callerComponent,
    );
  });

  test('ordinary nativeConfig retains non-selector props while selectors are stripped', () => {
    expect(
      secureNativeHostProps({
        source: { uri: 'https://second-selector.example' },
        newSource: { html: '<p>second selector</p>' },
        nativeHost: 'foliate',
        testID: 'ordinary-webview',
      }),
    ).toEqual({ testID: 'ordinary-webview' });
  });

  test('ordinary URI and HTML sources retain upstream conversion behavior', () => {
    const resolveAssetSource = jest.fn((source) => source);

    expect(
      resolveWebViewSource(
        {
          uri: 'https://reader.example/publication',
          headers: { Authorization: 'Bearer token' },
        },
        resolveAssetSource,
      ),
    ).toEqual({
      nativeHostSource: undefined,
      sourceResolved: {
        uri: 'https://reader.example/publication',
        headers: { Authorization: 'Bearer token' },
      },
      newSource: {
        uri: 'https://reader.example/publication',
        headers: [{ name: 'Authorization', value: 'Bearer token' }],
      },
    });
    expect(
      resolveWebViewSource({ html: '<main>reader</main>' }, resolveAssetSource),
    ).toEqual({
      nativeHostSource: undefined,
      sourceResolved: { html: '<main>reader</main>' },
      newSource: { html: '<main>reader</main>' },
    });
  });

  test('the sentinel contains no platform URL fields', () => {
    const selector = getWebViewNativeHostSource({ nativeHost: 'foliate' });

    expect(selector).toEqual({ nativeHost: 'foliate' });
    expect(JSON.stringify(selector)).not.toMatch(/uri|path|platform|file:/i);
  });
});
