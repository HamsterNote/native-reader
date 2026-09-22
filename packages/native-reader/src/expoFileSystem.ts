import * as FileSystem from 'expo-file-system/legacy';

import type { NativeSession } from './nativeSession';

// 公开声明不应泄漏仅用于构建的 core 包；打包时会把对应 runtime vendoring
// 到发布产物中，因此这里显式描述适配器协议。
type CoreFileSystem = {
  file: string | null;
  progress: number;
  downloading: boolean;
  size: number;
  error: string | null;
  success: boolean;
  documentDirectory: string | null;
  cacheDirectory: string | null;
  bundleDirectory: string | null;
  readAsStringAsync: (
    fileUri: string,
    options?: { encoding?: 'utf8' | 'base64' },
  ) => Promise<string>;
  writeAsStringAsync: (
    fileUri: string,
    contents: string,
    options?: { encoding?: 'utf8' | 'base64' },
  ) => Promise<void>;
  deleteAsync: (fileUri: string) => Promise<void>;
  downloadFile: (
    fromUrl: string,
    toFile: string,
  ) => Promise<{ uri: string | null; mimeType: string | null }>;
  getFileInfo: (fileUri: string) => Promise<{
    uri: string;
    exists: boolean;
    isDirectory: boolean;
    size: number | undefined;
  }>;
};

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
