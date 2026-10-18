package com.hamsternote.nativereader.securewebview;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class HNPdfProtocolTest {
    private final String session = "00000000-0000-0000-0000-000000000001";
    private JSONObject envelope(String type) throws Exception {
        return new JSONObject().put("protocol", "hamster-pdf").put("version", 1).put("sessionId", session)
                .put("generation", 1).put("commandId", 1).put("type", type);
    }
    @Test public void duplicateFieldsDepthOverflowTrailingDataAndUnsafeNumbersAreRejected() throws Exception {
        assertThrows(Exception.class, () -> HNPdfProtocol.parse("{\"version\":1,\"version\":2}"));
        assertThrows(Exception.class, () -> HNPdfProtocol.parse("{\"x\":[[[[[[[[[[]]]]]]]]]]}"));
        assertThrows(Exception.class, () -> HNPdfProtocol.parse("{} {}"));
        assertThrows(Exception.class, () -> HNPdfProtocol.parse("{\"x\":1e999999}"));
        JSONObject value = HNPdfProtocol.parse("{\"x\":1.0000000000000001}");
        assertFalse(HNPdfProtocol.integer(value.get("x"), 1, 1));
        assertFalse(HNPdfProtocol.integer("1", 1, 1));
    }
    @Test public void commandsAreBoundToProtocolIdentityAndClosedFields() throws Exception {
        JSONObject value = envelope("navigate").put("pageNumber", 2);
        assertTrue(HNPdfProtocol.command(value, session, 1));
        assertFalse(HNPdfProtocol.command(value, session, 2));
        assertFalse(HNPdfProtocol.command(value, "other", 1));
        value.put("uri", "file:///private.pdf");
        assertFalse(HNPdfProtocol.command(value, session, 1));
        assertFalse(HNPdfProtocol.command(envelope("open").put("uri", "file:///private.pdf"), session, 1));
    }
    @Test public void configurationRejectsRemoteSourcesBeforeAnyHostRead() throws Exception {
        JSONObject value = new JSONObject().put("sessionId", session).put("generation", 1).put("uri", "file:///cache/pdf");
        assertEquals(session, HNPdfProtocol.configuration(value.toString()).getString("sessionId"));
        value.put("uri", "https://example.com/private.pdf");
        assertThrows(Exception.class, () -> HNPdfProtocol.configuration(value.toString()));
    }
    @Test public void invalidSelectionsAndUnsolicitedCommandIdsAreRejected() throws Exception {
        JSONObject value = envelope("selection").put("commandId", 0).put("selection", new JSONObject()
                .put("sessionId", session).put("generation", 1).put("selectionId", "selected").put("text", "private")
                .put("coordinateSpace", "reader").put("rects", new org.json.JSONArray().put(new JSONObject()
                    .put("x", 1).put("y", 2).put("width", 3).put("height", 4))));
        assertTrue(HNPdfProtocol.event(value, session, 1));
        value.getJSONObject("selection").getJSONArray("rects").getJSONObject(0).put("width", 0);
        assertFalse(HNPdfProtocol.event(value, session, 1));
        assertFalse(HNPdfProtocol.event(envelope("boot"), session, 1));
        assertTrue(HNPdfProtocol.event(envelope("boot").put("commandId", 0), session, 1));
    }
}
