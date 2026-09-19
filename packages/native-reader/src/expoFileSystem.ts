import * as FileSystem from 'expo-file-system/legacy';

import type { ReaderProps } from '@epubjs-react-native/core';

import type { NativeSession } from './nativeSession';

type CoreFileSystem = ReturnType<ReaderProps['fileSystem']>;

export function createExpoFileSystem(
  sessionRoot: string,
  session?: NativeSession,
) {
  const scripts = new Map<string, string>();
  const tracked = <T>(operation: () => Promise<T>) =>
    session ? session.run(operation) : operation();
  return function useSessionFileSystem(): CoreFileSystem {
    return {
      file: null,
      progress: 0,
      downloading: false,
      size: 0,
      error: null,
      success: false,
      documentDirectory: sessionRoot.replace(/\/$/, ''),
      cacheDirectory: FileSystem.cacheDirectory,
      bundleDirectory: FileSystem.bundleDirectory,
      readAsStringAsync: (uri, options) =>
        tracked(() => FileSystem.readAsStringAsync(uri, options)),
      writeAsStringAsync: (uri, contents, options) => {
        if (/\/(?:jszip|epub)\.min\.js$/.test(uri)) {
          scripts.set(uri, contents);
          return Promise.resolve();
        }
        const securedContents = uri.endsWith('/index.html')
          ? contents.replace(
              /<script src="([^"]+)"><\/script>/g,
              (tag, scriptUri: string) => {
                const script = scripts.get(scriptUri);
                return script
                  ? `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`
                  : tag;
              },
            )
          : contents;
        return tracked(() =>
          FileSystem.writeAsStringAsync(uri, securedContents, options),
        );
      },
      deleteAsync: (uri) =>
        tracked(() => FileSystem.deleteAsync(uri, { idempotent: true })),
      downloadFile: async () => {
        throw new Error('Remote EPUB downloads are disabled.');
      },
      getFileInfo: async (uri) => {
        const info = await tracked(() => FileSystem.getInfoAsync(uri));
        return {
          uri: info.uri,
          exists: info.exists,
          isDirectory: info.exists ? info.isDirectory : false,
          size: info.exists ? info.size : undefined,
        };
      },
    };
  };
}
