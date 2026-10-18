package com.hamsternote.nativereader.securewebview

import android.content.Context
import android.graphics.Color
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout

/**
 * A [FrameLayout] container to hold the [HNSecureWebView].
 * We need this to prevent WebView crash when the WebView is out of viewport and
 * [com.facebook.react.views.view.ReactViewGroup] clips the canvas.
 * The WebView will then create an empty offscreen surface and NPE.
 */
class HNSecureWebViewWrapper(context: Context, webView: HNSecureWebView) : FrameLayout(context) {
  init {
    // We make the WebView as transparent on top of the container,
    // and let React Native sets background color for the container.
    webView.setBackgroundColor(Color.TRANSPARENT)
    addView(webView)
  }

  val webView: HNSecureWebView = getChildAt(0) as HNSecureWebView

  companion object {
    /**
     * A helper to get react tag id by given WebView
     */
    @JvmStatic
    fun getReactTagFromWebView(webView: WebView): Int {
      // It is expected that the webView is enclosed by [HNSecureWebViewWrapper] as the first child.
      // Therefore, it must have a parent, and the parent ID is the reactTag.
      // In exceptional cases, such as receiving WebView messaging after the view has been unmounted,
      // the WebView will not have a parent.
      // In this case, we simply return -1 to indicate that it was not found.
      return (webView.parent as? View)?.id ?: -1
    }
  }
}
