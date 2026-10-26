using System.Text;

namespace LedConference;

public static class Screen
{
    // Excel text may arrive in NFD and with stray spaces; compare places on a normalized form.
    public static string Norm(string s) =>
        string.Join(' ', s.Normalize(NormalizationForm.FormC).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
            .ToLowerInvariant();

    public static bool Matches(Room room, string place)
    {
        var p = Norm(place);
        return p.Length > 0 && (Norm(room.Name) == p || room.Places.Any(x => Norm(x) == p));
    }

    public static Room? RoomOf(IEnumerable<Room> rooms, string place) => rooms.FirstOrDefault(r => Matches(r, place));

    public static DateOnly WeekStart(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));

    public sealed record Pick(Meeting? Current, List<Meeting> Upcoming, Meeting? Next);

    // Current = normal meeting running now (start inclusive, end exclusive).
    // Upcoming = the rest of today that has not ended. Next = first meeting on a later day, only when today is done.
    public static Pick PickFor(IEnumerable<Meeting> roomMeetings, DateTime now, bool showNextDay)
    {
        var date = DateOnly.FromDateTime(now);
        var time = TimeOnly.FromDateTime(now);
        var list = roomMeetings.Where(m => m.Status != MeetingStatus.Cancelled)
            .OrderBy(m => m.Date).ThenBy(m => m.Start).ToList();
        var today = list.Where(m => m.Date == date).ToList();
        var current = today.FirstOrDefault(m => m.Status == MeetingStatus.Normal && m.Start <= time && time < m.End);
        var upcoming = today.Where(m => !ReferenceEquals(m, current) && m.End > time).ToList();
        var next = current is null && upcoming.Count == 0 && showNextDay ? list.FirstOrDefault(m => m.Date > date) : null;
        return new(current, upcoming, next);
    }

    public static List<Meeting> Overlaps(IEnumerable<Meeting> all, IEnumerable<Room> rooms, Meeting m)
    {
        var room = RoomOf(rooms, m.Place);
        if (room is null || m.Status != MeetingStatus.Normal) return [];
        return all.Where(o => o.Id != m.Id && o.Date == m.Date && o.Status == MeetingStatus.Normal
                              && o.Start < m.End && m.Start < o.End && Matches(room, o.Place))
            .OrderBy(o => o.Start).ToList();
    }
}
