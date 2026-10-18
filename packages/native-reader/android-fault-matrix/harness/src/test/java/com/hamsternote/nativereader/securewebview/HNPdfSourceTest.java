package com.hamsternote.nativereader.securewebview;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import android.content.Context;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.net.Uri;
import android.database.MatrixCursor;
import android.provider.OpenableColumns;
import android.os.CancellationSignal;
import android.os.Process;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class HNPdfSourceTest {
    @Test public void invalidOrRemoteSourcesAndClosedCapabilityNeverInspectContext() {
        Context context = mock(Context.class);
        for (String value : new String[]{"https://example.com/a.pdf", "file://host/a.pdf", "file:///a.pdf?x=1",
                "content://user@provider/a", "content://provider:123/a", "file:///a%00.pdf", "file:///a\\b.pdf"})
            assertThrows(Exception.class, () -> HNPdfSource.open(context, value, new CancellationSignal(), () -> true));
        assertThrows(Exception.class, () -> HNPdfSource.open(context, "file:///a.pdf", new CancellationSignal(), () -> false));
        verifyNoInteractions(context);
    }

    @Test public void canonicalFileScopeRejectsSiblingAndEscapingSymlink() throws Exception {
        File base = Files.createTempDirectory("pdf-source-policy-").toFile();
        try {
            Context context = mock(Context.class);
            File root = new File(base, "files");
            assertTrue(root.mkdir());
            File outside = new File(base, "files-other.pdf");
            Files.write(outside.toPath(), new byte[]{1});
            when(context.getFilesDir()).thenReturn(root);
            assertTrue(HNPdfSource.insideApp(context, new File(root, "a.pdf").getCanonicalFile()));
            assertFalse(HNPdfSource.insideApp(context, outside.getCanonicalFile()));
            File alias = new File(root, "alias.pdf");
            Files.createSymbolicLink(alias.toPath(), outside.toPath());
            assertFalse(HNPdfSource.insideApp(context, alias.getCanonicalFile()));
            Files.delete(alias.toPath());
            Files.delete(outside.toPath());
            Files.delete(root.toPath());
        } finally { Files.delete(base.toPath()); }
    }

    @Test public void contentRequiresOwnProviderOrExistingReadGrant() {
        Context context = mock(Context.class);
        PackageManager manager = mock(PackageManager.class);
        when(context.getPackageManager()).thenReturn(manager);
        Uri uri = Uri.parse("content://example.provider/document/1");
        ProviderInfo provider = new ProviderInfo();
        provider.applicationInfo = new ApplicationInfo();
        provider.applicationInfo.uid = Process.myUid() + 1;
        when(manager.resolveContentProvider("example.provider", 0)).thenReturn(provider);
        when(context.checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION))
                .thenReturn(PackageManager.PERMISSION_DENIED);
        assertFalse(HNPdfSource.hasContentGrant(context, uri));
        when(context.checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION))
                .thenReturn(PackageManager.PERMISSION_GRANTED);
        assertTrue(HNPdfSource.hasContentGrant(context, uri));
        provider.applicationInfo.uid = Process.myUid();
        assertTrue(HNPdfSource.hasContentGrant(context, uri));
    }

    @Test public void unknownNonIntegerAndOversizeContentMetadataNeverOpenDescriptor() throws Exception {
        Context context = mock(Context.class);
        PackageManager manager = mock(PackageManager.class);
        ContentResolver resolver = mock(ContentResolver.class);
        when(context.getPackageManager()).thenReturn(manager);
        when(context.getContentResolver()).thenReturn(resolver);
        ProviderInfo provider = new ProviderInfo();
        provider.applicationInfo = new ApplicationInfo();
        provider.applicationInfo.uid = Process.myUid();
        when(manager.resolveContentProvider("example.provider", 0)).thenReturn(provider);
        Uri uri = Uri.parse("content://example.provider/document/1");
        CancellationSignal signal = new CancellationSignal();
        for (Object size : new Object[]{null, "12", -1L, 0L, HNPdfDocument.MAX_BYTES + 1L}) {
            MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.SIZE});
            cursor.addRow(new Object[]{size});
            when(resolver.query(eq(uri), any(String[].class), isNull(), isNull(), isNull(), eq(signal))).thenReturn(cursor);
            assertThrows(IOException.class, () -> HNPdfSource.open(context, uri.toString(), signal, () -> true));
            assertTrue(cursor.isClosed());
        }
        verify(resolver, never()).openAssetFileDescriptor(any(), anyString(), any());
    }

    @Test public void realAppFileSnapshotKeepsHostBytesAndCanceledOpenCreatesNoSnapshot() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        File host = File.createTempFile("hn-pdf-", ".pdf", context.getFilesDir());
        byte[] bytes = "%PDF-1.7\nlocal host".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        try {
            Files.write(host.toPath(), bytes);
            HNPdfDocument document = HNPdfSource.open(context, Uri.fromFile(host).toString(), new CancellationSignal(), () -> true);
            assertArrayEquals(bytes, document.intercept(Uri.parse(document.url())).getData().readAllBytes());
            document.revoke();
            assertArrayEquals(bytes, Files.readAllBytes(host.toPath()));
            CancellationSignal canceled = new CancellationSignal();
            canceled.cancel();
            assertThrows(android.os.OperationCanceledException.class,
                    () -> HNPdfSource.open(context, Uri.fromFile(host).toString(), canceled, () -> true));
            assertArrayEquals(bytes, Files.readAllBytes(host.toPath()));
        } finally { Files.delete(host.toPath()); }
    }
}
