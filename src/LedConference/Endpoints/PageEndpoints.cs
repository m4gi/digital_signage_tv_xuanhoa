namespace LedConference;

// The admin page, the screen page (one room or the lobby) and their scripts, all embedded in the exe.
public static class PageEndpoints
{
    public static void MapPages(this WebApplication app)
    {
        app.MapGet("/", (HttpContext ctx, EmbeddedAssets assets) => assets.Page(ctx, "admin.html"));
        app.MapGet("/room/{code}", (string code, HttpContext ctx, EmbeddedAssets assets) => assets.Page(ctx, "display.html"));
        app.MapGet("/lobby", (HttpContext ctx, EmbeddedAssets assets) => assets.Page(ctx, "display.html")); // the page switches to lobby mode itself
        app.MapGet("/assets/{name}", (string name, HttpContext ctx, EmbeddedAssets assets) => assets.Page(ctx, name));
    }
}
