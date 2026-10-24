using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;

namespace LedConference;

public sealed record RowError(int Row, string Message);

public sealed record ParsedWeek(DateOnly From, DateOnly To, List<Meeting> Meetings, List<RowError> Errors);

// Reads and writes the weekly schedule in the layout exported by the ward's meeting software (Lichdonvi_*.xlsx):
// a title row holding the week range, a header row (Thời gian | Nội dung | Chủ trì | Thành phần | Địa điểm | Ghi chú,
// with "Thời gian" spanning the session column and the clock column), then per day a "Thứ x, dd/MM/yyyy" row
// followed by Sáng/Chiều rows. A blank session cell continues the session above; a row without Nội dung is no meeting.
public static partial class WeekExcel
{
    [GeneratedRegex(@"(\d{1,2})/(\d{1,2})/(\d{4})")]
    private static partial Regex DateRx();

    [GeneratedRegex(@"\s*(?:-|–|—|đến)\s*")]
    private static partial Regex RangeRx();

    [GeneratedRegex(@"^(\d{1,2})(?:h(\d{1,2})?)?$")]
    private static partial Regex ClockRx();

    static readonly string[] DayNames = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
    static readonly TimeOnly Noon = new(12, 0);
    const string TimeHint = "dùng 08:00, 8h00 hoặc 08:00 - 10:00";

    sealed record Row(
        int No, DateOnly Date, Session Session, TimeOnly Start, TimeOnly? End,
        string Title, string Chair, string Participants, string Place, string Note);

    public static ParsedWeek Read(Stream xlsx, Session morning, Session afternoon)
    {
        using var wb = new XLWorkbook(xlsx);
        var ws = wb.Worksheet(1);
        var last = ws.LastRowUsed()?.RowNumber() ?? 0;
        string Text(int r, int c) => c == 0 ? "" : ws.Cell(r, c).GetFormattedString().Trim();

        // Locate the header row and its columns by name.
        int header = 0, timeCol = 0, titleCol = 0, chairCol = 0, partCol = 0, placeCol = 0, noteCol = 0;
        for (var r = 1; r <= Math.Min(last, 20) && header == 0; r++)
        {
            timeCol = titleCol = chairCol = partCol = placeCol = noteCol = 0;
            for (var c = 1; c <= 20; c++)
            {
                switch (Screen.Norm(Text(r, c)))
                {
                    case "thời gian": timeCol = c; break;
                    case "nội dung": titleCol = c; break;
                    case "chủ trì": chairCol = c; break;
                    case "thành phần": partCol = c; break;
                    case "địa điểm": placeCol = c; break;
                    case "ghi chú": noteCol = c; break;
                }
            }
            if (timeCol > 0 && titleCol > 0 && placeCol > 0) header = r;
        }
        if (header == 0)
            return Fail("Không tìm thấy dòng tiêu đề cột (cần có Thời gian, Nội dung, Địa điểm).");
        var sessionCol = timeCol;
        var clockCol = timeCol + 1 == titleCol ? 0 : timeCol + 1;

        // Week range from the title, e.g. "LỊCH TUẦN - ... (19/10/2026-25/10/2026)".
        DateOnly? from = null, to = null;
        for (var r = 1; r < header; r++)
        {
            var dates = DateRx().Matches(Text(r, 1)).Select(ToDate).OfType<DateOnly>().ToList();
            if (dates.Count >= 2) (from, to) = (dates[0], dates[1]);
        }

        var errors = new List<RowError>();
        var rows = new List<Row>();
        var days = new List<DateOnly>();
        DateOnly? day = null;
        Session? session = null;
        for (var r = header + 1; r <= last; r++)
        {
            var label = Text(r, sessionCol);
            var title = Text(r, titleCol);
            var dateMatch = DateRx().Match(label);
            if (dateMatch.Success && title.Length == 0)
            {
                day = ToDate(dateMatch);
                if (day is null) errors.Add(new(r, $"ngày “{label}” không hợp lệ"));
                else days.Add(day.Value);
                session = null;
                continue;
            }

            var norm = Screen.Norm(label);
            if (norm.StartsWith("sáng")) session = morning;
            else if (norm.StartsWith("chiều")) session = afternoon;
            else if (norm.Length > 0) session = null; // "*****" or an unknown label: the time decides

            if (title.Length == 0) continue;

            var problems = new List<string>();
            if (day is null) problems.Add("chưa có dòng ngày (Thứ …, dd/mm/yyyy) phía trên");
            var place = Text(r, placeCol);
            if (place.Length == 0) problems.Add("có nội dung nhưng thiếu địa điểm");
            var (start, end, timeError) = ReadTime(clockCol == 0 ? null : ws.Cell(r, clockCol));
            if (timeError is not null) problems.Add(timeError);
            else if (start is null && session is null) problems.Add("thiếu giờ và không rõ buổi Sáng/Chiều");
            else if (start is not null && end is not null && end <= start) problems.Add("giờ kết thúc phải sau giờ bắt đầu");
            var (chair, parts, note) = (Text(r, chairCol), Text(r, partCol), Text(r, noteCol));
            if (title.Length > 300) problems.Add("nội dung dài quá 300 ký tự");
            if (place.Length > 200 || chair.Length > 200) problems.Add("địa điểm/chủ trì dài quá 200 ký tự");
            if (parts.Length > 500 || note.Length > 500) problems.Add("thành phần/ghi chú dài quá 500 ký tự");
            if (problems.Count > 0)
            {
                errors.Add(new(r, string.Join("; ", problems)));
                continue;
            }

            var s = start ?? session!.Start;
            rows.Add(new(r, day!.Value, session ?? (s < Noon ? morning : afternoon), s, end, title, chair, parts, place, note));
        }

        if (from is null || to is null)
        {
            if (days.Count == 0) return Fail("Không tìm thấy dòng ngày nào (dạng “Thứ 2, 19/10/2026”).");
            (from, to) = (days.Min(), days.Max());
        }
        if (to < from || to.Value.DayNumber - from.Value.DayNumber > 31)
            errors.Add(new(0, "khoảng ngày ở tiêu đề không hợp lệ"));
        foreach (var x in rows.Where(x => x.Date < from || x.Date > to))
            errors.Add(new(x.No, $"ngày {x.Date:dd/MM/yyyy} nằm ngoài tuần {from:dd/MM} – {to:dd/MM/yyyy}"));

        var meetings = rows.Select(x => (Row: x, Meeting: ToMeeting(x, rows))).ToList();

        // Two meetings in the same place must not overlap. Track the longest-running one so far per place and day.
        foreach (var group in meetings.GroupBy(x => (x.Meeting.Date, Screen.Norm(x.Meeting.Place))))
        {
            (Row Row, Meeting Meeting)? longest = null;
            foreach (var x in group.OrderBy(x => x.Meeting.Start))
            {
                if (longest is { } l && x.Meeting.Start < l.Meeting.End)
                    errors.Add(new(x.Row.No, $"trùng giờ với dòng {l.Row.No} tại {x.Meeting.Place} ({l.Meeting.Start:HH:mm} – {l.Meeting.End:HH:mm})"));
                if (longest is null || x.Meeting.End > longest.Value.Meeting.End) longest = x;
            }
        }

        errors.Sort((a, b) => a.Row.CompareTo(b.Row));
        return new(from.Value, to.Value, meetings.Select(x => x.Meeting).ToList(), errors);
    }

    // Without an end time the meeting runs until the next meeting in the same place, at most until the session ends.
    static Meeting ToMeeting(Row x, List<Row> all)
    {
        var end = x.End;
        if (end is null)
        {
            var next = all.Where(o => o.Date == x.Date && o.Start > x.Start && Screen.Norm(o.Place) == Screen.Norm(x.Place))
                .Select(o => (TimeOnly?)o.Start).Min();
            var cap = next is { } n && n < x.Session.End ? n : x.Session.End;
            end = cap > x.Start ? cap : x.Start.Hour >= 23 ? new TimeOnly(23, 59) : x.Start.AddHours(1);
        }
        // Write() marks postponed meetings with a leading "Hoãn" in Ghi chú; read it back as a status.
        var note = x.Note.Normalize(System.Text.NormalizationForm.FormC);
        var postponed = note.StartsWith("hoãn", StringComparison.OrdinalIgnoreCase);
        return new Meeting
        {
            Date = x.Date,
            Start = x.Start,
            End = end.Value,
            EndEstimated = x.End is null,
            Title = x.Title,
            Chair = x.Chair,
            Participants = x.Participants,
            Place = x.Place,
            Note = postponed ? note[4..].TrimStart('.', ':', ',', ' ') : x.Note,
            Status = postponed ? MeetingStatus.Postponed : MeetingStatus.Normal,
            Source = "excel",
        };
    }

    static (TimeOnly? Start, TimeOnly? End, string? Error) ReadTime(IXLCell? cell)
    {
        if (cell is null || cell.Value.IsBlank) return (null, null, null);
        var v = cell.Value;
        if (v.IsTimeSpan) return (Minute(v.GetTimeSpan()), null, null);
        if (v.IsDateTime) return (Minute(v.GetDateTime().TimeOfDay), null, null);
        if (v.IsNumber && v.GetNumber() is >= 0 and < 1) return (Minute(TimeSpan.FromDays(v.GetNumber())), null, null);

        var text = cell.GetFormattedString().Trim();
        if (text.Length == 0) return (null, null, null);
        var parts = RangeRx().Split(Screen.Norm(text));
        var start = parts.Length <= 2 ? Clock(parts[0]) : null;
        var end = parts.Length == 2 ? Clock(parts[1]) : null;
        if (start is null || (parts.Length == 2 && end is null))
            return (null, null, $"giờ “{text}” không hợp lệ ({TimeHint})");
        return (start, end, null);
    }

    // "8", "8h", "8h30", "08:30", "8g30", "8 giờ 30", "8.30" → 08:00 / 08:30.
    static TimeOnly? Clock(string s)
    {
        s = s.Replace("giờ", "h").Replace("phút", "").Replace("g", "h").Replace(":", "h").Replace(".", "h").Replace(" ", "").TrimEnd('p');
        var m = ClockRx().Match(s);
        if (!m.Success) return null;
        var h = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        var min = m.Groups[2].Success ? int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) : 0;
        return h < 24 && min < 60 ? new TimeOnly(h, min) : null;
    }

    static TimeOnly Minute(TimeSpan t) => TimeOnly.FromTimeSpan(TimeSpan.FromMinutes(Math.Round(t.TotalMinutes) % 1440));

    static DateOnly? ToDate(Match m) =>
        DateOnly.TryParseExact($"{m.Groups[1].Value}/{m.Groups[2].Value}/{m.Groups[3].Value}", "d/M/yyyy",
            CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    static ParsedWeek Fail(string message) => new(default, default, [], [new(0, message)]);

    // Same layout as the ward's export, so a file written here can be imported again unchanged.
    public static byte[] Write(DateOnly from, IEnumerable<Meeting> meetings, Org org)
    {
        var to = from.AddDays(6);
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Lịch tuần");
        double[] widths = [10.7, 20.7, 50.7, 20.7, 30.7, 30.7, 20.7];
        for (var i = 0; i < widths.Length; i++) ws.Column(i + 1).Width = widths[i];
        ws.Style.Alignment.WrapText = true;
        ws.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

        var title = ws.Range(1, 1, 1, 7).Merge();
        title.Value = $"LỊCH TUẦN - {org.Line1} {org.Line2}\n({from:dd/MM/yyyy}-{to:dd/MM/yyyy})";
        title.Style.Font.Bold = true;
        title.Style.Font.FontSize = 14;
        title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(1).Height = 42;

        ws.Range(2, 1, 2, 2).Merge();
        string[] heads = ["Thời gian", "", "Nội dung", "Chủ trì", "Thành phần", "Địa điểm", "Ghi chú"];
        for (var c = 0; c < heads.Length; c++)
            if (heads[c].Length > 0) ws.Cell(2, c + 1).Value = heads[c];
        var head = ws.Range(2, 1, 2, 7);
        head.Style.Font.Bold = true;
        head.Style.Fill.BackgroundColor = XLColor.FromHtml("#D9E7F7");
        head.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        var byDay = meetings
            .Where(m => m.Status != MeetingStatus.Cancelled && m.Date >= from && m.Date <= to)
            .OrderBy(m => m.Start)
            .ToLookup(m => m.Date);
        var r = 3;
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            var dayRow = ws.Range(r, 1, r, 7).Merge();
            dayRow.Value = $"{DayNames[(int)d.DayOfWeek]}, {d:dd/MM/yyyy}";
            dayRow.Style.Font.Bold = true;
            dayRow.Style.Fill.BackgroundColor = XLColor.FromHtml("#F2F2F2");
            r++;
            foreach (var (label, list) in new[] { ("Sáng", byDay[d].Where(m => m.Start < Noon)), ("Chiều", byDay[d].Where(m => m.Start >= Noon)) })
            {
                var first = true;
                foreach (var m in list)
                {
                    ws.Cell(r, 1).Value = first ? label : "";
                    ws.Cell(r, 2).Value = m.EndEstimated ? $"{m.Start:HH:mm}" : $"{m.Start:HH:mm} - {m.End:HH:mm}";
                    ws.Cell(r, 3).Value = m.Title;
                    ws.Cell(r, 4).Value = m.Chair;
                    ws.Cell(r, 5).Value = m.Participants;
                    ws.Cell(r, 6).Value = m.Place;
                    ws.Cell(r, 7).Value = m.Status == MeetingStatus.Postponed ? (m.Note.Length > 0 ? "Hoãn. " + m.Note : "Hoãn") : m.Note;
                    first = false;
                    r++;
                }
                if (first) ws.Cell(r++, 1).Value = label;
            }
        }

        var table = ws.Range(2, 1, r - 1, 7);
        table.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        table.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        ws.Range(3, 1, r - 1, 1).Style.Font.Bold = true;
        ws.SheetView.FreezeRows(2);
        ws.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        ws.PageSetup.FitToPages(1, 0);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public static byte[] Template(DateOnly from, Org org)
    {
        Meeting M(int day, int h, int m, int? endH, string title, string chair, string parts, string place, string note = "") => new()
        {
            Date = from.AddDays(day), Start = new(h, m), End = endH is { } e ? new(e, 30) : new(h + 1, m), EndEstimated = endH is null,
            Title = title, Chair = chair, Participants = parts, Place = place, Note = note,
        };
        return Write(from,
        [
            M(0, 8, 0, 9, "Giao ban tuần", "Chủ tịch UBND phường", "Lãnh đạo UBND, trưởng các phòng chuyên môn", "Phòng họp tầng 2"),
            M(0, 10, 0, null, "Họp triển khai kế hoạch chuyển đổi số", "Phó Chủ tịch UBND phường", "Văn phòng, phòng Văn hóa – Xã hội", "Phòng họp tầng 1",
                "Ví dụ: bỏ trống giờ kết thúc nếu chưa rõ"),
            M(2, 14, 0, 15, "Tiếp công dân định kỳ", "Chủ tịch UBND phường", "", "Phòng tiếp công dân"),
        ], org);
    }
}
