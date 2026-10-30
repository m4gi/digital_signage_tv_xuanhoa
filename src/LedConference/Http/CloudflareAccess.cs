using System.Security.Cryptography;
using System.Text.Json;

namespace LedConference;

// Admin requests that come through the Cloudflare tunnel must carry the Access login token
// (Cf-Access-Jwt-Assertion, RS256). It is checked here against the team's public keys, so the admin page stays
// closed even if a tunnel hostname is published without Access or its policy is loosened by mistake.
public sealed class CloudflareAccess(ServerConfig cfg, ILogger<CloudflareAccess> log)
{
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    readonly SemaphoreSlim refresh = new(1, 1);
    Dictionary<string, RSA> keys = [];
    DateTime fetched = DateTime.MinValue;

    public bool Configured => cfg.Access is { TeamDomain.Length: > 0, Aud.Length: > 0 };

    // The signed-in email (or service token name), or null when the token is missing, forged, expired or for another app.
    public async Task<string?> Check(string? token)
    {
        if (!Configured || string.IsNullOrEmpty(token)) return null;
        var a = cfg.Access!;
        var issuer = "https://" + a.TeamDomain;
        var now = DateTimeOffset.UtcNow;
        var who = AccessToken.Verify(token, keys, a.Aud, issuer, now);
        // Unknown key id: Cloudflare rotated its keys. Refetch, at most once a minute.
        if (who is null && DateTime.UtcNow - fetched > TimeSpan.FromMinutes(1) && await Refresh(a.TeamDomain))
            who = AccessToken.Verify(token, keys, a.Aud, issuer, now);
        return who;
    }

    async Task<bool> Refresh(string teamDomain)
    {
        await refresh.WaitAsync();
        try
        {
            if (DateTime.UtcNow - fetched <= TimeSpan.FromMinutes(1)) return true;
            fetched = DateTime.UtcNow;
            var json = await Http.GetStringAsync($"https://{teamDomain}/cdn-cgi/access/certs");
            keys = AccessToken.ParseKeys(json);
            return true;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or FormatException)
        {
            log.LogWarning(e, "Không lấy được khoá Cloudflare Access từ {Team}", teamDomain);
            return false;
        }
        finally
        {
            refresh.Release();
        }
    }
}
