package vn.xuanhoa.ledconference;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Full-screen kiosk view. The page (display.html/css/js, images) is bundled in the APK and served from a fake
 * http origin, so it works the same as on the server; only the schedule JSON and the logo come from the server,
 * fetched by the app on the page's behalf.
 */
public class DisplayActivity extends Activity {
    private static final String HOST = "led.local";
    private WebView web;
    private View splash;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        open();
    }

    private void open() {
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.brand));
        web.setKeepScreenOn(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.setWebViewClient(new Client());
        web.setOnLongClickListener(v -> { menu(); return true; });

        SharedPreferences p = getSharedPreferences(SetupActivity.PREFS, MODE_PRIVATE);
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        splash = getLayoutInflater().inflate(R.layout.splash, root, false);
        ((TextView) splash.findViewById(R.id.splashText)).setText("Đang tải lịch " + p.getString("roomName", "") + "…");
        root.addView(splash);
        setContentView(root);

        // Same-origin page: schedule and logo requests come back through proxy() below.
        web.loadUrl("http://" + HOST + "/display.html?client=apk&room=" + Uri.encode(p.getString("room", "")));
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    // Back / Menu on the remote, or a long press on the screen.
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_MENU) {
            menu();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void menu() {
        new AlertDialog.Builder(this)
                .setTitle("Màn hình lịch họp")
                .setItems(new String[]{"Đổi phòng / máy chủ", "Tải lại", "Tiếp tục chiếu"}, (d, i) -> {
                    if (i == 0) finish();
                    else if (i == 1) web.reload();
                })
                .show();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private class Client extends WebViewClient {
        // The page is local and fetches the schedule right after load; give it a moment, then fade the splash.
        @Override
        public void onPageFinished(WebView view, String url) {
            final View s = splash;
            s.animate().alpha(0).setStartDelay(800).setDuration(400).withEndAction(() -> s.setVisibility(View.GONE));
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath() == null ? "" : u.getPath();
            if (path.startsWith("/api/") || path.equals("/logo")) return proxy(u);
            String name = u.getLastPathSegment();
            try {
                return new WebResourceResponse(mime(name), "UTF-8", getAssets().open(name));
            } catch (IOException | NullPointerException e) {
                return status(404, "Not Found");
            }
        }

        // The WebView renderer died (low memory on cheap boxes): rebuild the page instead of letting the app crash.
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            web.destroy();
            open();
            return true;
        }
    }

    /**
     * The page asks its own origin for the schedule and logo; the app fetches them from the server here.
     * The setup screen reaches the server the same way, so if a room could be picked, the schedule loads too:
     * no WebView cross-origin, cleartext or local-network rules involved (newer WebViews block pages from
     * calling LAN addresses directly).
     */
    private WebResourceResponse proxy(Uri u) {
        String server = getSharedPreferences(SetupActivity.PREFS, MODE_PRIVATE).getString("server", "");
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(server + u.getEncodedPath()
                    + (u.getEncodedQuery() == null ? "" : "?" + u.getEncodedQuery())).openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(10000);
            int code = c.getResponseCode();
            InputStream body = code < 400 ? c.getInputStream() : c.getErrorStream();
            byte[] bytes = readAll(body);
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

    private static byte[] readAll(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
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
