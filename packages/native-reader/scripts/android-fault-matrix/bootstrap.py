#!/usr/bin/env python3
"""Run the production Android isolation gate from a fresh disposable checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
from urllib.parse import urlsplit

GRADLE_SHA = 'b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06'
GRADLE_URL = 'https://services.gradle.org/distributions/gradle-9.3.1-bin.zip'
CHECKSUM_URL = GRADLE_URL + '.sha256'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo', required=True, type=Path)
parser.add_argument('--workdir', required=True, type=Path)
parser.add_argument('--distribution', type=Path,
                    help='Optional existing official ZIP; verified before and after copying')
parser.add_argument('--revision', required=True,
                    help='Exact full Git SHA at the source checkout HEAD')
args = parser.parse_args()
if not re.fullmatch(r'[0-9a-f]{40}', args.revision):
    raise SystemExit('--revision must be a full lowercase Git commit SHA')
source = args.repo.resolve(strict=True)
runroot = args.workdir.resolve()
if source == runroot or source in runroot.parents or runroot in source.parents:
    raise SystemExit('The new workdir must be disjoint from the source checkout')
environment = os.environ.copy()
environment['CI'] = '1'
for variable in ('JAVA_HOME', 'ANDROID_HOME'):
    if not environment.get(variable):
        raise SystemExit(f'{variable} must point to the existing JDK 17 / Android SDK')
revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
if revision != args.revision:
    raise SystemExit('Source HEAD differs from --revision; select the intended checkout explicitly')

runroot.mkdir(parents=False, exist_ok=False)
snapshot = runroot / 'source'
downloads = runroot / 'downloads'
downloads.mkdir()
log = (runroot / 'run.log').open('w', encoding='utf-8')


def emit(value):
    print(value, flush=True)
    log.write(value + '\n')
    log.flush()


def run(argv, cwd=None):
    emit('$ ' + shlex.join(str(item) for item in argv))
    process = subprocess.Popen([str(item) for item in argv], cwd=cwd,
                               env=environment, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for line in process.stdout:
        emit(line.rstrip('\n'))
    status = process.wait()
    emit(f'[exit {status}]')
    if status:
        raise subprocess.CalledProcessError(status, argv)


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


emit('source_revision=' + revision)
emit('official_checksum_source=' + CHECKSUM_URL)
emit('expected_sha256=' + GRADLE_SHA)
distribution = downloads / 'gradle-9.3.1-bin.zip'
if args.distribution:
    original = args.distribution.resolve(strict=True)
    actual = sha256(original)
    emit(f'local_distribution={original} sha256={actual}')
    if actual != GRADLE_SHA:
        raise SystemExit('Rejected distribution: SHA-256 mismatch')
    shutil.copyfile(original, distribution)
    distribution_source = str(original)
else:
    run(['curl', '--fail', '--location', '--retry', '3', '--connect-timeout', '20',
         '--max-time', '600', '--output', distribution, GRADLE_URL])
    distribution_source = GRADLE_URL
actual = sha256(distribution)
if actual != GRADLE_SHA:
    raise SystemExit('Copied/downloaded distribution SHA-256 mismatch')
emit(f'private_distribution={distribution} bytes={distribution.stat().st_size} sha256={actual}')
(runroot / 'provenance.json').write_text(json.dumps({
    'sourceRevision': revision, 'distributionSource': distribution_source,
    'officialDistributionUrl': GRADLE_URL, 'officialChecksumUrl': CHECKSUM_URL,
    'sha256': actual, 'bytes': distribution.stat().st_size,
}, indent=2) + '\n', encoding='utf-8')

run(['git', 'clone', '--no-hardlinks', '--no-checkout', source, snapshot])
run(['git', 'checkout', '--detach', revision], snapshot)
run(['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts',
     '--store-dir', runroot / 'pnpm-store'], snapshot)
run(['node', 'scripts/bootstrap-foliate-submodule.mjs'], snapshot)
run(['node', 'scripts/stage-foliate-runtime.mjs'], snapshot)
run(['node', 'scripts/stage-foliate-runtime.mjs', '--check'], snapshot)

harness = snapshot / 'packages/native-reader/android-fault-matrix'
wrapper = harness / 'gradle/wrapper/gradle-wrapper.properties'
properties = wrapper.read_text(encoding='utf-8')
if f'distributionSha256Sum={GRADLE_SHA}' not in properties:
    raise SystemExit('Wrapper checksum pin differs from the official pin')
properties, count = re.subn(r'^distributionUrl=.*$',
                           'distributionUrl=' + distribution.as_uri(), properties, flags=re.M)
if count != 1:
    raise SystemExit('Expected exactly one wrapper distributionUrl')
wrapper.write_text(properties, encoding='utf-8')
emit('Only disposable wrapper URL changed; SHA-256 enforcement retained')

# Configure only this disposable harness; the isolation API strips inherited JVM options.
network_properties = ['\n# Task-local network/tool settings; not product source',
                      'org.gradle.workers.max=2']
for scheme in ('http', 'https'):
    raw = environment.get(scheme.upper() + '_PROXY') or environment.get(scheme + '_proxy')
    if not raw:
        continue
    proxy = urlsplit(raw)
    if proxy.scheme != 'http' or proxy.username or proxy.password or not proxy.hostname:
        raise SystemExit('Only an unauthenticated HTTP proxy is supported by this recipe')
    network_properties += [f'systemProp.{scheme}.proxyHost={proxy.hostname}',
                           f'systemProp.{scheme}.proxyPort={proxy.port or 80}',
                           f'systemProp.{scheme}.nonProxyHosts=localhost|127.*|[::1]']
with (harness / 'gradle.properties').open('a', encoding='utf-8') as output:
    output.write('\n'.join(network_properties) + '\n')
run(['git', 'diff', '--stat'], snapshot)
cache = runroot / 'isolated-cache'
cache.mkdir()
emit('Fresh isolation parent: empty; no Gradle cache, init script or daemon state copied')
run(['node', Path(__file__).with_name('run-isolated.mjs').resolve(), snapshot, cache])
emit('Isolation API succeeded; owned-root cleanup and authority invariants passed')
emit('isolation_parent_remaining=' + json.dumps([p.name for p in cache.iterdir()]))
run(['git', 'status', '--short'], source)
