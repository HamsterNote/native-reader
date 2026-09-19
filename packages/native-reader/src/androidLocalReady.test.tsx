import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const setIsLoading = jest.fn();
let renderedViewProps: Record<string, unknown> | undefined;

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
}));

jest.mock('@epubjs-react-native/core/lib/commonjs/context.js', () => {
  const ReactRuntime = jest.requireActual('react') as typeof React;
  return {
    ReaderContext: ReactRuntime.createContext({
      isLoading: false,
      setIsLoading,
    }),
    defaultTheme: {},
  };
});

jest.mock('@epubjs-react-native/core/lib/commonjs/View.js', () => ({
  View: (props: Record<string, unknown>) => {
    renderedViewProps = props;
    return null;
  },
}));

const { Reader } = jest.requireActual(
  '@epubjs-react-native/core/lib/commonjs/Reader.js',
) as {
  Reader: React.ComponentType<Record<string, unknown>>;
};

test('Android file source is read through the controlled filesystem and reaches WebView-ready state', async () => {
  const readAsStringAsync = jest.fn().mockResolvedValue('UEsDBBQAAAAA');
  const writes = new Map<string, string>();
  const writeAsStringAsync = jest.fn(async (uri: string, value: string) => {
    writes.set(uri, value);
  });
  const fileSystem = () => ({
    documentDirectory: 'file:///cache/native-reader-session',
    readAsStringAsync,
    writeAsStringAsync,
    downloadFile: jest.fn(),
    size: 0,
    progress: 0,
    success: false,
    error: null,
  });
  let renderer: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      <Reader
        fileSystem={fileSystem}
        renderLoadingFileComponent={() => null}
        src="file:///cache/native-reader-session/publication.epub"
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(readAsStringAsync).toHaveBeenCalledWith(
    'file:///cache/native-reader-session/publication.epub',
    { encoding: 'base64' },
  );
  const html = writes.get('file:///cache/native-reader-session/index.html');
  expect(html).toContain('const type = "base64";');
  expect(html).toContain('const file = "UEsDBBQAAAAA";');
  expect(html).not.toContain('publication.epub');
  expect(renderedViewProps).toMatchObject({
    allowedUris: 'file:///cache/native-reader-session',
    templateUri: 'file:///cache/native-reader-session/index.html',
  });

  act(() => renderer!.unmount());
});
