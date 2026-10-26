using System.Text.Json;

namespace LedConference;

// data\audit.log: one JSON line per change (who, what, which fields). Append-only, pruned by date.
public sealed class AuditLog(string path)
{
    readonly Lock gate = new();

    public void Append(string ip, string action, string target, object? changes)
    {
        var entry = new { at = DateTime.Now.ToString("s"), ip, action, target, changes };
        lock (gate) File.AppendAllText(path, JsonSerializer.Serialize(entry, Json.Compact) + "\n");
    }

    // Reads the whole log; old lines are pruned by Prune, so it stays small.
    public List<JsonElement> Read(int limit)
    {
        lock (gate)
        {
            if (!File.Exists(path)) return [];
            return File.ReadLines(path).TakeLast(limit).Reverse()
                .Select(l => JsonDocument.Parse(l).RootElement.Clone()).ToList();
        }
    }

    // Keeps only lines from `cutoff` on. Lines that cannot be read are kept rather than lost.
    public int Prune(DateOnly cutoff)
    {
        lock (gate)
        {
            if (!File.Exists(path)) return 0;
            var lines = File.ReadAllLines(path);
            var keep = lines.Where(l => !(DateOf(l) is { } at && at < cutoff)).ToList();
            if (keep.Count == lines.Length) return 0;
            File.WriteAllLines(path + ".tmp", keep);
            File.Move(path + ".tmp", path, overwrite: true);
            return lines.Length - keep.Count;
        }
    }

    static DateOnly? DateOf(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            return doc.RootElement.TryGetProperty("at", out var at) && DateTime.TryParse(at.GetString(), out var t)
                ? DateOnly.FromDateTime(t) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
