package vn.xuanhoa.ledconference;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.EditText;
import android.widget.GridView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * First screen: find the schedule server on the LAN (or type its address), pick the room, then start showing.
 * Once a room is saved the app goes straight to the display on every launch, boot and HOME press.
 */
public class SetupActivity extends Activity {
    private static final int DEFAULT_PORT = 8080;

    private final ExecutorService pool = Executors.newFixedThreadPool(48);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private ScreenPrefs prefs;
    private CardAdapter cards;
    private TextView panelTitle, status, current, currentServer;
    private TextView[] steps;
    private View currentCard, back, rescan;
    private ProgressBar progress;
    private EditText manual;
    private String roomsOf; // server whose rooms are shown, null while listing servers
    private int scanId;
    private boolean launching; // display start is queued; skip the rescan in onRestart
    private boolean askedBoot; // sent to the "Hiển thị trên ứng dụng khác" settings; show the schedule on return
    private AlertDialog asking;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new ScreenPrefs(this);
        buildUi();
        if (prefs.configured()) showOrAsk();
        else scan();
    }

    // HOME pressed, boot or the app icon while the display was running: singleTask cleared it, so start it again.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (prefs.configured()) showOrAsk();
    }

    // Back from the display ("Đổi phòng / máy chủ").
    @Override
    protected void onRestart() {
        super.onRestart();
        if (askedBoot) {
            askedBoot = false;
            startDisplay();
            return;
        }
        showCurrent();
        if (!launching) scan();
    }

    @Override
    protected void onStop() {
        super.onStop();
        launching = false;
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (roomsOf != null) scan();
        else super.onBackPressed();
    }

    private void startDisplay() {
        launching = true;
        startActivity(new Intent(this, DisplayActivity.class));
    }

    // Without the permission the app does not come back after a power cut: ask on every launch until it is allowed.
    private void showOrAsk() {
        if (!bootBlocked()) {
            startDisplay();
            return;
        }
        // Android 15+ also sends the boot broadcast on the first start after install, so this can come twice.
        if (asking != null && asking.isShowing()) return;
        asking = new AlertDialog.Builder(this)
                .setTitle("Tự mở khi bật máy")
                .setMessage("Android chặn ứng dụng tự mở khi bật máy. Để màn hình tự chiếu lịch sau khi mất điện hoặc "
                        + "khởi động lại: bấm Mở cài đặt, bật \"Hiển thị trên ứng dụng khác\" cho Lịch họp, rồi bấm Quay lại.")
                .setPositiveButton("Mở cài đặt", (d, w) -> openBootSettings())
                .setNegativeButton("Bỏ qua", (d, w) -> startDisplay())
                .setCancelable(false)
                .show();
    }

    /** Android 10+ ignores BootReceiver's start unless the overlay permission is allowed or this is the HOME app. */
    private boolean bootBlocked() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || Settings.canDrawOverlays(this)) return false;
        // RoleManager, not resolveActivity(HOME): Android 11+ hides other launchers, so that would always find this app.
        return !getSystemService(RoleManager.class).isRoleHeld(RoleManager.ROLE_HOME);
    }

    private void openBootSettings() {
        Uri app = Uri.parse("package:" + getPackageName());
        askedBoot = true;
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, app));
        } catch (ActivityNotFoundException e) {
            try { // some TV boxes have no such screen: the app's own settings page may still list it
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, app));
            } catch (ActivityNotFoundException e2) {
                askedBoot = false;
                startDisplay();
            }
        }
    }

    private static String host(String base) {
        return base.replace("http://", "");
    }

    // ---- UI ----

    private void buildUi() {
        setContentView(R.layout.activity_setup);
        panelTitle = findViewById(R.id.panelTitle);
        status = findViewById(R.id.status);
        progress = findViewById(R.id.progress);
        current = findViewById(R.id.current);
        currentServer = findViewById(R.id.currentServer);
        currentCard = findViewById(R.id.currentCard);
        manual = findViewById(R.id.manual);
        back = findViewById(R.id.back);
        rescan = findViewById(R.id.rescan);
        steps = new TextView[]{findViewById(R.id.step1), findViewById(R.id.step2), findViewById(R.id.step3)};

        ((TextView) findViewById(R.id.appInfo)).setText(getString(R.string.app_name) + "\nCài đặt màn hình · v" + version());
        back.setOnClickListener(v -> scan());
        rescan.setOnClickListener(v -> scan());
        findViewById(R.id.resume).setOnClickListener(v -> startDisplay());
        findViewById(R.id.connect).setOnClickListener(v -> connectManual());
        manual.setOnEditorActionListener((v, a, e) -> { connectManual(); return true; });

        GridView grid = findViewById(R.id.grid);
        cards = new CardAdapter(this);
        grid.setAdapter(cards);
        grid.setOnItemClickListener((p, v, i, id) -> {
            CardAdapter.Item it = cards.items.get(i);
            if (roomsOf == null) connect(it.key);
            else chooseRoom(roomsOf, it);
        });

        // Portrait standee: stack the two panels and drop the side texts so the server list keeps most of the height.
        if (getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT) {
            findViewById(R.id.help).setVisibility(View.GONE);
            findViewById(R.id.tip).setVisibility(View.GONE);
            if (getResources().getConfiguration().screenWidthDp < 600) findViewById(R.id.appInfo).setVisibility(View.GONE);
            ((LinearLayout) findViewById(R.id.body)).setOrientation(LinearLayout.VERTICAL);
            findViewById(R.id.left).setLayoutParams(new LinearLayout.LayoutParams(-1, 0, 1));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(16);
            findViewById(R.id.right).setLayoutParams(lp);
        }

        // Apps are drawn edge to edge on new Android: the blue header runs under the status bar,
        // everything else keeps clear of the navigation bar and the keyboard.
        final View header = findViewById(R.id.header), root = findViewById(R.id.root);
        root.setOnApplyWindowInsetsListener((v, in) -> {
            header.setPadding(dp(24) + in.getSystemWindowInsetLeft(), dp(16) + in.getSystemWindowInsetTop(),
                    dp(24) + in.getSystemWindowInsetRight(), dp(16));
            v.setPadding(0, 0, 0, in.getSystemWindowInsetBottom());
            return in.consumeSystemWindowInsets();
        });
        showCurrent();
    }

    private String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** Step chips: done = soft blue, current = solid blue, later = outlined. */
    private void step(int n) {
        for (int i = 0; i < steps.length; i++) {
            TextView s = steps[i];
            s.setPadding(dp(14), dp(7), dp(14), dp(7));
            boolean done = i < n - 1, now = i == n - 1;
            s.setBackground(CardAdapter.pill(now ? getColor(R.color.brand) : done ? getColor(R.color.brand_soft) : 0,
                    now || done ? 0 : getColor(R.color.line), dp(20)));
            s.setTextColor(getColor(now ? R.color.surface : done ? R.color.brand : R.color.muted));
        }
    }

    private void setStatus(String text, boolean error) {
        status.setText(text);
        status.setTextColor(getColor(error ? R.color.error : R.color.muted));
    }

    private void showCurrent() {
        boolean on = prefs.configured();
        currentCard.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) {
            String room = prefs.room();
            current.setText(ScreenPrefs.LOBBY.equals(room) ? "Tất cả phòng (màn hình sảnh)" : room + " – " + prefs.roomName());
            currentServer.setText("Máy chủ " + host(prefs.server()));
        }
    }

    private void putServer(String base, String sub, int dot) {
        CardAdapter.Item it = cards.find(base);
        if (it == null) {
            it = new CardAdapter.Item();
            it.key = base;
            it.title = host(base);
            cards.items.add(it);
        }
        it.sub = sub;
        it.dot = dot;
        cards.notifyDataSetChanged();
    }

    private static String label(JSONObject j) {
        JSONObject org = j.optJSONObject("org");
        JSONArray rooms = j.optJSONArray("rooms");
        return (org != null ? org.optString("line2") + " · " : "") + (rooms != null ? rooms.length() : 0) + " phòng";
    }

    // ---- discovery ----

    private void scan() {
        final int id = ++scanId;
        roomsOf = null;
        cards.items.clear();
        cards.notifyDataSetChanged();
        step(1);
        panelTitle.setText("Máy chủ trong mạng LAN");
        back.setVisibility(View.GONE);
        rescan.setVisibility(View.VISIBLE);

        Set<String> targets = ServerScanner.targets(prefs.known());
        if (targets.isEmpty()) {
            progress.setVisibility(View.GONE);
            setStatus("Thiết bị chưa có mạng LAN. Kiểm tra dây mạng, rồi bấm Quét lại hoặc nhập IP máy chủ.", true);
            return;
        }

        final int total = targets.size();
        final AtomicInteger done = new AtomicInteger();
        progress.setVisibility(View.VISIBLE);
        progress.setMax(total);
        progress.setProgress(0);
        setStatus("Đang tìm máy chủ…", false);
        for (final String base : targets) {
            pool.execute(() -> {
                JSONObject found = null;
                try {
                    Uri u = Uri.parse(base);
                    if (ServerScanner.open(u.getHost(), u.getPort())) found = ServerScanner.probe(base);
                } catch (Exception ignored) {
                    // not a schedule server
                }
                final JSONObject j = found;
                final int n = done.incrementAndGet();
                ui.post(() -> {
                    if (id != scanId) return;
                    if (j != null) putServer(base, label(j), getColor(R.color.ok));
                    progress.setProgress(n);
                    if (n < total) {
                        setStatus("Đang tìm máy chủ… đã thử " + n + "/" + total + " địa chỉ", false);
                    } else {
                        progress.setVisibility(View.GONE);
                        if (cards.items.isEmpty())
                            setStatus("Không tìm thấy máy chủ. Nhập IP máy chủ (và cổng màn hình) ở khung bên cạnh.", true);
                        else
                            setStatus("Tìm thấy " + cards.items.size() + " máy chủ. Chọn máy chủ để kết nối.", false);
                    }
                });
            });
        }
    }

    // ---- connect and pick a room ----

    private void connectManual() {
        String text = manual.getText().toString().trim();
        Uri u = Uri.parse(text.contains("://") ? text : "http://" + text);
        int port;
        try {
            port = u.getPort(); // throws on a malformed port such as "8080abc"
        } catch (NumberFormatException e) {
            port = 0;
        }
        if (u.getHost() == null || u.getHost().isEmpty() || port == 0 || port > 65535) {
            setStatus("Địa chỉ không hợp lệ. Ví dụ: 192.168.1.10:" + DEFAULT_PORT, true);
            return;
        }
        connect("http://" + u.getHost() + ":" + (port > 0 ? port : DEFAULT_PORT));
    }

    private void connect(final String base) {
        ++scanId; // stop listing scan results over what comes next
        progress.setVisibility(View.GONE);
        setStatus("Đang kết nối " + host(base) + "…", false);
        pool.execute(() -> {
            try {
                JSONObject j = ServerScanner.probe(base);
                ui.post(() -> showRooms(base, j));
            } catch (Exception e) {
                final String why = e instanceof SocketTimeoutException ? "hết thời gian chờ"
                        : e instanceof ConnectException ? "không kết nối được (sai IP/cổng, máy chủ tắt hoặc tường lửa chặn)"
                        : e.getMessage();
                ui.post(() -> {
                    if (roomsOf != null) return;
                    setStatus("Lỗi " + host(base) + ": " + why + ". Kiểm tra lại rồi nhập IP ở khung bên cạnh.", true);
                    if (cards.find(base) != null) putServer(base, "Không kết nối được", getColor(R.color.error));
                    manual.setText(host(base));
                });
            }
        });
    }

    private void showRooms(String base, JSONObject j) {
        roomsOf = base;
        step(2);
        panelTitle.setText("Chọn phòng");
        back.setVisibility(View.VISIBLE);
        rescan.setVisibility(View.GONE);
        cards.items.clear();
        JSONArray rooms = j.optJSONArray("rooms");
        // Lobby screen: room "*" makes the page show every room in turn (/api/lobby).
        if (rooms != null && rooms.length() > 0) {
            CardAdapter.Item lobby = new CardAdapter.Item();
            lobby.key = ScreenPrefs.LOBBY;
            lobby.badge = "SẢNH";
            lobby.title = "Tất cả phòng";
            lobby.sub = "Màn hình đặt ở sảnh, chiếu lần lượt lịch các phòng";
            cards.items.add(lobby);
        }
        for (int i = 0; rooms != null && i < rooms.length(); i++) {
            JSONObject r = rooms.optJSONObject(i);
            CardAdapter.Item it = new CardAdapter.Item();
            it.key = r.optString("code");
            it.badge = it.key;
            it.title = r.optString("name");
            it.sub = "Màn hình đặt trước phòng này";
            cards.items.add(it);
        }
        cards.notifyDataSetChanged();
        if (cards.items.isEmpty())
            setStatus("Đã kết nối " + host(base) + " nhưng máy chủ chưa có phòng nào. Thêm phòng ở trang quản trị rồi thử lại.", true);
        else
            setStatus("Đã kết nối " + host(base) + ". Màn hình này đặt trước phòng nào?", false);
        findViewById(R.id.grid).requestFocus();
    }

    private void chooseRoom(String base, CardAdapter.Item room) {
        prefs.choose(base, room.key, room.title);
        step(3);
        showCurrent();
        showOrAsk();
    }
}
