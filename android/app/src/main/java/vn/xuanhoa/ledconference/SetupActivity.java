package vn.xuanhoa.ledconference;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.inputmethod.EditorInfo;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
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

    private final ExecutorService pool = Executors.newFixedThreadPool(48);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final List<String> bases = new ArrayList<>();
    private ArrayAdapter<String> rows;
    private SharedPreferences prefs;
    private TextView status, current;
    private Button resume;
    private EditText manual;
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

    private boolean configured() {
        return prefs.contains("server") && prefs.contains("room");
    }

    private void startDisplay() {
        launching = true;
        startActivity(new Intent(this, DisplayActivity.class));
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        // Keep clear of the status/navigation bars and the on-screen keyboard (apps are drawn edge to edge on new Android).
        root.setOnApplyWindowInsetsListener((v, in) -> {
            v.setPadding(dp(32) + in.getSystemWindowInsetLeft(), dp(24) + in.getSystemWindowInsetTop(),
                    dp(32) + in.getSystemWindowInsetRight(), dp(24) + in.getSystemWindowInsetBottom());
            return in.consumeSystemWindowInsets();
        });

        TextView title = new TextView(this);
        title.setText("Cài đặt màn hình lịch họp");
        title.setTextSize(26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        current = new TextView(this);
        current.setTextSize(16);
        current.setPadding(0, dp(8), 0, 0);
        root.addView(current);

        resume = new Button(this);
        resume.setText("Tiếp tục chiếu");
        resume.setOnClickListener(v -> startDisplay());
        root.addView(resume, new LinearLayout.LayoutParams(-2, -2));

        status = new TextView(this);
        status.setTextSize(18);
        status.setPadding(0, dp(16), 0, dp(8));
        root.addView(status);

        ListView list = new ListView(this);
        rows = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1);
        list.setAdapter(rows);
        list.setOnItemClickListener((p, v, i, id) -> connect(bases.get(i)));
        root.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        manual = new EditText(this);
        manual.setHint("IP máy chủ, ví dụ 192.168.1.10:" + DEFAULT_PORT);
        manual.setSingleLine(true);
        manual.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        manual.setImeOptions(EditorInfo.IME_ACTION_GO);
        manual.setOnEditorActionListener((v, a, e) -> { connectManual(); return true; });
        row.addView(manual, new LinearLayout.LayoutParams(0, -2, 1));
        Button go = new Button(this);
        go.setText("Kết nối");
        go.setOnClickListener(v -> connectManual());
        row.addView(go);
        Button again = new Button(this);
        again.setText("Quét lại");
        again.setOnClickListener(v -> scan());
        row.addView(again);
        root.addView(row);

        setContentView(root);
        showCurrent();
    }

    private void showCurrent() {
        boolean on = configured();
        current.setText(on ? "Đang chiếu: " + prefs.getString("roomName", "") + " (" + prefs.getString("room", "")
                + ") · máy chủ " + prefs.getString("server", "").replace("http://", "") : "Chưa chọn phòng.");
        resume.setVisibility(on ? Button.VISIBLE : Button.GONE);
    }

    private void addRow(String base, String label) {
        int i = bases.indexOf(base);
        String text = base.replace("http://", "") + "  ·  " + label;
        if (i >= 0) {
            rows.remove(rows.getItem(i));
            rows.insert(text, i);
        } else {
            bases.add(base);
            rows.add(text);
        }
    }

    private static String label(JSONObject j) {
        return j.optJSONObject("org") != null ? j.optJSONObject("org").optString("line2") + " · "
                + j.optJSONArray("rooms").length() + " phòng" : "";
    }

    // ---- discovery ----

    private void scan() {
        final int id = ++scanId;
        bases.clear();
        rows.clear();
        status.setText("Đang tìm máy chủ trong mạng…");

        // Servers that worked before are listed (and checked) first, then the device's own /24 is swept.
        Set<String> targets = new LinkedHashSet<>(prefs.getStringSet("known", Collections.<String>emptySet()));
        for (String host : subnetHosts())
            for (int port : PORTS) targets.add("http://" + host + ":" + port);
        if (targets.isEmpty()) {
            status.setText("Thiết bị chưa có mạng LAN. Kiểm tra dây mạng, rồi bấm Quét lại hoặc nhập IP máy chủ.");
            return;
        }

        final AtomicInteger left = new AtomicInteger(targets.size());
        for (final String base : targets) {
            pool.execute(() -> {
                try {
                    Uri u = Uri.parse(base);
                    if (open(u.getHost(), u.getPort())) {
                        JSONObject j = probe(base);
                        ui.post(() -> { if (id == scanId) addRow(base, label(j)); });
                    }
                } catch (Exception ignored) {
                    // not a schedule server
                }
                if (left.decrementAndGet() == 0) ui.post(() -> {
                    if (id != scanId) return;
                    status.setText(bases.isEmpty()
                            ? "Không tìm thấy máy chủ. Nhập IP máy chủ (và cổng màn hình) bên dưới."
                            : "Chọn máy chủ để kết nối:");
                });
            });
        }
    }

    // ponytail: only the /24 around each LAN address; bigger subnets need the IP typed in.
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
            if (c.getResponseCode() != 200) throw new IOException("Máy chủ trả lỗi " + c.getResponseCode());
            JSONObject j = new JSONObject(read(c.getInputStream()));
            if (!"LedConference".equals(j.optString("app"))) throw new IOException("Địa chỉ này không phải máy chủ lịch họp");
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
            status.setText("Địa chỉ không hợp lệ. Ví dụ: 192.168.1.10:" + DEFAULT_PORT);
            return;
        }
        connect("http://" + u.getHost() + ":" + (port > 0 ? port : DEFAULT_PORT));
    }

    private void connect(final String base) {
        status.setText("Đang kết nối " + base.replace("http://", "") + "…");
        pool.execute(() -> {
            try {
                JSONObject j = probe(base);
                ui.post(() -> pickRoom(base, j));
            } catch (Exception e) {
                final String why = e instanceof SocketTimeoutException ? "hết thời gian chờ"
                        : e instanceof ConnectException ? "không kết nối được (sai IP/cổng, máy chủ tắt hoặc tường lửa chặn)"
                        : e.getMessage();
                ui.post(() -> {
                    status.setText("Lỗi " + base.replace("http://", "") + ": " + why + ". Kiểm tra lại rồi nhập IP bên dưới.");
                    manual.setText(base.replace("http://", ""));
                    manual.requestFocus();
                });
            }
        });
    }

    private void pickRoom(final String base, JSONObject j) {
        addRow(base, label(j));
        final JSONArray rooms = j.optJSONArray("rooms");
        if (rooms == null || rooms.length() == 0) {
            status.setText("Đã kết nối nhưng máy chủ chưa có phòng nào. Thêm phòng ở trang quản trị rồi thử lại.");
            return;
        }
        status.setText("Đã kết nối " + base.replace("http://", "") + ". Chọn phòng:");
        String[] items = new String[rooms.length()];
        for (int i = 0; i < items.length; i++) {
            JSONObject r = rooms.optJSONObject(i);
            items[i] = r.optString("code") + " – " + r.optString("name");
        }
        new AlertDialog.Builder(this)
                .setTitle("Màn hình này đặt trước phòng nào?")
                .setItems(items, (d, i) -> {
                    JSONObject r = rooms.optJSONObject(i);
                    Set<String> known = new HashSet<>(prefs.getStringSet("known", Collections.<String>emptySet()));
                    known.add(base);
                    prefs.edit()
                            .putString("server", base)
                            .putString("room", r.optString("code"))
                            .putString("roomName", r.optString("name"))
                            .putStringSet("known", known)
                            .apply();
                    showCurrent();
                    startDisplay();
                })
                .setNegativeButton("Huỷ", null)
                .show();
    }
}
