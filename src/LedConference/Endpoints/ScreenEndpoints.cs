using static LedConference.Api;

namespace LedConference;

// What the screens read (screen port, public): room list, one room's schedule, the lobby. See docs/screen-api.md.
public static class ScreenEndpoints
{
    public static void MapScreens(this WebApplication app)
    {
        // The screen app uses this to recognise a server on the LAN and to pick a room.
        app.MapGet("/api/screens", (HttpContext ctx, Store store) =>
        {
            ctx.Response.Headers.CacheControl = "no-store";
            var d = store.Current;
            return Results.Ok(new
            {
                app = "LedConference",
                apiVersion = 1,
                org = new { d.Settings.Org.Line1, d.Settings.Org.Line2 },
                rooms = d.Rooms.Select(r => new { r.Code, r.Name }),
            });
        });

        app.MapGet("/api/screens/{code}", (string code, HttpContext ctx, Store store, ScreenStatus status, LogoFiles logos) =>
        {
            ctx.Response.Headers.CacheControl = "no-store";
            var d = store.Current;
            var room = d.Rooms.FirstOrDefault(r => r.Code == code.ToUpperInvariant());
            if (room is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{code}'.");

            var s = (room.Display ?? new()).Over(Views.GlobalDisplay(d));
            var display = Views.Display(d, s);
            var org = Views.Org(d, logos.Path() is not null);
            var now = DateTime.Now;
            status.Seen(ctx, room.Code, now);
            var showNextDay = s.EmptyDay == "nextMeeting";
            var pick = Screen.PickFor(Views.RoomMeetings(d, room), now, showNextDay);
            var day = Views.Day(d, room, DateOnly.FromDateTime(now), showNextDay);
            var week = Screen.WeekStart(DateOnly.FromDateTime(now));
            return Results.Ok(new
            {
                apiVersion = 1, // bump on breaking changes; see docs/screen-api.md
                room = new { room.Code, room.Name },
                org,
                serverTime = now.ToString("yyyy-MM-ddTHH:mm:ss"),
                week = new { from = week, to = week.AddDays(6) },
                configVersion = Views.ConfigVersion(display, org),
                display,
                current = pick.Current is null ? null : Views.Public(pick.Current),
                upcoming = pick.Upcoming.Select(Views.Public),
                next = pick.Next is null ? null : Views.Public(pick.Next),
                today = day.Today,
                nextDay = day.NextDay,
            });
        });

        // Lobby screen: every room in one answer, shown in turn by the same page. Uses the global look, never a room's own.
        app.MapGet("/api/lobby", (HttpContext ctx, Store store, ScreenStatus status, LogoFiles logos) =>
        {
            ctx.Response.Headers.CacheControl = "no-store";
            var d = store.Current;
            var s = Views.GlobalDisplay(d);
            var display = Views.Display(d, s);
            var org = Views.Org(d, logos.Path() is not null);
            var now = DateTime.Now;
            status.Seen(ctx, ScreenStatus.LobbyKey, now);
            var date = DateOnly.FromDateTime(now);
            return Results.Ok(new
            {
                apiVersion = 1,
                lobby = true,
                org,
                serverTime = now.ToString("yyyy-MM-ddTHH:mm:ss"),
                configVersion = Views.ConfigVersion(display, org),
                display,
                rooms = d.Rooms.Select(r =>
                {
                    var day = Views.Day(d, r, date, s.EmptyDay == "nextMeeting");
                    return new { room = new { r.Code, r.Name }, today = day.Today, nextDay = day.NextDay };
                }),
            });
        });

        // Admin: link and status of the lobby screens (kept off the screen port: it lists device IPs).
        app.MapGet("/api/lobbyinfo", (HttpContext ctx, ServerConfig cfg, ScreenStatus status) => new
        {
            screenUrl = $"http://{ctx.Request.Host.Host}:{cfg.ScreenPort}/lobby",
            screens = status.Of(ScreenStatus.LobbyKey, DateTime.Now),
        });
    }
}
