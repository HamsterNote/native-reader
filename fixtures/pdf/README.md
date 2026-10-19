# Native PDF Demo sample

`native-demo.pdf` is synthetic content authored for this repository, dedicated
to the public domain under CC0-1.0. No external book, image or personal data is
included. The generator uses the existing `pdf-lib@1.17.1` eight-page text and
geometry recipe from `tests/e2e/pdf-reader.spec.ts`, without its JavaScript
OpenAction security canary. Helvetica is a PDF standard font, not an embedded
third-party font file. Dates and metadata are fixed for reproducible bytes.

```sh
pnpm run fixtures:pdf
pnpm run fixtures:pdf:check
```

- Size: **3317 bytes**.
- SHA-256: `5b322352fefe4745a6188ad5fbe41f2ea7fd8e3b394d0894ad6c2d52882256c0`.
- Expected: eight physical pages, 400 x 520 points; page 3 rotated 90 degrees.
- Each page has selectable `Expo PDF selectable page N` and
  `Offline physical page content` text, for N = 1 through 8.
- The check regenerates and compares exact bytes, reparses the PDF and checks
  page count and rotation. Browser PDF.js text extraction is checked separately.

`rejected.pdf` remains the deliberately corrupt signature-only error sample.
Neither command changes EPUB fixtures or their generation recipe.
Transfer the valid PDF into the phone's Files/Downloads using AirDrop, USB or
`adb push fixtures/pdf/native-demo.pdf /sdcard/Download/native-demo.pdf`, then
select it through the Demo's system picker. A path on the development machine
is not a phone URI. See `docs/validation.md` for the device checklist.
