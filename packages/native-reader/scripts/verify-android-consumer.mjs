import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = path.join(packageRoot, 'consumer-fixtures', 'rn-android');

const sha256File = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');

const packageManagerCommand = (command) =>
  process.platform === 'win32' ? `${command}.cmd` : command;

const assertArtifactDigest = async (artifact, release, label) => {
  const actual = await sha256File(artifact);
  if (actual !== release.tarballSha256) {
    throw new Error(
      `RN Android fixture tarball changed ${label}: expected ${release.tarballSha256}, received ${actual}`,
    );
  }
};

const tarHeaderString = (header, start, end) =>
  header.subarray(start, end).toString('utf8').replace(/\0.*$/, '');

const verifyTarballEntries = async (artifact, release) => {
  await assertArtifactDigest(artifact, release, 'before unpack validation');
  const archive = gunzipSync(await readFile(artifact));
  let offset = 0;
  let entries = 0;
  while (offset < archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.length !== 512) {
      throw new Error(
        'RN Android fixture tarball ends in a partial tar header',
      );
    }
    if (header.every((byte) => byte === 0)) break;
    const name = tarHeaderString(header, 0, 100);
    const prefix = tarHeaderString(header, 345, 500);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const encodedSize = tarHeaderString(header, 124, 136).trim();
    const type = String.fromCharCode(header[156] || 0);
    if (
      !entryName.startsWith('package/') ||
      entryName.includes('\\') ||
      path.posix.isAbsolute(entryName) ||
      entryName
        .split('/')
        .some((segment) => segment === '..' || segment === '') ||
      !/^[0-7]*$/.test(encodedSize) ||
      (type !== '\0' && type !== '0' && type !== '5')
    ) {
      throw new Error(
        `RN Android fixture tarball has an unsafe entry: ${entryName}`,
      );
    }
    const size = Number.parseInt(encodedSize || '0', 8);
    const paddedSize = Math.ceil(size / 512) * 512;
    if (
      offset + 512 + paddedSize > archive.length ||
      (type === '5' && size !== 0)
    ) {
      throw new Error(
        `RN Android fixture tarball has a truncated entry: ${entryName}`,
      );
    }
    entries += 1;
    offset += 512 + paddedSize;
  }
  if (entries === 0)
    throw new Error('RN Android fixture tarball has no entries');
};

const run = (command, args, cwd, env = process.env) => {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
};

const requireDirectory = async (candidate, name) => {
  try {
    if ((await lstat(candidate)).isDirectory()) return candidate;
  } catch {
    // Fall through to a diagnostic that includes the selected path.
  }
  throw new Error(
    `${name} is required for the Android consumer build: ${candidate}`,
  );
};

const androidBuildEnvironment = async () => {
  const javaHome = await requireDirectory(
    process.env.JAVA_HOME || path.join(os.homedir(), 'tools', 'jdk-17'),
    'JAVA_HOME',
  );
  const androidHome = await requireDirectory(
    process.env.ANDROID_HOME ||
      process.env.ANDROID_SDK_ROOT ||
      path.join(os.homedir(), 'Android', 'Sdk'),
    'ANDROID_HOME',
  );
  await requireDirectory(
    path.join(androidHome, 'platforms', 'android-36'),
    'Android SDK platform android-36',
  );
  await requireDirectory(
    path.join(androidHome, 'ndk', '27.1.12297006'),
    'Android NDK 27.1.12297006',
  );
  const java = path.join(javaHome, 'bin', 'java');
  try {
    execFileSync(java, ['-version'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(
      `JAVA_HOME does not provide an executable Java 17 runtime: ${java}`,
      { cause: error },
    );
  }
  return {
    ...process.env,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    JAVA_HOME: javaHome,
    PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
  };
};

const assertIdentity = async (filePath, label) => {
  const source = await readFile(filePath, 'utf8');
  if (!source.includes('HNSecureWebView')) {
    throw new Error(
      `${label} did not contain the HNSecureWebView identity: ${filePath}`,
    );
  }
};

const assertApkContainsIdentity = (apk) => {
  const entries = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry.endsWith('.dex') || entry.endsWith('.so'));
  const payload = Buffer.concat(
    entries.map((entry) =>
      // APK DEX payloads exceed execFileSync's default 1 MiB buffer.
      execFileSync('unzip', ['-p', apk, entry], {
        maxBuffer: 128 * 1024 * 1024,
      }),
    ),
  ).toString('latin1');
  if (!payload.includes('HNSecureWebView')) {
    throw new Error(
      `Debug APK does not contain the HNSecureWebView identity: ${apk}`,
    );
  }
};

export async function verifyAndroidConsumer(release, parentTemporaryRoot) {
  const root = await mkdtemp(
    path.join(parentTemporaryRoot, 'rn-android-consumer-'),
  );
  try {
    await cp(fixtureRoot, root, { recursive: true });
    const lockfile = path.join(root, 'package-lock.json');
    const lockBefore = await sha256File(lockfile);
    run(packageManagerCommand('npm'), ['ci', '--ignore-scripts'], root);
    if ((await sha256File(lockfile)) !== lockBefore) {
      throw new Error(
        'RN Android fixture npm ci modified the versioned package-lock.json',
      );
    }

    // The unique packIsolatedRelease result remains the only package source.
    const artifact = path.join(
      root,
      `native-reader-${release.tarballSha256}.tgz`,
    );
    await cp(release.tarball, artifact);
    await assertArtifactDigest(artifact, release, 'after copy');
    // 在 npm 首次读取 archive 前检查 tar 原始 header；拒绝链接、特殊条目与路径穿越。
    await verifyTarballEntries(artifact, release);
    run(
      packageManagerCommand('npm'),
      [
        'install',
        '--no-save',
        '--package-lock=false',
        '--ignore-scripts',
        `@hamster-note/native-reader@file:${artifact}`,
      ],
      root,
    );
    await assertArtifactDigest(artifact, release, 'after installation');
    if ((await sha256File(lockfile)) !== lockBefore) {
      throw new Error(
        'RN Android fixture lockfile changed during no-save tarball installation',
      );
    }
    // RN CLI discovers Android libraries from package.json, while npm correctly
    // leaves a --no-save artifact out of that manifest. This isolated runtime
    // copy points CLI at the exact SHA-named artifact without changing a lock.
    const consumerManifestPath = path.join(root, 'package.json');
    const consumerManifest = JSON.parse(
      await readFile(consumerManifestPath, 'utf8'),
    );
    consumerManifest.dependencies['@hamster-note/native-reader'] =
      `file:${artifact}`;
    await writeFile(
      consumerManifestPath,
      `${JSON.stringify(consumerManifest, null, 2)}\n`,
    );
    if ((await sha256File(lockfile)) !== lockBefore) {
      throw new Error(
        'RN Android fixture lockfile changed after transient autolinking declaration',
      );
    }
    const installedManifest = JSON.parse(
      await readFile(
        path.join(
          root,
          'node_modules/@hamster-note/native-reader/package.json',
        ),
        'utf8',
      ),
    );
    if (installedManifest.name !== '@hamster-note/native-reader') {
      throw new Error(
        'RN Android consumer did not install the final native-reader tarball',
      );
    }
    await assertArtifactDigest(
      artifact,
      release,
      'before Android native build',
    );

    const environment = await androidBuildEnvironment();
    run(
      process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
      [
        ':app:assembleDebug',
        '-PnewArchEnabled=true',
        '-PreactNativeArchitectures=x86_64',
      ],
      path.join(root, 'android'),
      environment,
    );
    const androidRoot = path.join(root, 'android');
    const apk = path.join(
      androidRoot,
      'app/build/outputs/apk/debug/app-debug.apk',
    );
    try {
      if (!(await lstat(apk)).isFile()) throw new Error('not a file');
    } catch {
      throw new Error(
        `RN Android assembleDebug did not produce an APK: ${apk}`,
      );
    }
    await assertIdentity(
      path.join(androidRoot, 'build/generated/autolinking/autolinking.json'),
      'Autolinking configuration',
    );
    await assertIdentity(
      path.join(
        androidRoot,
        'app/build/generated/autolinking/src/main/jni/autolinking.cpp',
      ),
      'Android Codegen autolinking source',
    );
    assertApkContainsIdentity(apk);
    console.log(
      `[android] final tarball Android new-architecture consumer passed: ${apk}`,
    );
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}
