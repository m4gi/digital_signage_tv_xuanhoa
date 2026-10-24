using System.Text.Json;

namespace LedConference;

public sealed class Data
{
    public required Settings Settings { get; set; }
    public required List<Room> Rooms { get; init; }
    public required List<Meeting> Meetings { get; init; }
    public required List<ImportRecord> Imports { get; init; }
    public required List<Theme> Themes { get; init; }
}

// All data lives in JSON files under data\. Readers take an immutable snapshot (Current);
// writers go through Edit, which copies, saves atomically, swaps the snapshot and appends to the audit log.
// One lock for all writes: fine for a few admins on a LAN; move to SQLite if many people edit at once.
public sealed class Store
{
    readonly string dir;
    readonly Lock gate = new();
    volatile Data current;

    public Store(string dir)
    {
        this.dir = Directory.CreateDirectory(dir).FullName;
        var (themes, themeError) = ReadThemes();
        ThemeError = themeError;
        current = new Data
        {
            Settings = Load<Settings>("settings.json") ?? new(),
            Rooms = Load<List<Room>>("rooms.json") ?? [],
            Meetings = Load<List<Meeting>>("meetings.json") ?? [],
            Imports = Load<List<ImportRecord>>("imports.json") ?? [],
            Themes = themes ?? [.. Theme.BuiltIn],
        };
        // Write these out on first run so IT can find and edit them.
        if (!File.Exists(PathOf("settings.json"))) Save("settings.json", current.Settings);
        if (!File.Exists(PathOf("themes.json"))) Save("themes.json", current.Themes);
    }

    public string Dir => dir;

    // Set when themes.json was hand-edited into an invalid state; the last good themes stay in use.
    public string? ThemeError { get; private set; }

    // Never mutate the returned lists.
    public Data Current => current;

    public void Edit(string ip, string action, string target, Func<Data, object?> edit)
    {
        lock (gate)
        {
            var old = current;
            var next = new Data
            {
                Settings = old.Settings, Rooms = [.. old.Rooms], Meetings = [.. old.Meetings],
                Imports = [.. old.Imports], Themes = [.. old.Themes],
            };
            var changes = edit(next);

            if (!ReferenceEquals(next.Settings, old.Settings)) Save("settings.json", next.Settings);
            if (Changed(next.Rooms, old.Rooms)) Save("rooms.json", next.Rooms);
            if (Changed(next.Meetings, old.Meetings))
            {
                Backup();
                Save("meetings.json", next.Meetings);
            }
            if (Changed(next.Imports, old.Imports)) Save("imports.json", next.Imports);
            if (Changed(next.Themes, old.Themes))
            {
                Save("themes.json", next.Themes);
                ThemeError = null;
            }
            current = next;

            var entry = new { at = DateTime.Now.ToString("s"), ip, action, target, changes };
            File.AppendAllText(PathOf("audit.log"), JsonSerializer.Serialize(entry, Json.Compact) + "\n");
        }
    }

    // Called when themes.json changes on disk. Returns the problem when the file is invalid (old themes kept).
    public string? ReloadThemes()
    {
        lock (gate)
        {
            var (themes, error) = ReadThemes();
            ThemeError = error;
            if (themes is not null && !themes.SequenceEqual(current.Themes))
            {
                var old = current;
                current = new Data
                {
                    Settings = old.Settings, Rooms = old.Rooms, Meetings = old.Meetings, Imports = old.Imports, Themes = themes,
                };
            }
            return error;
        }
    }

    // Reads the whole log; rotate audit.log yearly if it grows large.
    public List<JsonElement> ReadAudit(int limit)
    {
        lock (gate)
        {
            var path = PathOf("audit.log");
            if (!File.Exists(path)) return [];
            return File.ReadLines(path).TakeLast(limit).Reverse()
                .Select(l => JsonDocument.Parse(l).RootElement.Clone()).ToList();
        }
    }

    static bool Changed<T>(List<T> next, List<T> old) where T : class =>
        !next.SequenceEqual(old, ReferenceEqualityComparer.Instance);

    string PathOf(string name) => Path.Combine(dir, name);

    (List<Theme>? Themes, string? Error) ReadThemes()
    {
        var path = PathOf("themes.json");
        if (!File.Exists(path)) return ([.. Theme.BuiltIn], null);
        try
        {
            var list = JsonSerializer.Deserialize<List<Theme>>(File.ReadAllText(path), Json.Options) ?? [];
            var dup = list.GroupBy(t => t.Id).FirstOrDefault(g => g.Count() > 1);
            if (dup is not null) return (null, $"themes.json có hai mẫu cùng mã '{dup.Key}'.");
            foreach (var t in list)
            {
                var problems = t.Problems();
                if (problems.Count > 0)
                    return (null, $"themes.json, mẫu '{t.Id}': " + string.Join(" ", problems.Select(p => $"{p.Key}: {p.Value[0]}")));
            }
            return (Theme.Merge(list), null);
        }
        catch (Exception e) when (e is JsonException or IOException or NotSupportedException)
        {
            return (null, "themes.json không đọc được: " + e.Message);
        }
    }

    // A corrupt data file stops startup on purpose: better than silently starting empty and overwriting it.
    T? Load<T>(string name)
    {
        var path = PathOf(name);
        return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json.Options) : default;
    }

    void Save<T>(string name, T value)
    {
        var path = PathOf(name);
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(value, Json.Options));
        File.Move(path + ".tmp", path, overwrite: true);
    }

    // Keeps the first meetings.json of each day for 30 days.
    void Backup()
    {
        var src = PathOf("meetings.json");
        if (!File.Exists(src)) return;
        var backupDir = Directory.CreateDirectory(PathOf("backup")).FullName;
        var dst = Path.Combine(backupDir, $"meetings-{DateTime.Now:yyyyMMdd}.json");
        if (File.Exists(dst)) return;
        File.Copy(src, dst);
        foreach (var f in Directory.GetFiles(backupDir, "meetings-*.json"))
            if (File.GetCreationTime(f) < DateTime.Now.AddDays(-30)) File.Delete(f);
    }
}
