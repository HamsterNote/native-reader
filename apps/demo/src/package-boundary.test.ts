import { readFileSync } from 'node:fs';
import path from 'node:path';

test('consumes the reader only through its package root', () => {
  const source = readFileSync(path.join(__dirname, 'DemoApp.tsx'), 'utf8');
  expect(source).toContain("from '@hamster-note/native-reader'");
  expect(source).not.toMatch(/from ['\"]\.\.?\/.*NativeReader/);
  expect(source).not.toContain('@hamster-note/native-reader/');
});
