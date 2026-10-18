package com.hamsternote.nativereader.securewebview;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Process;
import android.provider.OpenableColumns;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.function.BooleanSupplier;

/** Independent PDF grant enforcement, called only after the selected private host is bound. */
final class HNPdfSource {
    static HNPdfDocument open(Context context, String value, CancellationSignal signal,
            BooleanSupplier authorized) throws Exception {
        HNPdfDocument.check(authorized);
        final Uri uri = localUri(value);
        if ("file".equals(uri.getScheme())) {
            final File file = new File(uri.getPath()).getCanonicalFile();
            if (!insideApp(context, file) || !file.isFile()) throw new IOException("PDF file is not authorized");
            final long size = file.length();
            HNPdfDocument.checkSize(size);
            HNPdfDocument.check(authorized);
            signal.throwIfCanceled();
            final FileDescriptor descriptor = Os.open(file.getPath(),
                    OsConstants.O_RDONLY | OsConstants.O_CLOEXEC | OsConstants.O_NOFOLLOW, 0);
            try (FileInputStream input = new FileInputStream(descriptor)) {
                final StructStat stat = Os.fstat(descriptor);
                if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size != size)
                    throw new IOException("PDF file metadata changed");
                return HNPdfDocument.snapshot(input, size, () -> !signal.isCanceled() && authorized.getAsBoolean());
            }
        }
        if (!hasContentGrant(context, uri)) throw new IOException("PDF content grant is unavailable");
        final long size;
        try (Cursor cursor = context.getContentResolver().query(uri,
                new String[]{OpenableColumns.SIZE}, null, null, null, signal)) {
            if (cursor == null || !cursor.moveToFirst() || cursor.isNull(0)
                    || cursor.getType(0) != Cursor.FIELD_TYPE_INTEGER)
                throw new IOException("Unknown PDF content size");
            size = cursor.getLong(0);
        }
        HNPdfDocument.checkSize(size);
        HNPdfDocument.check(authorized);
        signal.throwIfCanceled();
        try (AssetFileDescriptor asset = context.getContentResolver().openAssetFileDescriptor(uri, "r", signal)) {
            if (asset == null) throw new IOException("Missing PDF content descriptor");
            final StructStat stat = Os.fstat(asset.getFileDescriptor());
            final long start = asset.getStartOffset();
            final long declared = asset.getDeclaredLength();
            if (!OsConstants.S_ISREG(stat.st_mode) || start < 0 || start > stat.st_size
                    || size > stat.st_size - start
                    || (declared >= 0 ? declared != size : stat.st_size - start != size))
                throw new IOException("PDF content metadata changed");
            try (FileInputStream input = asset.createInputStream()) {
                return HNPdfDocument.snapshot(input, size, () -> !signal.isCanceled() && authorized.getAsBoolean());
            }
        }
    }

    static Uri localUri(String value) throws IOException {
        if (value == null || value.length() > 8192 || value.matches("(?s).*[\\x00-\\x20\\\\].*")
                || value.matches("(?is).*%(00|0a|0d|5c).*")) throw new IOException("Invalid local PDF URI");
        final Uri uri = Uri.parse(value);
        if (uri.getEncodedQuery() != null || uri.getEncodedFragment() != null
                || uri.getPath() == null || !uri.getPath().startsWith("/"))
            throw new IOException("Invalid local PDF URI");
        if ("file".equals(uri.getScheme()) && value.startsWith("file:///")
                && (uri.getEncodedAuthority() == null || uri.getEncodedAuthority().isEmpty())) return uri;
        if ("content".equals(uri.getScheme()) && uri.getEncodedAuthority() != null
                && uri.getEncodedAuthority().matches("[A-Za-z0-9_.-]+")) return uri;
        throw new IOException("Select a local PDF");
    }

    static boolean insideApp(Context context, File file) throws IOException {
        for (File root : new File[]{context.getFilesDir(), context.getCacheDir(),
                context.getNoBackupFilesDir(), context.getExternalFilesDir(null), context.getExternalCacheDir()}) {
            if (root == null) continue;
            final String prefix = root.getCanonicalPath() + File.separator;
            if (file.getPath().startsWith(prefix)) return true;
        }
        return false;
    }

    static boolean hasContentGrant(Context context, Uri uri) {
        final ProviderInfo provider = context.getPackageManager().resolveContentProvider(uri.getAuthority(), 0);
        return provider != null && provider.applicationInfo != null
                && (provider.applicationInfo.uid == Process.myUid()
                    || context.checkUriPermission(uri, Process.myPid(), Process.myUid(),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED);
    }
}
