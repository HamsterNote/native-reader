import * as FileSystem from 'expo-file-system/legacy';

const ownedPrefix = 'native-reader-';
let copySequence = 0;

function sourceHash(uri: string): string {
  let hash = 2166136261;
  for (let index = 0; index < uri.length; index += 1) {
    hash ^= uri.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export async function prepareNativeSource(uri: string): Promise<{
  uri: string;
  sessionRoot?: string;
  cleanup(): Promise<void>;
}> {
  if (!FileSystem.cacheDirectory)
    throw new Error('Cache directory unavailable');

  copySequence += 1;
  const sessionRoot = `${FileSystem.cacheDirectory}${ownedPrefix}${sourceHash(uri)}-${copySequence}/`;
  const target = `${sessionRoot}publication.epub`;
  try {
    await FileSystem.makeDirectoryAsync(sessionRoot, { intermediates: true });
    await FileSystem.copyAsync({ from: uri, to: target });
    const contents = await FileSystem.readAsStringAsync(target, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!contents) throw new Error('The EPUB file is empty');
    return {
      uri: contents,
      sessionRoot,
      cleanup: () =>
        FileSystem.deleteAsync(sessionRoot, { idempotent: true }).catch(
          () => undefined,
        ),
    };
  } catch (error) {
    await FileSystem.deleteAsync(sessionRoot, { idempotent: true }).catch(
      () => undefined,
    );
    throw error;
  }
}
