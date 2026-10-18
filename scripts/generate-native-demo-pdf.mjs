import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const output = new URL('../fixtures/pdf/native-demo.pdf', import.meta.url);
const pdf = await PDFDocument.create();
pdf.setTitle('Native Reader Demo - eight selectable pages');
pdf.setAuthor('HamsterNote');
pdf.setCreator('scripts/generate-native-demo-pdf.mjs (CC0-1.0)');
pdf.setProducer('pdf-lib 1.17.1');
pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
const font = await pdf.embedFont(StandardFonts.Helvetica);
// Reuse the eight-page text/geometry recipe in tests/e2e/pdf-reader.spec.ts,
// excluding that security test's JavaScript OpenAction canary.
for (let number = 1; number <= 8; number++) {
  const page = pdf.addPage([400, 520]);
  if (number === 3) page.setRotation(degrees(90));
  page.drawRectangle({
    x: 20,
    y: 20,
    width: 360,
    height: 480,
    color: rgb(0.96, 0.97, 0.98),
  });
  page.drawText(`Expo PDF selectable page ${number}`, {
    x: 30,
    y: 450,
    size: 16,
    font,
  });
  page.drawText('Offline physical page content', {
    x: 30,
    y: 410,
    size: 12,
    font,
  });
}
const bytes = Buffer.from(await pdf.save());
if (process.argv.includes('--check')) {
  if (!bytes.equals(await readFile(output)))
    throw new Error('native-demo.pdf differs; run pnpm run fixtures:pdf');
} else {
  await writeFile(output, bytes);
}
const parsed = await PDFDocument.load(bytes, { updateMetadata: false });
if (parsed.getPageCount() !== 8 || parsed.getPage(2).getRotation().angle !== 90)
  throw new Error('Expected eight physical pages with page 3 rotated');
console.log(
  `${fileURLToPath(output)}: ${bytes.length} bytes, 8 selectable pages, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
);
