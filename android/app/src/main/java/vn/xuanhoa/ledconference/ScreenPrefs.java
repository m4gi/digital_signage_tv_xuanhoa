package vn.xuanhoa.ledconference;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** What this screen shows: the chosen server and room, plus every server that worked before (listed first on a scan). */
final class ScreenPrefs {
    static final String LOBBY = "*";
    private final SharedPreferences p;

    ScreenPrefs(Context c) {
        p = c.getSharedPreferences("screen", Context.MODE_PRIVATE);
    }

    boolean configured() {
        return p.contains("server") && p.contains("room");
    }

    String server() { return p.getString("server", ""); }
    String room() { return p.getString("room", ""); }
    String roomName() { return p.getString("roomName", ""); }

    /** Degrees clockwise the page is turned (0, 90, 180, 270), for a screen mounted sideways that cannot rotate. */
    int rotation() { return p.getInt("rotation", 0); }

    void rotation(int degrees) { p.edit().putInt("rotation", degrees).apply(); }

    Set<String> known() {
        return p.getStringSet("known", Collections.<String>emptySet());
    }

    void choose(String server, String room, String roomName) {
        Set<String> known = new HashSet<>(known());
        known.add(server);
        p.edit()
                .putString("server", server)
                .putString("room", room)
                .putString("roomName", roomName)
                .putStringSet("known", known)
                .apply();
    }
}
