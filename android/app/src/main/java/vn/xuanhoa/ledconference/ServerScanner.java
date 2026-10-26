package vn.xuanhoa.ledconference;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Finding a schedule server on the LAN. Blocking calls: run them off the UI thread. */
final class ServerScanner {
    // Ports the installer usually suggests for the screen port; anything else is typed by hand.
    private static final int[] PORTS = {8080, 8082, 8083, 8088, 8090, 18080, 80};

    private ServerScanner() {
    }

    /** Servers that worked before come first, then every host and port of the device's own /24. */
    static Set<String> targets(Set<String> known) {
        Set<String> targets = new LinkedHashSet<>(known);
        for (String h : subnetHosts())
            for (int port : PORTS) targets.add("http://" + h + ":" + port);
        return targets;
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

    static boolean open(String host, int port) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, port), 400);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** The server's /api/screens answer, or an exception saying why this address is not a schedule server. */
    static JSONObject probe(String base) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/screens").openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(5000);
        try {
            if (c.getResponseCode() != 200) throw new IOException("máy chủ trả lỗi " + c.getResponseCode());
            JSONObject j = new JSONObject(new String(readAll(c.getInputStream()), "UTF-8"));
            if (!"LedConference".equals(j.optString("app"))) throw new IOException("địa chỉ này không phải máy chủ lịch họp");
            return j;
        } finally {
            c.disconnect();
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }
}
