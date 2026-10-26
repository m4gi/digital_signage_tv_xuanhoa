package vn.xuanhoa.ledconference;

import android.app.Activity;
import android.app.AlertDialog;
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

/**
 * Full-screen kiosk view. The page (display.html/css/js, images) is bundled in the APK and served from a fake
 * http origin, so it works the same as on the server; only the schedule JSON and the logo come from the server,
 * fetched by the app on the page's behalf (PageServer).
 */
public class DisplayActivity extends Activity {
    private ScreenPrefs prefs;
    private PageServer pages;
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
        prefs = new ScreenPrefs(this);
        pages = new PageServer(getAssets(), prefs);
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

        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        splash = getLayoutInflater().inflate(R.layout.splash, root, false);
        ((TextView) splash.findViewById(R.id.splashText)).setText("Đang tải lịch " + prefs.roomName() + "…");
        root.addView(splash);
        setContentView(root);

        // Same-origin page: schedule and logo requests come back through PageServer.
        web.loadUrl("http://" + PageServer.HOST + "/display.html?client=apk&room=" + Uri.encode(prefs.room()));
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
            return pages.handle(req.getUrl());
        }

        // The WebView renderer died (low memory on cheap boxes): rebuild the page instead of letting the app crash.
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            web.destroy();
            open();
            return true;
        }
    }
}
