using static LedConference.Api;

namespace LedConference;

// Settings editable from the admin page (org names, global look, session hours) and the audit log.
public static class SettingsEndpoints
{
    public static void MapSettings(this WebApplication app)
    {
        app.MapGet("/api/settings", (Store store) => store.Current.Settings);

        app.MapPut("/api/settings", (SettingsInput input, HttpContext ctx, Store store) =>
        {
            var errors = Validation.Settings(input, store.Current.Themes);
            if (errors.Count > 0) return Invalid(errors);

            var old = store.Current.Settings;
            var s = old with
            {
                Org = input.Org is { } org ? new Org(Clean(org.Line1), Clean(org.Line2)) : old.Org,
                Display = input.Display ?? old.Display,
                Morning = input.Morning ?? old.Morning,
                Afternoon = input.Afternoon ?? old.Afternoon,
            };
            store.Edit(Ip(ctx), "settings.update", "settings", d => { d.Settings = s; return Diff(old, s); });
            return Results.Ok(s);
        });

        app.MapGet("/api/audit", (int? limit, Store store) => store.Audit.Read(Math.Clamp(limit ?? 100, 1, 1000)));
    }
}
