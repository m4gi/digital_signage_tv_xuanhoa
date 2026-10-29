using System.Net;
using static LedConference.Api;

namespace LedConference;

// Screen port: read-only screen paths only, readable from any origin (the APK page is another origin).
// Admin port: allowlisted IPs (loopback always), and writes only from the admin page itself.
// Also sets the security headers every answer carries.
public static class PortGate
{
    static readonly string[] ScreenPaths = ["/room", "/lobby", "/api/screens", "/api/lobby", "/assets", "/logo"];

    public static IApplicationBuilder UsePortGate(this IApplicationBuilder app, ServerConfig cfg) => app.Use(async (ctx, next) =>
    {
        var headers = ctx.Response.Headers;
        headers.XContentTypeOptions = "nosniff";
        headers["Referrer-Policy"] = "no-referrer";
        var req = ctx.Request;
        var reading = HttpMethods.IsGet(req.Method) || HttpMethods.IsHead(req.Method);
        var onScreenPort = ctx.Connection.LocalPort == cfg.ScreenPort;
        // The admin page shows a live preview of a room screen in an iframe (screen port inside admin port).
        headers.ContentSecurityPolicy = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " + (onScreenPort
            ? $"frame-ancestors 'self' http://*:{cfg.AdminPort}"
            : $"frame-src 'self' http://{req.Host.Host}:{cfg.ScreenPort}; frame-ancestors 'none'");

        if (onScreenPort)
        {
            // Data here is public display info and no cookies are used, so any origin may read it.
            headers.AccessControlAllowOrigin = "*";
            if (HttpMethods.IsOptions(req.Method))
            {
                headers.AccessControlAllowMethods = "GET";
                headers.AccessControlAllowHeaders = "X-Device-Key";
                headers.AccessControlMaxAge = "86400";
                ctx.Response.StatusCode = StatusCodes.Status204NoContent;
                return;
            }
            if (!reading || !ScreenPaths.Any(p => req.Path.StartsWithSegments(p)))
            {
                await Results.NotFound().ExecuteAsync(ctx);
                return;
            }
        }
        else
        {
            var ip = ClientIp(ctx);
            if (!IPAddress.IsLoopback(ip) && !cfg.AdminAllow.Any(n => n.Contains(ip)))
            {
                await Problem(403, "Không có quyền", $"Máy {ip} không nằm trong danh sách được phép quản trị.").ExecuteAsync(ctx);
                return;
            }
            if (!ServerConfig.OwnHost(req.Host.Host))
            {
                await Problem(403, "Không có quyền", "Hãy mở trang quản trị bằng địa chỉ IP của máy chủ.").ExecuteAsync(ctx);
                return;
            }
            if (!reading && req.Headers.Origin is [{ } origin]
                && !(Uri.TryCreate(origin, UriKind.Absolute, out var o) && string.Equals(o.Authority, req.Host.Value, StringComparison.OrdinalIgnoreCase)))
            {
                await Problem(403, "Không có quyền", "Yêu cầu gửi từ trang khác bị chặn.").ExecuteAsync(ctx);
                return;
            }
        }
        await next(ctx);
    });
}
