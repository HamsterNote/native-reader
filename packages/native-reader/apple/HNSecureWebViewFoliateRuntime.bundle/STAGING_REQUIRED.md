# Secure WebView Foliate Runtime

`stage-secure-webview.mjs` replaces this tracked folder-reference skeleton with
the verified 19-file Foliate native closure before a release package is built.
The Podspec has exactly one resource input: this bundle directory. A source
checkout that has not been staged therefore has a real, non-empty CocoaPods
folder-reference input, but the resolver fails closed until the verified runtime
closure is present.
