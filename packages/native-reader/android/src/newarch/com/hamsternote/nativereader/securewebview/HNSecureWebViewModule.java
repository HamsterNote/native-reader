package com.hamsternote.nativereader.securewebview;

import android.app.DownloadManager;
import android.net.Uri;
import android.webkit.ValueCallback;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.annotations.ReactModule;

import java.util.Map;

@ReactModule(name = HNSecureWebViewModuleImpl.NAME)
public class HNSecureWebViewModule extends NativeHNSecureWebViewModuleSpec {
    final private HNSecureWebViewModuleImpl mHNSecureWebViewModuleImpl;

    public HNSecureWebViewModule(ReactApplicationContext reactContext) {
        super(reactContext);
        mHNSecureWebViewModuleImpl = new HNSecureWebViewModuleImpl(reactContext);
    }

    @Override
    protected Map<String, Object> getTypedExportedConstants() {
        return HNSecureWebViewModuleImpl.getCapabilityConstants();
    }

    @Override
    public void isFileUploadSupported(final Promise promise) {
        promise.resolve(mHNSecureWebViewModuleImpl.isFileUploadSupported());
    }

    @Override
    public void shouldStartLoadWithLockIdentifier(boolean shouldStart, double lockIdentifier) {
        mHNSecureWebViewModuleImpl.shouldStartLoadWithLockIdentifier(shouldStart, lockIdentifier);
    }

    public void startPhotoPickerIntent(ValueCallback<Uri> filePathCallback, String acceptType) {
        mHNSecureWebViewModuleImpl.startPhotoPickerIntent(acceptType, filePathCallback);
    }

    public boolean startPhotoPickerIntent(final ValueCallback<Uri[]> callback, final String[] acceptTypes, final boolean allowMultiple, final boolean isCaptureEnabled) {
        return mHNSecureWebViewModuleImpl.startPhotoPickerIntent(acceptTypes, allowMultiple, callback, isCaptureEnabled);
    }

    public void setDownloadRequest(DownloadManager.Request request) {
        mHNSecureWebViewModuleImpl.setDownloadRequest(request);
    }

    public void downloadFile(String downloadingMessage) {
        mHNSecureWebViewModuleImpl.downloadFile(downloadingMessage);
    }

    public boolean grantFileDownloaderPermissions(String downloadingMessage, String lackPermissionToDownloadMessage) {
        return mHNSecureWebViewModuleImpl.grantFileDownloaderPermissions(downloadingMessage, lackPermissionToDownloadMessage);
    }

    @NonNull
    @Override
    public String getName() {
        return HNSecureWebViewModuleImpl.NAME;
    }
}