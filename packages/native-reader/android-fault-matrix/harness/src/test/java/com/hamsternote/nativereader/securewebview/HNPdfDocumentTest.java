package com.hamsternote.nativereader.securewebview;

import static org.junit.Assert.*;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class HNPdfDocumentTest {
    private final byte[] pdf = "%PDF-1.7\nfixture requires engine validation".getBytes(StandardCharsets.UTF_8);

    @Test public void closedCapabilityAndUnknownOrOversizeMetadataReadNothing() {
        AtomicInteger reads = new AtomicInteger();
        InputStream input = new InputStream() {
            @Override public int read() { reads.incrementAndGet(); return -1; }
        };
        for (long size : new long[]{-1, 0, HNPdfDocument.MAX_BYTES + 1L})
            assertThrows(IOException.class, () -> HNPdfDocument.snapshot(input, size, () -> true));
        assertThrows(IOException.class, () -> HNPdfDocument.snapshot(input, pdf.length, () -> false));
        assertEquals(0, reads.get());
    }

    @Test public void truncatedGrowingAndNonPdfInputsFailClosed() {
        assertThrows(IOException.class, () -> HNPdfDocument.snapshot(new ByteArrayInputStream(pdf), pdf.length + 1, () -> true));
        assertThrows(IOException.class, () -> HNPdfDocument.snapshot(new ByteArrayInputStream(pdf), pdf.length - 1, () -> true));
        assertThrows(IOException.class, () -> HNPdfDocument.snapshot(new ByteArrayInputStream(new byte[pdf.length]), pdf.length, () -> true));
    }

    @Test public void onlyExactCurrentUrlServesPrivatePdfMimeAndNoStore() throws Exception {
        HNPdfDocument document = HNPdfDocument.snapshot(new ByteArrayInputStream(pdf), pdf.length, () -> true);
        WebResourceResponse response = document.intercept(Uri.parse(document.url()));
        assertEquals(200, response.getStatusCode());
        assertEquals("application/pdf", response.getMimeType());
        assertEquals("nosniff", response.getResponseHeaders().get("X-Content-Type-Options"));
        assertEquals("no-store", response.getResponseHeaders().get("Cache-Control"));
        assertArrayEquals(pdf, response.getData().readAllBytes());
        for (String value : new String[]{document.url() + "?x=1", document.url() + "#x",
                document.url().replace("/document.pdf", "/%64ocument.pdf"),
                document.url().replace("https://", "http://"),
                document.url().replace(".net/", ".net:443/"),
                HNPdfAssets.ORIGIN + "/pdf-document/old-token/document.pdf", "file:///private.pdf"})
            assertEquals(404, document.intercept(Uri.parse(value)).getStatusCode());
        document.revoke();
    }

    @Test public void replacementAndRevocationInvalidateOldUrlsAndInFlightDataWithoutMutatingHost() throws Exception {
        byte[] host = pdf.clone();
        HNPdfDocument old = HNPdfDocument.snapshot(new ByteArrayInputStream(host), host.length, () -> true);
        HNPdfDocument next = HNPdfDocument.snapshot(new ByteArrayInputStream(host), host.length, () -> true);
        String oldUrl = old.url();
        InputStream inflight = old.intercept(Uri.parse(oldUrl)).getData();
        assertNotEquals(oldUrl, next.url());
        assertEquals(404, next.intercept(Uri.parse(oldUrl)).getStatusCode());
        old.revoke();
        old.revoke();
        assertNull(old.url());
        assertEquals(404, old.intercept(Uri.parse(oldUrl)).getStatusCode());
        assertArrayEquals(new byte[pdf.length], inflight.readAllBytes());
        assertArrayEquals(pdf, host);
        assertEquals(200, next.intercept(Uri.parse(next.url())).getStatusCode());
        next.revoke();
    }

    @Test public void revocationDuringReadClearsPartialPrivateBuffer() {
        AtomicBoolean allowed = new AtomicBoolean(true);
        byte[][] observed = new byte[1][];
        InputStream input = new ByteArrayInputStream(pdf) {
            @Override public synchronized int read(byte[] bytes, int start, int length) {
                observed[0] = bytes;
                int count = super.read(bytes, start, length);
                allowed.set(false);
                return count;
            }
        };
        assertThrows(IOException.class, () -> HNPdfDocument.snapshot(input, pdf.length, allowed::get));
        assertNotNull(observed[0]);
        assertArrayEquals(new byte[pdf.length], observed[0]);
    }

    @Test public void exact32MiBBoundUsesBoundedReadsAndReturnsComplete200() throws Exception {
        AtomicInteger offset = new AtomicInteger();
        InputStream input = new InputStream() {
            @Override public int read() { return -1; }
            @Override public int read(byte[] bytes, int start, int length) {
                assertTrue(length <= 65536);
                int position = offset.getAndAdd(length);
                java.util.Arrays.fill(bytes, start, start + length, (byte) 0);
                if (position == 0) System.arraycopy(pdf, 0, bytes, start, 5);
                return length;
            }
        };
        HNPdfDocument document = HNPdfDocument.snapshot(input, HNPdfDocument.MAX_BYTES, () -> true);
        assertEquals(HNPdfDocument.MAX_BYTES, offset.get());
        WebResourceResponse response = document.intercept(Uri.parse(document.url()));
        assertEquals(200, response.getStatusCode());
        assertEquals(Integer.toString(HNPdfDocument.MAX_BYTES), response.getResponseHeaders().get("Content-Length"));
        assertArrayEquals("%PDF-".getBytes(StandardCharsets.UTF_8), response.getData().readNBytes(5));
        document.revoke();
    }

    @Test public void cancellationRacingAnActiveReadClearsBufferAndStopsFurtherReads() throws Exception {
        AtomicBoolean allowed = new AtomicBoolean(true);
        CountDownLatch reading = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        byte[][] observed = new byte[1][];
        AtomicInteger reads = new AtomicInteger();
        InputStream input = new InputStream() {
            @Override public int read() { fail("No EOF read after cancellation"); return -1; }
            @Override public int read(byte[] bytes, int start, int length) throws IOException {
                reads.incrementAndGet();
                observed[0] = bytes;
                System.arraycopy(pdf, 0, bytes, start, pdf.length);
                reading.countDown();
                try { if (!release.await(5, TimeUnit.SECONDS)) throw new IOException("Test read timed out"); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException(error); }
                return pdf.length;
            }
        };
        java.util.concurrent.ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            java.util.concurrent.Future<?> result = executor.submit(() -> {
                assertThrows(IOException.class, () -> HNPdfDocument.snapshot(input, pdf.length * 2, allowed::get));
            });
            assertTrue(reading.await(5, TimeUnit.SECONDS));
            allowed.set(false);
            release.countDown();
            result.get(5, TimeUnit.SECONDS);
            assertEquals(1, reads.get());
            assertArrayEquals(new byte[pdf.length * 2], observed[0]);
        } finally { release.countDown(); executor.shutdownNow(); }
    }

    @Test public void interruptedCallerReadsNothingAndRetainsInterruptFlag() {
        InputStream input = mockUnreadable();
        Thread.currentThread().interrupt();
        try {
            assertThrows(IOException.class, () -> HNPdfDocument.snapshot(input, pdf.length, () -> true));
            assertTrue(Thread.currentThread().isInterrupted());
        } finally { Thread.interrupted(); }
    }

    private InputStream mockUnreadable() {
        return new InputStream() {
            @Override public int read() { fail("Interrupted source must not be read"); return -1; }
        };
    }
}
