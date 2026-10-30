using System.Text;
using System.Text.Json;
using LedConference;
using static LedConference.MeetingStatus;

var room = new Room { Code = "P201", Name = "Phòng họp tầng 2", Places = ["PH tầng 2"] };
Check(Screen.Matches(room, "  phòng  HỌP tầng 2 "), "place matches room name, ignoring case and spaces");
Check(Screen.Matches(room, "Phòng họp tầng 2".Normalize(NormalizationForm.FormD)), "NFD text from Excel matches NFC");
Check(Screen.Matches(room, "ph tầng 2"), "place matches an alias");
Check(!Screen.Matches(room, ""), "empty place matches nothing");

Meeting M(string id, int from, int to, int day = 22, MeetingStatus s = Normal) => new()
{
    Id = id, Date = new(2026, 10, day), Start = new(from, 0), End = new(to, 0), Place = "PH tầng 2", Status = s,
};
Meeting[] week = [M("a", 8, 10), M("b", 10, 11), M("c", 14, 15, s: Postponed), M("x", 9, 10, s: Cancelled), M("n", 8, 9, day: 23)];

var p = Screen.PickFor(week, new DateTime(2026, 10, 22, 9, 30, 0), true);
Check(p.Current?.Id == "a", "09:30: meeting a is current");
Check(Ids(p.Upcoming) == "b,c", "09:30: b and postponed c are upcoming, cancelled x is hidden");
Check(p.Next is null, "09:30: no next-day meeting while today still has meetings");

p = Screen.PickFor(week, new DateTime(2026, 10, 22, 10, 0, 0), true);
Check(p.Current?.Id == "b", "10:00: end is exclusive, start inclusive, so b is current");

p = Screen.PickFor(week, new DateTime(2026, 10, 22, 16, 0, 0), true);
Check(p.Current is null && p.Upcoming.Count == 0 && p.Next?.Id == "n", "16:00: day is done, next is tomorrow's n");
Check(Screen.PickFor(week, new DateTime(2026, 10, 22, 16, 0, 0), false).Next is null, "next-day meeting hidden when emptyDay is 'free'");

var rooms = new[] { room };
Check(Ids(Screen.Overlaps(week, rooms, M("new", 9, 11) with { Start = new(9, 30) })) == "a,b", "09:30-11:00 overlaps a and b, not cancelled x");
Check(Screen.Overlaps(week, rooms, M("new", 11, 12)).Count == 0, "back-to-back meetings do not overlap");
Check(Screen.Overlaps(week, rooms, M("new", 9, 10) with { Place = "Hội trường" }).Count == 0, "unassigned place has no overlap check");

var global = new DisplaySettings { Theme = "official" }.Over(DisplaySettings.Defaults);
var merged = new DisplaySettings { Theme = "formal", FooterNote = "" }.Over(global);
Check(merged.Theme == "formal" && merged.Clock == true && merged.FooterNote == "", "room override wins, unset fields inherit");
var oldSettings = JsonSerializer.Deserialize<DisplaySettings>("{\"theme\":\"formal\",\"contactEnabled\":true,\"contact\":\"x\"}", Json.Compact);
Check(oldSettings?.Theme == "formal", "settings saved before the contact moved to meetings still load");

var server = ServerConfig.From(new Settings { ScreenPort = 1, AdminPort = 2, AdminHosts = [" Schedule.Xuanhoa.io.vn "] });
Check(server.OwnHost("10.188.44.125") && server.OwnHost("[::1]") && server.OwnHost("LOCALHOST")
      && server.OwnHost(Environment.MachineName), "admin port accepts the server's IP, localhost and machine name");
Check(!server.OwnHost("evil.example") && !server.OwnHost(Environment.MachineName + ".evil.example") && !server.OwnHost(""),
      "admin port refuses other host names (DNS rebinding)");
Check(server.OwnHost("schedule.xuanhoa.io.vn") && !server.OwnHost("xuanhoa.io.vn"), "admin port accepts a configured tunnel hostname, nothing around it");

Check(Screen.WeekStart(new(2026, 10, 25)) == new DateOnly(2026, 10, 19), "Sunday belongs to the week starting Monday");
Check(Screen.WeekStart(new(2026, 10, 19)) == new DateOnly(2026, 10, 19), "Monday is its own week start");

var json = JsonSerializer.Serialize(M("a", 8, 10), Json.Compact);
Check(json.Contains("\"start\":\"08:00\"") && json.Contains("\"status\":\"normal\""), "JSON uses HH:mm and camelCase enums");
Check(JsonSerializer.Deserialize<Meeting>(json, Json.Compact) == M("a", 8, 10), "meeting JSON round-trips");
Check(JsonSerializer.Deserialize<Meeting>("{\"title\":\"x\",\"note\":\"n\"}", Json.Compact)!.ShowNote, "meetings saved before the Ghi chú switch still show their note");

// ---------- Weekly Excel ----------

var morning = new Session(new(7, 30), new(11, 30));
var afternoon = new Session(new(13, 30), new(17, 30));

// Same layout as Lichdonvi_*.xlsx: title, merged "Thời gian" header, "*****", day rows, Sáng/Chiều rows.
var good = Sheet(
    ["Thứ 2, 19/10/2026"],
    ["Sáng", "08:00 - 09:30", "Giao ban tuần", "Chủ tịch UBND phường", "Lãnh đạo UBND", "Phòng họp tầng 2", "", "Đ/c Lan – Văn phòng"],
    ["", "10h", "Họp chuyển đổi số", "Phó Chủ tịch", "", " phòng họp  TẦNG 2", ""],
    ["Chiều", "", "Rà soát hồ sơ đất đai", "Trưởng phòng Kinh tế", "", "Hội trường", ""],
    ["", "15:00", "Họp tổ công tác", "", "", "Hội trường", ""],
    ["Thứ 3, 20/10/2026"],
    ["Sáng", new TimeSpan(8, 30, 0), "Họp chuẩn bị hội nghị", "Chánh Văn phòng", "", "Phòng họp tầng 1", "Hoãn. Chờ lịch mới"],
    ["Chiều", "", "", "", "", "", ""],
    ["Chủ nhật, 25/10/2026"],
    ["Sáng", "", "", "", "", "", ""]);
var w = WeekExcelReader.Read(good, morning, afternoon);
Check(w.Errors.Count == 0, "sample layout imports without errors: " + string.Join(" | ", w.Errors));
Check(w.From == new DateOnly(2026, 10, 19) && w.To == new DateOnly(2026, 10, 25), "week range read from the title");
Check(w.Meetings.Count == 5, "5 meetings, empty Sáng/Chiều rows skipped");
var m0 = w.Meetings[0];
Check(m0.Start == new TimeOnly(8, 0) && m0.End == new TimeOnly(9, 30) && !m0.EndEstimated && m0.Chair == "Chủ tịch UBND phường", "explicit range 08:00 - 09:30");
Check(m0.Contact == "Đ/c Lan – Văn phòng" && m0.ShowContact && w.Meetings[1] is { Contact: "", ShowContact: false },
    "optional Liên hệ column: filled cell shows on screen, empty cell shows nothing");
Check(w.Meetings[1].Start == new TimeOnly(10, 0) && w.Meetings[1].End == new TimeOnly(11, 30) && w.Meetings[1].EndEstimated,
    "'10h' with no end runs to the end of the morning session");
Check(w.Meetings[2].Start == new TimeOnly(13, 30) && w.Meetings[2].End == new TimeOnly(15, 0),
    "blank time takes the session start and ends at the next meeting in the same place");
Check(w.Meetings[3].End == new TimeOnly(17, 30), "continuation row keeps the afternoon session");
var m4 = w.Meetings[4];
Check(m4.Start == new TimeOnly(8, 30) && m4.Status == Postponed && m4.Note == "Chờ lịch mới", "Excel time cell read; 'Hoãn' note becomes postponed");

var bad = Sheet(
    ["Thứ 2, 19/10/2026"],
    ["Sáng", "8x", "Giờ sai", "", "", "Phòng họp tầng 2", ""],          // row 5
    ["", "09:00", "Thiếu địa điểm", "", "", "", ""],                     // row 6
    ["", "09:00 - 10:00", "Họp A", "", "", "Phòng họp tầng 1", ""],      // row 7
    ["", "09:30 - 10:30", "Họp B trùng giờ", "", "", "phòng họp tầng 1", ""], // row 8
    ["Thứ 2, 26/10/2026"],
    ["Sáng", "08:00", "Ngoài tuần", "", "", "Phòng họp tầng 2", ""]);    // row 10
var e = WeekExcelReader.Read(bad, morning, afternoon);
Check(string.Join(",", e.Errors.Select(x => x.Row)) == "5,6,8,10", "errors reported on rows 5,6,8,10: " + string.Join(" | ", e.Errors));
Check(e.Errors[0].Message.Contains("8x") && e.Errors[1].Message.Contains("địa điểm") && e.Errors[2].Message.Contains("dòng 7"),
    "error messages name the bad value, the missing place and the clashing row");

var noHeader = new MemoryStream();
using (var wb = new ClosedXML.Excel.XLWorkbook()) { wb.AddWorksheet("x").Cell(1, 1).Value = "abc"; wb.SaveAs(noHeader); }
noHeader.Position = 0;
Check(WeekExcelReader.Read(noHeader, morning, afternoon).Errors is [{ Row: 0 }], "file without the header row is refused");

var round = WeekExcelReader.Read(new MemoryStream(WeekExcelWriter.Write(w.From, w.Meetings, new Org("ỦY BAN NHÂN DÂN", "PHƯỜNG XUÂN HÒA"))), morning, afternoon);
Check(round.Errors.Count == 0 && round.From == w.From && round.To == w.To, "exported file imports again without errors");
Check(round.Meetings.Select(Key).SequenceEqual(w.Meetings.Select(Key)), "export → import keeps every meeting field");

var tpl = WeekExcelReader.Read(new MemoryStream(WeekExcelWriter.Template(w.From, new Org("A", "B"))), morning, afternoon);
Check(tpl.Errors.Count == 0 && tpl.Meetings.Count == 3, "template file imports cleanly");
var hidden = WeekExcelReader.Read(new MemoryStream(WeekExcelWriter.Write(w.From, [m4 with { ShowNote = false }], new Org("A", "B"))), morning, afternoon).Meetings[0];
Check(hidden.Note == "" && hidden.Status == Postponed, "a hidden note is not exported; Hoãn still is");

// ---------- Themes ----------

Check(Theme.BuiltIn.All(t => t.Problems().Count == 0), "built-in themes are valid");
Check(Theme.BuiltIn.All(t => t.Contrast() >= 4.5), "built-in themes reach 4.5:1 text contrast: " + string.Join(", ", Theme.BuiltIn.Select(t => $"{t.Id} {t.Contrast()}")));
var official = Theme.BuiltIn[0];
var broken = official with { Ink = "red", Card = "url(x)", BgAngle = 400, Id = "Bad Id" };
Check(broken.Problems().Keys.Order().SequenceEqual(["bgAngle", "card", "id", "ink"]), "bad color, CSS injection, angle and id are rejected");
Check((official with { Card = "rgba(255, 255, 255, .5)" }).Problems().Count == 0, "rgba() card color is accepted");
var custom = official with { Id = "mau-abc", Name = "Hội trường" };
var edited = official with { Accent = "#FF0000" };
var merged2 = Theme.Merge([custom, edited]);
Check(merged2.Count == 4 && merged2[0].Accent == "#FF0000" && merged2[3].Id == "mau-abc" && !merged2[3].IsBuiltIn,
    "themes.json overrides a built-in in place, adds custom ones, keeps the other built-ins");
Check(!JsonSerializer.Serialize(official, Json.Compact).Contains("isBuiltIn"), "computed IsBuiltIn is not written to themes.json");
var oldFormat = JsonSerializer.Serialize(official, Json.Compact).Replace(",\"skyline\":\"#FFFFFF\",\"skylineOpacity\":0.4,\"skylineStrongOpacity\":0.7", "");
var loaded = JsonSerializer.Deserialize<Theme>(oldFormat, Json.Compact)!;
Check(!oldFormat.Contains("skyline") && loaded.Skyline == "#FFFFFF" && loaded.SkylineOpacity == 0.4 && loaded.Problems().Count == 0,
    "a themes.json written before the skyline fields still loads, with defaults");
Check((official with { Skyline = "#12345" }).Problems().ContainsKey("skyline"), "skyline color is validated");

// ---------- Retention (real Store in a temp folder) ----------

var tmp = Directory.CreateTempSubdirectory("ledconf-selfcheck-").FullName;
try
{
    var store = new Store(tmp);
    var todayD = DateOnly.FromDateTime(DateTime.Now);
    var cutoff = todayD.AddDays(-30);
    Directory.CreateDirectory(Path.Combine(tmp, "imports"));
    foreach (var id in new[] { "imp_old", "imp_new" }) File.WriteAllText(Path.Combine(tmp, "imports", id + ".xlsx"), "x");
    store.Edit("test", "seed", "data", d =>
    {
        d.Meetings.AddRange([M("old", 8, 9) with { Date = cutoff.AddDays(-1) }, M("edge", 8, 9) with { Date = cutoff }, M("new", 8, 9) with { Date = todayD }]);
        d.Imports.Add(new ImportRecord("imp_old", DateTime.Now.AddDays(-31), "test", "a.xlsx", cutoff, cutoff, 1));
        d.Imports.Add(new ImportRecord("imp_new", DateTime.Now, "test", "b.xlsx", todayD, todayD, 1));
        return null;
    });
    store.Prune(cutoff);
    Check(Ids(store.Current.Meetings) == "edge,new", "meetings dated before the cutoff are removed, the cutoff day itself is kept");
    Check(store.Current.Imports.Select(i => i.Id).SequenceEqual(["imp_new"]) && !File.Exists(Path.Combine(tmp, "imports", "imp_old.xlsx"))
        && File.Exists(Path.Combine(tmp, "imports", "imp_new.xlsx")), "old import record and its saved .xlsx are removed, recent ones kept");
    var reloaded = new Store(tmp);
    Check(Ids(reloaded.Current.Meetings) == "edge,new", "cleanup is saved to meetings.json");

    var log = Path.Combine(tmp, "audit.log");
    File.AppendAllText(log, $"{{\"at\":\"{cutoff.AddDays(-2):yyyy-MM-dd}T10:00:00\",\"ip\":\"x\",\"action\":\"old\"}}\nnot json\n");
    var removedLines = reloaded.Audit.Prune(cutoff);
    var lines = File.ReadAllLines(log);
    Check(removedLines == 1 && lines.Contains("not json") && lines.Any(l => l.Contains("\"cleanup\"")),
        "audit.log drops lines before the cutoff, keeps unreadable lines and the cleanup entry");
    Check(new Settings().RetentionDays == 30, "retention defaults to 30 days");
}
finally
{
    Directory.Delete(tmp, true);
}

Console.WriteLine("SelfCheck OK");

static string Key(Meeting m) =>
    $"{m.Date}|{m.Start}|{m.End}|{m.EndEstimated}|{m.Title}|{m.Chair}|{m.Participants}|{Screen.Norm(m.Place)}|{m.Note}|{m.Contact}|{m.ShowContact}|{m.Status}";

// Builds a workbook in the ward export layout. A one-cell row is a merged day row.
static MemoryStream Sheet(params object[][] rows)
{
    using var wb = new ClosedXML.Excel.XLWorkbook();
    var ws = wb.AddWorksheet("Sheet1");
    ws.Range(1, 1, 1, 7).Merge().Value = "LỊCH TUẦN - ỦY BAN NHÂN DÂN PHƯỜNG XUÂN HÒA\r\n (19/10/2026-25/10/2026)";
    ws.Range(2, 1, 2, 2).Merge().Value = "Thời gian";
    string[] heads = ["Nội dung", "Chủ trì", "Thành phần", "Địa điểm", "Ghi chú", "Liên hệ"];
    for (var i = 0; i < heads.Length; i++) ws.Cell(2, 3 + i).Value = heads[i];
    ws.Cell(3, 1).Value = "*****";
    var r = 4;
    foreach (var row in rows)
    {
        if (row.Length == 1) ws.Range(r, 1, r, 7).Merge().Value = (string)row[0];
        else
            for (var c = 0; c < row.Length; c++)
                ws.Cell(r, c + 1).Value = row[c] switch { TimeSpan t => t, var o => (string)o };
        r++;
    }
    var ms = new MemoryStream();
    wb.SaveAs(ms);
    ms.Position = 0;
    return ms;
}

static string Ids(IEnumerable<Meeting> ms) => string.Join(",", ms.Select(m => m.Id));

static void Check(bool ok, string what)
{
    if (!ok) throw new Exception("FAIL: " + what);
    Console.WriteLine("ok   " + what);
}
