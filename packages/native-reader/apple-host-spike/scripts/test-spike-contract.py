#!/usr/bin/env python3
"""工程lane合流后静态检查；不是Xcode可运行性或真实WKWebView通过证明。"""
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
sys.dont_write_bytecode = True
from spike_support import file_bytes, source_inventory


def method_body(source, selector):
    """窄ObjC方法抽取：屏蔽注释/字符串中的花括号，避免JS模板干扰顺序检查。"""
    tokens = r'/\*.*?\*/|//[^\n]*|@?"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\''
    masked = re.sub(tokens, lambda m: ' ' * len(m.group()), source, flags=re.S)
    header = re.search(r'-\s*\([^)]*\)\s*' + re.escape(selector) + r'\b[^\{]*\{', masked)
    if not header:
        raise ValueError('Required method missing: ' + selector)
    start = header.end(); depth = 1
    for at in range(start, len(masked)):
        if masked[at] == '{': depth += 1
        elif masked[at] == '}': depth -= 1
        if depth == 0:
            # 保留方法语句、屏蔽注释和string，注释不能代替实际等待调用。
            return masked[start:at]
    raise ValueError('Unclosed method: ' + selector)


def check_wait_order(source):
    """JS completion不等于消息交付；显式等待自己的expectation，禁止helper全量wait。"""
    helper = method_body(source, 'evaluate')
    waits = re.findall(r'\[\s*self\s+waitForExpectations[^;]*;', helper)
    done = r'\[\s*self\s+waitForExpectations\s*:\s*@\[\s*done\s*\]\s+timeout\s*:\s*5\s*\]\s*;'
    if len(waits) != 1 or not re.fullmatch(done, waits[0]):
        raise ValueError('evaluate helper must wait only @[done] timeout:5')
    body = method_body(source, 'testSourceFreeBindAndContentWorldIsolation')
    steps = [
        r'XCTestExpectation\s*\*\s*pageProbe\s*=',
        r'self\.nextPageProbeMessage\s*=\s*\^\s*\{\s*\[\s*pageProbe\s+fulfill\s*\]\s*;\s*\}\s*;',
        r'NSDictionary\s*\*\s*pageMarker\s*=\s*\[\s*self\s+evaluate\s*:',
        r'\[\s*self\s+waitForExpectations\s*:\s*@\[\s*pageProbe\s*\]\s+timeout\s*:\s*5\s*\]\s*;',
        r'self\.nextPageProbeMessage\s*=\s*nil\s*;',
    ]
    matches = [list(re.finditer(pattern, body)) for pattern in steps]
    if any(len(found) != 1 for found in matches):
        raise ValueError('Exactly one pageProbe registration/dispatch/wait/clear required')
    positions = [found[0].start() for found in matches]
    if positions != sorted(positions):
        raise ValueError('pageProbe must register, evaluate, explicitly wait, then clear')
    return dict(pageProbeWaitBeforeClear=True, evaluateWaitOnlyDone=True)


def check(spike):
    project=spike/'HNFoliateHostSpike.xcodeproj/project.pbxproj'
    text=file_bytes(project).decode()
    for name in ['HNFoliateHostSpikeApp','HNFoliateHostSpikeTests','../../apple/HNSecureFoliateHostRelay.h',
                 '../../apple/HNSecureFoliateHostRelay.m','../../apple/HNSecureWebViewFoliateRuntime.bundle']:
        if name not in text:raise ValueError('Expected direct project reference missing: '+name)
    if re.search(r'React-Core|ReactNative|Pods/|PBXShellScriptBuildPhase|XCRemoteSwiftPackageReference',text):
        raise ValueError('RN/Pods/packages/source-mutating build phase refused')
    scheme=spike/'HNFoliateHostSpike.xcodeproj/xcshareddata/xcschemes/HNFoliateHostSpike.xcscheme'
    xml=ET.fromstring(file_bytes(scheme))
    tests=xml.findall('./TestAction/Testables/TestableReference')
    if len(tests)!=1 or tests[0].get('skipped')=='YES':raise ValueError('Shared scheme test target missing/skipped')
    references=[r.get('BlueprintName') for r in xml.iter('BuildableReference')]
    if 'HNFoliateHostSpikeTests' not in references or 'HNFoliateHostSpikeApp' not in references:raise ValueError('Scheme target names mismatch')
    inventory=source_inventory(spike/'Tests')
    expected={'HNFoliateHostSpikeTests/'+name+'()' for name in [
        'testCanonicalBundleManifestClosure','testSourceFreeBindAndContentWorldIsolation',
        'testDeactivatedRelayRejectsActualStaleMessageAndNativeSend',
        'testDeniedNavigationFailsClosedAndRejectsOldRelay',
        'testExactHostURLDepartureRejectsActualStaleMessageAndNativeSend']}
    # 来自已交付gen22源码，后续inventory改动须父级重新核准，不允许静默少跑。
    if set(inventory['testIdentifiers'])!=expected:raise ValueError('Delivered five-method inventory changed; parent approval required')
    source='\n'.join(file_bytes(p).decode() for p in sorted((spike/'Tests').glob('*.m')))
    # 当前约定：每test实际attachment，不能用仅控制台PASS或synthetic fixture替代。
    for token in ['XCTAttachment','schemaVersion','hosted-xctest-real-wkwebview','securityOrigin','actual-preflight-outcome','native-bind-dispatch','production-accepted-message']:
        if token not in source:raise ValueError('Per-test actual evidence lane contract absent: '+token)
    wait_contract = check_wait_order(source)
    return dict(status='STATIC_CONTRACT_PASS_NOT_4B3',inventory=inventory,waitContract=wait_contract,macExecutionVerified=False)


if __name__=='__main__':
    try:print(json.dumps(check(pathlib.Path(__file__).resolve().parent.parent),indent=2))
    except Exception as error:print('INCOMPLETE: engineering lane contract not delivered/approved: '+str(error),file=sys.stderr);sys.exit(2)
