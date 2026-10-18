# Third-Party Notices

The Android secure WebView implementation staged into this package is derived
from `react-native-webview` 13.16.1 and is redistributed under the MIT license.
The complete upstream license text is included at `secure-webview/LICENSE` in
the packed package.

The package-private `foliate-runtime/` assets are generated from
`johnfactotum/foliate-js` commit `78914aef4466eb960965702401634c2cb348e9b1`
and are redistributed under the MIT license. Its source license is included at
`foliate-runtime/LICENSE`; `foliate-runtime/manifest.json` records each staged
asset, its source path, checksums, and applicable license.

Foliate's staged `vendor/zip.js` dependency is zip.js 2.8.22, from
`https://github.com/gildas-lormeau/zip.js/releases/tag/v2.8.22`, and is
redistributed under the BSD-3-Clause license. Its complete license and
copyright text are included at `foliate-runtime/LICENSES/zip.js-BSD-3-Clause.txt`.

Foliate's staged `vendor/fflate.js` dependency is fflate 0.8.2, from
`https://github.com/101arrowz/fflate/releases/tag/v0.8.2`, and is redistributed
under the MIT license. Its complete license and copyright text are included at
`foliate-runtime/LICENSES/fflate-MIT.txt`.

The independent PDF adapter and neutral contracts come from
`HamsterNote/reader` revision `e45a997f13d607b2cabd8d3c83a7039875d4e183`
under MIT; the complete copyright/license is shipped at
`pdf-runtime/READER_LICENSE`. The pinned npm artifact and its SHA-256 are
recorded in `vendor/reader-pdf.json` in source. PDF.js, worker, CMaps, standard
fonts, WASM and ICC resources are from `pdfjs-dist` 5.4.530 under Apache-2.0;
the upstream license and third-party notices are shipped at
`pdf-runtime/LICENSE`. `pdf-runtime/manifest.json` records exact shipped hashes.
