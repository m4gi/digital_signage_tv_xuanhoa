using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace LedConference;

// Small helpers shared by the endpoints: error answers, client address, ids and audit diffs.
public static class Api
{
    public static IResult Invalid(Dictionary<string, string[]> errors) => Results.ValidationProblem(errors, title: "Dữ liệu không hợp lệ");

    public static IResult Problem(int status, string title, string detail) => Results.Problem(statusCode: status, title: title, detail: detail);

    public static IPAddress ClientIp(HttpContext ctx)
    {
        var ip = ctx.Connection.RemoteIpAddress ?? IPAddress.None;
        return ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip;
    }

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
