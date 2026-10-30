package vn.xuanhoa.ledconference;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Opens the app after power-on. Android 10+ blocks this unless "Hiển thị trên ứng dụng khác" is allowed (asked by
 * SetupActivity) or the app is the default HOME app.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        context.startActivity(new Intent(context, SetupActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
