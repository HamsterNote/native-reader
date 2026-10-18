package com.hamsternote.nativereader.securewebview;

import android.util.JsonReader;
import android.util.JsonToken;
import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Closed PDF-only wire; never delegates a message to the EPUB interpreter. */
final class HNPdfProtocol {
    static final int MAX_WIRE = 262144;
    static final long MAX_INTEGER = 9007199254740991L;
    private static final String[] ENVELOPE = {"protocol", "version", "sessionId", "generation", "commandId", "type"};

    static JSONObject parse(String wire) throws Exception {
        if (wire == null || wire.length() > MAX_WIRE) throw new IOException("PDF wire too large");
        try (JsonReader reader = new JsonReader(new StringReader(wire))) {
            reader.setLenient(false);
            Object value = read(reader, 0);
            if (!(value instanceof JSONObject) || reader.peek() != JsonToken.END_DOCUMENT)
                throw new IOException("Invalid PDF JSON");
            return (JSONObject) value;
        }
    }

    private static Object read(JsonReader reader, int depth) throws Exception {
        if (depth > 8) throw new IOException("PDF JSON depth exceeded");
        switch (reader.peek()) {
            case BEGIN_OBJECT: {
                JSONObject object = new JSONObject();
                Set<String> keys = new HashSet<>();
                reader.beginObject();
                while (reader.hasNext()) {
                    String key = reader.nextName();
                    if (key.length() > 128 || keys.size() >= 64 || !keys.add(key))
                        throw new IOException("Duplicate or excessive PDF fields");
                    object.put(key, read(reader, depth + 1));
                }
                reader.endObject();
                return object;
            }
            case BEGIN_ARRAY: {
                JSONArray values = new JSONArray();
                reader.beginArray();
                while (reader.hasNext()) {
                    if (values.length() >= 64) throw new IOException("PDF array too large");
                    values.put(read(reader, depth + 1));
                }
                reader.endArray();
                return values;
            }
            case STRING: return reader.nextString();
            case NUMBER: {
                String number = reader.nextString();
                if (number.length() > 64) throw new IOException("PDF number too large");
                BigDecimal value = new BigDecimal(number);
                if (!Double.isFinite(value.doubleValue())) throw new IOException("Nonfinite PDF number");
                return value;
            }
            case BOOLEAN: return reader.nextBoolean();
            case NULL: reader.nextNull(); return JSONObject.NULL;
            default: throw new IOException("Invalid PDF JSON token");
        }
    }

    static boolean keys(JSONObject value, String... fields) {
        if (value.length() != fields.length) return false;
        for (String field : fields) if (!value.has(field)) return false;
        return true;
    }

    static boolean envelopeKeys(JSONObject value, String... extra) {
        String[] fields = Arrays.copyOf(ENVELOPE, ENVELOPE.length + extra.length);
        System.arraycopy(extra, 0, fields, ENVELOPE.length, extra.length);
        return keys(value, fields);
    }

    static boolean integer(Object value, long min, long max) {
        if (!(value instanceof Number)) return false;
        if (value instanceof BigDecimal) {
            BigDecimal decimal = ((BigDecimal) value).stripTrailingZeros();
            return decimal.scale() <= 0 && decimal.compareTo(BigDecimal.valueOf(min)) >= 0
                    && decimal.compareTo(BigDecimal.valueOf(max)) <= 0;
        }
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) && number == Math.floor(number) && number >= min && number <= max;
    }

    static boolean string(Object value, int max) { return value instanceof String && ((String) value).length() <= max; }

    static boolean identity(JSONObject value, String session, long generation) {
        return session.equals(value.opt("sessionId")) && integer(value.opt("generation"), generation, generation);
    }

    static JSONObject configuration(String wire) throws Exception {
        if (wire == null || wire.length() > 16384) throw new IOException("Invalid PDF configuration");
        JSONObject value = parse(wire);
        if (!keys(value, "sessionId", "generation", "uri") || !string(value.opt("sessionId"), 36)
                || !value.getString("sessionId").matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
                || !integer(value.opt("generation"), 1, MAX_INTEGER) || !string(value.opt("uri"), 8192))
            throw new IOException("Invalid PDF configuration");
        HNPdfSource.localUri(value.getString("uri"));
        return value;
    }

    static boolean envelope(JSONObject value, String session, long generation) {
        return "hamster-pdf".equals(value.opt("protocol")) && integer(value.opt("version"), 1, 1)
                && identity(value, session, generation) && integer(value.opt("commandId"), 0, MAX_INTEGER)
                && string(value.opt("type"), 32);
    }

    static boolean command(JSONObject value, String session, long generation) {
        if (!envelope(value, session, generation) || !integer(value.opt("commandId"), 1, MAX_INTEGER)) return false;
        String type = value.optString("type");
        switch (type) {
            case "navigate": case "thumbnail":
                return envelopeKeys(value, "pageNumber") && integer(value.opt("pageNumber"), 1, 100000);
            case "scale":
                return envelopeKeys(value, "scale") && value.opt("scale") instanceof Number
                        && value.optDouble("scale") >= 0.5 && value.optDouble("scale") <= 3;
            case "clear": case "rotate": case "dispose": return envelopeKeys(value);
            default: return false;
        }
    }

    private static boolean page(JSONObject value, String session, long generation, boolean state) {
        return value != null && identity(value, session, generation)
                && (state ? keys(value, "sessionId", "generation", "status", "pageNumber", "pageCount")
                    : keys(value, "sessionId", "generation", "pageNumber", "pageCount"))
                && integer(value.opt("pageCount"), 1, 100000)
                && integer(value.opt("pageNumber"), 1, value.optLong("pageCount"));
    }

    private static boolean selection(Object input, String session, long generation) {
        if (input == JSONObject.NULL) return true;
        if (!(input instanceof JSONObject)) return false;
        JSONObject value = (JSONObject) input;
        if (!identity(value, session, generation) || !keys(value, "sessionId", "generation", "selectionId", "text", "rects", "coordinateSpace")
                || !"reader".equals(value.opt("coordinateSpace")) || !string(value.opt("selectionId"), 128)
                || !string(value.opt("text"), 8192) || value.optString("text").isEmpty()) return false;
        JSONArray rects = value.optJSONArray("rects");
        if (rects == null || rects.length() == 0 || rects.length() > 64) return false;
        for (int index = 0; index < rects.length(); index++) {
            JSONObject rect = rects.optJSONObject(index);
            if (rect == null || !keys(rect, "x", "y", "width", "height")) return false;
            for (String key : new String[]{"x", "y", "width", "height"}) {
                if (!(rect.opt(key) instanceof Number) || !Double.isFinite(rect.optDouble(key)) || Math.abs(rect.optDouble(key)) > 100000)
                    return false;
            }
            if (rect.optDouble("width") <= 0 || rect.optDouble("height") <= 0) return false;
        }
        return true;
    }

    static boolean event(JSONObject value, String session, long generation) {
        if (!envelope(value, session, generation)) return false;
        String type = value.optString("type");
        if (!"result".equals(type) && value.optLong("commandId") != 0) return false;
        switch (type) {
            case "boot": return envelopeKeys(value);
            case "page": return envelopeKeys(value, "page") && page(value.optJSONObject("page"), session, generation, false);
            case "selection": return envelopeKeys(value, "selection") && selection(value.opt("selection"), session, generation);
            case "state": {
                JSONObject state = value.optJSONObject("state");
                if (!envelopeKeys(value, "state") || state == null || !identity(state, session, generation)) return false;
                if ("loading".equals(state.opt("status"))) return keys(state, "sessionId", "generation", "status");
                if ("ready".equals(state.opt("status"))) return page(state, session, generation, true);
                JSONObject error = state.optJSONObject("error");
                return "error".equals(state.opt("status")) && keys(state, "sessionId", "generation", "status", "error")
                        && error != null && keys(error, "category", "code", "message")
                        && Arrays.asList("read", "invalid", "unsupported", "drm", "render").contains(error.opt("category"))
                        && string(error.opt("code"), 128) && string(error.opt("message"), 512);
            }
            case "result": {
                if (!envelopeKeys(value, "result") || !integer(value.opt("commandId"), 1, MAX_INTEGER)) return false;
                Object result = value.opt("result");
                if (result == JSONObject.NULL || result instanceof Boolean) return true;
                if (!(result instanceof JSONObject)) return false;
                JSONObject thumbnail = (JSONObject) result;
                return keys(thumbnail, "sessionId", "generation", "pageNumber", "width", "height", "uri")
                        && identity(thumbnail, session, generation) && integer(thumbnail.opt("pageNumber"), 1, 100000)
                        && integer(thumbnail.opt("width"), 1, 112) && integer(thumbnail.opt("height"), 1, 150)
                        && string(thumbnail.opt("uri"), 200000)
                        && thumbnail.optString("uri").matches("data:image/png;base64,[A-Za-z0-9+/=]+");
            }
            default: return false;
        }
    }
}
