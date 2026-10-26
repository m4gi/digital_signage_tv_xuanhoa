using static LedConference.Api;

namespace LedConference;

public static class LogoEndpoints
{
    public static void MapLogo(this WebApplication app)
    {
        // An uploaded logo wins; otherwise the ward logo embedded in the exe.
        app.MapGet("/logo", (HttpContext ctx, LogoFiles logos, EmbeddedAssets assets) =>
        {
            ctx.Response.Headers.CacheControl = "public, max-age=86400"; // URLs carry ?v=N, bumped on upload
            var path = logos.Path();
            return path is null ? assets.File("logo.webp") : Results.File(path, assets.ContentType(path));
        });

        app.MapPost("/api/logo", async (HttpRequest req, HttpContext ctx, Store store, LogoFiles logos) =>
        {
            using var body = new MemoryStream();
            await req.Body.CopyToAsync(body);
            var bytes = body.ToArray();
            var kind = LogoFiles.Kind(bytes);
            if (kind is null) return Problem(415, "Không nhận file này", "Logo phải là ảnh WebP, PNG hoặc JPG.");
            if (bytes.Length > 2 * 1024 * 1024) return Problem(413, "File quá lớn", "Logo tối đa 2MB.");
            store.Edit(Ip(ctx), "logo.update", "logo", d =>
            {
                logos.Replace(kind, bytes);
                d.Settings = d.Settings with { LogoVersion = d.Settings.LogoVersion + 1 };
                return new { type = kind, bytes = bytes.Length };
            });
            return Results.Ok(new { logoVersion = store.Current.Settings.LogoVersion });
        });

        app.MapDelete("/api/logo", (HttpContext ctx, Store store, LogoFiles logos) =>
        {
            if (logos.Path() is null) return Results.NoContent();
            store.Edit(Ip(ctx), "logo.delete", "logo", d =>
            {
                logos.Delete();
                d.Settings = d.Settings with { LogoVersion = d.Settings.LogoVersion + 1 };
                return null;
            });
            return Results.NoContent();
        });
    }
}
