"""source-free spike基础设施；仅标准库，证据真实性优先于兼容猜测。"""
import hashlib
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import time

MANIFEST_SHA = '4231493d9742d74e9c78704cae60865f01348d41d4c69f1e290ce296a766aaa8'
ANCHOR_SHA = 'ed712e6627a56999b9a7a393bb481d35647daf9b4604be184f5cf4ae55dc836a'
MAX_JSON = 16 * 1024 * 1024


def canonical_no_links(value, directory=True):
    """不接受含symlink的parent链；Mac /var别名须调用者先选真实/private路径。"""
    path = pathlib.Path(value)
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise ValueError('Path must be absolute/canonical: '+str(path))
    for part in [path, *path.parents]:
        if stat.S_ISLNK(part.lstat().st_mode):
            raise ValueError('Symlink component refused: '+str(part))
    if directory and not path.is_dir():
        raise ValueError('Existing real directory required')
    return path


def overlaps(a, b):
    return a == b or a in b.parents or b in a.parents


def output_parent(value, workspace, authorities):
    path = canonical_no_links(value)
    for authority in [workspace, *authorities]:
        if overlaps(path, pathlib.Path(authority)):
            raise ValueError('Output overlaps authority/workspace: '+str(authority))
    return path


def file_bytes(path, limit=MAX_JSON):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError('Not bounded regular input: '+str(path))
        parts, left = [], limit+1
        while left:
            data = os.read(fd, min(left, 1024*1024))
            if not data:
                break
            parts.append(data); left -= len(data)
        after = os.fstat(fd)
        fields = ['st_dev','st_ino','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']
        if len(b''.join(parts)) > limit or any(getattr(before,k) != getattr(after,k) or getattr(after,k) != getattr(pathlib.Path(path).lstat(),k) for k in fields):
            raise ValueError('Input mutated/too large: '+str(path))
        return b''.join(parts)
    finally:
        os.close(fd)


def read_json(path):
    return json.loads(file_bytes(path))


def save(path, value):
    """exclusive/fsync；不改写已有证据，不宣称跨平台事务提交协议。"""
    data = (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        at = 0
        while at < len(data):
            count = os.write(fd, data[at:])
            if count <= 0:
                raise OSError('Zero evidence write')
            at += count
        os.fsync(fd)
    finally:
        os.close(fd)


def digest(path):
    """完整framed树摘要：mode/type/bytes/空目录；拒绝authority内的links。"""
    path = pathlib.Path(path); h = hashlib.sha256(); count = 0
    def frame(data):
        h.update(str(len(data)).encode()+b':'+data)
    def visit(target, relative):
        nonlocal count
        before = target.lstat(); count += 1
        frame(json.dumps([relative,before.st_mode],separators=(',',':')).encode())
        if stat.S_ISLNK(before.st_mode):
            raise ValueError('Authority link refused: '+str(target))
        if stat.S_ISDIR(before.st_mode):
            names = sorted(os.listdir(target)); frame(b'directory')
            for name in names:
                visit(target/name, str(pathlib.Path(relative)/name))
            if sorted(os.listdir(target)) != names:
                raise ValueError('Authority directory mutated during read')
        elif stat.S_ISREG(before.st_mode):
            fd = os.open(target,os.O_RDONLY|os.O_NOFOLLOW)
            try:
                current = os.fstat(fd)
                if (current.st_dev,current.st_ino) != (before.st_dev,before.st_ino):
                    raise ValueError('Authority replaced')
                frame(('file:'+str(current.st_size)).encode())
                while True:
                    data = os.read(fd,1024*1024)
                    if not data: break
                    h.update(data)
                final_fd=os.fstat(fd)
                if any(getattr(current,k)!=getattr(final_fd,k) for k in ['st_dev','st_ino','st_size','st_mode','st_mtime_ns','st_ctime_ns']):
                    raise ValueError('Authority fd changed while hashing')
            finally:
                os.close(fd)
        else:
            raise ValueError('Unsupported authority type')
        after = target.lstat()
        if any(getattr(before,k) != getattr(after,k) for k in ['st_dev','st_ino','st_size','st_mode','st_mtime_ns','st_ctime_ns']):
            raise ValueError('Authority changed while hashing')
    visit(path,'')
    return dict(sha256=h.hexdigest(),entries=count)


def snapshot(paths):
    return {str(p):digest(p) for p in paths}


def authority_snapshot(required, optional):
    """required缺失即拒绝；optional缺失是受保护状态，不生成/fallback。"""
    records = {}
    for path in required:
        canonical_no_links(path,directory=path.is_dir())
        records[str(path)] = dict(required=True,present=True,digest=digest(path))
    for path in optional:
        # lexists包含dangling link；link不是“缺失”，也不能混过absence保护。
        if os.path.lexists(path):
            canonical_no_links(path,directory=path.is_dir())
            records[str(path)] = dict(required=False,present=True,digest=digest(path))
        else:
            canonical_no_links(path.parent)
            if path.parent/path.name != path or pathlib.Path(os.path.abspath(path)) != path:
                raise ValueError('Optional authority path not canonical')
            records[str(path)] = dict(required=False,present=False)
    return records


def controlled_env(root, developer_dir=None):
    env = dict(PATH='/usr/bin:/bin:/usr/sbin:/sbin',HOME=str(root/'home'),TMPDIR=str(root/'tmp'),
               CFFIXED_USER_HOME=str(root/'home'),LANG='en_US.UTF-8',LC_ALL='en_US.UTF-8',
               PYTHONDONTWRITEBYTECODE='1')
    if developer_dir:
        env['DEVELOPER_DIR'] = str(canonical_no_links(developer_dir))
    return env


class Commands:
    """own unreaped session/group only；未知PID无信号；timeout先kill再reap。"""
    def __init__(self, root, env, deadline=None):
        self.root, self.env, self.sequence, self.deadline = root,env,0,deadline

    def run(self, argv, seconds=30, check=True):
        if self.deadline is not None:
            seconds = min(seconds,self.deadline-time.monotonic())
            if seconds<=0:raise TimeoutError('Command wall deadline reached')
        self.sequence += 1
        prefix = self.root/'evidence'/('%03d'%self.sequence)
        save(str(prefix)+'-invocation.json',dict(argv=argv,timeoutSeconds=seconds,startedUTC=time.time()))
        process = None; reaped = False; outcome = dict(code=None,timedOut=False,ownerReaped=False)
        # 文件日志不通过PIPE积攒无界内存；原始日志完整保留。
        with open(str(prefix)+'-stdout.log','xb') as out, open(str(prefix)+'-stderr.log','xb') as err:
            try:
                process = subprocess.Popen(argv,cwd=self.root,env=self.env,stdin=subprocess.DEVNULL,
                                           stdout=out,stderr=err,start_new_session=True)
                outcome['pid'] = process.pid
                try:
                    code = process.wait(timeout=seconds); reaped = True
                except subprocess.TimeoutExpired:
                    outcome['timedOut'] = True
                    # leader未wait/reap，PID仍为本子进程；不扫描或signal陌生PID。
                    if process.returncode is None:
                        try:os.killpg(process.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                    code = process.wait(timeout=5); reaped = True
                outcome.update(code=code,ownerReaped=True)
            except BaseException as error:
                outcome.update(errorType=type(error).__name__,errno=getattr(error,'errno',None),message=str(error))
                raise
            finally:
                if process is not None and not reaped:
                    # Popen.wait遇KeyboardInterrupt时自身可能已reap；不能再signal复用PID。
                    if process.returncode is None:
                        try:os.killpg(process.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                    try:process.wait(timeout=5);outcome['ownerReaped']=True
                    except subprocess.TimeoutExpired:pass
                out.flush();err.flush();os.fsync(out.fileno());os.fsync(err.fileno())
                save(str(prefix)+'-exit.json',outcome)
        record = dict(outcome,stdoutPath=str(prefix)+'-stdout.log',stderrPath=str(prefix)+'-stderr.log')
        if check and (outcome['code'] != 0 or outcome['timedOut'] or not outcome['ownerReaped']):
            raise RuntimeError('Command failed/timeout: '+json.dumps(record))
        return record


def command_json(commands, argv, seconds=30):
    record = commands.run(argv,seconds)
    return read_json(record['stdoutPath'])


def select_simulator(runtime_id, runtimes, device_types):
    matches = [r for r in runtimes.get('runtimes',[]) if r.get('identifier') == runtime_id and r.get('isAvailable') is True]
    if len(matches)!=1 or not runtime_id.startswith('com.apple.CoreSimulator.SimRuntime.iOS-'):
        raise ValueError('Exact available iOS runtime required; no fallback')
    runtime = matches[0];supported = runtime.get('supportedDeviceTypes')
    # 没有兼容表时不猜device；交给实际Mac探测，不使用booted。
    if not isinstance(supported,list):
        raise ValueError('Runtime lacks supportedDeviceTypes; selection unassessed')
    identifiers = {d['identifier'] for d in supported if isinstance(d,dict) and isinstance(d.get('identifier'),str)}
    devices = [d for d in device_types.get('devicetypes',[]) if d.get('identifier') in identifiers and d.get('productFamily')=='iPhone']
    if not devices:
        raise ValueError('No compatible iPhone device type')
    return runtime,sorted(devices,key=lambda d:d['identifier'])[0]


def source_inventory(tests_root):
    """仅明确ObjC XCTest无参数方法；宏/Swift未知形式不猜，交付后父级核准。"""
    ids = []; files = []
    for path in sorted(pathlib.Path(tests_root).rglob('*.m')):
        source = file_bytes(path).decode()
        clean = re.sub(r'/\*.*?\*/|//[^\n]*','',source,flags=re.S)
        classes = re.findall(r'@implementation\s+(\w+)\s*(.*?)@end',clean,flags=re.S)
        for cls,body in classes:
            for name in re.findall(r'-\s*\(\s*void\s*\)\s*(test\w+)\s*\{',body):
                ids.append(cls+'/'+name+'()')
        files.append(dict(path=str(path),sha256=hashlib.sha256(file_bytes(path)).hexdigest()))
    if list(pathlib.Path(tests_root).rglob('*.swift')):
        raise ValueError('Swift test inventory unsupported; parent must adapt parser explicitly')
    if not ids or len(ids)!=len(set(ids)):
        raise ValueError('No unambiguous source test inventory')
    return dict(testIdentifiers=sorted(ids),files=files,status='SOURCE_PARSED_REQUIRES_PARENT_APPROVAL')


def attachment_identity(record):
    name = record.get('test')
    match = re.fullmatch(r'-\[(\w+)\s+(test\w+)\]',name or '')
    if not match:raise ValueError('Unknown actual XCTest attachment identity')
    return match[1]+'/'+match[2]+'()'


def validate_attachment(key, record, passed):
    """解析gen22实际事件格式；closure-only测试明确N/A，不伪造tuple/preflight。"""
    if type(record.get('schemaVersion')) is not int or record['schemaVersion']!=1 or attachment_identity(record)!=key or record.get('execution')!='hosted-xctest-real-wkwebview' or record.get('scope')!='source/publication-free':
        raise ValueError('Attachment schema/identity/execution mismatch')
    if not isinstance(record.get('events'),list) or not isinstance(record.get('rawMessages'),list) or not isinstance(record.get('acceptedMessages'),list) or not isinstance(record.get('failures'),list) or type(record.get('assertionsFailed')) is not int or record['assertionsFailed']!=len(record['failures']):
        raise ValueError('Attachment missing actual event/failure records')
    if passed and record['assertionsFailed']!=0:raise ValueError('Passed XCTest has assertion failures')
    events = record['events']
    def event(name):return [e.get('details') for e in events if isinstance(e,dict) and e.get('event')==name]
    if not event('cleanup'):raise ValueError('Test teardown evidence missing')
    closure = key.endswith('/testCanonicalBundleManifestClosure()')
    if closure:
        if passed and (not event('asset-hash-measured') or not event('runtime-file-closure-measured')):raise ValueError('Measured closure evidence missing')
        return dict(actualTuple=None,preflight=None,bind=None,notApplicableReason='Runtime asset closure only; no WebView bind is performed',events=events)
    preflight=event('actual-preflight-outcome');dispatch=event('native-bind-dispatch');acks=event('production-accepted-message')
    actual = record['rawMessages']
    # 正常失败可能没有走到bind，保留实测的缺失状态，不能称成功；PASSED则严查。
    if passed:
        if len(preflight)!=1 or preflight[0].get('passed') is not True or not dispatch or dispatch[0].get('sent') is not True or not acks or not actual:
            raise ValueError('Passed test missing real preflight/bind/tuple')
        for row in actual:
            origin=row.get('securityOrigin',{})
            if not isinstance(origin.get('protocol'),str) or not isinstance(origin.get('host'),str) or type(origin.get('port')) is not int or type(row.get('frameIsMain')) is not bool or not isinstance(row.get('webViewURL'),str) or not isinstance(row.get('frameURL'),str):
                raise ValueError('Actual WK tuple missing/invalid')
        # file origin空host是本spike待实测条件，不能因empty host丢弃真实tuple。
        initial=actual[0]
        if initial['securityOrigin']!=dict(protocol='file',host='',port=0) or initial['frameIsMain'] is not True or initial.get('isNamedWorld') is not True or initial.get('worldName')!='hn-foliate-host' or initial['frameURL']!=initial['webViewURL'] or not initial['webViewURL'].startswith('file:'):
            raise ValueError('Passed test actual tuple conflicts with production strict file gate')
        command=dispatch[0].get('command',{})
        ack=json.loads(acks[0].get('rawAck',''))
        expected=dict(command,direction='host-to-native',type='ack',payload=dict(command='bind',status='bridge-bound'))
        if command.get('type')!='bind' or command.get('commandId')!=0 or command.get('direction')!='native-to-host' or ack!=expected:
            raise ValueError('Passed test lacks matching commandId0 bridge-bound ack')
        if not record['acceptedMessages'] or json.loads(record['acceptedMessages'][0])!=ack:
            raise ValueError('Accepted messages/ack attachment mismatch')
    return dict(actualTuple=actual,preflight=preflight,bind=dict(dispatch=dispatch,accepted=acks),events=events)


def evaluate_results(summary, tests, inventory, evidence, exit_record):
    """仅支持现代xcresult JSON；无法识别、缺attachment/tuple均INCOMPLETE。"""
    ids = inventory['testIdentifiers']; found = {}; errors = []
    def visit(node):
        if not isinstance(node,dict):raise ValueError('Bad test tree node')
        if node.get('nodeType')=='Test Case':
            key=node.get('nodeIdentifier')
            if key in found or key not in ids:raise ValueError('Duplicate/unknown test identifier')
            if any(child.get('nodeType') not in ['Failure Message'] for child in node.get('children',[])):
                raise ValueError('Repetition/parameterized test nodes unsupported')
            if node.get('result') not in ['Passed','Failed','Skipped']:raise ValueError('Unknown test result')
            found[key]=node['result']
        else:
            for child in node.get('children',[]):visit(child)
    try:
        if not isinstance(tests.get('testNodes'),list):raise ValueError('Missing testNodes')
        for node in tests['testNodes']:visit(node)
        if set(found)!=set(ids):raise ValueError('Exact source inventory coverage missing')
        counts = dict(totalTestCount=len(ids),passedTests=sum(v=='Passed' for v in found.values()),
                      failedTests=sum(v=='Failed' for v in found.values()),skippedTests=sum(v=='Skipped' for v in found.values()))
        for key,value in counts.items():
            if type(summary.get(key)) is not int or summary[key]!=value:raise ValueError('Summary count mismatch: '+key)
        if type(summary.get('expectedFailures')) is not int or summary['expectedFailures']!=0:
            raise ValueError('Unknown/nonzero expected failure count')
        if summary.get('result') not in ['Passed','Failed']:
            raise ValueError('Unknown summary result')
        if counts['failedTests'] and summary['result']!='Failed':raise ValueError('Summary failure contradicted')
        if set(evidence)!=set(ids):raise ValueError('Per-test actual evidence missing')
        observations={key:validate_attachment(key,record,found[key]=='Passed') for key,record in evidence.items()}
        if exit_record.get('timedOut') or exit_record.get('ownerReaped') is not True or type(exit_record.get('code')) is not int or exit_record['code']<0:raise ValueError('Unknown/timeout/signal exit')
        # 非zero绝不PASS；只有严格inventory和证据完整的正常失败才为FAIL。
        status='PASS' if exit_record['code']==0 and summary['result']=='Passed' and counts['failedTests']==0 and counts['skippedTests']==0 else 'FAIL'
        return dict(status=status,counts=counts,perTest=found,observations=observations,errors=[])
    except (ValueError,TypeError,KeyError,AttributeError) as error:
        errors.append(str(error))
        return dict(status='INCOMPLETE',counts=None,perTest=found,errors=errors)
