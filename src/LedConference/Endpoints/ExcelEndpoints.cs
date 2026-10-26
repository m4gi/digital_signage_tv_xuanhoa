using System.IO.Compression;
using System.Security.Cryptography;
using static LedConference.Api;

namespace LedConference;

// Weekly Excel: sample template, export of a week, import (replaces the file's week) and the import history.
public static class ExcelEndpoints
{
    const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static void MapExcel(this WebApplication app)
    {
        app.MapGet("/template.xlsx", (Store store) => Results.File(
            WeekExcelWriter.Template(Screen.WeekStart(DateOnly.FromDateTime(DateTime.Now)), store.Current.Settings.Org), XlsxType, "Mau_LichTuan.xlsx"));

        app.MapGet("/api/export", (DateOnly? week, Store store) =>
        {
            var d = store.Current;
            var from = Screen.WeekStart(week ?? DateOnly.FromDateTime(DateTime.Now));
            return Results.File(WeekExcelWriter.Write(from, d.Meetings, d.Settings.Org), XlsxType, $"LichTuan_{from:yyyy-MM-dd}.xlsx");
        });

        // Body is the raw .xlsx. Replaces every meeting in the file's week; asks first (409) when that drops manual edits.
        app.MapPost("/api/import", async (HttpRequest req, bool? confirm, HttpContext ctx, Store store, ILoggerFactory logs) =>
        {
            using var body = new MemoryStream();
            await req.Body.CopyToAsync(body);
            var bytes = body.ToArray();
            if (!LooksLikeXlsx(bytes))
                return Problem(415, "Không đọc được file", "Chỉ nhận file Excel .xlsx (không nhận .xls cũ hay .xlsm có macro).");

            var settings = store.Current.Settings;
            ParsedWeek week;
            try { week = WeekExcelReader.Read(new MemoryStream(bytes), settings.Morning, settings.Afternoon); }
            catch (Exception e) when (e is not OutOfMemoryException)
            {
                logs.CreateLogger("LedConference").LogWarning(e, "Import failed to parse");
                return Problem(415, "Không đọc được file", "File Excel bị hỏng hoặc không đúng định dạng.");
            }
            if (week.Errors.Count > 0)
                return Results.Problem(statusCode: 422, title: "File bị từ chối",
                    detail: $"{week.Errors.Count} lỗi. Lịch cũ được giữ nguyên.",
                    extensions: new Dictionary<string, object?> { ["rows"] = week.Errors });

            // An empty export would silently wipe the week; treat it as a mistake.
            if (week.Meetings.Count == 0)
                return Results.Problem(statusCode: 422, title: "File bị từ chối",
                    detail: $"File không có cuộc họp nào cho tuần {week.From:dd/MM} – {week.To:dd/MM/yyyy}. Lịch cũ được giữ nguyên.",
                    extensions: new Dictionary<string, object?> { ["rows"] = Array.Empty<RowError>() });

            bool InWeek(Meeting m) => m.Date >= week.From && m.Date <= week.To;
            var manual = store.Current.Meetings.Where(m => InWeek(m) && m.Source == "manual").OrderBy(m => m.Date).ThenBy(m => m.Start).ToList();
            if (manual.Count > 0 && confirm != true)
                return Results.Problem(statusCode: 409, title: "Cần xác nhận",
                    detail: $"Tuần {week.From:dd/MM} – {week.To:dd/MM/yyyy} có {manual.Count} cuộc họp sửa tay sẽ bị thay thế.",
                    extensions: new Dictionary<string, object?> { ["manual"] = manual.Select(m => new { m.Id, m.Date, m.Start, m.Title }) });

            var now = DateTime.Now;
            var ip = Ip(ctx);
            var id = $"imp_{now:yyyyMMdd_HHmmss}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(2)).ToLowerInvariant()}";
            var fileName = Path.GetFileName(Uri.UnescapeDataString(req.Headers["X-File-Name"].ToString())).Trim();
            if (fileName.Length is 0 or > 200) fileName = "lich-tuan.xlsx";
            File.WriteAllBytes(Path.Combine(Directory.CreateDirectory(Path.Combine(store.Dir, "imports")).FullName, id + ".xlsx"), bytes);

            var meetings = week.Meetings.Select(m => m with { Id = NewId("m_"), ImportId = id, UpdatedAt = now, UpdatedBy = ip }).ToList();
            var replaced = 0;
            store.Edit(ip, "import", id, d =>
            {
                replaced = d.Meetings.RemoveAll(InWeek);
                d.Meetings.AddRange(meetings);
                d.Imports.Insert(0, new ImportRecord(id, now, ip, fileName, week.From, week.To, meetings.Count));
                return new { fileName, week = new { from = week.From, to = week.To }, total = meetings.Count, replaced };
            });

            var rooms = store.Current.Rooms;
            return Results.Ok(new
            {
                importId = id,
                week = new { from = week.From, to = week.To },
                total = meetings.Count,
                replaced,
                byRoom = rooms.Select(r => new { roomCode = r.Code, r.Name, count = meetings.Count(m => Screen.Matches(r, m.Place)) })
                    .Where(x => x.count > 0),
                unassigned = meetings.Where(m => Screen.RoomOf(rooms, m.Place) is null)
                    .GroupBy(m => Screen.Norm(m.Place))
                    .Select(g => new { place = g.First().Place, count = g.Count() }),
                estimatedEnds = meetings.Count(m => m.EndEstimated),
            });
        });

        app.MapGet("/api/imports", (Store store) => store.Current.Imports);

        app.MapGet("/api/imports/{id}/file", (string id, Store store) =>
        {
            var record = store.Current.Imports.FirstOrDefault(i => i.Id == id);
            var path = record is null ? null : Path.Combine(store.Dir, "imports", record.Id + ".xlsx");
            return path is not null && File.Exists(path)
                ? Results.File(path, XlsxType, record!.FileName)
                : Problem(404, "Không tìm thấy file", $"Không có lần nhập '{id}'.");
        });
    }

    // A real .xlsx is a zip with a workbook part and no VBA project (.xlsm macros are refused).
    static bool LooksLikeXlsx(byte[] bytes)
    {
        if (bytes.Length < 4 || bytes[0] != 'P' || bytes[1] != 'K') return false;
        try
        {
            using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
            return zip.GetEntry("xl/workbook.xml") is not null && zip.GetEntry("xl/vbaProject.bin") is null;
        }
        catch (InvalidDataException)
        {
            return false;
        }
    }
}
