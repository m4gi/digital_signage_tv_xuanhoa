package vn.xuanhoa.ledconference;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Answers the WebView for the fake origin http://led.local: the page files come from the APK assets,
 * the schedule JSON and the logo are fetched from the server on the page's behalf.
 */
final class PageServer {
    static final String HOST = "led.local";
    private final AssetManager assets;
    private final ScreenPrefs prefs;

    PageServer(AssetManager assets, ScreenPrefs prefs) {
        this.assets = assets;
        this.prefs = prefs;
    }

    /** null for any other origin, so the WebView loads it itself. */
    WebResourceResponse handle(Uri u) {
        if (!HOST.equals(u.getHost())) return null;
        String path = u.getPath() == null ? "" : u.getPath();
        if (path.startsWith("/api/") || path.equals("/logo")) return proxy(u);
        String name = u.getLastPathSegment();
        try {
            return new WebResourceResponse(mime(name), "UTF-8", assets.open(name));
        } catch (IOException | NullPointerException e) {
            return status(404, "Not Found");
        }
    }

    /**
     * The page asks its own origin for the schedule and logo; the app fetches them from the server here.
     * The setup screen reaches the server the same way, so if a room could be picked, the schedule loads too:
     * no WebView cross-origin, cleartext or local-network rules involved (newer WebViews block pages from
     * calling LAN addresses directly).
     */
    private WebResourceResponse proxy(Uri u) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(prefs.server() + u.getEncodedPath()
                    + (u.getEncodedQuery() == null ? "" : "?" + u.getEncodedQuery())).openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(10000);
            int code = c.getResponseCode();
            InputStream body = code < 400 ? c.getInputStream() : c.getErrorStream();
            byte[] bytes = ServerScanner.readAll(body);
            if (code >= 300 && code < 400) return status(502, "Bad Gateway"); // WebResourceResponse refuses 3xx
            String type = c.getContentType() == null ? "application/octet-stream" : c.getContentType().split(";")[0].trim();
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(type, "UTF-8", code, reason(code), headers, new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            return status(502, "Bad Gateway"); // server unreachable: the page shows "Mất kết nối" and keeps the last schedule
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String reason(int code) {
        return code == 200 ? "OK" : code == 404 ? "Not Found" : "Error";
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason,
                Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }
}
