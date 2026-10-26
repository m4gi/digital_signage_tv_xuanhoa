using System.Collections.Concurrent;

namespace LedConference;

// Which device last fetched which screen (a room code, or LobbyKey), for the admin's online/offline dots.
// Kept in memory only; after a restart the list refills within one poll (60s).
public sealed class ScreenStatus
{
    public const string LobbyKey = "*"; // lobby screens; room codes never contain '*'

    readonly ConcurrentDictionary<(string Key, string Ip), (DateTime At, string Client)> seen = new();

    // The admin preview (?client=preview) does not count as a screen.
    public void Seen(HttpContext ctx, string key, DateTime now)
    {
        var client = ctx.Request.Query["client"].ToString();
        if (client != "preview") seen[(key, Api.Ip(ctx))] = (now, client == "apk" ? "apk" : "web");
    }

    // Screens that fetched this key in the last day; they poll every 60s, so 3 minutes of silence = offline.
    public object Of(string key, DateTime now) => seen
        .Where(x => x.Key.Key == key && now - x.Value.At < TimeSpan.FromDays(1))
        .OrderByDescending(x => x.Value.At)
        .Select(x => new { ip = x.Key.Ip, lastSeen = x.Value.At.ToString("yyyy-MM-ddTHH:mm:ss"), x.Value.Client, online = now - x.Value.At < TimeSpan.FromMinutes(3) })
        .ToList();
}
