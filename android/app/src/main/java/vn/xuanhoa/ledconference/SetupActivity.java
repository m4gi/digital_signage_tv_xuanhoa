package vn.xuanhoa.ledconference;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.GridView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * First screen: find the schedule server on the LAN (or type its address), pick the room, then start showing.
 * Once a room is saved the app goes straight to the display on every launch, boot and HOME press.
 */
public class SetupActivity extends Activity {
    static final String PREFS = "screen";
    // Ports the installer usually suggests for the screen port; anything else is typed by hand.
    private static final int[] PORTS = {8080, 8088, 8090, 18080, 80};
    private static final int DEFAULT_PORT = 8080;

    /** One card in the grid: a server (key = base url) or a room (key = room code). */
    private static final class Item {
        String key, badge, title, sub;
        int dot; // 0 = no dot
    }

    private final ExecutorService pool = Executors.newFixedThreadPool(48);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final List<Item> items = new ArrayList<>();
    private SharedPreferences prefs;
    private TextView panelTitle, status, current, currentServer;
    private TextView[] steps;
    private View currentCard, back, rescan;
    private ProgressBar progress;
    private EditText manual;
    private BaseAdapter adapter;
    private String roomsOf; // server whose rooms are shown, null while listing servers
    private int scanId;
    private boolean launching; // display start is queued; skip the rescan in onRestart

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildUi();
        if (configured()) startDisplay();
        else scan();
    }

    // HOME pressed (or boot) while the display was running: singleTask cleared it, so start it again.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (configured()) startDisplay();
    }

    // Back from the display ("Đổi phòng / máy chủ").
    @Override
    protected void onRestart() {
        super.onRestart();
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

    private boolean configured() {
        return prefs.contains("server") && prefs.contains("room");
    }

    private void startDisplay() {
        launching = true;
        startActivity(new Intent(this, DisplayActivity.class));
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
        adapter = new Cards();
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((p, v, i, id) -> {
            Item it = items.get(i);
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

    private static GradientDrawable pill(int fill, int stroke, float radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        if (stroke != 0) g.setStroke(2, stroke);
        g.setCornerRadius(radius);
        return g;
    }

    /** Step chips: done = soft blue, current = solid blue, later = outlined. */
    private void step(int n) {
        for (int i = 0; i < steps.length; i++) {
            TextView s = steps[i];
            s.setPadding(dp(14), dp(7), dp(14), dp(7));
            boolean done = i < n - 1, now = i == n - 1;
            s.setBackground(pill(now ? getColor(R.color.brand) : done ? getColor(R.color.brand_soft) : 0,
                    now || done ? 0 : getColor(R.color.line), dp(20)));
            s.setTextColor(getColor(now ? R.color.surface : done ? R.color.brand : R.color.muted));
        }
    }

    private void setStatus(String text, boolean error) {
        status.setText(text);
        status.setTextColor(getColor(error ? R.color.error : R.color.muted));
    }

    private void showCurrent() {
        boolean on = configured();
        currentCard.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) {
            current.setText(prefs.getString("room", "") + " – " + prefs.getString("roomName", ""));
            currentServer.setText("Máy chủ " + host(prefs.getString("server", "")));
        }
    }

    private class Cards extends BaseAdapter {
        @Override public int getCount() { return items.size(); }
        @Override public Object getItem(int i) { return items.get(i); }
        @Override public long getItemId(int i) { return i; }

        @Override
        public View getView(int i, View v, ViewGroup parent) {
            if (v == null) v = getLayoutInflater().inflate(R.layout.item_card, parent, false);
            Item it = items.get(i);
            View dot = v.findViewById(R.id.dot);
            dot.setVisibility(it.dot == 0 ? View.GONE : View.VISIBLE);
            if (it.dot != 0) dot.setBackground(pill(it.dot, 0, dp(6)));
            TextView badge = v.findViewById(R.id.badge);
            badge.setVisibility(it.badge == null ? View.GONE : View.VISIBLE);
            badge.setText(it.badge);
            badge.setBackground(pill(getColor(R.color.brand_soft), 0, dp(8)));
            ((TextView) v.findViewById(R.id.title)).setText(it.title);
            ((TextView) v.findViewById(R.id.sub)).setText(it.sub);
            return v;
        }
    }

    private void putServer(String base, String sub, int dot) {
        Item it = null;
        for (Item x : items) if (x.key.equals(base)) it = x;
        if (it == null) {
            it = new Item();
            it.key = base;
            it.title = host(base);
            items.add(it);
        }
        it.sub = sub;
        it.dot = dot;
        adapter.notifyDataSetChanged();
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
        items.clear();
        adapter.notifyDataSetChanged();
        step(1);
        panelTitle.setText("Máy chủ trong mạng LAN");
        back.setVisibility(View.GONE);
        rescan.setVisibility(View.VISIBLE);

        // Servers that worked before are listed (and checked) first, then the device's own /24 is swept.
        Set<String> targets = new LinkedHashSet<>(prefs.getStringSet("known", Collections.<String>emptySet()));
        for (String h : subnetHosts())
            for (int port : PORTS) targets.add("http://" + h + ":" + port);
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
                    if (open(u.getHost(), u.getPort())) found = probe(base);
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
                        if (items.isEmpty())
                            setStatus("Không tìm thấy máy chủ. Nhập IP máy chủ (và cổng màn hình) ở khung bên cạnh.", true);
                        else
                            setStatus("Tìm thấy " + items.size() + " máy chủ. Chọn máy chủ để kết nối.", false);
                    }
                });
            });
        }
    }

    // Limit: only the /24 around each LAN address; bigger subnets need the IP typed in.
    private static List<String> subnetHosts() {
        List<String> hosts = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress a = ia.getAddress();
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    byte[] b = a.getAddress();
                    String prefix = (b[0] & 255) + "." + (b[1] & 255) + "." + (b[2] & 255) + ".";
                    for (int i = 1; i < 255; i++) hosts.add(prefix + i);
                }
            }
        } catch (Exception ignored) {
            // no interfaces: caller shows the "no LAN" message
        }
        return hosts;
    }

    private static boolean open(String host, int port) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, port), 400);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    static JSONObject probe(String base) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/screens").openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(5000);
        try {
            if (c.getResponseCode() != 200) throw new IOException("máy chủ trả lỗi " + c.getResponseCode());
            JSONObject j = new JSONObject(read(c.getInputStream()));
            if (!"LedConference".equals(j.optString("app"))) throw new IOException("địa chỉ này không phải máy chủ lịch họp");
            return j;
        } finally {
            c.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
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
                JSONObject j = probe(base);
                ui.post(() -> showRooms(base, j));
            } catch (Exception e) {
                final String why = e instanceof SocketTimeoutException ? "hết thời gian chờ"
                        : e instanceof ConnectException ? "không kết nối được (sai IP/cổng, máy chủ tắt hoặc tường lửa chặn)"
                        : e.getMessage();
                ui.post(() -> {
                    if (roomsOf != null) return;
                    setStatus("Lỗi " + host(base) + ": " + why + ". Kiểm tra lại rồi nhập IP ở khung bên cạnh.", true);
                    for (Item x : items) if (x.key.equals(base)) putServer(base, "Không kết nối được", getColor(R.color.error));
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
        items.clear();
        JSONArray rooms = j.optJSONArray("rooms");
        for (int i = 0; rooms != null && i < rooms.length(); i++) {
            JSONObject r = rooms.optJSONObject(i);
            Item it = new Item();
            it.key = r.optString("code");
            it.badge = it.key;
            it.title = r.optString("name");
            it.sub = "Màn hình đặt trước phòng này";
            items.add(it);
        }
        adapter.notifyDataSetChanged();
        if (items.isEmpty())
            setStatus("Đã kết nối " + host(base) + " nhưng máy chủ chưa có phòng nào. Thêm phòng ở trang quản trị rồi thử lại.", true);
        else
            setStatus("Đã kết nối " + host(base) + ". Màn hình này đặt trước phòng nào?", false);
        findViewById(R.id.grid).requestFocus();
    }

    private void chooseRoom(String base, Item room) {
        Set<String> known = new HashSet<>(prefs.getStringSet("known", Collections.<String>emptySet()));
        known.add(base);
        prefs.edit()
                .putString("server", base)
                .putString("room", room.key)
                .putString("roomName", room.title)
                .putStringSet("known", known)
                .apply();
        step(3);
        showCurrent();
        startDisplay();
    }
}
