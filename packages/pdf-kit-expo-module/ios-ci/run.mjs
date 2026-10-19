import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPolicyResults } from './contract.mjs';
import { prepareConsumer } from './prepare-consumer.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const source = realpathSync(path.join(scripts, '..'));
const workspace = realpathSync(path.join(source, '../..'));
let output;
const report = {
  status: 'failed',
  scope: 'Swift compilation and policy XCTest; not device/UI acceptance',
};
const sanitize = (text) => {
  for (const [value, replacement] of [
    [output, '$OUTPUT'],
    [workspace, '$WORKSPACE'],
    [homedir(), '$HOME'],
  ])
    if (value) text = text.replaceAll(value, replacement);
  return text;
};
const inputs = [
  'ios/HamsterPdfKitModule.swift',
  'ios/HamsterPdfKitView.swift',
  'ios/PdfLocalSnapshot.swift',
  'ios/PdfPolicy.swift',
  'ios/Tests/PdfPolicyTests.swift',
];
const hashes = () =>
  Object.fromEntries(
    inputs.map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(path.join(source, file)))
        .digest('hex'),
    ]),
  );

function run(name, program, args, cwd, timeout = 60_000, quiet = false) {
  console.log(`[pdfkit] ${name}`);
  const started = Date.now();
  const result = spawnSync(program, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 128 * 1024 * 1024,
    env: {
      ...process.env,
      PDFKIT_SOURCE_ROOT: source,
      NODE_BINARY: process.execPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  report.stages ??= {};
  report.stages[name] = { seconds: (Date.now() - started) / 1000 };
  const log = sanitize(
    String(result.stdout ?? '') + String(result.stderr ?? ''),
  );
  writeFileSync(path.join(output, `${name}.log`), log);
  if (!quiet) process.stdout.write(log);
  if (result.error || result.status !== 0) {
    throw new Error(
      `${name} failed (exit ${result.status ?? result.signal ?? result.error?.code})`,
      {
        cause: result.error,
      },
    );
  }
  return result.stdout;
}

try {
  assert.equal(
    process.platform,
    'darwin',
    'PDFKit native verification requires macOS, Xcode and CocoaPods',
  );
  if (process.env.PDFKIT_IOS_OUTPUT) {
    output = path.resolve(process.env.PDFKIT_IOS_OUTPUT);
    mkdirSync(output);
  } else {
    output = mkdtempSync(path.join(tmpdir(), 'hamster-pdfkit-ios-'));
  }
  const before = hashes();
  report.sources = before;
  report.checkout = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: workspace,
    encoding: 'utf8',
  }).trim();
  report.xcode = run(
    'xcode-version',
    'xcodebuild',
    ['-version'],
    workspace,
  ).trim();
  report.cocoapods = run('pod-version', 'pod', ['--version'], workspace).trim();
  const { consumer, ios } = prepareConsumer({ output, source, workspace });
  run('create-project', 'ruby', ['create-project.rb'], ios);
  run(
    'pod-install',
    'pod',
    ['install', '--project-directory=ios'],
    consumer,
    15 * 60_000,
  );
  run('verify-project', 'ruby', ['verify-project.rb'], ios);
  const devices = JSON.parse(
    run(
      'simulators',
      'xcrun',
      ['simctl', 'list', 'devices', 'available', '--json'],
      ios,
      60_000,
      true,
    ),
  );
  const device = Object.entries(devices.devices)
    .filter(([runtime]) => runtime.includes('.iOS-'))
    .flatMap(([runtime, values]) =>
      values.map((value) => ({ ...value, runtime })),
    )
    .find((value) => value.isAvailable && value.name.startsWith('iPhone'));
  assert(device, 'An available real iOS Simulator runtime is required');
  report.simulator = { name: device.name, runtime: device.runtime };
  const common = [
    '-workspace',
    'PdfKitPolicyHost.xcworkspace',
    '-scheme',
    'PdfKitPolicyHost',
    '-configuration',
    'Debug',
    '-sdk',
    'iphonesimulator',
    '-destination',
    `platform=iOS Simulator,id=${device.udid}`,
    '-derivedDataPath',
    path.join(output, 'DerivedData'),
    'CODE_SIGNING_ALLOWED=NO',
  ];
  run(
    'compile',
    'xcodebuild',
    [
      ...common,
      '-resultBundlePath',
      path.join(output, 'compile.xcresult'),
      'build-for-testing',
    ],
    ios,
    25 * 60_000,
  );
  report.compiled = true;
  const result = path.join(output, 'policy.xcresult');
  run(
    'xctest',
    'xcodebuild',
    [
      ...common,
      '-resultBundlePath',
      result,
      '-parallel-testing-enabled',
      'NO',
      'test-without-building',
    ],
    ios,
    8 * 60_000,
  );
  const summary = JSON.parse(
    run(
      'test-summary',
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'summary', '--path', result],
      ios,
      60_000,
      true,
    ),
  );
  const tests = JSON.parse(
    run(
      'test-tree',
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', result],
      ios,
      60_000,
      true,
    ),
  );
  report.tests = verifyPolicyResults(summary, tests);
  assert.deepEqual(
    hashes(),
    before,
    'Native verification must not modify module/test sources',
  );
  report.status = 'passed';
} catch (error) {
  report.error = sanitize(error.stack ?? String(error));
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (output) {
    writeFileSync(
      path.join(output, 'verification.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(sanitize(JSON.stringify(report, null, 2)));
  }
}
