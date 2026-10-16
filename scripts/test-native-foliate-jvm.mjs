import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Compile the production protocol class verbatim. These tests need only a JDK;
// they prove parser/ledger behavior, never Android WebView/port behavior. The
// separate isolated Robolectric and installed-WebView gates remain required.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(
  path.join(
    root,
    'packages/native-reader/android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebView.java',
  ),
  'utf8',
);
const start = source.indexOf(
  '    static final class NativeFoliateHostBridge {',
);
const end = source.indexOf(
  '    protected static class ProgressChangedFilter',
  start,
);
assert.ok(start >= 0 && end > start, 'production protocol class boundaries');
const productionClass = source.slice(start, end);
const corpusFile = path.join(
  root,
  'packages/native-reader/secure-webview/foliate-host-wire-corpus.v1.json',
);
const java = `import java.util.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

public class FoliateProtocolJvm {
  @interface Nullable {}
  static final String NATIVE_READER_HOST_URL = "https://appassets.androidplatform.net/foliate/reader.html";
  static final java.security.SecureRandom PRIVATE_BRIDGE_RANDOM = new java.security.SecureRandom();
  // Only Android's base64 API used by the transport installation token is
  // shimmed. No parser, envelope, identity or command logic is replaced.
  static class Base64 {
    static final int URL_SAFE = 8, NO_PADDING = 1, NO_WRAP = 2;
    static String encodeToString(byte[] bytes, int flags) {
      return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
  }
${productionClass}
  static void check(boolean condition, String label) {
    if (!condition) throw new AssertionError(label);
  }
  static NativeFoliateHostBridge bridge() {
    NativeFoliateHostBridge value = new NativeFoliateHostBridge();
    check(value.beginReload(), "reload");
    check(value.createInstallToken() != null, "install token");
    value.onPrivatePortInstalled();
    return value;
  }
  static String disposition(Enum<?> result) {
    switch (result.name()) {
      case "ACCEPTED": case "ACCEPTED_TERMINAL": return "accepted";
      case "NO_OP": return "no-op";
      default: return "terminal";
    }
  }
  @SuppressWarnings("unchecked")
  public static void main(String[] args) throws Exception {
    Map<String, Object> corpus = (Map<String, Object>) new NativeFoliateHostBridge.StrictJson(Files.readString(Path.of(args[0]))).parse();
    Map<String, String> wires = new HashMap<>();
    int cases = 0;
    for (String section : List.of("cases", "semanticCases")) {
      for (Map<String, Object> entry : (List<Map<String, Object>>) corpus.get(section)) {
        String wire = (String) entry.get("wire");
        boolean valid = NativeFoliateHostBridge.parse(wire, "native-to-host") != null
          || NativeFoliateHostBridge.parse(wire, "host-to-native") != null;
        check(valid == (Boolean) entry.get("parse"), (String) entry.get("id"));
        wires.put((String) entry.get("id"), wire);
        cases++;
      }
    }
    int malformed = 0;
    for (Map.Entry<String, String> entry : wires.entrySet()) {
      if (!entry.getKey().startsWith("invalid-")) continue;
      NativeFoliateHostBridge value = bridge();
      // Preserve malformed bytes; these corpus fixtures declare their test direction literally.
      boolean hostEvent = entry.getValue().contains("\\"direction\\":\\"host-to-native\\"");
      if (hostEvent) value.send(true, NATIVE_READER_HOST_URL, wires.get("valid-bind"));
      Enum<?> result = hostEvent ? value.receive(true, NATIVE_READER_HOST_URL, entry.getValue())
        : value.send(true, NATIVE_READER_HOST_URL, entry.getValue());
      check(disposition(result).equals("terminal"), "current malformed: " + entry.getKey());
      malformed++;
    }
    int scenarios = 0;
    for (Map<String, Object> scenario : (List<Map<String, Object>>) corpus.get("scenarios")) {
      NativeFoliateHostBridge value = bridge();
      for (Map<String, String> step : (List<Map<String, String>>) scenario.get("steps")) {
        String wire = wires.get(step.get("case"));
        boolean command = NativeFoliateHostBridge.parse(wire, "native-to-host") != null;
        Enum<?> actual = command ? value.send(true, NATIVE_READER_HOST_URL, wire)
          : value.receive(true, NATIVE_READER_HOST_URL, wire);
        check(disposition(actual).equals(step.get("expect")), scenario.get("id") + ": " + step.get("case"));
      }
      scenarios++;
    }
    for (Map<String, String> entry : (List<Map<String, String>>) corpus.get("identityCases")) {
      NativeFoliateHostBridge identity = bridge();
      identity.send(true, NATIVE_READER_HOST_URL, wires.get("valid-bind"));
      Enum<?> actual = entry.get("direction").equals("native-to-host")
        ? identity.send(true, NATIVE_READER_HOST_URL, entry.get("wire"))
        : identity.receive(true, NATIVE_READER_HOST_URL, entry.get("wire"));
      check(disposition(actual).equals(entry.get("expect")), entry.get("id"));
      if (entry.get("expect").equals("no-op")) {
        check(disposition(identity.receive(true, NATIVE_READER_HOST_URL, wires.get("valid-ack-bind"))).equals("accepted"), entry.get("id") + " preserved inflight");
      }
    }
    NativeFoliateHostBridge value = bridge();
    String bind = wires.get("valid-bind");
    check(disposition(value.send(true, NATIVE_READER_HOST_URL, bind)).equals("accepted"), "bind");
    value.receive(true, NATIVE_READER_HOST_URL, wires.get("valid-ack-bind"));
    String flowId = NativeFoliateHostBridge.parse(wires.get("valid-flow"), "native-to-host").commandId;
    for (int index = 1; index < 4096; index++) {
      String id = "a".repeat(43 - String.valueOf(index).length()) + index;
      check(disposition(value.send(true, NATIVE_READER_HOST_URL, wires.get("valid-flow").replace(flowId, id))).equals("accepted"), "flow " + index);
      check(disposition(value.receive(true, NATIVE_READER_HOST_URL, wires.get("valid-ack-flow").replace(flowId, id))).equals("accepted"), "ack " + index);
    }
    check(disposition(value.send(true, NATIVE_READER_HOST_URL, bind)).equals("no-op"), "old IDs never evicted");
    check(disposition(value.send(true, NATIVE_READER_HOST_URL, wires.get("valid-flow"))).equals("terminal"), "finite ID memory");
    System.out.println("Production JVM protocol: " + cases + " raw cases, " + malformed + " current malformed dispatches, " + ((List<?>) corpus.get("identityCases")).size() + " identity cases, " + scenarios + " scenarios, 4096-command boundary passed. No Android WebView behavior claimed.");
  }
}
`;
const temporary = await mkdtemp(path.join(os.tmpdir(), 'hn-foliate-protocol-'));
const executable = (name) =>
  process.env.JAVA_HOME
    ? path.join(
        process.env.JAVA_HOME,
        'bin',
        process.platform === 'win32' ? `${name}.exe` : name,
      )
    : name;
try {
  const file = path.join(temporary, 'FoliateProtocolJvm.java');
  await writeFile(file, java);
  execFileSync(
    executable('javac'),
    ['-encoding', 'UTF-8', '-d', temporary, file],
    { stdio: 'inherit' },
  );
  execFileSync(
    executable('java'),
    ['-cp', temporary, 'FoliateProtocolJvm', corpusFile],
    { stdio: 'inherit' },
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
