package com.hamsternote.nativereader.securewebview;

import static org.junit.Assert.*;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class HNPdfAssetsTest {
    private static String hash(byte[] data) throws Exception {
        StringBuilder value = new StringBuilder();
        for (byte part : MessageDigest.getInstance("SHA-256").digest(data))
            value.append(String.format(java.util.Locale.ROOT, "%02x", part & 255));
        return value.toString();
    }
    private static final class Fixture {
        final Map<String, byte[]> files = new HashMap<>();
        final JSONArray entries = new JSONArray();
        final AtomicInteger opens = new AtomicInteger();
        Fixture() throws Exception {
            for (String name : new String[]{"android-reader.html", "android-shell.mjs", "reader.html", "shell.mjs",
                    "shell.css", "protocol.js", "adapter.js", "pdf.worker.min.mjs", "pdf.css", "wasm/qcms_bg.wasm", "READER_LICENSE"}) {
                final byte[] bytes = ("static-" + name).getBytes(StandardCharsets.UTF_8);
                files.put("pdf-runtime/" + name, bytes);
                String mime = name.equals("READER_LICENSE") ? "text/plain"
                        : name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css"
                        : name.endsWith(".wasm") ? "application/wasm" : "text/javascript";
                entries.put(new JSONObject().put("path", name).put("mimeType", mime)
                        .put("size", bytes.length).put("sha256", hash(bytes)));
            }
            save();
        }
        void save() throws Exception {
            files.put("pdf-runtime/manifest.json", new JSONObject().put("version", 1).put("pdfjsVersion", "5.4.530")
                    .put("files", entries).toString().getBytes(StandardCharsets.UTF_8));
        }
        HNPdfAssets host() throws Exception {
            return new HNPdfAssets(name -> {
                opens.incrementAndGet();
                final byte[] value = files.get(name);
                if (value == null) throw new IOException("missing");
                return new ByteArrayInputStream(value);
            });
        }
    }

    @Test public void exactResourcesCarryMimeCspAndNoSniff() throws Exception {
        Fixture fixture = new Fixture();
        HNPdfAssets host = fixture.host();
        WebResourceResponse html = host.intercept(Uri.parse(HNPdfAssets.HOST));
        assertEquals(200, html.getStatusCode());
        assertEquals("text/html", html.getMimeType());
        assertEquals(HNPdfAssets.CSP, html.getResponseHeaders().get("Content-Security-Policy"));
        assertEquals("nosniff", html.getResponseHeaders().get("X-Content-Type-Options"));
        assertEquals("text/javascript", host.intercept(Uri.parse(HNPdfAssets.ORIGIN + "/pdf-runtime/adapter.js")).getMimeType());
        assertEquals("application/wasm", host.intercept(Uri.parse(HNPdfAssets.ORIGIN + "/pdf-runtime/wasm/qcms_bg.wasm")).getMimeType());
        assertEquals("text/plain", host.intercept(Uri.parse(HNPdfAssets.ORIGIN + "/pdf-runtime/READER_LICENSE")).getMimeType());
    }

    @Test public void everyRealStagedManifestEntryIsServedWithItsAuthoritativeMimeAndBytes() throws Exception {
        java.util.function.Function<String, java.io.InputStream> resource = name ->
                getClass().getClassLoader().getResourceAsStream("hn-pdf-runtime/" + name);
        byte[] manifestBytes;
        try (java.io.InputStream input = resource.apply("manifest.json")) {
            assertNotNull("The harness must stage the real PDF runtime", input);
            manifestBytes = input.readAllBytes();
        }
        JSONObject manifest = new JSONObject(new String(manifestBytes, StandardCharsets.UTF_8));
        JSONArray files = manifest.getJSONArray("files");
        assertTrue(files.length() > 200);
        HNPdfAssets host = new HNPdfAssets(name -> {
            java.io.InputStream input = resource.apply(name.substring("pdf-runtime/".length()));
            if (input == null) throw new IOException("Missing staged resource");
            return input;
        });
        boolean license = false;
        for (int index = 0; index < files.length(); index++) {
            JSONObject file = files.getJSONObject(index);
            String path = file.getString("path");
            if (path.equals("READER_LICENSE")) { license = true; assertEquals("text/plain", file.getString("mimeType")); }
            WebResourceResponse response = host.intercept(Uri.parse(HNPdfAssets.ORIGIN + HNPdfAssets.ROOT + path));
            assertEquals(path, 200, response.getStatusCode());
            assertEquals(path, file.getString("mimeType"), response.getMimeType());
            byte[] bytes = response.getData().readAllBytes();
            assertEquals(path, file.getLong("size"), bytes.length);
            assertEquals(path, file.getString("sha256"), hash(bytes));
        }
        assertTrue("The regression must include READER_LICENSE", license);
    }

    @Test public void unknownTraversalEncodingAndRemotePathsNeverReadAnAsset() throws Exception {
        Fixture fixture = new Fixture();
        HNPdfAssets host = fixture.host();
        int before = fixture.opens.get();
        for (String value : new String[]{
                "https://example.com/pdf-runtime/adapter.js", "http://appassets.androidplatform.net/pdf-runtime/adapter.js",
                HNPdfAssets.ORIGIN + ":443/pdf-runtime/adapter.js", HNPdfAssets.HOST + "?query=yes", HNPdfAssets.HOST + "#fragment",
                HNPdfAssets.ORIGIN + "/pdf-runtime/../adapter.js", HNPdfAssets.ORIGIN + "/pdf-runtime/%2e%2e/adapter.js",
                HNPdfAssets.ORIGIN + "/pdf-runtime/wasm%2fqcms_bg.wasm", HNPdfAssets.ORIGIN + "/pdf-runtime/unknown.js",
                HNPdfAssets.ORIGIN + "/pdf-runtime/manifest.json", HNPdfAssets.ORIGIN + "/foliate/reader.html", "file:///private.pdf"}) {
            assertEquals(value, 404, host.intercept(Uri.parse(value)).getStatusCode());
        }
        assertEquals(before, fixture.opens.get());
    }

    @Test public void tamperedOrOversizedResourceFailsClosed() throws Exception {
        Fixture fixture = new Fixture();
        HNPdfAssets host = fixture.host();
        fixture.files.put("pdf-runtime/adapter.js", "changed".getBytes(StandardCharsets.UTF_8));
        assertEquals(404, host.intercept(Uri.parse(HNPdfAssets.ORIGIN + "/pdf-runtime/adapter.js")).getStatusCode());
        fixture.files.put("pdf-runtime/android-reader.html", new byte[512]);
        assertEquals(404, host.intercept(Uri.parse(HNPdfAssets.HOST)).getStatusCode());
    }

    @Test public void duplicateWrongMimeAndIncompleteManifestsAreRejected() throws Exception {
        Fixture duplicate = new Fixture();
        duplicate.entries.put(duplicate.entries.getJSONObject(0));
        duplicate.save();
        assertThrows(Exception.class, duplicate::host);
        Fixture wrongMime = new Fixture();
        wrongMime.entries.getJSONObject(0).put("mimeType", "application/pdf");
        wrongMime.save();
        assertThrows(Exception.class, wrongMime::host);
        Fixture incomplete = new Fixture();
        incomplete.entries.getJSONObject(0).put("path", "other.html");
        incomplete.save();
        assertThrows(Exception.class, incomplete::host);
    }
}
