using System.Text.RegularExpressions;

namespace LedConference;

// Input rules of the admin API. Each check returns field → messages (empty = valid), in the shape
// ValidationProblem sends back, so the admin page can show each message next to its field.
public static class Validation
{
    public static Dictionary<string, string[]> Meeting(MeetingInput i, Data d, out string place)
    {
        var e = new Dictionary<string, string[]>();
        place = (i.Place ?? "").Trim();
        if (i.Date is null) e["date"] = ["Thiếu ngày."];
        if (i.Start is null) e["start"] = ["Thiếu giờ bắt đầu."];
        if (i.End is null) e["end"] = ["Thiếu giờ kết thúc."];
        else if (i.Start is not null && i.End <= i.Start) e["end"] = ["Giờ kết thúc phải sau giờ bắt đầu."];
        if (string.IsNullOrWhiteSpace(i.Title)) e["title"] = ["Thiếu nội dung cuộc họp."];
        Length(e, "title", i.Title, 300);
        Length(e, "chair", i.Chair, 200);
        Length(e, "participants", i.Participants, 500);
        Length(e, "note", i.Note, 500);
        Length(e, "contact", i.Contact, 200);
        Length(e, "place", i.Place, 200);
        if (!string.IsNullOrWhiteSpace(i.RoomCode))
        {
            var room = d.Rooms.FirstOrDefault(r => r.Code == i.RoomCode.Trim().ToUpperInvariant());
            if (room is null) e["roomCode"] = [$"Không có phòng mã '{i.RoomCode}'."];
            else place = room.Name;
        }
        else if (place.Length == 0) e["place"] = ["Chọn phòng hoặc nhập địa điểm."];
        return e;
    }

    public static Dictionary<string, string[]> Room(RoomInput i, bool creating, IEnumerable<Theme> themes)
    {
        var e = new Dictionary<string, string[]>();
        if (creating && !Regex.IsMatch((i.Code ?? "").Trim().ToUpperInvariant(), "^[A-Z0-9_-]{1,32}$"))
            e["code"] = ["Mã phòng chỉ gồm chữ không dấu, số, - hoặc _, tối đa 32 ký tự."];
        if (string.IsNullOrWhiteSpace(i.Name)) e["name"] = ["Thiếu tên phòng."];
        Length(e, "name", i.Name, 100);
        if (i.Places is { Count: > 20 }) e["places"] = ["Tối đa 20 địa điểm."];
        else if (i.Places?.Any(p => p is null || p.Length > 200) == true) e["places"] = ["Mỗi địa điểm tối đa 200 ký tự."];
        Display(e, i.Display, themes);
        return e;
    }

    public static Dictionary<string, string[]> Settings(SettingsInput i, IEnumerable<Theme> themes)
    {
        var e = new Dictionary<string, string[]>();
        Display(e, i.Display, themes);
        if (i.Morning is { } mo && mo.End <= mo.Start) e["morning"] = ["Giờ kết thúc buổi sáng phải sau giờ bắt đầu."];
        if (i.Afternoon is { } af && af.End <= af.Start) e["afternoon"] = ["Giờ kết thúc buổi chiều phải sau giờ bắt đầu."];
        Length(e, "org.line1", i.Org?.Line1, 100);
        Length(e, "org.line2", i.Org?.Line2, 100);
        return e;
    }

    static void Display(Dictionary<string, string[]> e, DisplaySettings? s, IEnumerable<Theme> themes)
    {
        if (s is null) return;
        if (s.Theme is not null && !themes.Any(t => t.Id == s.Theme)) e["display.theme"] = ["Không có mẫu giao diện này."];
        if (s.Orientation is not null && !DisplaySettings.Orientations.Contains(s.Orientation)) e["display.orientation"] = ["Giá trị không hợp lệ."];
        if (s.Effect is not null && !DisplaySettings.Effects.Contains(s.Effect)) e["display.effect"] = ["Giá trị không hợp lệ."];
        if (s.EmptyDay is not null && !DisplaySettings.EmptyDays.Contains(s.EmptyDay)) e["display.emptyDay"] = ["Giá trị không hợp lệ."];
        if (s.Skyline is not null && !DisplaySettings.Skylines.Contains(s.Skyline)) e["display.skyline"] = ["Giá trị không hợp lệ."];
        Length(e, "display.footerNote", s.FooterNote, 200);
    }

    public static void Length(Dictionary<string, string[]> e, string key, string? value, int max)
    {
        if (value is not null && value.Length > max) e.TryAdd(key, [$"Tối đa {max} ký tự."]);
    }
}
