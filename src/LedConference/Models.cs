using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Text.Unicode;

namespace LedConference;

public enum MeetingStatus { Normal, Postponed, Cancelled }

public sealed record Meeting
{
    public string Id { get; init; } = "";
    public DateOnly Date { get; init; }
    public TimeOnly Start { get; init; }
    public TimeOnly End { get; init; }
    public bool EndEstimated { get; init; }
    public string Title { get; init; } = "";
    public string Chair { get; init; } = "";
    public string Participants { get; init; } = "";
    public string Note { get; init; } = "";
    // The room is resolved from Place at read time, so assigning a place later applies to old meetings too.
    public string Place { get; init; } = "";
    public MeetingStatus Status { get; init; }
    public string Source { get; init; } = "manual";
    public string? ImportId { get; init; }
    public DateTime UpdatedAt { get; init; }
    public string UpdatedBy { get; init; } = "";
}

// On a room, a null field means "use the global value".
public sealed record DisplaySettings
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Theme { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Orientation { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Effect { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Clock { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Footer { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? ReduceMotion { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? HideCursor { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? FooterNote { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? EmptyDay { get; init; }
    // The ward skyline drawing behind the content, tinted by the theme.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Skyline { get; init; }
    // "Liên hệ: …" line under Ghi chú on the screen.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? ContactEnabled { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Contact { get; init; }

    public static readonly DisplaySettings Defaults = new()
    {
        Theme = "official", Orientation = "auto", Effect = "fadeUp", Clock = true, Footer = true,
        ReduceMotion = false, HideCursor = true, FooterNote = "", EmptyDay = "nextMeeting", Skyline = "normal",
        ContactEnabled = false, Contact = "",
    };

    public static readonly string[] Orientations = ["auto", "portrait", "landscape"];
    public static readonly string[] Effects = ["fadeUp", "zoom", "slideLeft", "shine", "border"];
    public static readonly string[] EmptyDays = ["nextMeeting", "free"];
    public static readonly string[] Skylines = ["off", "normal", "strong"];

    public DisplaySettings Over(DisplaySettings g) => new()
    {
        Theme = Theme ?? g.Theme,
        Orientation = Orientation ?? g.Orientation,
        Effect = Effect ?? g.Effect,
        Clock = Clock ?? g.Clock,
        Footer = Footer ?? g.Footer,
        ReduceMotion = ReduceMotion ?? g.ReduceMotion,
        HideCursor = HideCursor ?? g.HideCursor,
        FooterNote = FooterNote ?? g.FooterNote,
        EmptyDay = EmptyDay ?? g.EmptyDay,
        Skyline = Skyline ?? g.Skyline,
        ContactEnabled = ContactEnabled ?? g.ContactEnabled,
        Contact = Contact ?? g.Contact,
    };
}

public sealed record Room
{
    public string Code { get; init; } = "";
    public string Name { get; init; } = "";
    public List<string> Places { get; init; } = [];
    public DisplaySettings Display { get; init; } = new();
}

public sealed record Org(string Line1, string Line2);

public sealed record Session(TimeOnly Start, TimeOnly End);

public sealed record Settings
{
    // Ports and the admin allowlist are edited in data\settings.json only, then the service is restarted.
    public int ScreenPort { get; init; } = 8080;
    public int AdminPort { get; init; } = 8081;
    public List<string> AdminAllow { get; init; } = [];
    public Org Org { get; init; } = new("ỦY BAN NHÂN DÂN", "PHƯỜNG XUÂN HÒA");
    public DisplaySettings Display { get; init; } = DisplaySettings.Defaults;
    public Session Morning { get; init; } = new(new(7, 30), new(11, 30));
    public Session Afternoon { get; init; } = new(new(13, 30), new(17, 30));
    // Places marked "no screen", hidden from the unassigned list.
    public List<string> IgnoredPlaces { get; init; } = [];
    // Bumped on each logo upload so screens re-fetch /logo?v=N.
    public int LogoVersion { get; init; }
    // Meetings, imported Excel files, audit lines and backups older than this many days are deleted. 0 = keep everything.
    public int RetentionDays { get; init; } = 30;
}

public sealed record ImportRecord(string Id, DateTime At, string Ip, string FileName, DateOnly From, DateOnly To, int Total);

// Colors from the ward design spec. Dot is a hex color drawn at DotOpacity; the skyline drawing is tinted
// Skyline at SkylineOpacity, or SkylineStrongOpacity when a screen asks for the strong level.
// Themes live in data\themes.json (built-ins can be edited there, custom ones added); see Store.
// The skyline parameters have defaults so a themes.json written before they existed still loads.
public sealed record Theme(
    string Id, string Name, int BgAngle, string Bg1, string Bg2, string Ink, string Muted,
    string Accent, string OnAccent, string Card, string CardBorder, string Person, string Label,
    string Num, string Dot, double DotOpacity,
    string Skyline = "#FFFFFF", double SkylineOpacity = 0.4, double SkylineStrongOpacity = 0.7)
{
    static readonly Regex HexRx = new("^#[0-9A-Fa-f]{6}$");
    static readonly Regex RgbaRx = new(@"^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$");

    [JsonIgnore] public bool IsBuiltIn => BuiltIn.Any(b => b.Id == Id);

    // Strict formats: these values end up in CSS custom properties on every screen.
    public Dictionary<string, string[]> Problems()
    {
        var e = new Dictionary<string, string[]>();
        if (Id is null || !Regex.IsMatch(Id, "^[a-z0-9-]{1,32}$")) e["id"] = ["Mã mẫu chỉ gồm a-z, 0-9, dấu - (tối đa 32 ký tự)."];
        if (string.IsNullOrWhiteSpace(Name) || Name.Length > 50) e["name"] = ["Tên mẫu từ 1 đến 50 ký tự."];
        foreach (var (key, value) in new[] { ("bg1", Bg1), ("bg2", Bg2), ("ink", Ink), ("muted", Muted), ("accent", Accent),
                     ("onAccent", OnAccent), ("person", Person), ("label", Label), ("num", Num), ("dot", Dot), ("skyline", Skyline) })
            if (value is null || !HexRx.IsMatch(value)) e[key] = ["Màu phải có dạng #RRGGBB."];
        foreach (var (key, value) in new[] { ("card", Card), ("cardBorder", CardBorder) })
            if (value is null || !(HexRx.IsMatch(value) || RgbaRx.IsMatch(value))) e[key] = ["Màu phải có dạng #RRGGBB hoặc rgba(r,g,b,a)."];
        if (BgAngle is < 0 or > 360) e["bgAngle"] = ["Góc từ 0 đến 360."];
        if (DotOpacity is < 0 or > 0.3) e["dotOpacity"] = ["Độ đậm chấm từ 0 đến 0.3."];
        if (SkylineOpacity is < 0 or > 1) e["skylineOpacity"] = ["Độ đậm từ 0 đến 1."];
        if (SkylineStrongOpacity is < 0 or > 1) e["skylineStrongOpacity"] = ["Độ đậm từ 0 đến 1."];
        return e;
    }

    // WCAG contrast of the main text against the lighter/darker end of the background.
    public double Contrast()
    {
        if (!HexRx.IsMatch(Ink ?? "") || !HexRx.IsMatch(Bg1 ?? "") || !HexRx.IsMatch(Bg2 ?? "")) return 0;
        return Math.Round(Math.Min(Ratio(Ink!, Bg1!), Ratio(Ink!, Bg2!)), 1);
    }

    static double Ratio(string a, string b)
    {
        var (x, y) = (Luminance(a), Luminance(b));
        return (Math.Max(x, y) + 0.05) / (Math.Min(x, y) + 0.05);
    }

    static double Luminance(string hex)
    {
        var n = Convert.ToInt32(hex[1..], 16);
        double C(int v) { var c = v / 255.0; return c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4); }
        return 0.2126 * C(n >> 16 & 255) + 0.7152 * C(n >> 8 & 255) + 0.0722 * C(n & 255);
    }

    // Built-ins always exist (a file entry with the same id replaces one); other file entries are custom themes.
    public static List<Theme> Merge(IReadOnlyCollection<Theme> fromFile) =>
    [
        .. BuiltIn.Select(b => fromFile.FirstOrDefault(t => t.Id == b.Id) ?? b),
        .. fromFile.Where(t => !t.IsBuiltIn),
    ];

    public static readonly Theme[] BuiltIn =
    [
        new("official", "Chính thức", 180, "#D0EDFF", "#8ACAFF", "#0B2545", "#2A4A73", "#FFC72C", "#0B2545",
            "rgba(255,255,255,.62)", "rgba(255,255,255,.95)", "#0A3D82", "#7A5600", "#0C4DA2", "#0B2545", 0.04,
            "#FFFFFF", 0.4, 0.7),
        new("formal", "Trang trọng", 135, "#6E0A10", "#B8131A", "#FFF6DC", "#F4D8A0", "#FFD04D", "#5A0B0F",
            "rgba(255,208,77,.10)", "rgba(255,208,77,.40)", "#FFF6DC", "#FFD04D", "#FFD04D", "#FFD04D", 0.08,
            "#FFD04D", 0.12, 0.2),
        new("modern", "Hiện đại", 135, "#F3F7FC", "#E3EDF9", "#0B2545", "#566883", "#FFC72C", "#0B2545",
            "#FFFFFF", "#D5E1F0", "#0C4DA2", "#B88A00", "#0C4DA2", "#0C4DA2", 0.04,
            "#0C4DA2", 0.08, 0.14),
    ];
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = Configure(new(JsonSerializerDefaults.Web) { WriteIndented = true });
    public static readonly JsonSerializerOptions Compact = Configure(new(JsonSerializerDefaults.Web));

    public static JsonSerializerOptions Configure(JsonSerializerOptions o)
    {
        o.Converters.Add(new HourMinuteConverter());
        o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        o.Encoder = JavaScriptEncoder.Create(UnicodeRanges.All);
        return o;
    }

    sealed class HourMinuteConverter : JsonConverter<TimeOnly>
    {
        static readonly string[] Formats = ["HH:mm", "H:mm", "HH:mm:ss"];

        public override TimeOnly Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
            TimeOnly.TryParseExact(reader.GetString(), Formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)
                ? t
                : throw new JsonException("Giờ phải có dạng HH:mm.");

        public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value.ToString("HH:mm", CultureInfo.InvariantCulture));
    }
}
