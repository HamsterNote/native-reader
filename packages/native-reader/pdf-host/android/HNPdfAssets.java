package com.hamsternote.nativereader.securewebview;

import android.net.Uri;
import android.webkit.WebResourceResponse;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** Exact APK-owned PDF resources. No request is allowed to fall through to HTTPS. */
final class HNPdfAssets {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String ROOT = "/pdf-runtime/";
    static final String HOST = ORIGIN + ROOT + "android-reader.html";
    static final String CSP = "default-src 'none'; script-src 'self'; worker-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'self'; "
            + "base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'";
    interface OpenAsset { InputStream open(String name) throws IOException; }
    private static final int MAX_ASSET = 16 * 1024 * 1024;
    private final OpenAsset assets;
    private final Map<String, Entry> entries;

    HNPdfAssets(OpenAsset assets) throws Exception {
        this.assets = assets;
        final JSONObject manifest;
        try (InputStream input = assets.open("pdf-runtime/manifest.json")) {
            manifest = new JSONObject(new String(read(input, 256 * 1024), StandardCharsets.UTF_8));
        }
        if (manifest.getInt("version") != 1 || !"5.4.530".equals(manifest.getString("pdfjsVersion")))
            throw new IOException("Unsupported PDF runtime");
        final JSONArray files = manifest.getJSONArray("files");
        if (files.length() < 10 || files.length() > 512) throw new IOException("Invalid PDF closure");
        final Map<String, Entry> parsed = new HashMap<>();
        for (int index = 0; index < files.length(); index++) {
            final JSONObject file = files.getJSONObject(index);
            final String path = file.getString("path");
            final String mime = file.getString("mimeType");
            final long size = file.getLong("size");
            final String hash = file.getString("sha256");
            if (!validPath(path) || !mimeFor(path).equals(mime) || size <= 0 || size > MAX_ASSET
                    || !hash.matches("[a-f0-9]{64}") || parsed.containsKey(path))
                throw new IOException("Invalid PDF asset entry");
            parsed.put(path, new Entry(mime, (int) size, hash));
        }
        for (String name : new String[]{"android-reader.html", "android-shell.mjs", "reader.html",
                "shell.mjs", "shell.css", "protocol.js", "adapter.js", "pdf.worker.min.mjs", "pdf.css"})
            if (!parsed.containsKey(name)) throw new IOException("Incomplete PDF runtime");
        this.entries = Collections.unmodifiableMap(parsed);
    }

    static boolean validPath(String path) {
        if (path == null || path.length() > 512 || path.isEmpty()) return false;
        for (String part : path.split("/", -1))
            if (!part.matches("[A-Za-z0-9_.-]+") || part.equals(".") || part.equals("..")) return false;
        return true;
    }

    static String mimeFor(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    static String pathFor(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme())
                || !"appassets.androidplatform.net".equals(uri.getEncodedAuthority())
                || uri.getEncodedQuery() != null || uri.getEncodedFragment() != null
                || uri.toString().indexOf('%') >= 0 || uri.toString().indexOf('\\') >= 0)
            return null;
        final String path = uri.getEncodedPath();
        return path != null && path.startsWith(ROOT) && validPath(path.substring(ROOT.length()))
                ? path.substring(ROOT.length()) : null;
    }

    WebResourceResponse intercept(Uri uri) {
        final String path = pathFor(uri);
        final Entry entry = path == null ? null : entries.get(path);
        if (entry == null) return deny();
        try (InputStream input = assets.open("pdf-runtime/" + path)) {
            final byte[] bytes = read(input, entry.size);
            if (bytes.length != entry.size || !sha256(bytes).equals(entry.hash)) return deny();
            final Map<String, String> headers = new HashMap<>();
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Cache-Control", "no-store");
            headers.put("Content-Length", Integer.toString(bytes.length));
            headers.put("Content-Security-Policy", CSP);
            headers.put("Referrer-Policy", "no-referrer");
            return new WebResourceResponse(entry.mime, "UTF-8", 200, "OK", headers, new ByteArrayInputStream(bytes));
        } catch (Exception error) { return deny(); }
    }

    static WebResourceResponse deny() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.singletonMap("X-Content-Type-Options", "nosniff"), new ByteArrayInputStream(new byte[0]));
    }

    static byte[] read(InputStream input, int limit) throws IOException {
        final ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 65536));
        final byte[] buffer = new byte[8192];
        int remaining = limit + 1;
        while (remaining > 0) {
            final int count = input.read(buffer, 0, Math.min(buffer.length, remaining));
            if (count < 0) break;
            if (count == 0) throw new IOException("Asset read stalled");
            output.write(buffer, 0, count);
            remaining -= count;
        }
        if (output.size() > limit) throw new IOException("Asset exceeded declared bound");
        return output.toByteArray();
    }

    private static String sha256(byte[] value) throws Exception {
        final byte[] hash = MessageDigest.getInstance("SHA-256").digest(value);
        final StringBuilder result = new StringBuilder();
        for (byte part : hash) result.append(String.format(java.util.Locale.ROOT, "%02x", part & 255));
        return result.toString();
    }
    private static final class Entry {
        final String mime, hash;
        final int size;
        Entry(String mime, int size, String hash) { this.mime = mime; this.size = size; this.hash = hash; }
    }
}
