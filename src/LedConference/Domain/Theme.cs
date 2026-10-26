using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace LedConference;

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
