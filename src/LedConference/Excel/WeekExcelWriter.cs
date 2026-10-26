using ClosedXML.Excel;

namespace LedConference;

// Writes a week in the same layout WeekExcelReader reads (the ward's Lichdonvi export), plus the sample template.
public static class WeekExcelWriter
{
    static readonly string[] DayNames = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
    static readonly TimeOnly Noon = WeekExcelReader.Noon;

    // Same layout as the ward's export, so a file written here can be imported again unchanged.
    public static byte[] Write(DateOnly from, IEnumerable<Meeting> meetings, Org org)
    {
        var to = from.AddDays(6);
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Lịch tuần");
        double[] widths = [10.7, 20.7, 50.7, 20.7, 30.7, 30.7, 20.7, 25.7];
        for (var i = 0; i < widths.Length; i++) ws.Column(i + 1).Width = widths[i];
        ws.Style.Alignment.WrapText = true;
        ws.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

        var title = ws.Range(1, 1, 1, 8).Merge();
        title.Value = $"LỊCH TUẦN - {org.Line1} {org.Line2}\n({from:dd/MM/yyyy}-{to:dd/MM/yyyy})";
        title.Style.Font.Bold = true;
        title.Style.Font.FontSize = 14;
        title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(1).Height = 42;

        ws.Range(2, 1, 2, 2).Merge();
        string[] heads = ["Thời gian", "", "Nội dung", "Chủ trì", "Thành phần", "Địa điểm", "Ghi chú", "Liên hệ"];
        for (var c = 0; c < heads.Length; c++)
            if (heads[c].Length > 0) ws.Cell(2, c + 1).Value = heads[c];
        var head = ws.Range(2, 1, 2, 8);
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
            var dayRow = ws.Range(r, 1, r, 8).Merge();
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
                    var note = m.ShowNote ? m.Note : ""; // a hidden note stays hidden after re-import
                    ws.Cell(r, 7).Value = m.Status == MeetingStatus.Postponed ? (note.Length > 0 ? "Hoãn. " + note : "Hoãn") : note;
                    ws.Cell(r, 8).Value = m.ShowContact ? m.Contact : ""; // a hidden contact stays hidden after re-import
                    first = false;
                    r++;
                }
                if (first) ws.Cell(r++, 1).Value = label;
            }
        }

        var table = ws.Range(2, 1, r - 1, 8);
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
        Meeting M(int day, int h, int m, int? endH, string title, string chair, string parts, string place, string note = "", string contact = "") => new()
        {
            Date = from.AddDays(day), Start = new(h, m), End = endH is { } e ? new(e, 30) : new(h + 1, m), EndEstimated = endH is null,
            Title = title, Chair = chair, Participants = parts, Place = place, Note = note, Contact = contact, ShowContact = contact.Length > 0,
        };
        return Write(from,
        [
            M(0, 8, 0, 9, "Giao ban tuần", "Chủ tịch UBND phường", "Lãnh đạo UBND, trưởng các phòng chuyên môn", "Phòng họp tầng 2",
                contact: "Đ/c Lan – Văn phòng UBND"),
            M(0, 10, 0, null, "Họp triển khai kế hoạch chuyển đổi số", "Phó Chủ tịch UBND phường", "Văn phòng, phòng Văn hóa – Xã hội", "Phòng họp tầng 1",
                "Ví dụ: bỏ trống giờ kết thúc nếu chưa rõ"),
            M(2, 14, 0, 15, "Tiếp công dân định kỳ", "Chủ tịch UBND phường", "", "Phòng tiếp công dân"),
        ], org);
    }
}
