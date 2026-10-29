package vn.xuanhoa.ledconference;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.util.DisplayMetrics;
import android.view.Surface;

/**
 * Turning the screen for a standee mounted sideways. Android is asked to rotate the app's windows (so the mouse and
 * dialogs turn too); whatever part of the turn the device refuses is done by the page itself (display.html?rotate=).
 * Degrees are clockwise from the device's natural orientation, the same as Display.getRotation() * 90.
 */
final class Rotation {
    private Rotation() {}

    static void request(Activity a, int degrees) {
        boolean naturalPortrait = naturalPortrait(a);
        int[] byQuarter = naturalPortrait
                ? new int[]{ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE,
                        ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT, ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE}
                // Landscape-natural boxes differ in which way "portrait" turns; the page makes up the rest.
                : new int[]{ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT,
                        ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT};
        a.setRequestedOrientation(degrees == 0 ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED : byQuarter[degrees / 90 % 4]);
    }

    /** The turn still missing after Android's own rotation: 0 when the device rotated, all of it when it refused. */
    static int remaining(Activity a, int degrees) {
        if (degrees == 0) return 0; // "Dọc": leave the device as it is, even when its settings turn it
        return ((degrees - current(a)) % 360 + 360) % 360;
    }

    @SuppressWarnings("deprecation")
    private static int current(Activity a) {
        switch (a.getWindowManager().getDefaultDisplay().getRotation()) {
            case Surface.ROTATION_90: return 90;
            case Surface.ROTATION_180: return 180;
            case Surface.ROTATION_270: return 270;
            default: return 0;
        }
    }

    private static boolean naturalPortrait(Activity a) {
        DisplayMetrics m = a.getResources().getDisplayMetrics();
        boolean turned = current(a) % 180 != 0;
        return (m.heightPixels > m.widthPixels) != turned;
    }
}
