package com.hamsternote.nativereader.securewebview;

import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/** Reader-owned immutable source snapshot; the renderer never receives the host URI. */
final class HNPdfDocument {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    private final String url;
    private byte[] bytes;

    private HNPdfDocument(byte[] bytes) {
        this.bytes = bytes;
        this.url = HNPdfAssets.ORIGIN + "/pdf-document/" + UUID.randomUUID() + "/document.pdf";
    }

    static void checkSize(long size) throws IOException {
        if (size <= 0 || size > MAX_BYTES) throw new IOException("Unsupported PDF size");
    }

    static HNPdfDocument snapshot(InputStream input, long size, BooleanSupplier authorized) throws IOException {
        checkSize(size);
        check(authorized);
        final byte[] data = new byte[(int) size];
        boolean retained = false;
        try {
            int offset = 0;
            while (offset < data.length) {
                check(authorized);
                final int count = input.read(data, offset, Math.min(65536, data.length - offset));
                if (count <= 0) throw new IOException("PDF source changed or stalled");
                offset += count;
            }
            check(authorized);
            if (input.read() != -1) throw new IOException("PDF source size changed");
            check(authorized);
            if (data.length < 5 || data[0] != '%' || data[1] != 'P' || data[2] != 'D'
                    || data[3] != 'F' || data[4] != '-') throw new IOException("Invalid PDF candidate");
            // The signature is only a candidate check; PDF.js validates the complete content.
            final HNPdfDocument result = new HNPdfDocument(data);
            retained = true;
            return result;
        } finally {
            if (!retained) Arrays.fill(data, (byte) 0);
        }
    }

    static void check(BooleanSupplier authorized) throws IOException {
        if (!authorized.getAsBoolean() || Thread.currentThread().isInterrupted())
            throw new IOException("PDF source authorization revoked");
    }

    synchronized String url() { return bytes == null ? null : url; }

    synchronized WebResourceResponse intercept(Uri request) {
        if (bytes == null || request == null || !url.equals(request.toString())) return HNPdfAssets.deny();
        final Map<String, String> headers = new HashMap<>();
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Length", Integer.toString(bytes.length));
        headers.put("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        headers.put("Referrer-Policy", "no-referrer");
        // Ranges are deliberately ignored; every authorized request receives a complete 200.
        return new WebResourceResponse("application/pdf", null, 200, "OK", headers,
                new ByteArrayInputStream(bytes));
    }

    synchronized void revoke() {
        if (bytes == null) return;
        Arrays.fill(bytes, (byte) 0);
        bytes = null;
    }
}
