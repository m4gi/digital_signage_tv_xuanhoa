using System.Net;
using static LedConference.Api;

namespace LedConference;

// Screen port: read-only screen paths only, readable from any origin (the APK page is another origin).
// Admin port: allowlisted IPs (loopback always) or, through the Cloudflare tunnel, a valid Access login;
// writes only from the admin page itself.
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
        // The admin page previews a room screen in an iframe served by the admin port itself (same origin, so it
        // also works through a tunnel where the screen port is not reachable); only those pages may be framed.
        var framed = req.Path.StartsWithSegments("/room") || req.Path.StartsWithSegments("/lobby");
        headers.ContentSecurityPolicy = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " + (onScreenPort
            ? $"frame-ancestors 'self' http://*:{cfg.AdminPort}"
            : "frame-src 'self'; frame-ancestors " + (framed ? "'self'" : "'none'"));

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
            if (ViaTunnel(ctx))
            {
                // Through the tunnel the Access login decides, not adminAllow (remote admins have changing IPs).
                var access = ctx.RequestServices.GetRequiredService<CloudflareAccess>();
                var user = await access.Check(req.Headers["Cf-Access-Jwt-Assertion"].ToString());
                if (user is null)
                {
                    await Problem(403, "Không có quyền", access.Configured
                        ? "Cần đăng nhập Cloudflare Access để vào trang quản trị."
                        : "Máy chủ chưa cấu hình mục access trong data\\settings.json nên không nhận truy cập qua tunnel.").ExecuteAsync(ctx);
                    return;
                }
                ctx.Items[AccessUser] = user;
            }
            else if (!IPAddress.IsLoopback(ip) && !cfg.AdminAllow.Any(n => n.Contains(ip)))
            {
                await Problem(403, "Không có quyền", $"Máy {ip} không nằm trong danh sách được phép quản trị.").ExecuteAsync(ctx);
                return;
            }
            if (!cfg.OwnHost(req.Host.Host))
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
