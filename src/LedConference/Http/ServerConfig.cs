using System.Net;
using System.Net.Sockets;

namespace LedConference;

// The startup part of data\settings.json: ports and the admin allowlist only change on a service restart.
public sealed record ServerConfig(int ScreenPort, int AdminPort, IReadOnlyList<IPNetwork> AdminAllow, IReadOnlyList<string> AdminAllowText)
{
    public static ServerConfig From(Settings s)
    {
        if (s.ScreenPort == s.AdminPort)
            throw new InvalidOperationException("ScreenPort và AdminPort trong data\\settings.json phải khác nhau.");
        return new(s.ScreenPort, s.AdminPort, s.AdminAllow.Select(ParseNetwork).ToList(), s.AdminAllow)
        {
            AdminHosts = s.AdminHosts.Select(h => h.Trim()).Where(h => h.Length > 0).ToList(),
        };
    }

    public IReadOnlyList<string> AdminHosts { get; init; } = [];

    // The admin port answers only to the server's own names and the configured adminHosts (a Cloudflare tunnel
    // hostname): a web page whose domain is re-pointed at this server (DNS rebinding) sends its own domain as
    // Host and is refused, even from an allowed admin PC.
    public bool OwnHost(string host) =>
        IPAddress.TryParse(host.Trim('[', ']'), out _)
        || host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || host.Equals(Environment.MachineName, StringComparison.OrdinalIgnoreCase)
        || AdminHosts.Any(h => h.Equals(host, StringComparison.OrdinalIgnoreCase));

    static IPNetwork ParseNetwork(string s)
    {
        s = s.Trim();
        if (s.Contains('/') && IPNetwork.TryParse(s, out var net)) return net;
        if (!s.Contains('/') && IPAddress.TryParse(s, out var ip))
            return new IPNetwork(ip, ip.AddressFamily == AddressFamily.InterNetwork ? 32 : 128);
        throw new InvalidOperationException(
            $"data\\settings.json: adminAllow có giá trị sai '{s}'. Dùng IP (192.168.1.20) hoặc dải IP (192.168.1.0/24, phần cuối là 0).");
    }
}
