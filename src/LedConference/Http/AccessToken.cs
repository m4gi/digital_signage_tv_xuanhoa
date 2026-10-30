using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LedConference;

// Cloudflare Access login tokens (JWT, RS256): the pure parts, no network, so SelfCheck can test them.
public static class AccessToken
{
    // {"keys":[{"kid":"…","kty":"RSA","n":"…","e":"AQAB"}, …]}
    public static Dictionary<string, RSA> ParseKeys(string json)
    {
        var result = new Dictionary<string, RSA>();
        foreach (var k in JsonDocument.Parse(json).RootElement.GetProperty("keys").EnumerateArray())
        {
            if (k.GetProperty("kty").GetString() != "RSA") continue;
            var rsa = RSA.Create();
            rsa.ImportParameters(new RSAParameters
            {
                Modulus = Base64Url(k.GetProperty("n").GetString()!),
                Exponent = Base64Url(k.GetProperty("e").GetString()!),
            });
            result[k.GetProperty("kid").GetString()!] = rsa;
        }
        return result;
    }

    // Pure check, no network: RS256 signature by a known key, this app's audience, Access issuer, not expired.
    public static string? Verify(string token, IReadOnlyDictionary<string, RSA> keys, string aud, string issuer, DateTimeOffset now)
    {
        try
        {
            var parts = token.Split('.');
            if (parts.Length != 3) return null;
            using var header = JsonDocument.Parse(Base64Url(parts[0]));
            if (header.RootElement.GetProperty("alg").GetString() != "RS256") return null; // never "none" or HS256
            if (!keys.TryGetValue(header.RootElement.GetProperty("kid").GetString() ?? "", out var key)) return null;
            var signed = Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]);
            if (!key.VerifyData(signed, Base64Url(parts[2]), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) return null;

            using var body = JsonDocument.Parse(Base64Url(parts[1]));
            var p = body.RootElement;
            var audience = p.GetProperty("aud");
            var audOk = audience.ValueKind == JsonValueKind.Array
                ? audience.EnumerateArray().Any(x => x.GetString() == aud)
                : audience.GetString() == aud;
            if (!audOk || p.GetProperty("iss").GetString() != issuer) return null;
            var skew = TimeSpan.FromMinutes(1);
            if (DateTimeOffset.FromUnixTimeSeconds(p.GetProperty("exp").GetInt64()) < now - skew) return null;
            if (p.TryGetProperty("nbf", out var nbf) && DateTimeOffset.FromUnixTimeSeconds(nbf.GetInt64()) > now + skew) return null;
            return p.TryGetProperty("email", out var email) && email.GetString() is { Length: > 0 } e ? e
                : p.TryGetProperty("common_name", out var cn) ? cn.GetString() ?? "service token" : "service token";
        }
        catch (Exception e) when (e is FormatException or JsonException or KeyNotFoundException or InvalidOperationException
                                  or CryptographicException or ArgumentException)
        {
            return null;
        }
    }

    public static byte[] Base64Url(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }
}
