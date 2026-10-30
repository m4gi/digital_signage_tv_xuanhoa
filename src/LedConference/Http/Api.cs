using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace LedConference;

// Small helpers shared by the endpoints: error answers, client address, ids and audit diffs.
public static class Api
{
    public static IResult Invalid(Dictionary<string, string[]> errors) => Results.ValidationProblem(errors, title: "Dữ liệu không hợp lệ");

    public static IResult Problem(int status, string title, string detail) => Results.Problem(statusCode: status, title: title, detail: detail);

    // A Cloudflare tunnel (cloudflared on this machine) connects from loopback and names the real visitor in
    // Cf-Connecting-Ip. The header is trusted from loopback only: a LAN machine cannot pose as someone else, and
    // tunnel visitors are never mistaken for the server itself (which skips the admin allowlist).
    public static IPAddress ClientIp(HttpContext ctx)
    {
        var ip = ctx.Connection.RemoteIpAddress ?? IPAddress.None;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) && ctx.Request.Headers.ContainsKey("Cf-Connecting-Ip"))
            return IPAddress.TryParse(ctx.Request.Headers["Cf-Connecting-Ip"].ToString().Trim(), out var real) && !IPAddress.IsLoopback(real)
                ? (real.IsIPv4MappedToIPv6 ? real.MapToIPv4() : real)
                : IPAddress.None; // header present but unusable: never treat it as the server
        return ip;
    }

    // Screen links (for the app, Fully Kiosk, "Mở màn hình") always use the server's LAN address, even when the
    // admin page is opened through a tunnel hostname or as localhost, where the screen port is not reachable.
    public static string ScreenUrl(HttpContext ctx, ServerConfig cfg, string path)
    {
        var host = ctx.Request.Host.Host;
        if (!IPAddress.TryParse(host.Trim('[', ']'), out var ip) || IPAddress.IsLoopback(ip)) host = LanAddress.Value;
        return $"http://{host}:{cfg.ScreenPort}{path}";
    }

    // The IPv4 the server uses toward its default gateway (a UDP "connect" sends nothing).
    static readonly Lazy<string> LanAddress = new(() =>
    {
        try
        {
            using var s = new System.Net.Sockets.Socket(System.Net.Sockets.AddressFamily.InterNetwork,
                System.Net.Sockets.SocketType.Dgram, System.Net.Sockets.ProtocolType.Udp);
            s.Connect("8.8.8.8", 53);
            return ((IPEndPoint)s.LocalEndPoint!).Address.ToString();
        }
        catch (System.Net.Sockets.SocketException)
        {
            return Environment.MachineName;
        }
    });

    public static string Ip(HttpContext ctx) => ClientIp(ctx).ToString();

    public static string Clean(string? s) => (s ?? "").Trim();

    public static string NewId(string prefix) => prefix + Convert.ToHexString(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant();

    // Field-by-field before/after of a changed record, for the audit log.
    public static Dictionary<string, JsonElement[]> Diff<T>(T a, T b)
    {
        var x = JsonSerializer.SerializeToElement(a, Json.Compact);
        var y = JsonSerializer.SerializeToElement(b, Json.Compact);
        return x.EnumerateObject()
            .Where(p => p.Name is not ("updatedAt" or "updatedBy")
                        && y.TryGetProperty(p.Name, out var q) && p.Value.GetRawText() != q.GetRawText())
            .ToDictionary(p => p.Name, p => new[] { p.Value, y.GetProperty(p.Name) });
    }
}
