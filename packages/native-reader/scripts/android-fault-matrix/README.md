# Android Fault Matrix Bootstrap

Runs the production isolation gate from a fresh checkout of an explicit commit.
Requires Linux, Python3, Git, curl, Node24, pnpm10, JDK17, Android SDK36 and network
access to npm, Google Maven, Maven Central and the Foliate Git repository. No
sudo, emulator, device, NDK or shared Gradle cache is required for Robolectric.
The Android runtime used by Robolectric is API35, compatible with Java17.

From the native-reader repository root, with JAVA_HOME and ANDROID_HOME set:

```sh
python3 packages/native-reader/scripts/android-fault-matrix/bootstrap.py \
  --repo . --revision "$(git rev-parse HEAD)" --workdir ../android-verification
```

The workdir must not exist and must be disjoint from the checkout. Its parent
must exist. The source HEAD must equal the full40-character revision. Only
committed files are tested; local edits are not included. A fresh pnpm store,
checked-out source snapshot, provenance.json and run.log are retained there.
The production API cleans its own Gradle/staging root on success or failure;
the retained checkout and downloads are available for diagnosis.

## Distribution On Another Machine

By default the tool fetches the official Gradle9.3.1 ZIP with curl. It never
copies a Gradle user home, cache, init script or daemon. On a machine with a
previously downloaded official ZIP, add `--distribution /path/to/gradle-9.3.1-bin.zip`.
To obtain that ZIP separately:

```sh
curl --fail --location --output gradle-9.3.1-bin.zip \
  https://services.gradle.org/distributions/gradle-9.3.1-bin.zip
sha256sum gradle-9.3.1-bin.zip
```

Expected SHA256 (also enforced by both the bootstrap and Gradle wrapper):
`b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06`.
Official checksum source:
https://services.gradle.org/distributions/gradle-9.3.1-bin.zip.sha256
The verified official artifact is137037885 bytes. Transfer the ZIP to another
machine through your normal file-transfer mechanism, then pass --distribution;
the tool verifies it before and after making its private copy. A mismatch is
fatal. The source wrapper is never rewritten: only the disposable clone's URL
changes to its checked private ZIP, retaining checksum enforcement.

Inherited HTTP_PROXY/HTTPS_PROXY (or lowercase forms) are supported only for
unauthenticated HTTP proxies. No credentials are written. Proxy settings are
applied to the disposable harness, whose test task forwards them to the
Robolectric JVM. Gradle and Robolectric download separately; npm/pnpm access
still requires the host's working network setup. This bootstrap is not offline:
the optional ZIP avoids only the Gradle distribution download.

## Evidence Boundary

This runs actual production staging, Kotlin/Java compilation and JVM tests.
WebView engine behavior, native MessagePort delivery, long-press menus and
selection handles require a working Android WebView device. The private PDF
port is a WebMessageChannel, not a TCP service: there is no listening socket,
loopback binding or numeric network port. The origin and main frame are fixed;
document grants use independent random URL tokens. A successful build or
Robolectric result does not satisfy those device acceptance items.
