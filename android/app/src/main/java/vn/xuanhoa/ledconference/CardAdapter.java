package vn.xuanhoa.ledconference;

import android.app.Activity;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/** The setup grid: server cards (key = base url) or room cards (key = room code). */
final class CardAdapter extends BaseAdapter {
    static final class Item {
        String key, badge, title, sub;
        int dot; // 0 = no dot
    }

    final List<Item> items = new ArrayList<>();
    private final Activity a;

    CardAdapter(Activity a) {
        this.a = a;
    }

    static GradientDrawable pill(int fill, int stroke, float radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        if (stroke != 0) g.setStroke(2, stroke);
        g.setCornerRadius(radius);
        return g;
    }

    Item find(String key) {
        for (Item x : items) if (x.key.equals(key)) return x;
        return null;
    }

    @Override public int getCount() { return items.size(); }
    @Override public Object getItem(int i) { return items.get(i); }
    @Override public long getItemId(int i) { return i; }

    @Override
    public View getView(int i, View v, ViewGroup parent) {
        if (v == null) v = a.getLayoutInflater().inflate(R.layout.item_card, parent, false);
        float dp = a.getResources().getDisplayMetrics().density;
        Item it = items.get(i);
        View dot = v.findViewById(R.id.dot);
        dot.setVisibility(it.dot == 0 ? View.GONE : View.VISIBLE);
        if (it.dot != 0) dot.setBackground(pill(it.dot, 0, Math.round(6 * dp)));
        TextView badge = v.findViewById(R.id.badge);
        badge.setVisibility(it.badge == null ? View.GONE : View.VISIBLE);
        badge.setText(it.badge);
        badge.setBackground(pill(a.getColor(R.color.brand_soft), 0, Math.round(8 * dp)));
        ((TextView) v.findViewById(R.id.title)).setText(it.title);
        ((TextView) v.findViewById(R.id.sub)).setText(it.sub);
        return v;
    }
}
