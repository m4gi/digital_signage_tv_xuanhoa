using static LedConference.Api;

namespace LedConference;

public static class RoomEndpoints
{
    public static void MapRooms(this WebApplication app)
    {
        app.MapGet("/api/rooms", (HttpContext ctx, Store store, ServerConfig cfg, ScreenStatus status) =>
        {
            var d = store.Current;
            var now = DateTime.Now;
            var today = DateOnly.FromDateTime(now);
            return d.Rooms.Select(r => new
            {
                r.Code,
                r.Name,
                r.Places,
                r.Display,
                todayCount = d.Meetings.Count(m => m.Date == today && m.Status != MeetingStatus.Cancelled && Screen.Matches(r, m.Place)),
                screenUrl = $"http://{ctx.Request.Host.Host}:{cfg.ScreenPort}/room/{r.Code}",
                screens = status.Of(r.Code, now),
            });
        });

        app.MapPost("/api/rooms", (RoomInput input, HttpContext ctx, Store store) =>
        {
            var errors = Validation.Room(input, creating: true, store.Current.Themes);
            if (errors.Count > 0) return Invalid(errors);
            var room = ToRoom(input, input.Code!.Trim().ToUpperInvariant());
            if (store.Current.Rooms.Any(r => r.Code == room.Code)) return Problem(409, "Mã phòng đã có", $"Đã có phòng mã '{room.Code}'.");
            store.Edit(Ip(ctx), "room.create", room.Code, d => { d.Rooms.Add(room); return room; });
            return Results.Ok(room);
        });

        app.MapPut("/api/rooms/{code}", (string code, RoomInput input, HttpContext ctx, Store store) =>
        {
            code = code.ToUpperInvariant();
            var old = store.Current.Rooms.FirstOrDefault(r => r.Code == code);
            if (old is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{code}'.");
            var errors = Validation.Room(input, creating: false, store.Current.Themes);
            if (errors.Count > 0) return Invalid(errors);
            var room = ToRoom(input, code);
            store.Edit(Ip(ctx), "room.update", code, d =>
            {
                var i = d.Rooms.FindIndex(r => r.Code == code);
                if (i >= 0) d.Rooms[i] = room;
                return Diff(old, room);
            });
            return Results.Ok(room);
        });

        app.MapDelete("/api/rooms/{code}", (string code, HttpContext ctx, Store store) =>
        {
            code = code.ToUpperInvariant();
            var old = store.Current.Rooms.FirstOrDefault(r => r.Code == code);
            if (old is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{code}'.");
            // Meetings stay: they belong to a place, and show up again if a room matches that place.
            store.Edit(Ip(ctx), "room.delete", code, d => { d.Rooms.RemoveAll(r => r.Code == code); return old; });
            return Results.NoContent();
        });
    }

    static Room ToRoom(RoomInput i, string code) => new()
    {
        Code = code,
        Name = i.Name!.Trim(),
        Places = (i.Places ?? []).Select(p => p.Trim()).Where(p => p.Length > 0).Distinct().ToList(),
        Display = i.Display ?? new(),
    };
}
