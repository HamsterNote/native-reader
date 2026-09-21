import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packIsolatedRelease, RELEASE_VERSION } from './isolated-release.mjs';
import {
  findForbiddenTarballFiles,
  REQUIRED_TARBALL_FILES,
  verifyStaticNativePropagation,
} from './verify-static-native-propagation.mjs';
import { verifyAndroidConsumer } from './verify-android-consumer.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, '../..');

const packageManagerCommand = (command) =>
  process.platform === 'win32' ? `${command}.cmd` : command;

const run = (command, args, cwd) => {
  console.log(`> ${command} ${args.join(' ')}`);
  // 安装器与编译器可能产生大量正常输出。直接流向父进程可避免
  // execFileSync 默认缓冲区导致 ENOBUFS，同时仍由异常保留退出码检查。
  execFileSync(command, args, { cwd, stdio: 'inherit' });
};

const digestTree = async (root) => {
  const digest = createHash('sha256');
  const visit = async (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    let entry;
    try {
      entry = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT' && !relativePath) {
        digest.update('missing\0');
        return;
      }
      throw error;
    }
    if (entry.isSymbolicLink()) {
      digest.update(`link\0${relativePath}\0${await readlink(absolutePath)}\0`);
      return;
    }
    if (entry.isDirectory()) {
      digest.update(`directory\0${relativePath}\0`);
      const children = (await readdir(absolutePath)).sort();
      for (const child of children) {
        await visit(relativePath ? path.join(relativePath, child) : child);
      }
      return;
    }
    digest.update(`file\0${relativePath}\0`);
    digest.update(await readFile(absolutePath));
    digest.update('\0');
  };
  await visit('');
  return digest.digest('hex');
};

const snapshotWorkspaceReleaseInputs = async () => ({
  manifest: await digestTree(path.join(packageRoot, 'package.json')),
  lib: await digestTree(path.join(packageRoot, 'lib')),
});

const assertWorkspaceReleaseInputsUnchanged = async (before) => {
  const after = await snapshotWorkspaceReleaseInputs();
  if (before.manifest !== after.manifest || before.lib !== after.lib) {
    throw new Error(
      'Packed verification mutated the workspace package.json or lib tree',
    );
  }
  console.log(
    '[pack] workspace package.json and lib digests are unchanged after isolated staging',
  );
};

const listSourceTarballs = async () => {
  try {
    const entries = await readdir(packageRoot);
    return entries.filter((entry) => entry.endsWith('.tgz')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
};

const verifySourcePackRefusal = async () => {
  const tarballsBefore = await listSourceTarballs();
  const sourceManifest = JSON.parse(
    await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  // P1-5：源码根 manifest 必须是 source-only 的无 version 清单。发布 version
  // 只能由 isolated-release.mjs 注入隔离 staging，因此 exact no-script 命令
  // （npm pack --ignore-scripts --dry-run --json）必须在源码根被 npm 自身的
  // version 校验拒绝，而不能靠 --ignore-scripts 绕过 prepack 成功产出 tarball。
  if (sourceManifest.version !== undefined) {
    throw new Error(
      'Source manifest must not declare a version; release versions are injected only into isolated staging',
    );
  }
  // 即使未来有人把 version 加回源清单，prepack 仍必须是源码根的第二道门禁。
  if (
    sourceManifest.scripts?.prepack !==
    'node scripts/release-lifecycle.mjs refuse-source-pack'
  ) {
    throw new Error(
      'Source manifest must retain the source-root prepack refusal gate',
    );
  }
  let packError;
  try {
    // exact 验收命令：不带任何额外参数（也不使用 --pack-destination），确保
    // 失败只能由源码根 manifest 本身造成。
    execFileSync(
      packageManagerCommand('npm'),
      ['pack', '--ignore-scripts', '--dry-run', '--json'],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    packError = error;
  }
  if (!packError) {
    throw new Error(
      'Source-root npm pack --ignore-scripts --dry-run --json unexpectedly succeeded',
    );
  }
  const output = `${packError?.stdout ?? ''}\n${packError?.stderr ?? ''}`;
  if (!output.includes('must have name and version')) {
    throw new Error(
      `Source-root npm pack --ignore-scripts --dry-run --json failed for an unexpected reason: ${output.trim()}`,
      { cause: packError },
    );
  }
  const tarballsAfter = await listSourceTarballs();
  if (tarballsAfter.join('\0') !== tarballsBefore.join('\0')) {
    throw new Error(
      'Source-root npm pack --ignore-scripts --dry-run left a tarball in the source tree',
    );
  }
  console.log(
    '[pack] source-root npm pack --ignore-scripts --dry-run --json refused (missing version) without creating a tarball',
  );
};

const sha256File = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');

const assertArtifactDigest = async (artifact, release, label) => {
  const actual = await sha256File(artifact);
  if (actual !== release.tarballSha256) {
    throw new Error(
      `Consumer artifact digest changed ${label}: expected ${release.tarballSha256}, received ${actual}`,
    );
  }
  console.log(
    `[pack] consumer artifact SHA-256 verified ${label}: ${path.basename(artifact)}`,
  );
};

// final tarball 的 SHA-256 由 packIsolatedRelease 计算并返回。consumer 流程在
// 任何使用之前以及每次 consumer 安装前后都必须复核它；一旦不一致就 fail
// closed，避免重新 pack、从 staging 安装或使用被替换的 tarball。
const assertReleaseTarballDigest = async (release, label) => {
  const expected = release?.tarballSha256;
  if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(
      'Isolated release did not return a valid final tarball SHA-256',
    );
  }
  const actual = await sha256File(release.tarball);
  if (actual !== expected) {
    throw new Error(
      `Release tarball digest changed ${label}: expected ${expected}, received ${actual}`,
    );
  }
  console.log(
    `[pack] final release tarball SHA-256 verified ${label}: ${expected}`,
  );
};

const artifactFilename = (release) =>
  `native-reader-${release.tarballSha256}.tgz`;

// 固定 fixture 只保存第三方依赖。验证时把最终 tarball 复制为 SHA 命名文件，并在
// 临时 manifest/lockfile 中以相对 file: 定位符声明，避免任何 staging 路径泄露。
const copyVerifiedTarballArtifact = async (consumerRoot, release, label) => {
  const artifact = path.join(consumerRoot, artifactFilename(release));
  await cp(release.tarball, artifact);
  await assertArtifactDigest(artifact, release, label);
  return artifact;
};

const tarHeaderString = (header, start, end) =>
  header.subarray(start, end).toString('utf8').replace(/\0.*$/, '');

const tarEntrySize = (header) => {
  const encoded = tarHeaderString(header, 124, 136).trim();
  if (!/^[0-7]*$/.test(encoded)) {
    throw new Error('Verified tarball has an invalid tar entry size');
  }
  return Number.parseInt(encoded || '0', 8);
};

const assertSafeTarEntryPath = (entryName) => {
  if (
    !entryName.startsWith('package/') ||
    entryName.includes('\\') ||
    path.posix.isAbsolute(entryName) ||
    entryName.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error(
      `Verified tarball contains an unsafe or non-package entry: ${entryName}`,
    );
  }
};

// 仅接受 npm pack 的普通文件与目录条目。这里先解析原始 tar header，再解包，避免
// 外部 tar 在不同平台对链接、PAX 或路径穿越有不同默认行为。
const extractVerifiedTarball = async (artifact, extractionRoot, release) => {
  await assertArtifactDigest(
    artifact,
    release,
    'before verified tarball unpack',
  );
  const archive = gunzipSync(await readFile(artifact));
  let offset = 0;
  let entries = 0;
  while (offset < archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.length !== 512) {
      throw new Error('Verified tarball ends in a partial tar header');
    }
    if (header.every((byte) => byte === 0)) break;
    const name = tarHeaderString(header, 0, 100);
    const prefix = tarHeaderString(header, 345, 500);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 0);
    const size = tarEntrySize(header);
    const payloadStart = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;
    if (!entryName || payloadStart + paddedSize > archive.length) {
      throw new Error('Verified tarball has a truncated or unnamed tar entry');
    }
    assertSafeTarEntryPath(entryName);
    if (type !== '\0' && type !== '0' && type !== '5') {
      throw new Error(
        `Verified tarball contains unsupported tar entry type ${JSON.stringify(type)}: ${entryName}`,
      );
    }
    if (type === '5' && size !== 0) {
      throw new Error(
        `Verified tarball directory has payload data: ${entryName}`,
      );
    }
    const destination = path.resolve(extractionRoot, entryName);
    const relativeDestination = path.relative(extractionRoot, destination);
    if (
      relativeDestination === '' ||
      relativeDestination === '..' ||
      relativeDestination.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeDestination)
    ) {
      throw new Error(
        `Verified tarball entry escapes extraction root: ${entryName}`,
      );
    }
    if (type === '5') {
      await mkdir(destination, { recursive: true });
    } else {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(
        destination,
        archive.subarray(payloadStart, payloadStart + size),
      );
    }
    entries += 1;
    offset = payloadStart + paddedSize;
  }
  if (entries === 0) throw new Error('Verified tarball contains no entries');
  await assertArtifactDigest(
    artifact,
    release,
    'after verified tarball unpack',
  );
};

const assertPublishedManifestMatchesFixtureContract = async (
  consumerRoot,
  installedPackageRoot,
) => {
  const fixtureManifest = JSON.parse(
    await readFile(path.join(consumerRoot, 'package.json'), 'utf8'),
  );
  const contract = fixtureManifest.nativeReaderConsumerContract;
  if (!contract?.dependencies || !contract?.peerDependencies) {
    throw new Error(
      'Consumer fixture must contain a nativeReaderConsumerContract',
    );
  }
  const installedManifest = JSON.parse(
    await readFile(path.join(installedPackageRoot, 'package.json'), 'utf8'),
  );
  assert.deepEqual(
    installedManifest.dependencies,
    contract.dependencies,
    'Published dependency contract does not match the versioned consumer fixture',
  );
  assert.deepEqual(
    installedManifest.peerDependencies,
    contract.peerDependencies,
    'Published peer dependency contract does not match the versioned consumer fixture',
  );
};

const assertInstalledPackageMatchesArtifact = async (
  consumerRoot,
  installedPackageRoot,
  artifact,
  release,
) => {
  const extractionRoot = path.join(consumerRoot, 'verified-tarball');
  await mkdir(extractionRoot, { recursive: true });
  await extractVerifiedTarball(artifact, extractionRoot, release);
  const expected = await digestTree(path.join(extractionRoot, 'package'));
  // pnpm 将直接依赖链接到虚拟 store；比较实际包目录而不是链接文本，才能保持
  // 与 npm consumer 相同的“安装树等于 tarball”验证意图。
  const installed = await digestTree(await realpath(installedPackageRoot));
  if (expected !== installed) {
    throw new Error(
      'Installed @hamster-note/native-reader tree does not exactly match the verified final tarball',
    );
  }
};

// P1-5：final tarball 必须携带明确 release version，不能因为源清单无 version
// 而丢失。安装树与 tarball 解包结果逐字节一致（上面已断言），因此安装清单的
// version 即 tarball 内 package.json 的 version。
const assertPublishedManifestVersion = async (installedPackageRoot) => {
  const installedManifest = JSON.parse(
    await readFile(path.join(installedPackageRoot, 'package.json'), 'utf8'),
  );
  if (installedManifest.version !== RELEASE_VERSION) {
    throw new Error(
      `Published tarball version must be ${RELEASE_VERSION}, received ${installedManifest.version}`,
    );
  }
  console.log(`[pack] published tarball version verified: ${RELEASE_VERSION}`);
};

const probeCommand = (command, args) => {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: output.trim() };
  } catch (error) {
    return {
      ok: false,
      output: `${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim(),
      code: error?.status ?? error?.code ?? 'unknown',
    };
  }
};

// Linux 的常规 package gate 只能覆盖发布物的静态结构，不能声称 iOS 原生
// consumer 已通过验证。发布前的 macOS gate 通过 REQUIRE_IOS_CONSUMER=1
// 启用：工具链不可用时必须失败，而不是把跳过误报为通过。
const requireIosTarballConsumer = process.env.REQUIRE_IOS_CONSUMER === '1';

const iosToolchainUnavailableReason = (pod, xcodebuild) =>
  [
    !pod.ok && `pod --version (exit=${pod.code}): ${pod.output || 'no output'}`,
    !xcodebuild.ok &&
      `xcodebuild -version (exit=${xcodebuild.code}): ${xcodebuild.output || 'no output'}`,
  ]
    .filter(Boolean)
    .join('\n') || `platform=${process.platform} (requires darwin)`;

// 尽早拒绝错误的发布执行环境，避免 Linux release job 在完成所有耗时的
// tarball/Android consumer 检查后才发现 iOS 证据从未产生。
if (requireIosTarballConsumer) {
  const pod = probeCommand('pod', ['--version']);
  const xcodebuild = probeCommand('xcodebuild', ['-version']);
  if (process.platform !== 'darwin' || !pod.ok || !xcodebuild.ok) {
    throw new Error(
      `[ios] REQUIRE_IOS_CONSUMER=1 requires a macOS host with CocoaPods and Xcode to verify the final tarball consumer; native validation is unavailable:\n${iosToolchainUnavailableReason(pod, xcodebuild)}`,
    );
  }
}

// macOS 上 os.tmpdir() 位于 /var/...，其真实路径是 /private/var/...（符号
// 链接）。创建后立即做 realpath 规范化，确保后续由 temporaryRoot 派生的所有
// consumer 绝对路径（例如 verifyIosTarballConsumer 中与 React Native CLI 解析
// 出的 podspecPath 直接比较的路径）具有一致的真实前缀，避免 /var 与
// /private/var 失配造成误判。
const temporaryRoot = await realpath(
  await mkdtemp(path.join(os.tmpdir(), 'native-reader-package-')),
);

const verifyIosTarballConsumer = async (consumerRoot, installedPackageRoot) => {
  const podspec = path.join(installedPackageRoot, 'HNSecureWebView.podspec');
  const autolink = path.join(installedPackageRoot, 'react-native.config.js');
  // Do not allow a packaging-only check to hide an unavailable Apple toolchain.
  // The raw probe output identifies exactly what a macOS validation host must run.
  const pod = probeCommand('pod', ['--version']);
  const xcodebuild = probeCommand('xcodebuild', ['-version']);
  if (process.platform !== 'darwin' || !pod.ok || !xcodebuild.ok) {
    const unavailableReason = iosToolchainUnavailableReason(pod, xcodebuild);
    if (requireIosTarballConsumer) {
      throw new Error(
        `[ios] REQUIRE_IOS_CONSUMER=1 requires a macOS host with CocoaPods and Xcode to verify the final tarball consumer; native validation is unavailable:\n${unavailableReason}`,
      );
    }
    console.log(
      `[ios] tarball consumer source verified (${podspec}, ${autolink}); native build NOT verified and this result is not release evidence. Before release, run pnpm run test:package:ios on macOS with CocoaPods and Xcode:\n${unavailableReason}`,
    );
    return;
  }
  const iosRoot = path.join(consumerRoot, 'ios');
  const schema = path.join(iosRoot, 'HNSecureWebViewSpec-schema.json');
  const codegenOutput = path.join(iosRoot, 'generated');
  const config = JSON.parse(
    execFileSync('node_modules/.bin/react-native', ['config'], {
      cwd: consumerRoot,
      encoding: 'utf8',
    }),
  );
  const dependency = config.dependencies?.['@hamster-note/native-reader'];
  if (dependency?.platforms?.ios?.podspecPath !== podspec) {
    throw new Error('iOS autolink did not expose the HNSecureWebView podspec');
  }
  run(
    'node',
    [
      'node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js',
      '--platform',
      'ios',
      schema,
      path.join(installedPackageRoot, 'secure-webview/src'),
    ],
    consumerRoot,
  );
  run(
    'node',
    [
      'node_modules/react-native/scripts/generate-specs-cli.js',
      '--platform',
      'ios',
      '--schemaPath',
      schema,
      '--outputDir',
      codegenOutput,
      '--libraryName',
      'HNSecureWebViewSpec',
      '--libraryType',
      'all',
    ],
    consumerRoot,
  );
  const generatedSpec = await readFile(
    path.join(codegenOutput, 'HNSecureWebViewSpec/HNSecureWebViewSpec.h'),
    'utf8',
  );
  if (
    !generatedSpec.includes('HNSecureWebView') ||
    generatedSpec.includes('RNCWebView')
  ) {
    throw new Error(
      'iOS Codegen did not exclusively generate the HNSecureWebView spec',
    );
  }
  await cp(
    path.join(
      installedPackageRoot,
      'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m',
    ),
    path.join(
      iosRoot,
      'HNSecureConsumerTests/HNSecureWebViewDecisionManagerTests.m',
    ),
  );
  run('ruby', ['create-project.rb'], iosRoot);
  run('pod', ['install', '--project-directory=ios'], consumerRoot);
  const podsProject = path.join(iosRoot, 'Pods/Pods.xcodeproj');
  run(
    'xcodebuild',
    [
      '-workspace',
      path.join(iosRoot, 'HNSecureConsumer.xcworkspace'),
      '-scheme',
      'HNSecureConsumer',
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ],
    consumerRoot,
  );
  const podsProjectText = await readFile(
    path.join(podsProject, 'project.pbxproj'),
    'utf8',
  );
  if (!podsProjectText.includes('HNSecureWebView')) {
    throw new Error(
      'iOS consumer build metadata did not reference HNSecureWebView',
    );
  }
  const podfileLock = await readFile(
    path.join(iosRoot, 'Podfile.lock'),
    'utf8',
  );
  if (
    !podfileLock.includes('HNSecureWebView') ||
    !podfileLock.includes('react-native-webview')
  ) {
    throw new Error(
      'iOS consumer did not install both HNSecureWebView and official react-native-webview pods',
    );
  }
  run(
    'xcodebuild',
    [
      '-workspace',
      path.join(iosRoot, 'HNSecureConsumer.xcworkspace'),
      '-scheme',
      'HNSecureConsumer',
      '-destination',
      'platform=iOS Simulator',
      'CODE_SIGNING_ALLOWED=NO',
      'test',
    ],
    consumerRoot,
  );
  console.log(
    `[ios] tarball consumer Codegen, CocoaPods, and HNSecureConsumer app build passed.`,
  );
};

const writeConsumerSupport = async (consumer) => {
  await mkdir(consumer, { recursive: true });
  await mkdir(path.join(consumer, 'ios'), { recursive: true });
  // CocoaPods needs an app target to integrate autolinked native modules. The
  // xcodeproj Ruby gem is installed with CocoaPods, so this only runs in the
  // same Darwin/toolchain branch that will perform the native build.
  await writeFile(
    path.join(consumer, 'ios', 'create-project.rb'),
    "require 'xcodeproj'\nproject = Xcodeproj::Project.new(File.join(__dir__, 'HNSecureConsumer.xcodeproj'))\napp = project.new_target(:application, 'HNSecureConsumer', :ios, '15.1')\ntests = project.new_target(:unit_test_bundle, 'HNSecureConsumerTests', :ios, '15.1')\napp_group = project.main_group.new_group('HNSecureConsumer')\napp_source = app_group.new_file('HNSecureConsumer/main.m')\napp.source_build_phase.add_file_reference(app_source)\ntest_group = project.main_group.new_group('HNSecureConsumerTests')\ntest_source = test_group.new_file('HNSecureConsumerTests/HNSecureWebViewDecisionManagerTests.m')\ntests.source_build_phase.add_file_reference(test_source)\ntests.add_dependency(app)\ntests.build_configurations.each do |config|\n  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'\n  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.hamsternote.secureconsumer.tests'\n  config.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/HNSecureConsumer.app/HNSecureConsumer'\n  config.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'\n  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'\nend\napp.build_configurations.each do |config|\n  config.build_settings['INFOPLIST_FILE'] = 'HNSecureConsumer/Info.plist'\n  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.hamsternote.secureconsumer'\n  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'\nend\nproject.save\nscheme = Xcodeproj::XCScheme.new\nscheme.add_build_target(app)\n# 测试 target 必须同时进入 BuildAction（buildForTesting=YES，供 xcodebuild test 构建）\n# 和 TestAction 的 TestableReference；test_action.add_testable 只接受 testable 对象，\n# 直接传 PBXNativeTarget 会因缺少 xml_element 在保存时抛 NoMethodError。\nscheme.add_build_target(tests, false)\nscheme.add_test_target(tests)\nscheme.save_as(project.path, 'HNSecureConsumer', true)\n",
  );
  await mkdir(path.join(consumer, 'ios', 'HNSecureConsumer'), {
    recursive: true,
  });
  await mkdir(path.join(consumer, 'ios', 'HNSecureConsumerTests'), {
    recursive: true,
  });
  await writeFile(
    path.join(consumer, 'ios', 'HNSecureConsumer', 'main.m'),
    '#import <UIKit/UIKit.h>\nint main(int argc, char * argv[]) { @autoreleasepool { return UIApplicationMain(argc, argv, nil, nil); } }\n',
  );
  await writeFile(
    path.join(consumer, 'ios', 'HNSecureConsumer', 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleName</key><string>HNSecureConsumer</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundleVersion</key><string>1</string></dict></plist>\n',
  );
  await writeFile(
    path.join(consumer, 'ios', 'Podfile'),
    `platform :ios, '15.1'\nrequire_relative '../node_modules/react-native/scripts/react_native_pods'\nprepare_react_native_project!\ntarget 'HNSecureConsumer' do\n  config = use_native_modules!\n  use_react_native!(:path => config[:reactNativePath])\nend\ntarget 'HNSecureConsumerTests' do\n  inherit! :search_paths\n  pod 'HNSecureWebView', :path => '../node_modules/@hamster-note/native-reader'\nend\n`,
  );
  await writeFile(
    path.join(consumer, 'index.mts'),
    "import { NativeReader, type ReaderSource } from '@hamster-note/native-reader';\nconst source: ReaderSource = { kind: 'uri', uri: 'file:///book.epub' };\nvoid NativeReader; void source;\n",
  );
  await writeFile(
    path.join(consumer, 'index.cts'),
    "import { NativeReader, type ReaderSource } from '@hamster-note/native-reader';\nconst source: ReaderSource = { kind: 'uri', uri: 'file:///book.epub' };\nvoid NativeReader; void source;\n",
  );
  await writeFile(
    path.join(consumer, 'verify-esm.mjs'),
    "const { NativeReader } = await import('@hamster-note/native-reader');\nif (typeof NativeReader !== 'function') throw new TypeError('ESM NativeReader export is not a function');\n",
  );
  await writeFile(
    path.join(consumer, 'verify-cjs.cjs'),
    "const { NativeReader } = require('@hamster-note/native-reader');\nif (typeof NativeReader !== 'function') throw new TypeError('CJS NativeReader export is not a function');\n",
  );
  await writeFile(
    path.join(consumer, 'verify-condition.mjs'),
    `const expected = process.argv[2];
const resolved = import.meta.resolve('@hamster-note/native-reader');
if (!resolved.endsWith(expected)) {
  throw new Error(\`Expected conditional export \${expected}, resolved \${resolved}\`);
}
const { NativeReader } = await import('@hamster-note/native-reader');
if (typeof NativeReader !== 'function') {
  throw new TypeError(\`Conditional \${expected} NativeReader export is not a function\`);
}
console.log(\`Resolved and loaded conditional export: \${expected}\`);
`,
  );
  // 裸 Node 无法解析 React Native 的 Flow 源码，也没有 WebView/Gesture/Expo
  // 原生运行时。这里只替换这些平台边界；native-reader 与 bundled core
  // 的 ESM/CJS 代码仍由 Node 真实执行。
  await writeFile(
    path.join(consumer, 'runtime-stub.mjs'),
    `export const ActivityIndicator = () => null;
export const View = () => null;
export const Text = () => null;
export const Pressable = () => null;
export const StyleSheet = { create: (styles) => styles };
export const Platform = { OS: 'android' };
export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => undefined }),
};
export const I18nManager = { isRTL: false };
export const Dimensions = { get: () => ({ width: 320, height: 640 }) };
export const WebView = () => null;
export const GestureHandlerRootView = ({ children }) => children;
export const GestureDetector = ({ children }) => children;
export const TouchableWithoutFeedback = ({ children }) => children;
export const Directions = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8 };
const chain = { maxDuration: () => chain, numberOfTaps: () => chain, direction: () => chain, onStart: () => chain };
export const Gesture = { Tap: () => chain, LongPress: () => chain, Fling: () => chain, Exclusive: () => chain };
export const cacheDirectory = null;
export const bundleDirectory = null;
export const readAsStringAsync = async () => '';
export const writeAsStringAsync = async () => undefined;
export const deleteAsync = async () => undefined;
export const getInfoAsync = async (uri) => ({ uri, exists: false });
export default function createEpubStub() { return {}; }
`,
  );
  await writeFile(
    path.join(consumer, 'runtime-loader.mjs'),
    `const platformModules = new Set([
  'expo-file-system/legacy',
  'react-native',
  'react-native-gesture-handler',
  'react-native-webview',
]);
const stubUrl = new URL('./runtime-stub.mjs', import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  return platformModules.has(specifier)
    ? { shortCircuit: true, url: stubUrl }
    : nextResolve(specifier, context);
}
`,
  );
  await writeFile(
    path.join(consumer, 'register-runtime-stubs.cjs'),
    `const Module = require('node:module');
const originalLoad = Module._load;
const chain = {};
Object.assign(chain, {
  maxDuration: () => chain,
  numberOfTaps: () => chain,
  direction: () => chain,
  onStart: () => chain,
});
const component = ({ children }) => children ?? null;
const stub = {
  ActivityIndicator: component,
  View: component,
  Text: component,
  Pressable: component,
  StyleSheet: { create: (styles) => styles },
  Platform: { OS: 'android' },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: () => undefined }),
  },
  I18nManager: { isRTL: false },
  Dimensions: { get: () => ({ width: 320, height: 640 }) },
  WebView: component,
  GestureHandlerRootView: component,
  GestureDetector: component,
  TouchableWithoutFeedback: component,
  Directions: { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8 },
  Gesture: { Tap: () => chain, LongPress: () => chain, Fling: () => chain, Exclusive: () => chain },
  cacheDirectory: null,
  bundleDirectory: null,
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => undefined,
  deleteAsync: async () => undefined,
  getInfoAsync: async (uri) => ({ uri, exists: false }),
};
const platformModules = new Set([
  'epubjs',
  'expo-file-system/legacy',
  'react-native',
  'react-native-gesture-handler',
  'react-native-webview',
]);
Module._load = function load(request, parent, isMain) {
  return platformModules.has(request)
    ? stub
    : originalLoad.call(this, request, parent, isMain);
};
`,
  );
  await writeFile(
    path.join(consumer, 'tsconfig.base.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          jsx: 'react-jsx',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
        },
        include: ['index.mts', 'index.cts'],
      },
      null,
      2,
    )}\n`,
  );
  for (const condition of ['browser', 'react-native']) {
    await writeFile(
      path.join(consumer, `tsconfig.${condition}.json`),
      `${JSON.stringify(
        {
          extends: './tsconfig.base.json',
          compilerOptions: { customConditions: [condition] },
        },
        null,
        2,
      )}\n`,
    );
  }
  await writeFile(
    path.join(consumer, 'verify-typescript-resolution.mjs'),
    `import path from 'node:path';
import ts from 'typescript';

const condition = process.argv[2];
const expected = process.argv[3];
const containingFile = path.join(process.cwd(), 'index.mts');
const result = ts.resolveModuleName(
  '@hamster-note/native-reader',
  containingFile,
  {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    customConditions: [condition],
  },
  ts.sys,
).resolvedModule;
if (!result?.resolvedFileName.endsWith(expected)) {
  throw new Error(
    \`TypeScript condition \${condition} expected \${expected}, resolved \${result?.resolvedFileName}\`,
  );
}
console.log(\`TypeScript resolved \${condition} to \${expected}\`);
`,
  );
};

const prepareLockedConsumer = async (release, packageManager) => {
  const consumer = path.join(temporaryRoot, `${packageManager}-consumer`);
  const fixture = path.join(packageRoot, 'consumer-fixtures', packageManager);
  const lockedSource = path.join(
    temporaryRoot,
    `${packageManager}-locked-source`,
  );
  await cp(fixture, lockedSource, { recursive: true });
  const artifact = await copyVerifiedTarballArtifact(
    lockedSource,
    release,
    `before ${packageManager} locked consumer preparation`,
  );
  const manifestPath = path.join(lockedSource, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const artifactSpecifier = `file:./${path.basename(artifact)}`;
  manifest.dependencies['@hamster-note/native-reader'] = artifactSpecifier;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const lockfileName =
    packageManager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml';
  const lockfile = path.join(lockedSource, lockfileName);

  if (packageManager === 'pnpm') {
    // 锁定工作目录绝不作为 consumer 使用。先将相对 SHA artifact 定位符写进
    // pnpm lockfile，随后把它复制给全新的 consumer，由 frozen install 首次安装。
    run(
      packageManagerCommand('pnpm'),
      ['install', '--lockfile-only', '--ignore-scripts'],
      lockedSource,
    );
    const lockText = await readFile(lockfile, 'utf8');
    if (
      !lockText.includes(`specifier: ${artifactSpecifier}`) ||
      !lockText.includes(`file:${path.basename(artifact)}`)
    ) {
      throw new Error(
        'pnpm consumer lockfile must retain the SHA-named relative file: tarball dependency',
      );
    }
  }

  await assertArtifactDigest(
    artifact,
    release,
    `before ${packageManager} locked consumer copy`,
  );
  await cp(lockedSource, consumer, { recursive: true });
  const consumerArtifact = path.join(consumer, path.basename(artifact));
  await assertArtifactDigest(
    consumerArtifact,
    release,
    `before ${packageManager} first consumer install`,
  );
  await writeConsumerSupport(consumer);
  const consumerLockfile = path.join(consumer, lockfileName);
  const lockedSourceDigest = await sha256File(lockfile);
  const lockDigestBefore = await sha256File(consumerLockfile);
  if (lockDigestBefore !== lockedSourceDigest) {
    throw new Error(
      `${packageManager} consumer copy did not preserve the prepared lockfile digest`,
    );
  }
  // 在安装器首次解包前，先对该 consumer 即将使用的 artifact 做 fail-closed tar
  // 结构验证。之后的树比较会再次实际解包并复核摘要。
  await extractVerifiedTarball(
    consumerArtifact,
    path.join(consumer, 'preinstall-verified-tarball'),
    release,
  );
  if (packageManager === 'npm') {
    // npm 的 fixture lockfile 不含本次唯一的 tarball；保留 manifest 声明供 RN
    // autolink 使用，同时禁止写回版本化 lockfile。
    console.log('[npm] consumer install with manifest-declared SHA artifact');
    run(
      packageManagerCommand('npm'),
      ['install', '--ignore-scripts', '--package-lock=false'],
      consumer,
    );
  } else {
    console.log(
      '[pnpm] first consumer install: pnpm install --frozen-lockfile --ignore-scripts',
    );
    run(
      packageManagerCommand('pnpm'),
      ['install', '--frozen-lockfile', '--ignore-scripts'],
      consumer,
    );
  }
  const lockDigestAfterInstall = await sha256File(consumerLockfile);
  if (lockDigestAfterInstall !== lockDigestBefore) {
    throw new Error(
      `${packageManager} fixed fixture install modified its lockfile`,
    );
  }
  await assertArtifactDigest(
    consumerArtifact,
    release,
    `after ${packageManager} consumer install`,
  );
  await assertReleaseTarballDigest(
    release,
    `after ${packageManager} consumer install`,
  );
  const installedPackageRoot = path.join(
    consumer,
    'node_modules/@hamster-note/native-reader',
  );
  await assertInstalledPackageMatchesArtifact(
    consumer,
    installedPackageRoot,
    consumerArtifact,
    release,
  );
  await assertPublishedManifestVersion(installedPackageRoot);
  await assertPublishedManifestMatchesFixtureContract(
    consumer,
    installedPackageRoot,
  );
  return consumer;
};

const expectVerificationFailure = async (
  description,
  expectedMessage,
  runTest,
) => {
  try {
    await runTest();
  } catch (error) {
    if (!String(error?.message).includes(expectedMessage)) {
      throw new Error(
        `${description} failed for the wrong reason: ${error?.message}`,
        { cause: error },
      );
    }
    return;
  }
  throw new Error(`${description} did not fail closed`);
};

const verifyFailClosedMutations = async (consumer, installedPackageRoot) => {
  const mutationRoot = path.join(temporaryRoot, 'native-propagation-mutation');
  await cp(installedPackageRoot, mutationRoot, { recursive: true });
  const manifestPath = path.join(mutationRoot, 'SECURE_WEBVIEW_SHA256.json');
  const originalManifestText = await readFile(manifestPath, 'utf8');
  const tamperedManifest = JSON.parse(originalManifestText);
  const [firstHashedFile] = Object.keys(tamperedManifest.files);
  tamperedManifest.files[firstHashedFile] = '0'.repeat(64);
  await writeFile(
    manifestPath,
    `${JSON.stringify(tamperedManifest, null, 2)}\n`,
  );
  await expectVerificationFailure(
    'Tampered hash test',
    'SHA-256 mismatch',
    () =>
      verifyStaticNativePropagation({
        consumerRoot: consumer,
        packageRoot: mutationRoot,
        dependencyResolutionRoot: installedPackageRoot,
      }),
  );

  const identityTarget = 'secure-webview/src/NativeHNSecureWebViewModule.ts';
  const identityTargetPath = path.join(mutationRoot, identityTarget);
  const originalIdentitySource = await readFile(identityTargetPath, 'utf8');
  const identitySource = `${originalIdentitySource}\n// RNCWebView legacy identity injection\n`;
  await writeFile(identityTargetPath, identitySource);
  const identityManifest = JSON.parse(originalManifestText);
  identityManifest.files[identityTarget] = createHash('sha256')
    .update(identitySource)
    .digest('hex');
  await writeFile(
    manifestPath,
    `${JSON.stringify(identityManifest, null, 2)}\n`,
  );
  await expectVerificationFailure(
    'Legacy identity injection test',
    'Old WebView identity leaked',
    () =>
      verifyStaticNativePropagation({
        consumerRoot: consumer,
        packageRoot: mutationRoot,
        dependencyResolutionRoot: installedPackageRoot,
      }),
  );

  await writeFile(identityTargetPath, originalIdentitySource);
  const gateTarget = 'lib/commonjs/NativeReader.native.js';
  const gateTargetPath = path.join(mutationRoot, gateTarget);
  const originalGateSource = await readFile(gateTargetPath, 'utf8');
  const regressedGateSource = `${originalGateSource}\nrequire('./NativeReaderImplementation.native');\n`;
  await writeFile(gateTargetPath, regressedGateSource);
  const gateManifest = JSON.parse(originalManifestText);
  gateManifest.files[gateTarget] = createHash('sha256')
    .update(regressedGateSource)
    .digest('hex');
  await writeFile(manifestPath, `${JSON.stringify(gateManifest, null, 2)}\n`);
  await expectVerificationFailure(
    'Static implementation regression test',
    'must contain exactly one literal implementation require',
    () =>
      verifyStaticNativePropagation({
        consumerRoot: consumer,
        packageRoot: mutationRoot,
        dependencyResolutionRoot: installedPackageRoot,
      }),
  );

  const validatorTarget = 'lib/module/nativeCapability.js';
  const validatorTargetPath = path.join(mutationRoot, validatorTarget);
  const originalValidatorSource = await readFile(validatorTargetPath, 'utf8');
  const regressedValidatorSource = originalValidatorSource.replace(
    'activeRegistry.get;',
    'activeRegistry.getEnforcing;',
  );
  await writeFile(validatorTargetPath, regressedValidatorSource);
  const validatorManifest = JSON.parse(originalManifestText);
  validatorManifest.files[validatorTarget] = createHash('sha256')
    .update(regressedValidatorSource)
    .digest('hex');
  await writeFile(gateTargetPath, originalGateSource);
  await writeFile(
    manifestPath,
    `${JSON.stringify(validatorManifest, null, 2)}\n`,
  );
  await expectVerificationFailure(
    'Enforcing registry regression test',
    'must not use TurboModuleRegistry.getEnforcing',
    () =>
      verifyStaticNativePropagation({
        consumerRoot: consumer,
        packageRoot: mutationRoot,
        dependencyResolutionRoot: installedPackageRoot,
      }),
  );
  const coreIndex = 'lib/vendor/core/index.js';
  const missingCoreManifest = JSON.parse(originalManifestText);
  delete missingCoreManifest.files[coreIndex];
  await rm(path.join(mutationRoot, coreIndex));
  await writeFile(
    manifestPath,
    `${JSON.stringify(missingCoreManifest, null, 2)}\n`,
  );
  await expectVerificationFailure(
    'Missing vendored core entry regression test',
    `Required tarball expected-set file is missing: ${coreIndex}`,
    () =>
      verifyStaticNativePropagation({
        consumerRoot: consumer,
        packageRoot: mutationRoot,
        dependencyResolutionRoot: installedPackageRoot,
      }),
  );
  console.log(
    '[npm] fail-closed verifier tests (no reinstall): tampered hash, legacy identity, static gate, enforcing registry, and missing vendored core entry regressions rejected',
  );
};

const verifyConsumer = async (consumer, packageManager, testFailClosed) => {
  const installedPackageRoot = path.join(
    consumer,
    'node_modules/@hamster-note/native-reader',
  );
  console.log(
    `[${packageManager}] un-stubbed static native propagation (installed tree, no runtime loader)`,
  );
  await verifyStaticNativePropagation({
    consumerRoot: consumer,
    packageRoot: installedPackageRoot,
  });
  await verifyIosTarballConsumer(consumer, installedPackageRoot);
  if (testFailClosed) {
    await verifyFailClosedMutations(consumer, installedPackageRoot);
  }

  console.log(`[${packageManager}] TypeScript browser conditional surface`);
  run(
    'node',
    ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.browser.json'],
    consumer,
  );
  run(
    'node',
    [
      'verify-typescript-resolution.mjs',
      'browser',
      '/lib/typescript/module/src/index.web.d.ts',
    ],
    consumer,
  );
  console.log(
    `[${packageManager}] TypeScript react-native conditional surface`,
  );
  run(
    'node',
    [
      'node_modules/typescript/bin/tsc',
      '--project',
      'tsconfig.react-native.json',
    ],
    consumer,
  );
  run(
    'node',
    [
      'verify-typescript-resolution.mjs',
      'react-native',
      '/lib/typescript/commonjs/src/index.native.d.ts',
    ],
    consumer,
  );
  console.log(`[${packageManager}] real browser conditional export load`);
  run(
    'node',
    [
      '--conditions=browser',
      '--loader',
      './runtime-loader.mjs',
      'verify-condition.mjs',
      '/lib/module/index.web.js',
    ],
    consumer,
  );
  console.log(`[${packageManager}] real react-native conditional export load`);
  run(
    'node',
    [
      '--conditions=react-native',
      '--require',
      './register-runtime-stubs.cjs',
      '--loader',
      './runtime-loader.mjs',
      'verify-condition.mjs',
      '/lib/commonjs/index.native.js',
    ],
    consumer,
  );
  console.log(
    `[${packageManager}] stubbed ESM/CJS smoke (not native evidence)`,
  );
  run(
    'node',
    [
      '--require',
      './register-runtime-stubs.cjs',
      '--loader',
      './runtime-loader.mjs',
      'verify-esm.mjs',
    ],
    consumer,
  );
  run(
    'node',
    ['--require', './register-runtime-stubs.cjs', 'verify-cjs.cjs'],
    consumer,
  );
};

const workspaceReleaseInputsBefore = await snapshotWorkspaceReleaseInputs();
let verificationError;
try {
  await verifySourcePackRefusal();
  const { packed, tarball, tarballSha256 } = await packIsolatedRelease({
    stagingRoot: temporaryRoot,
    packDestination: temporaryRoot,
    packageRoot,
    workspaceRoot,
  });
  // consumer 流程唯一允许消费的发布产物。所有安装都只引用这个 tarball 的
  // 本地副本，任何一次摘要不一致都会直接失败。
  const release = { packed, tarball, tarballSha256 };
  await assertReleaseTarballDigest(release, 'before any consumer is created');
  const files = packed.files.map(({ path: file }) => file);
  for (const file of REQUIRED_TARBALL_FILES) {
    if (!files.includes(file))
      throw new Error(`Packed package is missing ${file}`);
  }
  const forbidden = findForbiddenTarballFiles(files);
  if (forbidden.length)
    throw new Error(
      `Packed package contains private files: ${forbidden.join(', ')}`,
    );

  const npmConsumer = await prepareLockedConsumer(release, 'npm');
  await verifyConsumer(npmConsumer, 'npm', true);
  // 两套 React Native 依赖树无需同时驻留；及时释放 npm consumer，避免
  // 受限 CI 临时卷在 pnpm 链接阶段触发 EDQUOT/ENOSPC。
  await rm(npmConsumer, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });

  await assertReleaseTarballDigest(
    release,
    'before the pnpm consumer is created',
  );
  const pnpmConsumer = await prepareLockedConsumer(release, 'pnpm');
  await verifyConsumer(pnpmConsumer, 'pnpm', false);
  await verifyAndroidConsumer(release, temporaryRoot);

  console.log(
    `Packed package plus npm/pnpm ESM and CJS consumers verified: ${packed.filename} (${files.length} files).`,
  );
} catch (error) {
  verificationError = error;
}

const finalizationErrors = [];
try {
  await assertWorkspaceReleaseInputsUnchanged(workspaceReleaseInputsBefore);
} catch (error) {
  finalizationErrors.push(error);
}
try {
  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
} catch (error) {
  finalizationErrors.push(error);
}
if (verificationError) finalizationErrors.unshift(verificationError);
if (finalizationErrors.length === 1) throw finalizationErrors[0];
if (finalizationErrors.length > 1) {
  throw new AggregateError(
    finalizationErrors,
    'Packed package verification and finalization failed',
  );
}
