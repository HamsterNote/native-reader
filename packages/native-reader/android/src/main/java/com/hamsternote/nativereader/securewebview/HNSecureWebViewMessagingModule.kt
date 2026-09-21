package com.hamsternote.nativereader.securewebview

import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.WritableMap

internal interface HNSecureWebViewMessagingModule : JavaScriptModule {
  fun onShouldStartLoadWithRequest(event: WritableMap)
  fun onMessage(event: WritableMap)
}
