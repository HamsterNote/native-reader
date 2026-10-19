import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareConsumer } from './prepare-consumer.mjs';

test('the real isolated consumer resolves PDFKit, Expo core and RN without workspace native-reader', (t) => {
  const source = realpathSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const workspace = realpathSync(path.join(source, '../..'));
  const output = mkdtempSync(path.join(tmpdir(), 'pdfkit-resolver-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const { consumer, ios } = prepareConsumer({ output, source, workspace });
  const run = (args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--no-warnings',
          '--eval',
          "require('expo/bin/autolinking')",
          'expo-modules-autolinking',
          ...args,
        ],
        { cwd: ios, encoding: 'utf8' },
      ),
    );
  const apple = run([
    'resolve',
    '--platform',
    'apple',
    '--project-root',
    consumer,
    '--json',
  ]);
  assert(
    apple.modules.some((module) => module.packageName === 'expo-modules-core'),
  );
  const host = apple.modules.find(
    (module) => module.packageName === '@hamster-note/pdfkit',
  );
  assert.equal(host?.modules[0]?.class, 'HamsterPdfKitModule');
  assert.equal(realpathSync(host.pods[0].podspecDir), path.join(source, 'ios'));
  const native = run(['react-native-config', '--json', '--platform', 'ios']);
  assert.equal(
    realpathSync(native.reactNativePath),
    realpathSync(path.join(workspace, 'node_modules/react-native')),
  );
  assert(!native.dependencies['@hamster-note/native-reader']);
});
