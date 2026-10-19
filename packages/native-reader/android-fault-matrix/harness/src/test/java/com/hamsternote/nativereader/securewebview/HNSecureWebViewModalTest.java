package com.hamsternote.nativereader.securewebview;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.ArgumentMatchers.any;
import static org.robolectric.Shadows.shadowOf;

import android.app.Activity;
import android.os.Looper;
import android.view.KeyEvent;
import android.widget.FrameLayout;
import android.widget.TextView;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.queue.MessageQueueThread;
import com.facebook.react.bridge.queue.ReactQueueConfiguration;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags;
import com.facebook.react.uimanager.DisplayMetricsHolder;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.views.modal.ReactModalHostView;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** Native container integration only: Robolectric does not execute WebView JS or screen readers. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class HNSecureWebViewModalTest {
    private static ThemedReactContext createContext(Activity activity) {
        ReactApplicationContext application = mock(ReactApplicationContext.class);
        when(application.getCurrentActivity()).thenReturn(activity);
        when(application.getJSModule(HNSecureWebViewMessagingModule.class))
                .thenReturn(mock(HNSecureWebViewMessagingModule.class));
        ThemedReactContext context = new ThemedReactContext(application, activity);
        // Modal layout posts a real UIManager size callback through this bridge queue.
        MessageQueueThread queue = mock(MessageQueueThread.class);
        doAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return true;
        }).when(queue).runOnQueue(any(Runnable.class));
        ReactQueueConfiguration queues = mock(ReactQueueConfiguration.class);
        when(queues.getUIQueueThread()).thenReturn(queue);
        when(queues.getNativeModulesQueueThread()).thenReturn(queue);
        when(queues.getJSQueueThread()).thenReturn(queue);
        context.initializeMessageQueueThreads(queues);
        DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context);
        return context;
    }

    @Test
    public void platformDialogAcceptsSecureHostAndDispatchesBackWithoutViewKeyEvents() {
        // Avoid JNI flag access in the JVM; flags remain false, including key/imperative focus.
        try (MockedStatic<ReactNativeFeatureFlags> flags = mockStatic(ReactNativeFeatureFlags.class)) {
            Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
            ThemedReactContext context = createContext(activity);
            HNSecureWebView host = new HNSecureWebView(context);
            ReactModalHostView modal = new ReactModalHostView(context);
            modal.setTransparent(true);
            modal.addView(host, 0);
            AtomicInteger closes = new AtomicInteger();
            modal.setOnRequestCloseListener(dialog -> {
                closes.incrementAndGet();
                modal.onDropInstance();
            });
            modal.showOrUpdate();
            shadowOf(Looper.getMainLooper()).idle();
            assertNotNull(modal.getDialog());
            assertTrue(modal.getDialog().isShowing());
            assertSame(host, modal.getChildAt(0));
            assertTrue(host.isAttachedToWindow());
            modal.getDialog().dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK));
            shadowOf(Looper.getMainLooper()).idle();
            assertEquals(1, closes.get());
            assertFalse(host.isAttachedToWindow());
            host.destroy();
            activity.finish();
        }
    }

    @Test
    public void openingAndClosingOverlayPreservesBackgroundSecureHost() {
        try (MockedStatic<ReactNativeFeatureFlags> flags = mockStatic(ReactNativeFeatureFlags.class)) {
            Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
            ThemedReactContext context = createContext(activity);
            HNSecureWebView host = new HNSecureWebView(context);
            FrameLayout background = new FrameLayout(context);
            background.addView(host);
            activity.setContentView(background);
            Object sessionMarker = new Object();
            host.setTag(sessionMarker);
            ReactModalHostView modal = new ReactModalHostView(context);
            TextView title = new TextView(context);
            title.setText("Reader contents");
            modal.addView(title, 0);
            modal.setOnRequestCloseListener(dialog -> modal.onDropInstance());
            modal.showOrUpdate();
            shadowOf(Looper.getMainLooper()).idle();
            assertTrue(modal.getDialog().isShowing());
            assertSame(background, host.getParent());
            assertTrue(host.isAttachedToWindow());
            modal.onDropInstance();
            assertSame(background, host.getParent());
            assertSame(sessionMarker, host.getTag());
            assertTrue(host.isAttachedToWindow());
            host.destroy();
            activity.finish();
        }
    }
}
