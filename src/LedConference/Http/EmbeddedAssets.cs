using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace LedConference;

// The pages, scripts and images in web\ are embedded in the exe (single-file deploy) and served from here.
public sealed class EmbeddedAssets
{
    readonly FileExtensionContentTypeProvider mime = new();
    // Embedded files change only when the exe does: one ETag per build turns the browser's checks into 304s.
    readonly EntityTagHeaderValue tag = new($"\"{typeof(EmbeddedAssets).Assembly.ManifestModule.ModuleVersionId:N}\"");

    public IResult File(string name)
    {
        var stream = typeof(EmbeddedAssets).Assembly.GetManifestResourceStream(name);
        if (stream is null) return Results.NotFound();
        return Results.Stream(stream, ContentType(name), entityTag: tag);
    }

    // Pages and scripts: browsers must ask again every time ("no-cache"), or an admin keeps running the
    // old admin.js after an update.
    public IResult Page(HttpContext ctx, string name)
    {
        ctx.Response.Headers.CacheControl = "no-cache";
        return File(name);
    }

    public string ContentType(string name) => mime.TryGetContentType(name, out var type) ? type : "application/octet-stream";
}
