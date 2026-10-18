package com.hamsternote.nativereader.securewebview;

import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;
import java.util.HashMap;
import java.util.Map;

public final class HNPdfViewManager extends SimpleViewManager<HNPdfView> {
    @Override public String getName() { return "HNPdfView"; }
    @Override protected HNPdfView createViewInstance(ThemedReactContext context) { return new HNPdfView(context); }
    @ReactProp(name = "configuration") public void setConfiguration(HNPdfView view, String wire) { view.configure(wire); }
    @ReactProp(name = "command") public void setCommand(HNPdfView view, String wire) { view.command(wire); }
    @Override public Map<String, Object> getExportedViewConstants() {
        Map<String, Object> constants = new HashMap<>();
        constants.put("pdfProtocolVersion", 1);
        constants.put("maxPdfBytes", HNPdfDocument.MAX_BYTES);
        constants.put("privatePdfPort", true);
        constants.put("readyAfterDraw", true);
        return constants;
    }
    @Override public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
        Map<String, Object> events = new HashMap<>();
        Map<String, String> message = new HashMap<>();
        message.put("registrationName", "onPdfMessage");
        events.put("topPdfMessage", message);
        return events;
    }
    @Override public void onDropViewInstance(HNPdfView view) { view.retire(); super.onDropViewInstance(view); }
}
