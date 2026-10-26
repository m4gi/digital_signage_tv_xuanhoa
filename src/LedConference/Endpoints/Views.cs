using System.Security.Cryptography;
using System.Text.Json;

namespace LedConference;

// The JSON shapes the API sends: what screens may see (public) and what the admin page gets.
public static class Views
{
    public static DisplaySettings GlobalDisplay(Data d) => d.Settings.Display.Over(DisplaySettings.Defaults);

    // A switched-off note or contact never leaves the server: the screen gets "" and shows no such line.
    public static object Public(Meeting m) => new
    {
        m.Id, m.Date, m.Start, m.End, m.EndEstimated, m.Title, m.Chair, m.Participants,
        note = m.ShowNote ? m.Note : "", contact = m.ShowContact ? m.Contact : "", m.Status,
    };

    public static object Admin(Meeting m, IEnumerable<Room> rooms) => new
    {
        m.Id, m.Date, m.Start, m.End, m.EndEstimated, m.Title, m.Chair, m.Participants, m.Note, m.ShowNote, m.Contact, m.ShowContact, m.Place,
        roomCode = Screen.RoomOf(rooms, m.Place)?.Code,
        m.Status, m.Source, m.ImportId, m.UpdatedAt, m.UpdatedBy,
    };

    public static object Display(Data d, DisplaySettings s) => new
    {
        s.Orientation, s.Effect, s.Clock, s.Footer, s.ReduceMotion, s.HideCursor, s.FooterNote, s.EmptyDay, s.Skyline,
        theme = d.Themes.FirstOrDefault(t => t.Id == s.Theme) ?? d.Themes[0],
    };

    public static object Org(Data d, bool customLogo) => new
    {
        d.Settings.Org.Line1,
        d.Settings.Org.Line2,
        logoUrl = $"/logo?v={d.Settings.LogoVersion}",
        customLogo,
    };

    // Changes when anything the screen draws from (look, names, logo) changes; screens re-apply only then.
    public static string ConfigVersion(object display, object org) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { display, org }, Json.Compact)))[..8].ToLowerInvariant();

    public static List<Meeting> RoomMeetings(Data d, Room room) =>
        d.Meetings.Where(m => Screen.Matches(room, m.Place) && m.Status != MeetingStatus.Cancelled).ToList();

    // The day's meetings and the first one of a later day; the screen re-picks from these itself
    // (meeting just ended, rotating card, offline, lobby), see web/schedule.js.
    public static (IEnumerable<object> Today, object? NextDay) Day(Data d, Room room, DateOnly date, bool showNextDay)
    {
        var list = RoomMeetings(d, room);
        var next = showNextDay ? list.Where(m => m.Date > date).OrderBy(m => m.Date).ThenBy(m => m.Start).FirstOrDefault() : null;
        return (list.Where(m => m.Date == date).OrderBy(m => m.Start).Select(Public).ToList(), next is null ? null : Public(next));
    }

    public static object Theme(Theme t, Data d)
    {
        var global = GlobalDisplay(d).Theme;
        return new
        {
            t.Id,
            t.Name,
            builtIn = t.IsBuiltIn,
            modified = t.IsBuiltIn && t != LedConference.Theme.BuiltIn.First(b => b.Id == t.Id),
            usedGlobally = global == t.Id,
            usedBy = d.Rooms.Where(r => ((r.Display ?? new()).Theme ?? global) == t.Id).Select(r => r.Code),
            contrast = t.Contrast(),
            tokens = t,
        };
    }
}
