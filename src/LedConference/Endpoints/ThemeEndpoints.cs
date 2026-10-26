using System.Security.Cryptography;
using static LedConference.Api;

namespace LedConference;

// Screen color themes (data\themes.json): built-ins can be edited and reset, custom ones created and deleted.
public static class ThemeEndpoints
{
    public static void MapThemes(this WebApplication app)
    {
        app.MapGet("/api/themes", (Store store) =>
        {
            var d = store.Current;
            return new { fileError = store.ThemeError, items = d.Themes.Select(t => Views.Theme(t, d)) };
        });

        app.MapPut("/api/themes/{id}", (string id, Theme input, HttpContext ctx, Store store) =>
        {
            var old = store.Current.Themes.FirstOrDefault(t => t.Id == id);
            if (old is null) return Problem(404, "Không tìm thấy mẫu", $"Không có mẫu giao diện '{id}'.");
            var theme = input with { Id = id, Name = (input.Name ?? "").Trim() };
            var errors = theme.Problems();
            if (errors.Count > 0) return Invalid(errors);
            store.Edit(Ip(ctx), "theme.update", id, d =>
            {
                var i = d.Themes.FindIndex(t => t.Id == id);
                if (i >= 0) d.Themes[i] = theme;
                return Diff(old, theme);
            });
            return Results.Ok(Views.Theme(theme, store.Current));
        });

        app.MapPost("/api/themes", (NewThemeInput input, HttpContext ctx, Store store) =>
        {
            var source = store.Current.Themes.FirstOrDefault(t => t.Id == (input.From ?? "official"));
            if (source is null) return Problem(404, "Không tìm thấy mẫu", $"Không có mẫu giao diện '{input.From}'.");
            var name = Clean(input.Name);
            if (name.Length == 0) name = source.Name + " (bản sao)";
            var theme = source with { Id = "mau-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(3)).ToLowerInvariant(), Name = name[..Math.Min(name.Length, 50)] };
            store.Edit(Ip(ctx), "theme.create", theme.Id, d => { d.Themes.Add(theme); return new { from = source.Id, theme.Name }; });
            return Results.Ok(Views.Theme(theme, store.Current));
        });

        app.MapDelete("/api/themes/{id}", (string id, HttpContext ctx, Store store) =>
        {
            var d = store.Current;
            var theme = d.Themes.FirstOrDefault(t => t.Id == id);
            if (theme is null) return Problem(404, "Không tìm thấy mẫu", $"Không có mẫu giao diện '{id}'.");
            if (theme.IsBuiltIn) return Problem(400, "Không xoá được mẫu gốc", "Mẫu gốc chỉ có thể khôi phục về mặc định.");
            var global = Views.GlobalDisplay(d).Theme == id;
            var rooms = d.Rooms.Where(r => (r.Display ?? new()).Theme == id).Select(r => r.Code).ToList();
            if (global || rooms.Count > 0)
                return Results.Problem(statusCode: 409, title: "Mẫu đang được dùng",
                    detail: $"Mẫu “{theme.Name}” đang được dùng bởi {string.Join(", ", (global ? ["cấu hình chung"] : Array.Empty<string>()).Concat(rooms))}.",
                    extensions: new Dictionary<string, object?> { ["usedBy"] = rooms, ["usedGlobally"] = global });
            store.Edit(Ip(ctx), "theme.delete", id, x => { x.Themes.RemoveAll(t => t.Id == id); return theme; });
            return Results.NoContent();
        });

        app.MapPost("/api/themes/{id}/reset", (string id, HttpContext ctx, Store store) =>
        {
            var original = Theme.BuiltIn.FirstOrDefault(t => t.Id == id);
            if (original is null) return Problem(400, "Không phải mẫu gốc", "Chỉ mẫu gốc mới khôi phục được.");
            var old = store.Current.Themes.First(t => t.Id == id);
            store.Edit(Ip(ctx), "theme.reset", id, d =>
            {
                var i = d.Themes.FindIndex(t => t.Id == id);
                if (i >= 0) d.Themes[i] = original;
                return Diff(old, original);
            });
            return Results.Ok(Views.Theme(original, store.Current));
        });
    }
}
