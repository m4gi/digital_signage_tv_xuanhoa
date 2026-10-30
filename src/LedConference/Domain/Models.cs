using System.Text.Json.Serialization;

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
    // Ghi chú can be hidden from the screen and kept for the admin. Meetings saved before this field show it.
    public bool ShowNote { get; init; } = true;
    // "Liên hệ: …" line on the screen for this meeting; the text is kept when the line is switched off.
    public string Contact { get; init; } = "";
    public bool ShowContact { get; init; }
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

    public static readonly DisplaySettings Defaults = new()
    {
        Theme = "official", Orientation = "auto", Effect = "fadeUp", Clock = true, Footer = true,
        ReduceMotion = false, HideCursor = true, FooterNote = "", EmptyDay = "nextMeeting", Skyline = "normal",
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
    // Extra host names the admin port answers to, e.g. a Cloudflare tunnel hostname (IP, localhost and the
    // machine name always work).
    public List<string> AdminHosts { get; init; } = [];
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
