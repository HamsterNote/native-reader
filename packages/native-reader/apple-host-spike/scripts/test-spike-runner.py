#!/usr/bin/env python3
"""Linux stdlib fixtures：所有summary/attachments标明模拟，不调用Apple工具。"""
import copy
import importlib.util
import json
import os
import pathlib
import signal
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
from spike_support import (Commands, attachment_identity, canonical_no_links, controlled_env, digest,
                           evaluate_results, output_parent, save, select_simulator, source_inventory, authority_snapshot)

SCRIPT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('runner',SCRIPT/'run-spike.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
contract_spec=importlib.util.spec_from_file_location('contract',SCRIPT/'test-spike-contract.py')
contract=importlib.util.module_from_spec(contract_spec);contract_spec.loader.exec_module(contract)
CACHE=pathlib.Path.home() / '.cache/opencode-tmp/opencode'
TEMP_PARENT=CACHE if CACHE.is_dir() else pathlib.Path(tempfile.gettempdir()).resolve()
RUNTIME='com.apple.CoreSimulator.SimRuntime.iOS-18-0'
UUID='12345678-1234-1234-1234-123456789ABC'
ID='SpikeTests/testBind()'


def attachment(key=ID):
    cls,name=key.split('/');name=name.removesuffix('()')
    command=dict(protocol='hn-foliate-host',version=1,direction='native-to-host',type='bind',session='A'*43,generation='G'*43,commandId='z'*43,payload={})
    ack=json.dumps(dict(command,direction='host-to-native',type='ack',payload=dict(command='bind',status='bridge-bound')))
    return dict(schemaVersion=1,test=f'-[{cls} {name}]',execution='hosted-xctest-real-wkwebview',scope='source/publication-free',
                failures=[],assertionsFailed=0,acceptedMessages=[ack],
                rawMessages=[dict(securityOrigin=dict(protocol='file',host='',port=0),frameIsMain=True,isNamedWorld=True,worldName='hn-foliate-host',webViewURL='file:///mock/reader.html',frameURL='file:///mock/reader.html')],
                events=[dict(event='cleanup',details={}),dict(event='actual-preflight-outcome',details=dict(passed=True)),
                        dict(event='native-bind-dispatch',details=dict(sent=True,command=command)),dict(event='production-accepted-message',details=dict(rawAck=ack))])


def result_documents():
    return (dict(totalTestCount=1,passedTests=1,failedTests=0,skippedTests=0,expectedFailures=0,result='Passed'),
            dict(testNodes=[dict(nodeType='Test Case',nodeIdentifier=ID,result='Passed')]),
            dict(testIdentifiers=[ID]),{ID:attachment()},dict(code=0,timedOut=False,ownerReaped=True))


class FakeCommands:
    instances=[]
    fail_boot=False
    malformed_uuid=False
    preexisting=False
    fail_delete=False
    appear_optional=None
    change_mode=None
    change_authority=None
    def __init__(self,root,env,deadline=None):
        self.root=root;self.deadline=deadline;self.calls=[];self.deleted=False;self.owned_name=None
        FakeCommands.instances.append(self)
    def run(self,argv,seconds=30,check=True):
        self.calls.append(argv);value='';code=0
        if argv[:3]==['/usr/bin/xcrun','simctl','list']:
            if argv[3]=='runtimes':value=dict(runtimes=[dict(identifier=RUNTIME,isAvailable=True,supportedDeviceTypes=[dict(identifier='phone')])])
            elif argv[3]=='devicetypes':value=dict(devicetypes=[dict(identifier='phone',productFamily='iPhone')])
            else:value=dict(devices={RUNTIME:[] if self.deleted or (not self.owned_name and not self.preexisting) else [dict(udid=UUID,name=self.owned_name or 'other-user-device',state='Booted')]})
        elif argv[:3]==['/usr/bin/xcrun','simctl','create']:
            self.owned_name=argv[3];value='unknown' if self.malformed_uuid else UUID
        elif argv[:3]==['/usr/bin/xcrun','simctl','boot'] and self.fail_boot:raise RuntimeError('Injected boot failure')
        elif argv[:3]==['/usr/bin/xcrun','simctl','delete']:
            if self.fail_delete:raise RuntimeError('Injected own UUID deletion failure')
            self.deleted=True
        elif argv[:2]==['/usr/bin/xcodebuild','test']:
            (self.root/'HostSpike.xcresult').mkdir();(self.root/'HostSpike.xcresult/raw').write_text('SYNTHETIC NOT XCODE')
            if self.change_authority:self.change_authority.write_text('injected-authority-drift')
            if self.appear_optional:self.appear_optional.mkdir()
            if self.change_mode:self.change_mode.chmod(0o600)
        elif 'summary' in argv:value=result_documents()[0]
        elif 'tests' in argv:value=result_documents()[1]
        elif argv[:4]==['/usr/bin/xcrun','xcresulttool','export','attachments']:
            folder=pathlib.Path(argv[argv.index('--output-path')+1]);folder.mkdir()
            save(folder/'UUID-renamed-attachment.json',attachment())
        path=self.root/'evidence'/('fake-%03d.log'%len(self.calls))
        path.write_text(json.dumps(value) if isinstance(value,dict) else value)
        return dict(code=code,timedOut=False,ownerReaped=True,stdoutPath=str(path),stderrPath=str(path))


class Safety(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='hn-spike-fixture-',dir=TEMP_PARENT)
        self.root=pathlib.Path(self.temp.name);self.workspace=self.root/'workspace';self.workspace.mkdir()
        self.external=self.root/'external';self.external.mkdir()
    def tearDown(self):self.temp.cleanup()  # 仅测试自有temp，无旧输出/真实simulator。

    def test_output_existing_external_no_links_no_overlap(self):
        self.assertEqual(output_parent(self.external,self.workspace,[]),self.external)
        for path in [self.workspace,self.root,self.workspace/'missing']:
            with self.assertRaises((ValueError,FileNotFoundError)):output_parent(path,self.workspace,[])
        link=self.root/'alias';link.symlink_to(self.external,target_is_directory=True)
        with self.assertRaises(ValueError):canonical_no_links(link)

    def test_digest_complete_tree_and_source_drift_detected(self):
        p=self.workspace/'source';p.write_text('trusted');before=digest(self.workspace)
        p.write_text('changed');self.assertNotEqual(before,digest(self.workspace))
        p.unlink();p.symlink_to(self.external)
        with self.assertRaises(ValueError):digest(self.workspace)

    def test_optional_absence_presence_and_unexpected_appearance(self):
        optional=self.workspace/'foliate-runtime'
        before=authority_snapshot([self.workspace],[optional])
        self.assertEqual(before[str(optional)],dict(required=False,present=False))
        self.assertEqual(before,authority_snapshot([self.workspace],[optional]))
        optional.mkdir();(optional/'asset').write_text('mock')
        self.assertNotEqual(before,authority_snapshot([self.workspace],[optional]))
        present=authority_snapshot([], [optional]);self.assertTrue(present[str(optional)]['present'])
        (optional/'asset').chmod(0o400)
        self.assertNotEqual(present,authority_snapshot([], [optional]))

    def test_required_apple_closure_missing_rejected_before_output_write(self):
        package=self.workspace/'package';package.mkdir()
        anchor=self.external/'original-anchor';anchor.write_text('mock anchor')
        with patch.object(runner,'PACKAGE',package),patch.object(runner,'tool_preflight'),patch('tempfile.mkdtemp',side_effect=AssertionError('Output creation reached')):
            with self.assertRaises(FileNotFoundError):runner.run(self.external,RUNTIME,anchor)
        apple=package/'apple';apple.mkdir();bundle=apple/'HNSecureWebViewFoliateRuntime.bundle';bundle.mkdir()
        native=bundle/'foliate-runtime/native';native.mkdir(parents=True)
        with patch.object(runner,'PACKAGE',package):
            for name in ['manifest.json','reader.html','bootstrap.js']:
                with self.assertRaises(FileNotFoundError):runner.required_runtime_preflight()
                (native/name).write_text('mock required asset')
            self.assertEqual(runner.required_runtime_preflight(),native)
            (native/'reader.html').unlink();(native/'reader.html').symlink_to(native/'bootstrap.js')
            with self.assertRaises(ValueError):runner.required_runtime_preflight()

    def test_environment_no_ambient_loader_or_jvm_node_python(self):
        with patch.dict(os.environ,dict(LD_PRELOAD='evil',NODE_OPTIONS='evil',PYTHONPATH='evil',JAVA_TOOL_OPTIONS='evil',HOME='/evil')):
            env=controlled_env(self.root)
        self.assertEqual(env['HOME'],str(self.root/'home'))
        self.assertFalse(any(k in env for k in ['LD_PRELOAD','NODE_OPTIONS','PYTHONPATH','JAVA_TOOL_OPTIONS']))

    def test_linux_preflight_never_invokes_apple(self):
        with patch('platform.system',return_value='Linux'),patch('subprocess.Popen',side_effect=AssertionError('Apple spawn reached')):
            with self.assertRaisesRegex(RuntimeError,'Mac/Xcode'):runner.run(self.external,RUNTIME,self.external/'absent')

    def test_exact_runtime_device_no_booted_fallback(self):
        runtime=dict(runtimes=[dict(identifier=RUNTIME,isAvailable=True,supportedDeviceTypes=[dict(identifier='phone')])])
        dev=dict(devicetypes=[dict(identifier='phone',productFamily='iPhone')])
        self.assertEqual(select_simulator(RUNTIME,runtime,dev)[1]['identifier'],'phone')
        for r,d in [(dict(runtimes=[]),dev),(dict(runtimes=[dict(identifier=RUNTIME,isAvailable=True)]),dev),(runtime,dict(devicetypes=[]))]:
            with self.assertRaises(ValueError):select_simulator(RUNTIME,r,d)

    def test_source_inventory_without_real_engineering_files(self):
        t=self.root/'tests';t.mkdir();(t/'T.m').write_text('@implementation SpikeTests\n- (void)testBind { }\n@end')
        self.assertEqual(source_inventory(t)['testIdentifiers'],[ID])
        (t/'Other.m').write_text('@implementation SpikeTests\n- (void)testBind { }\n@end')
        with self.assertRaises(ValueError):source_inventory(t)

    def wait_source(self):
        # 独立synthetic源码，不依赖另一lane文件；JS string/注释不算等待证据。
        return '''
        - (id)evaluate:(NSString *)script world:(WKContentWorld *)world {
          [self waitForExpectations:@[done] timeout:5]; return output;
        }
        - (void)testSourceFreeBindAndContentWorldIsolation {
          XCTestExpectation *pageProbe = [self expectationWithDescription:@"fixture"];
          self.nextPageProbeMessage = ^{ [pageProbe fulfill]; };
          NSDictionary *pageMarker = [self evaluate:@"({key:'}'}); // JS fixture" world:world];
          [self waitForExpectations:@[pageProbe] timeout:5];
          self.nextPageProbeMessage = nil;
        }
        '''

    def test_page_probe_wait_contract_positive(self):
        self.assertEqual(contract.check_wait_order(self.wait_source()),dict(pageProbeWaitBeforeClear=True,evaluateWaitOnlyDone=True))

    def test_page_probe_deleted_wait_mutation_rejected(self):
        source=self.wait_source().replace('[self waitForExpectations:@[pageProbe] timeout:5];','// [self waitForExpectations:@[pageProbe] timeout:5];')
        with self.assertRaisesRegex(ValueError,'registration/dispatch/wait/clear'):contract.check_wait_order(source)

    def test_page_probe_early_clear_mutation_rejected(self):
        source=self.wait_source().replace('[self waitForExpectations:@[pageProbe] timeout:5];\n          self.nextPageProbeMessage = nil;',
                                         'self.nextPageProbeMessage = nil;\n          [self waitForExpectations:@[pageProbe] timeout:5];')
        with self.assertRaisesRegex(ValueError,'then clear'):contract.check_wait_order(source)

    def test_evaluate_global_wait_mutation_rejected(self):
        source=self.wait_source().replace('[self waitForExpectations:@[done] timeout:5];','[self waitForExpectationsWithTimeout:5 handler:nil];')
        with self.assertRaisesRegex(ValueError,r'only @\[done\]'):contract.check_wait_order(source)

    def test_xcode_argv_external_paths_specific_uuid_no_package_resolve(self):
        argv=runner.build_argv(self.external,UUID)
        self.assertIn('platform=iOS Simulator,id='+UUID,argv);self.assertNotIn('booted',argv)
        self.assertEqual(argv[argv.index('-derivedDataPath')+1],str(self.external/'deriveddata'))
        self.assertIn('-disableAutomaticPackageResolution',argv);self.assertIn('-onlyUsePackageVersionsFromResolvedFile',argv)
        self.assertEqual(argv[argv.index('-parallel-testing-enabled')+1],'NO')

    def command_root(self):
        for n in ['evidence','home','tmp']:(self.root/n).mkdir()
        return Commands(self.root,controlled_env(self.root))

    def test_own_child_timeout_kill_reap_and_nonzero_not_success(self):
        cmd=self.command_root()
        record=cmd.run([sys.executable,'-E','-s','-B','-c','import time;time.sleep(10)'],seconds=.1,check=False)
        self.assertTrue(record['timedOut']);self.assertTrue(record['ownerReaped']);self.assertEqual(record['code'],-signal.SIGKILL)
        with self.assertRaises(RuntimeError):cmd.run([sys.executable,'-E','-s','-B','-c','raise SystemExit(1)'])

    def test_spawn_exception_recorded_no_unknown_pid_signal(self):
        cmd=self.command_root()
        with patch('subprocess.Popen',side_effect=PermissionError('denied')),patch('os.killpg') as killed:
            with self.assertRaises(PermissionError):cmd.run(['/fake'])
            killed.assert_not_called()
        outcome=json.loads((self.root/'evidence/001-exit.json').read_text())
        self.assertEqual(outcome['errorType'],'PermissionError');self.assertFalse(outcome['ownerReaped'])

    def test_summary_actual_inventory_attachments_success(self):
        docs=result_documents();out=evaluate_results(*docs)
        self.assertEqual(out['status'],'PASS');self.assertEqual(out['observations'][ID]['actualTuple'][0]['securityOrigin']['host'],'')

    def test_unknown_nonzero_timeout_exit_never_pass(self):
        for record,status in [(dict(code=1,timedOut=False,ownerReaped=True),'FAIL'),(dict(code=None,ownerReaped=True),'INCOMPLETE'),(dict(code=-9,ownerReaped=True),'INCOMPLETE'),(dict(code=0,timedOut=True,ownerReaped=True),'INCOMPLETE')]:
            docs=list(result_documents());docs[-1]=record;self.assertEqual(evaluate_results(*docs)['status'],status)

    def test_missing_count_coverage_duplicate_and_unknown_result_incomplete(self):
        for mutate in [lambda d:d[0].pop('totalTestCount'),lambda d:d[1]['testNodes'].clear(),
                       lambda d:d[1]['testNodes'].append(copy.deepcopy(d[1]['testNodes'][0])),
                       lambda d:d[1]['testNodes'][0].update(result='UNKNOWN')]:
            docs=list(result_documents());mutate(docs);self.assertEqual(evaluate_results(*docs)['status'],'INCOMPLETE')

    def test_log_only_pass_no_attachment_no_tuple_incomplete(self):
        for mutate in [lambda d:d[3].clear(),lambda d:d[3][ID]['rawMessages'].clear(),lambda d:d[3][ID]['events'].clear(),lambda d:d[3][ID].update(test='-[Other testBind]')]:
            docs=list(result_documents());mutate(docs);self.assertEqual(evaluate_results(*docs)['status'],'INCOMPLETE')

    def test_pass_with_wrong_actual_tuple_bind_or_expected_failure_incomplete(self):
        mutations=[lambda d:d[3][ID]['rawMessages'][0]['securityOrigin'].update(host='attacker'),
                   lambda d:d[3][ID]['rawMessages'][0].update(frameIsMain=False),
                   lambda d:d[3][ID]['events'][2]['details']['command'].update(commandId=3),
                   lambda d:d[0].update(expectedFailures=1),
                   lambda d:d[0].update(result='Unknown')]
        for mutate in mutations:
            docs=list(result_documents());mutate(docs);self.assertEqual(evaluate_results(*docs)['status'],'INCOMPLETE')

    def test_run_total_deadline_before_spawn(self):
        cmd=self.command_root();cmd.deadline=0
        with patch('subprocess.Popen',side_effect=AssertionError('Expired run spawned process')):
            with self.assertRaises(TimeoutError):cmd.run(['/fake'])

    def test_injected_interrupt_containment_reaps_own_process(self):
        cmd=self.command_root()
        class Process:
            pid=12345
            returncode=None
            def __init__(self):self.waits=0
            def wait(self,timeout):
                self.waits+=1
                if self.waits==1:raise InterruptedError('fixture cancellation')
                return -signal.SIGKILL
        own=Process()
        with patch('subprocess.Popen',return_value=own),patch('os.killpg') as killed:
            with self.assertRaises(InterruptedError):cmd.run(['/fake'])
            killed.assert_called_once_with(own.pid,signal.SIGKILL)
        self.assertTrue(json.loads((self.root/'evidence/001-exit.json').read_text())['ownerReaped'])

    def test_already_reaped_on_wait_error_never_signals_reused_pid(self):
        cmd=self.command_root()
        class Process:
            pid=12345
            returncode=0
            def __init__(self):self.calls=0
            def wait(self,timeout):
                self.calls+=1
                if self.calls==1:raise KeyboardInterrupt('wait has already reaped')
                return 0
        with patch('subprocess.Popen',return_value=Process()),patch('os.killpg') as killed:
            with self.assertRaises(KeyboardInterrupt):cmd.run(['/fake'])
            killed.assert_not_called()

    def test_workflow_dispatch_only_no_install_prepack_existing_workflow_touch(self):
        workflow=(SCRIPT.parents[3]/'.github/workflows/native-reader-ios-host-spike.yml').read_text()
        self.assertIn('workflow_dispatch:',workflow);self.assertNotIn('pull_request:',workflow);self.assertNotIn('push:',workflow)
        self.assertNotIn('pnpm install',workflow);self.assertNotIn('prepack',workflow.replace('not RN tarball/prepack',''))
        self.assertIn('contents: read',workflow);self.assertIn('if: always()',workflow);self.assertIn('NATIVE_READER_INCIDENT_ANCHOR_BASE64',workflow)
        self.assertNotIn('Protect checked-out sources',workflow);self.assertNotIn('.chmod(',workflow.replace('anchor.chmod(0o400)',''))

    def test_true_failed_test_keeps_failure_attachments(self):
        docs=list(result_documents());docs[0].update(passedTests=0,failedTests=1,result='Failed');docs[1]['testNodes'][0]['result']='Failed'
        docs[3][ID].update(assertionsFailed=1,failures=[dict(description='actual XCTest failure')]);docs[3][ID]['rawMessages']=[]
        docs[4]['code']=65
        self.assertEqual(evaluate_results(*docs)['status'],'FAIL')

    def test_production_string_serialization_exception_honest_fail_or_incomplete(self):
        # 模拟gen22已经捕获的生产同步异常，不运行/修改NSJSONSerialization。
        docs=list(result_documents())
        docs[0].update(passedTests=0,failedTests=1,result='Failed')
        docs[1]['testNodes'][0]['result']='Failed'
        record=docs[3][ID]
        record.update(assertionsFailed=1,failures=[dict(description='production preflight threw: NSInvalidArgumentException')],rawMessages=[],acceptedMessages=[])
        record['events']=[dict(event='preflight-invocation-exception',details=dict(name='NSInvalidArgumentException',reason='top-level string options:0')),
                          dict(event='cleanup',details={})]
        docs[4]['code']=65
        result=evaluate_results(*docs)
        self.assertEqual(result['status'],'FAIL')
        self.assertEqual(result['observations'][ID]['events'][0]['details']['name'],'NSInvalidArgumentException')
        self.assertEqual(result['observations'][ID]['preflight'],[])
        docs[3].clear()
        self.assertEqual(evaluate_results(*docs)['status'],'INCOMPLETE')

    def test_closure_only_explicit_na_not_fabricated_tuple(self):
        key='SpikeTests/testCanonicalBundleManifestClosure()';record=attachment(key)
        record['rawMessages']=[];record['events']=[dict(event=n,details={}) for n in ['cleanup','asset-hash-measured','runtime-file-closure-measured']]
        docs=list(result_documents());docs[1]['testNodes'][0]['nodeIdentifier']=key;docs[2]['testIdentifiers']=[key];docs[3]={key:record}
        out=evaluate_results(*docs);self.assertEqual(out['status'],'PASS');self.assertIsNone(out['observations'][key]['actualTuple'])

    def mock_run(self,fail_boot=False,malformed=False,drift=False,preexisting=False,fail_delete=False,appear=False,mode=False,optional_present=False):
        old_instances=len(FakeCommands.instances)
        package=self.workspace/'packages/native-reader';package.mkdir(parents=True)
        spike=package/'apple-host-spike';spike.mkdir();project=spike/'HNFoliateHostSpike.xcodeproj';project.mkdir()
        tests=spike/'Tests';tests.mkdir();(tests/'T.m').write_text('@implementation SpikeTests\n- (void)testBind { }\n@end')
        scripts=spike/'scripts';scripts.mkdir();(scripts/'test-spike-contract.py').write_text("def check(spike): return dict(status='SYNTHETIC_CONTRACT_ONLY')")
        manifest=package/'SECURE_WEBVIEW_SHA256.json';manifest.write_text('mock current manifest')
        manifest.chmod(0o644)
        optional=package/'foliate-runtime'
        if optional_present:optional.mkdir();(optional/'asset').write_text('mock optional asset')
        anchor=self.root/'anchor';anchor.write_text('mock original anchor')
        FakeCommands.fail_boot=fail_boot;FakeCommands.malformed_uuid=malformed;FakeCommands.change_authority=manifest if drift else None
        FakeCommands.preexisting=preexisting;FakeCommands.fail_delete=fail_delete
        FakeCommands.appear_optional=optional if appear else None;FakeCommands.change_mode=manifest if mode else None
        import hashlib
        with patch.multiple(runner,SPIKE=spike,PACKAGE=package,WORKSPACE=self.workspace,PROJECT=project,Commands=FakeCommands,
                            MANIFEST_SHA=hashlib.sha256(manifest.read_bytes()).hexdigest(),ANCHOR_SHA=hashlib.sha256(anchor.read_bytes()).hexdigest()),\
             patch.object(runner,'tool_preflight'),patch.object(runner,'probe_api',return_value=dict(status='SYNTHETIC_API')),\
             patch.object(runner,'required_runtime_preflight'),patch.object(runner,'optional_authorities',return_value=[optional]),\
             patch.object(runner,'authorities',return_value=[spike,manifest,anchor]):
            outcome=runner.run(self.external,RUNTIME,anchor)
            return outcome,FakeCommands.instances[-1] if len(FakeCommands.instances)>old_instances else None

    def test_mock_full_lifecycle_uuid_cleanup_before_after_and_raw_result(self):
        result,cmd=self.mock_run();self.assertEqual(result['status'],'PASS')
        self.assertTrue(result['authorityUnchanged']);self.assertTrue(result['simulatorCleanup']['deleted'])
        self.assertEqual([a for a in cmd.calls if a[:3]==['/usr/bin/xcrun','simctl','delete']][0][-1],UUID)
        self.assertTrue((pathlib.Path(result['outputRoot'])/'HostSpike.xcresult/raw').exists())
        before=json.loads((pathlib.Path(result['outputRoot'])/'evidence/before.json').read_text())
        self.assertFalse(before['authorities'][str(self.workspace/'packages/native-reader/foliate-runtime')]['present'])

    def test_mock_optional_present_protected_full_digest(self):
        result,cmd=self.mock_run(optional_present=True);self.assertEqual(result['status'],'PASS')
        before=json.loads((pathlib.Path(result['outputRoot'])/'evidence/before.json').read_text())
        entry=before['authorities'][str(self.workspace/'packages/native-reader/foliate-runtime')]
        self.assertTrue(entry['present']);self.assertEqual(entry['digest']['entries'],2)

    def test_mock_optional_appearance_overrides_pass(self):
        result,cmd=self.mock_run(appear=True);self.assertEqual(result['status'],'INCOMPLETE')
        after=json.loads((pathlib.Path(result['outputRoot'])/'evidence/after.json').read_text())
        self.assertFalse(after['unchanged'])

    def test_mock_original_source_modes_not_normalized_mutation_incomplete(self):
        result,cmd=self.mock_run(mode=True);self.assertEqual(result['status'],'INCOMPLETE')
        manifest=self.workspace/'packages/native-reader/SECURE_WEBVIEW_SHA256.json'
        self.assertEqual(manifest.stat().st_mode & 0o777,0o600)  # runner不恢复/伪装mode。
        self.assertTrue(any(e.get('phase')=='authority-finally' for e in result['errors']))

    def test_mock_boot_failure_cleanup_owned_uuid_only_and_incomplete(self):
        result,cmd=self.mock_run(fail_boot=True);self.assertEqual(result['status'],'INCOMPLETE')
        self.assertTrue(result['simulatorCleanup']['deleted']);self.assertFalse(any(a[:2]==['/usr/bin/xcodebuild','test'] for a in cmd.calls))

    def test_mock_unknown_uuid_never_delete_someone_else(self):
        result,cmd=self.mock_run(malformed=True);self.assertEqual(result['status'],'INCOMPLETE')
        self.assertFalse(any(a[:3]==['/usr/bin/xcrun','simctl','delete'] for a in cmd.calls));self.assertIsNone(result['simulatorCleanup']['createdUUID'])

    def test_mock_returned_preexisting_uuid_never_adopt_or_delete(self):
        result,cmd=self.mock_run(preexisting=True);self.assertEqual(result['status'],'INCOMPLETE')
        self.assertIsNone(result['simulatorCleanup']['createdUUID']);self.assertFalse(any(a[:3]==['/usr/bin/xcrun','simctl','delete'] for a in cmd.calls))

    def test_mock_owned_cleanup_failure_overrides_pass_no_retry(self):
        result,cmd=self.mock_run(fail_delete=True);self.assertEqual(result['status'],'INCOMPLETE')
        self.assertFalse(result['simulatorCleanup']['deleted'])
        self.assertEqual(len([a for a in cmd.calls if a[:3]==['/usr/bin/xcrun','simctl','delete']]),1)

    def test_mock_before_persistence_error_no_apple_spawn(self):
        real_save=runner.save
        def fault(path,value):
            if pathlib.Path(path).name=='before.json':raise PermissionError('Injected write denied without chmod workaround')
            return real_save(path,value)
        with patch.object(runner,'save',side_effect=fault):result,cmd=self.mock_run()
        self.assertEqual(result['status'],'INCOMPLETE')
        self.assertIsNone(cmd)  # Commands未构造，任何Apple调用都未发生。
        self.assertIsNone(result['simulatorCleanup']['createdUUID'])
        self.assertEqual((self.workspace/'packages/native-reader/SECURE_WEBVIEW_SHA256.json').stat().st_mode & 0o777,0o644)

    def test_mock_authority_mutation_overrides_result_pass(self):
        result,cmd=self.mock_run(drift=True);self.assertEqual(result['status'],'INCOMPLETE')
        self.assertTrue(result['simulatorCleanup']['deleted']);self.assertTrue(any(e.get('phase')=='authority-finally' for e in result['errors']))

    def test_help_schema_not_probed_never_guess_api_flags(self):
        cmd=self.command_root()
        with patch.object(cmd,'run',return_value=dict(stdoutPath=str(self.root/'missing'),stderrPath=str(self.root/'missing'))):
            with self.assertRaises(FileNotFoundError):runner.probe_api(cmd)

    def test_modern_pre_result_help_only_actual_result_path_and_fresh_export(self):
        root=self.root/'probe';root.mkdir();(root/'evidence').mkdir();(root/'attachments').mkdir()
        class ProbeCommands(FakeCommands):
            def run(self,argv,seconds=30,check=True):
                if argv[:2]==['/usr/bin/xcodebuild','-help'] or argv[:3]==['/usr/bin/xcrun','xcresulttool','help']:
                    self.calls.append(argv);p=self.root/'evidence'/('help-%03d.log'%len(self.calls))
                    p.write_text('-disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile -derivedDataPath -resultBundlePath -parallel-testing-enabled --path --output-path --test-id')
                    return dict(stdoutPath=str(p),stderrPath=str(p))
                return super().run(argv,seconds,check)
        FakeCommands.change_authority=None;FakeCommands.appear_optional=None;FakeCommands.change_mode=None
        cmd=ProbeCommands(root,{})
        runner.probe_api(cmd)
        self.assertFalse(any('--schema' in a for a in cmd.calls))
        self.assertTrue(all(a[2]=='help' for a in cmd.calls if a[:2]==['/usr/bin/xcrun','xcresulttool']))
        with self.assertRaises((ValueError,FileExistsError)):runner.collect_results(cmd,root,dict(testIdentifiers=[ID]),dict(code=0))
        self.assertFalse(any(a[:3]==['/usr/bin/xcrun','xcresulttool','get'] for a in cmd.calls))
        cmd.run(['/usr/bin/xcodebuild','test'])
        result=runner.collect_results(cmd,root,dict(testIdentifiers=[ID]),dict(code=0,timedOut=False,ownerReaped=True))
        self.assertEqual(result['status'],'PASS')
        actual=[a for a in cmd.calls if a[:2]==['/usr/bin/xcrun','xcresulttool'] and a[2]!='help']
        self.assertEqual(len(actual),3)
        for argv in actual:self.assertEqual(argv[argv.index('--path')+1],str(root/'HostSpike.xcresult'))
        export=actual[-1];self.assertEqual(export[export.index('--test-id')+1],ID)
        self.assertEqual(export[export.index('--output-path')+1],str(root/'attachments/000'))
        with self.assertRaises((ValueError,FileExistsError)):runner.collect_results(cmd,root,dict(testIdentifiers=[ID]),dict(code=0))


if __name__=='__main__':unittest.main(verbosity=2)
