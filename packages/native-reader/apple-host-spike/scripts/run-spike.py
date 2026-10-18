#!/usr/bin/env python3
"""Mac-only source-free WKWebView spike；不stage/pack/生成manifest，不修改authority。"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import platform
import re
import signal
import sys
import tempfile
import time

sys.dont_write_bytecode = True  # 即使手动入口未带-B，也不在受保护spike写__pycache__。
from spike_support import (ANCHOR_SHA, MANIFEST_SHA, Commands, canonical_no_links, command_json,
                           controlled_env, digest, evaluate_results, file_bytes, output_parent,
                           read_json, save, select_simulator, authority_snapshot, source_inventory, attachment_identity)

SPIKE = pathlib.Path(__file__).resolve().parent.parent
PACKAGE = SPIKE.parent
WORKSPACE = PACKAGE.parent.parent
PROJECT = SPIKE/'HNFoliateHostSpike.xcodeproj'
SCHEME = 'HNFoliateHostSpike'
DEFAULT_ANCHOR = pathlib.Path('/home/zhangxiao/.cache/opencode-tmp/opencode/foliate-recovery-20260930/SECURE_WEBVIEW_SHA256.anchor.json')


def authorities(anchor):
    # 不递归node_modules/git；覆盖直接编译源/runtime/spike和相关受审authority。
    return [PACKAGE/'apple',PACKAGE/'android',PACKAGE/'secure-webview',
            PACKAGE/'scripts',SPIKE,PACKAGE/'SECURE_WEBVIEW_SHA256.json',PACKAGE/'package.json',
            PACKAGE/'HNSecureWebView.podspec',WORKSPACE/'.github/workflows/native-reader-ios-host-spike.yml',anchor]


def optional_authorities():
    # ignored生成目录在clean checkout可能不存在；存在时仍保护全部原始mode/type/bytes。
    return [PACKAGE/'foliate-runtime']


def required_runtime_preflight():
    apple = canonical_no_links(PACKAGE/'apple')
    bundle = canonical_no_links(apple/'HNSecureWebViewFoliateRuntime.bundle')
    native = canonical_no_links(bundle/'foliate-runtime/native')
    for name in ['manifest.json','reader.html','bootstrap.js']:
        file = canonical_no_links(native/name,directory=False)
        file_bytes(file)  # bounded regular/no-link；这里只读，不stage/补生成。
    return native


def tool_preflight():
    if platform.system()!='Darwin':
        raise RuntimeError('Mac/Xcode required; Linux fixtures do not close 4B.3')
    for tool in ['/usr/bin/xcrun','/usr/bin/xcodebuild','/usr/bin/xcode-select']:
        if not pathlib.Path(tool).is_file() or not os.access(tool,os.X_OK):
            raise RuntimeError('Required Apple tool unavailable: '+tool)


def probe_api(commands):
    """实际Mac help先行；只支持文档中的modern API，不试造legacy flags。"""
    commands.run(['/usr/bin/xcodebuild','-version'])
    commands.run(['/usr/bin/xcode-select','-p'])
    commands.run(['/usr/bin/xcrun','--find','simctl'])
    commands.run(['/usr/bin/xcrun','--find','xcresulttool'])
    help_record = commands.run(['/usr/bin/xcodebuild','-help'])
    help_text = file_bytes(help_record['stdoutPath']).decode(errors='replace')+file_bytes(help_record['stderrPath']).decode(errors='replace')
    for flag in ['-disableAutomaticPackageResolution','-onlyUsePackageVersionsFromResolvedFile',
                 '-derivedDataPath','-resultBundlePath','-parallel-testing-enabled']:
        if flag not in help_text:raise ValueError('Target xcodebuild does not advertise '+flag)
    root_help = commands.run(['/usr/bin/xcrun','xcresulttool','help'])
    probes = [['get','test-results','summary'],['get','test-results','tests'],['export','attachments']]
    for args in probes:
        record = commands.run(['/usr/bin/xcrun','xcresulttool','help',*args])
        text = file_bytes(record['stdoutPath']).decode(errors='replace')+file_bytes(record['stderrPath']).decode(errors='replace')
        if '--path' not in text:raise ValueError('Unsupported xcresulttool API '+str(args))
        if args[0]=='export' and ('--output-path' not in text or '--test-id' not in text):
            raise ValueError('Per-test attachments export unsupported')
    # 此时没有result；仅help，不调用需要实际--path的summary/tests/export/schema。
    return dict(rootHelp=root_help,status='MODERN_HELP_PROBED_NOT_RESULT_VERIFIED')


def build_argv(root, uuid):
    return ['/usr/bin/xcodebuild','test','-project',str(PROJECT),'-scheme',SCHEME,
            '-destination','platform=iOS Simulator,id='+uuid,
            '-derivedDataPath',str(root/'deriveddata'),'-resultBundlePath',str(root/'HostSpike.xcresult'),
            '-disableAutomaticPackageResolution','-onlyUsePackageVersionsFromResolvedFile',
            '-parallel-testing-enabled','NO','CODE_SIGNING_ALLOWED=NO']


def collect_results(commands, root, inventory, exit_record):
    bundle = root/'HostSpike.xcresult'
    if not bundle.is_dir() or bundle.is_symlink():raise ValueError('No original regular xcresult directory')
    save(root/'evidence/xcresult-tree.json',digest(bundle))
    summary = command_json(commands,['/usr/bin/xcrun','xcresulttool','get','test-results','summary','--path',str(bundle)])
    tests = command_json(commands,['/usr/bin/xcrun','xcresulttool','get','test-results','tests','--path',str(bundle)])
    save(root/'evidence/xcresult-summary.json',summary)
    save(root/'evidence/xcresult-tests.json',tests)
    attachments = {}; exports = []
    for index,test_id in enumerate(inventory['testIdentifiers']):
        folder = root/'attachments'/('%03d'%index)
        if os.path.lexists(folder):raise ValueError('Attachment output must be fresh; no overwrite')
        # xcresulttool自己创建export目录；不能导出到authority或覆盖旧export。
        record = commands.run(['/usr/bin/xcrun','xcresulttool','export','attachments','--path',str(bundle),
                               '--output-path',str(folder),'--test-id',test_id])
        if not folder.is_dir() or folder.is_symlink():raise ValueError('Missing per-test attachments export')
        records = []
        for path in sorted(folder.rglob('*')):
            if path.is_symlink():raise ValueError('Exported attachment symlink refused')
            if path.is_file():
                # JSON附件可能被xcresulttool以UUID重命名，按内容schema而非文件名匹配。
                try:value=json.loads(file_bytes(path))
                except (UnicodeDecodeError,json.JSONDecodeError):continue
                if isinstance(value,dict) and value.get('schemaVersion')==1 and value.get('execution')=='hosted-xctest-real-wkwebview':
                    records.append(value)
        if len(records)!=1 or attachment_identity(records[0])!=test_id:
            raise ValueError('Exactly one actual tuple/preflight/bind attachment required: '+test_id)
        attachments[test_id]=records[0]
        exports.append(dict(testIdentifier=test_id,tree=digest(folder),command=record))
    save(root/'evidence/test-attachment-evidence.json',dict(perTest=attachments,exports=exports))
    return evaluate_results(summary,tests,inventory,attachments,exit_record)


def run(output, runtime_id, anchor, developer_dir=None):
    tool_preflight()  # Linux/工具错误不能创建execution root或触发Apple命令。
    anchor = canonical_no_links(anchor,directory=False)
    required_runtime_preflight()  # required Apple closure缺失：任何输出写入前稳定拒绝。
    paths = authorities(anchor)
    optional = optional_authorities()
    for path in paths:canonical_no_links(path,directory=path.is_dir())
    parent = output_parent(output,WORKSPACE,[*paths,*optional])
    if hashlib.sha256(file_bytes(PACKAGE/'SECURE_WEBVIEW_SHA256.json')).hexdigest()!=MANIFEST_SHA:
        raise ValueError('Current manifest pin mismatch; no automatic baseline update')
    if hashlib.sha256(file_bytes(anchor)).hexdigest()!=ANCHOR_SHA:raise ValueError('Historical anchor pin mismatch')
    # 工程lane未交付/宏inventory不明确时不猜成功；由父级先合流contract核验。
    inventory = source_inventory(SPIKE/'Tests')
    if not PROJECT.is_dir():raise ValueError('Delivered project required before actual Mac run')
    spec=importlib.util.spec_from_file_location('spike_contract',SPIKE/'scripts/test-spike-contract.py')
    contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)
    contract_result=contract.check(SPIKE)
    before = authority_snapshot(paths,optional)
    root = pathlib.Path(tempfile.mkdtemp(prefix='hn-ios-host-spike-',dir=parent))
    os.chmod(root,0o700)
    for name in ['home','tmp','evidence','deriveddata','attachments']:(root/name).mkdir(mode=0o700)
    started=time.monotonic(); limit=2400
    commands = None; uuid = None; cleanup = dict(createdUUID=None,deleted=False,creationUnknown=False)
    result = dict(status='INCOMPLETE',outputRoot=str(root),scope='source-free WKWebView Simulator spike only; not RN/Apple production/publication/4C/4D evidence',errors=[])
    def remaining():
        seconds=limit-(time.monotonic()-started)
        if seconds<=0:raise TimeoutError('Run wall budget reached')
        return min(1800,seconds)
    try:
        # before/inventory全部持久化在任何Apple执行前；保存失败也进入authority finally。
        save(root/'evidence/before.json',dict(authorities=before,manifestSha256=MANIFEST_SHA,incidentAnchorSha256=ANCHOR_SHA,
                                            outputRoot=str(root),inventory=inventory,sourceFree=True))
        save(root/'evidence/engineering-contract.json',contract_result)
        env = controlled_env(root,developer_dir)
        commands = Commands(root,env,started+limit)
        save(root/'evidence/tool-api.json',probe_api(commands))
        runtimes = command_json(commands,['/usr/bin/xcrun','simctl','list','runtimes','--json'])
        devices = command_json(commands,['/usr/bin/xcrun','simctl','list','devicetypes','--json'])
        before_devices = command_json(commands,['/usr/bin/xcrun','simctl','list','devices','--json'])
        save(root/'evidence/simulator-before.json',dict(runtimes=runtimes,deviceTypes=devices,devices=before_devices))
        runtime,device = select_simulator(runtime_id,runtimes,devices)
        save(root/'evidence/simulator-selection.json',dict(runtime=runtime,deviceType=device))
        owned_name=root.name
        cleanup['creationUnknown']=True  # create异常时不按名称扫/猜UUID，不误删别人。
        create_record = commands.run(['/usr/bin/xcrun','simctl','create',owned_name,device['identifier'],runtime_id])
        created = file_bytes(create_record['stdoutPath']).decode().strip()
        if not re.fullmatch(r'[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}',created):raise ValueError('Unknown create UUID; no guessed cleanup; Simulator creation may be incomplete')
        previous = {d['udid'].lower() for rows in before_devices.get('devices',{}).values() for d in rows}
        if created.lower() in previous:raise ValueError('Create returned preexisting simulator; no adoption/deletion')
        # 只有成功create返回且不在原列表中的UUID才可登记cleanup。
        uuid = created;cleanup.update(createdUUID=uuid,creationUnknown=False)
        save(root/'evidence/owned-simulator.json',dict(uuid=uuid,name=owned_name,runtimeID=runtime_id,createdByThisRun=True))
        commands.run(['/usr/bin/xcrun','simctl','boot',uuid],seconds=min(60,remaining()))
        commands.run(['/usr/bin/xcrun','simctl','bootstatus',uuid,'-b'],seconds=min(120,remaining()))
        actual = command_json(commands,['/usr/bin/xcrun','simctl','list','devices','--json'])
        save(root/'evidence/simulator-actual.json',actual)
        matches=[d for d in actual.get('devices',{}).get(runtime_id,[]) if d.get('udid','').lower()==uuid.lower()]
        if len(matches)!=1 or matches[0].get('name')!=owned_name or matches[0].get('state')!='Booted':raise ValueError('Created device/runtime identity mismatch')
        exit_record = commands.run(build_argv(root,uuid),seconds=remaining(),check=False)
        save(root/'evidence/xcodebuild-exit.json',exit_record)
        result.update(collect_results(commands,root,inventory,exit_record))
    except BaseException as error:
        result['status']='INCOMPLETE';result['errors'].append(dict(errorType=type(error).__name__,errno=getattr(error,'errno',None),message=str(error)))
    finally:
        # cleanup有自己的90s小预算；不延长xcodebuild/测试期限。
        if commands is not None:commands.deadline=time.monotonic()+90
        # 不清输出/deriveddata/xcresult；仅删除本次明确create返回的UUID。
        if uuid is not None:
            try:
                commands.run(['/usr/bin/xcrun','simctl','shutdown',uuid],seconds=30,check=False)
                commands.run(['/usr/bin/xcrun','simctl','delete',uuid],seconds=30)
                final_devices = command_json(commands,['/usr/bin/xcrun','simctl','list','devices','--json'])
                if any(d.get('udid','').lower()==uuid.lower() for rows in final_devices.get('devices',{}).values() for d in rows):raise ValueError('Owned UUID still present')
                cleanup['deleted']=True
            except BaseException as error:result['status']='INCOMPLETE';result['errors'].append(dict(phase='owned-UUID-cleanup',message=str(error)))
        try:
            after = authority_snapshot(paths,optional)
            # 保存实际漂移状态，再拒绝；不以chmod重塑原mode或改写before。
            save(root/'evidence/after.json',dict(authorities=after,unchanged=after==before,manifestSha256=MANIFEST_SHA,incidentAnchorSha256=ANCHOR_SHA))
            if after!=before:raise ValueError('Authority digest changed')
            if hashlib.sha256(file_bytes(PACKAGE/'SECURE_WEBVIEW_SHA256.json')).hexdigest()!=MANIFEST_SHA or hashlib.sha256(file_bytes(anchor)).hexdigest()!=ANCHOR_SHA:raise ValueError('Pinned manifest/anchor changed')
            result['authorityUnchanged']=True
        except BaseException as error:result['status']='INCOMPLETE';result['errors'].append(dict(phase='authority-finally',message=str(error)))
        result.update(simulatorCleanup=cleanup,elapsedSeconds=time.monotonic()-started)
        save(root/'evidence/result.json',result)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-parent',required=True)
    parser.add_argument('--runtime-id',required=True)
    parser.add_argument('--incident-anchor',default=str(DEFAULT_ANCHOR),help='原始事故anchor只读字节，必须命中固定SHA；CI不得生成替代baseline')
    args=parser.parse_args()
    def cancel(number,frame):
        signal.signal(number,signal.SIG_IGN)
        raise InterruptedError('Cancelled by signal '+str(number))
    for number in [signal.SIGTERM,signal.SIGINT]:signal.signal(number,cancel)
    try:result=run(args.output_parent,args.runtime_id,args.incident_anchor,os.environ.get('DEVELOPER_DIR'))
    except Exception as error:
        print(json.dumps(dict(status='INCOMPLETE',phase='preflight',errorType=type(error).__name__,message=str(error))),file=sys.stderr);sys.exit(2)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    sys.exit(0 if result['status']=='PASS' else 1 if result['status']=='FAIL' else 2)
