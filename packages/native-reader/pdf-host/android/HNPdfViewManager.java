package com.hamsternote.nativereader.securewebview;

import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;

public final class HNPdfViewManager extends SimpleViewManager<HNPdfView> {
    @Override public String getName() { return "HNPdfView"; }
    @Override protected HNPdfView createViewInstance(ThemedReactContext context) { return new HNPdfView(context); }
    @Override public void onDropViewInstance(HNPdfView view) { view.retire(); super.onDropViewInstance(view); }
}
