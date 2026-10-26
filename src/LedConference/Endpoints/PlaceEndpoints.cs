using static LedConference.Api;

namespace LedConference;

// Places named in meetings: those no room matches yet, assigning one to a room, or marking it "no screen".
public static class PlaceEndpoints
{
    public static void MapPlaces(this WebApplication app)
    {
        // Places used from this week on that match no room and were not marked "no screen".
        app.MapGet("/api/places/unassigned", (Store store) =>
        {
            var d = store.Current;
            var since = Screen.WeekStart(DateOnly.FromDateTime(DateTime.Now));
            var ignored = d.Settings.IgnoredPlaces.Select(Screen.Norm).ToHashSet();
            return d.Meetings
                .Where(m => m.Date >= since && m.Status != MeetingStatus.Cancelled && !ignored.Contains(Screen.Norm(m.Place))
                            && Screen.RoomOf(d.Rooms, m.Place) is null)
                .GroupBy(m => Screen.Norm(m.Place))
                .Select(g => new { place = g.First().Place, count = g.Count(), firstDate = g.Min(m => m.Date) })
                .OrderBy(x => x.firstDate);
        });

        app.MapPost("/api/places/assign", (PlaceInput input, HttpContext ctx, Store store) =>
        {
            var place = Clean(input.Place);
            var code = Clean(input.RoomCode).ToUpperInvariant();
            if (place.Length is 0 or > 200) return Invalid(new() { ["place"] = ["Thiếu địa điểm (tối đa 200 ký tự)."] });
            var room = store.Current.Rooms.FirstOrDefault(r => r.Code == code);
            if (room is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{input.RoomCode}'.");
            if (Screen.Matches(room, place)) return Results.Ok(room);
            var other = Screen.RoomOf(store.Current.Rooms, place);
            if (other is not null) return Problem(409, "Địa điểm đã gán", $"“{place}” đang thuộc phòng {other.Code}.");
            if (room.Places.Count >= 20) return Invalid(new() { ["place"] = ["Phòng đã có tối đa 20 địa điểm."] });
            var updated = room with { Places = [.. room.Places, place] };
            store.Edit(Ip(ctx), "place.assign", code, d =>
            {
                var i = d.Rooms.FindIndex(r => r.Code == code);
                if (i >= 0) d.Rooms[i] = updated;
                return new { place };
            });
            return Results.Ok(updated);
        });

        app.MapPost("/api/places/ignore", (PlaceInput input, HttpContext ctx, Store store) =>
        {
            var place = Clean(input.Place);
            if (place.Length is 0 or > 200) return Invalid(new() { ["place"] = ["Thiếu địa điểm (tối đa 200 ký tự)."] });
            var s = store.Current.Settings;
            if (s.IgnoredPlaces.Any(p => Screen.Norm(p) == Screen.Norm(place))) return Results.NoContent();
            store.Edit(Ip(ctx), "place.ignore", place, d => { d.Settings = s with { IgnoredPlaces = [.. s.IgnoredPlaces, place] }; return null; });
            return Results.NoContent();
        });

        app.MapDelete("/api/places/ignore", (string place, HttpContext ctx, Store store) =>
        {
            var s = store.Current.Settings;
            var kept = s.IgnoredPlaces.Where(p => Screen.Norm(p) != Screen.Norm(place)).ToList();
            if (kept.Count == s.IgnoredPlaces.Count) return Results.NoContent();
            store.Edit(Ip(ctx), "place.unignore", place, d => { d.Settings = s with { IgnoredPlaces = kept }; return null; });
            return Results.NoContent();
        });
    }
}
