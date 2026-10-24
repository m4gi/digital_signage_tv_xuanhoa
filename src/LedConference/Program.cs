using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using LedConference;
using Microsoft.AspNetCore.StaticFiles;

var store = new Store(Path.Combine(AppContext.BaseDirectory, "data"));
var cfg = store.Current.Settings;
if (cfg.ScreenPort == cfg.AdminPort)
    throw new InvalidOperationException("ScreenPort và AdminPort trong data\\settings.json phải khác nhau.");
var adminAllow = cfg.AdminAllow.Select(ParseNetwork).ToList();

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory });
// Runs as a Windows Service when started by the service manager (install.bat), as a console app otherwise.
// As a service, logs go to the Windows Event Log (Application, source "LedConference").
builder.Host.UseWindowsService(o => o.ServiceName = "LedConference");
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning); // no per-request lines in the console
builder.WebHost.ConfigureKestrel(k =>
{
    k.ListenAnyIP(cfg.ScreenPort);
    k.ListenAnyIP(cfg.AdminPort);
    k.Limits.MaxRequestBodySize = 10 * 1024 * 1024;
});
builder.Services.ConfigureHttpJsonOptions(o => Json.Configure(o.SerializerOptions));
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseExceptionHandler();

// themes.json may be edited by hand on the server; reload it shortly after it changes.
if (store.ThemeError is { } themeError) app.Logger.LogError("{Error} Đang dùng các mẫu gốc.", themeError);
var themeWatcher = new FileSystemWatcher(store.Dir, "themes.json")
{
    NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName,
    EnableRaisingEvents = true,
};
var themeReload = new Timer(_ =>
{
    if (store.ReloadThemes() is { } error) app.Logger.LogError("{Error} Giữ nguyên các mẫu đang dùng.", error);
});
void ThemesChanged(object? sender, FileSystemEventArgs e) => themeReload.Change(500, Timeout.Infinite);
themeWatcher.Changed += ThemesChanged;
themeWatcher.Created += ThemesChanged;
themeWatcher.Renamed += ThemesChanged;
app.UseStatusCodePages(); // empty error responses (e.g. malformed JSON) get a ProblemDetails body too

// Screen port: read-only screen paths only. Admin port: allowlisted IPs (loopback always), same-origin writes.
string[] screenPaths = ["/room", "/api/screens", "/assets", "/logo"];
app.Use(async (ctx, next) =>
{
    var headers = ctx.Response.Headers;
    headers.XContentTypeOptions = "nosniff";
    headers["Referrer-Policy"] = "no-referrer";
    headers.ContentSecurityPolicy = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'";

    var req = ctx.Request;
    var reading = HttpMethods.IsGet(req.Method) || HttpMethods.IsHead(req.Method);
    if (ctx.Connection.LocalPort == cfg.ScreenPort)
    {
        // The screen app may render from a page bundled in the APK, i.e. another origin. Data here is public
        // display info and no cookies are used, so any origin may read it.
        headers.AccessControlAllowOrigin = "*";
        if (HttpMethods.IsOptions(req.Method))
        {
            headers.AccessControlAllowMethods = "GET";
            headers.AccessControlAllowHeaders = "X-Device-Key";
            headers.AccessControlMaxAge = "86400";
            ctx.Response.StatusCode = StatusCodes.Status204NoContent;
            return;
        }
        if (!reading || !screenPaths.Any(p => req.Path.StartsWithSegments(p)))
        {
            await Results.NotFound().ExecuteAsync(ctx);
            return;
        }
    }
    else
    {
        var ip = ClientIp(ctx);
        if (!IPAddress.IsLoopback(ip) && !adminAllow.Any(n => n.Contains(ip)))
        {
            await Problem(403, "Không có quyền", $"Máy {ip} không nằm trong danh sách được phép quản trị.").ExecuteAsync(ctx);
            return;
        }
        if (!reading && req.Headers.Origin is [{ } origin]
            && !(Uri.TryCreate(origin, UriKind.Absolute, out var o) && string.Equals(o.Authority, req.Host.Value, StringComparison.OrdinalIgnoreCase)))
        {
            await Problem(403, "Không có quyền", "Yêu cầu gửi từ trang khác bị chặn.").ExecuteAsync(ctx);
            return;
        }
    }
    await next(ctx);
});

// ---------- Pages ----------

var mime = new FileExtensionContentTypeProvider();
IResult Asset(string name)
{
    var stream = typeof(Store).Assembly.GetManifestResourceStream(name);
    if (stream is null) return Results.NotFound();
    mime.TryGetContentType(name, out var type);
    return Results.Stream(stream, type ?? "application/octet-stream");
}

app.MapGet("/", () => Asset("admin.html"));
app.MapGet("/room/{code}", (string code) => Asset("display.html"));
app.MapGet("/assets/{name}", (string name) => Asset(name));

// ---------- Logo ----------

string[] logoFiles = ["logo.webp", "logo.png", "logo.jpg"];
string? LogoPath() => logoFiles.Select(n => Path.Combine(store.Dir, n)).FirstOrDefault(File.Exists);

// An uploaded logo wins; otherwise the ward logo embedded in the exe.
app.MapGet("/logo", (HttpContext ctx) =>
{
    ctx.Response.Headers.CacheControl = "public, max-age=86400"; // URLs carry ?v=N, bumped on upload
    var path = LogoPath();
    if (path is null) return Asset("logo.webp");
    mime.TryGetContentType(path, out var type);
    return Results.File(path, type ?? "application/octet-stream");
});

app.MapPost("/api/logo", async (HttpRequest req, HttpContext ctx) =>
{
    using var body = new MemoryStream();
    await req.Body.CopyToAsync(body);
    var bytes = body.ToArray();
    var ext = bytes switch
    {
        [0x89, 0x50, 0x4E, 0x47, ..] => "png",
        [0xFF, 0xD8, 0xFF, ..] => "jpg",
        [(byte)'R', (byte)'I', (byte)'F', (byte)'F', _, _, _, _, (byte)'W', (byte)'E', (byte)'B', (byte)'P', ..] => "webp",
        _ => null,
    };
    if (ext is null) return Problem(415, "Không nhận file này", "Logo phải là ảnh WebP, PNG hoặc JPG.");
    if (bytes.Length > 2 * 1024 * 1024) return Problem(413, "File quá lớn", "Logo tối đa 2MB.");
    store.Edit(Ip(ctx), "logo.update", "logo", d =>
    {
        foreach (var name in logoFiles) File.Delete(Path.Combine(store.Dir, name));
        File.WriteAllBytes(Path.Combine(store.Dir, "logo." + ext), bytes);
        d.Settings = d.Settings with { LogoVersion = d.Settings.LogoVersion + 1 };
        return new { type = ext, bytes = bytes.Length };
    });
    return Results.Ok(new { logoVersion = store.Current.Settings.LogoVersion });
});

app.MapDelete("/api/logo", (HttpContext ctx) =>
{
    if (LogoPath() is null) return Results.NoContent();
    store.Edit(Ip(ctx), "logo.delete", "logo", d =>
    {
        foreach (var name in logoFiles) File.Delete(Path.Combine(store.Dir, name));
        d.Settings = d.Settings with { LogoVersion = d.Settings.LogoVersion + 1 };
        return null;
    });
    return Results.NoContent();
});

// ---------- Screen API ----------

app.MapGet("/api/screens/{code}", (string code, HttpContext ctx) =>
{
    ctx.Response.Headers.CacheControl = "no-store";
    var d = store.Current;
    var room = d.Rooms.FirstOrDefault(r => r.Code == code.ToUpperInvariant());
    if (room is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{code}'.");

    var s = (room.Display ?? new()).Over(GlobalDisplay(d));
    var theme = d.Themes.FirstOrDefault(t => t.Id == s.Theme) ?? d.Themes[0];
    var display = new
    {
        s.Orientation, s.Effect, s.Clock, s.Footer, s.ReduceMotion, s.HideCursor, s.FooterNote, s.EmptyDay, s.Skyline,
        contact = s.ContactEnabled == true ? s.Contact : "", // empty = no "Liên hệ" line
        theme,
    };
    var org = new
    {
        d.Settings.Org.Line1,
        d.Settings.Org.Line2,
        logoUrl = $"/logo?v={d.Settings.LogoVersion}",
        customLogo = LogoPath() is not null,
    };
    var version = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { display, org }, Json.Compact)))[..8];

    var now = DateTime.Now;
    var pick = Screen.PickFor(d.Meetings.Where(m => Screen.Matches(room, m.Place)), now, s.EmptyDay == "nextMeeting");
    var week = Screen.WeekStart(DateOnly.FromDateTime(now));
    return Results.Ok(new
    {
        apiVersion = 1, // bump on breaking changes; see docs/screen-api.md
        room = new { room.Code, room.Name },
        org,
        serverTime = now.ToString("yyyy-MM-ddTHH:mm:ss"),
        week = new { from = week, to = week.AddDays(6) },
        configVersion = version.ToLowerInvariant(),
        display,
        current = pick.Current is null ? null : PublicView(pick.Current),
        upcoming = pick.Upcoming.Select(PublicView),
        next = pick.Next is null ? null : PublicView(pick.Next),
    });
});

// ---------- Rooms ----------

app.MapGet("/api/rooms", (HttpContext ctx) =>
{
    var d = store.Current;
    var today = DateOnly.FromDateTime(DateTime.Now);
    return d.Rooms.Select(r => new
    {
        r.Code,
        r.Name,
        r.Places,
        r.Display,
        todayCount = d.Meetings.Count(m => m.Date == today && m.Status != MeetingStatus.Cancelled && Screen.Matches(r, m.Place)),
        screenUrl = $"http://{ctx.Request.Host.Host}:{cfg.ScreenPort}/room/{r.Code}",
    });
});

app.MapPost("/api/rooms", (RoomInput input, HttpContext ctx) =>
{
    var errors = CheckRoom(input, creating: true, store.Current.Themes);
    if (errors.Count > 0) return Invalid(errors);
    var room = ToRoom(input, input.Code!.Trim().ToUpperInvariant());
    if (store.Current.Rooms.Any(r => r.Code == room.Code)) return Problem(409, "Mã phòng đã có", $"Đã có phòng mã '{room.Code}'.");
    store.Edit(Ip(ctx), "room.create", room.Code, d => { d.Rooms.Add(room); return room; });
    return Results.Ok(room);
});

app.MapPut("/api/rooms/{code}", (string code, RoomInput input, HttpContext ctx) =>
{
    code = code.ToUpperInvariant();
    var old = store.Current.Rooms.FirstOrDefault(r => r.Code == code);
    if (old is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{code}'.");
    var errors = CheckRoom(input, creating: false, store.Current.Themes);
    if (errors.Count > 0) return Invalid(errors);
    var room = ToRoom(input, code);
    store.Edit(Ip(ctx), "room.update", code, d =>
    {
        var i = d.Rooms.FindIndex(r => r.Code == code);
        if (i >= 0) d.Rooms[i] = room;
        return Diff(old, room);
    });
    return Results.Ok(room);
});

app.MapDelete("/api/rooms/{code}", (string code, HttpContext ctx) =>
{
    code = code.ToUpperInvariant();
    var old = store.Current.Rooms.FirstOrDefault(r => r.Code == code);
    if (old is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{code}'.");
    // Meetings stay: they belong to a place, and show up again if a room matches that place.
    store.Edit(Ip(ctx), "room.delete", code, d => { d.Rooms.RemoveAll(r => r.Code == code); return old; });
    return Results.NoContent();
});

// ---------- Meetings ----------

app.MapGet("/api/meetings", (DateOnly? from, DateOnly? to, string? room) =>
{
    var d = store.Current;
    var f = from ?? Screen.WeekStart(DateOnly.FromDateTime(DateTime.Now));
    var t = to ?? f.AddDays(6);
    if (t < f || t.DayNumber - f.DayNumber > 366)
        return Invalid(new() { ["to"] = ["Khoảng ngày không hợp lệ (tối đa 1 năm)."] });
    Room? r = null;
    if (!string.IsNullOrWhiteSpace(room))
    {
        r = d.Rooms.FirstOrDefault(x => x.Code == room.ToUpperInvariant());
        if (r is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{room}'.");
    }
    var items = d.Meetings
        .Where(m => m.Date >= f && m.Date <= t && (r is null || Screen.Matches(r, m.Place)))
        .OrderBy(m => m.Date).ThenBy(m => m.Start)
        .Select(m => AdminView(m, d.Rooms));
    return Results.Ok(new { from = f, to = t, items });
});

app.MapPost("/api/meetings", (MeetingInput input, HttpContext ctx) =>
{
    var errors = CheckMeeting(input, store.Current, out var place);
    if (errors.Count > 0) return Invalid(errors);
    var m = new Meeting
    {
        Id = NewId("m_"),
        Date = input.Date!.Value,
        Start = input.Start!.Value,
        End = input.End!.Value,
        Title = input.Title!.Trim(),
        Chair = Clean(input.Chair),
        Participants = Clean(input.Participants),
        Note = Clean(input.Note),
        Place = place,
        Status = input.Status ?? MeetingStatus.Normal,
        Source = "manual",
        UpdatedAt = DateTime.Now,
        UpdatedBy = Ip(ctx),
    };
    store.Edit(Ip(ctx), "meeting.create", m.Id, d => { d.Meetings.Add(m); return m; });
    return Results.Ok(new { meeting = AdminView(m, store.Current.Rooms), warnings = Warnings(m) });
});

app.MapPut("/api/meetings/{id}", (string id, MeetingInput input, HttpContext ctx) =>
{
    var old = store.Current.Meetings.FirstOrDefault(m => m.Id == id);
    if (old is null) return Problem(404, "Không tìm thấy cuộc họp", $"Không có cuộc họp '{id}'.");
    var errors = CheckMeeting(input, store.Current, out var place);
    if (errors.Count > 0) return Invalid(errors);
    var m = old with
    {
        Date = input.Date!.Value,
        Start = input.Start!.Value,
        End = input.End!.Value,
        EndEstimated = false,
        Title = input.Title!.Trim(),
        Chair = Clean(input.Chair),
        Participants = Clean(input.Participants),
        Note = Clean(input.Note),
        Place = place,
        Status = input.Status ?? old.Status,
        Source = "manual",
        UpdatedAt = DateTime.Now,
        UpdatedBy = Ip(ctx),
    };
    store.Edit(Ip(ctx), "meeting.update", id, d =>
    {
        var i = d.Meetings.FindIndex(x => x.Id == id);
        if (i >= 0) d.Meetings[i] = m;
        return Diff(old, m);
    });
    return Results.Ok(new { meeting = AdminView(m, store.Current.Rooms), warnings = Warnings(m) });
});

app.MapDelete("/api/meetings/{id}", (string id, HttpContext ctx) =>
{
    var old = store.Current.Meetings.FirstOrDefault(m => m.Id == id);
    if (old is null) return Problem(404, "Không tìm thấy cuộc họp", $"Không có cuộc họp '{id}'.");
    store.Edit(Ip(ctx), "meeting.delete", id, d => { d.Meetings.RemoveAll(m => m.Id == id); return old; });
    return Results.NoContent();
});

// ---------- Excel import / export ----------

const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

app.MapGet("/template.xlsx", () => Results.File(
    WeekExcel.Template(Screen.WeekStart(DateOnly.FromDateTime(DateTime.Now)), store.Current.Settings.Org), XlsxType, "Mau_LichTuan.xlsx"));

app.MapGet("/api/export", (DateOnly? week) =>
{
    var d = store.Current;
    var from = Screen.WeekStart(week ?? DateOnly.FromDateTime(DateTime.Now));
    return Results.File(WeekExcel.Write(from, d.Meetings, d.Settings.Org), XlsxType, $"LichTuan_{from:yyyy-MM-dd}.xlsx");
});

// Body is the raw .xlsx. Replaces every meeting in the file's week; asks first (409) when that drops manual edits.
app.MapPost("/api/import", async (HttpRequest req, bool? confirm, HttpContext ctx) =>
{
    using var body = new MemoryStream();
    await req.Body.CopyToAsync(body);
    var bytes = body.ToArray();
    if (!LooksLikeXlsx(bytes))
        return Problem(415, "Không đọc được file", "Chỉ nhận file Excel .xlsx (không nhận .xls cũ hay .xlsm có macro).");

    var settings = store.Current.Settings;
    ParsedWeek week;
    try { week = WeekExcel.Read(new MemoryStream(bytes), settings.Morning, settings.Afternoon); }
    catch (Exception e) when (e is not OutOfMemoryException)
    {
        app.Logger.LogWarning(e, "Import failed to parse");
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

app.MapGet("/api/imports", () => store.Current.Imports);

app.MapGet("/api/imports/{id}/file", (string id) =>
{
    var record = store.Current.Imports.FirstOrDefault(i => i.Id == id);
    var path = record is null ? null : Path.Combine(store.Dir, "imports", record.Id + ".xlsx");
    return path is not null && File.Exists(path)
        ? Results.File(path, XlsxType, record!.FileName)
        : Problem(404, "Không tìm thấy file", $"Không có lần nhập '{id}'.");
});

// ---------- Places ----------

// Places used from this week on that match no room and were not marked "no screen".
app.MapGet("/api/places/unassigned", () =>
{
    var d = store.Current;
    var since = Screen.WeekStart(DateOnly.FromDateTime(DateTime.Now));
    var ignored = d.Settings.IgnoredPlaces.Select(Screen.Norm).ToHashSet();
    return d.Meetings
        .Where(m => m.Date >= since && m.Status != MeetingStatus.Cancelled && !ignored.Contains(Screen.Norm(m.Place))
                    && Screen.RoomOf(d.Rooms, m.Place) is null)
        .GroupBy(m => Screen.Norm(m.Place))
        .Select(g => new { place = g.First().Place, count = g.Count(), firstDate = g.Min(m => m.Date) })
        .OrderBy(x => x.firstDate);
});

app.MapPost("/api/places/assign", (PlaceInput input, HttpContext ctx) =>
{
    var place = Clean(input.Place);
    var code = Clean(input.RoomCode).ToUpperInvariant();
    if (place.Length is 0 or > 200) return Invalid(new() { ["place"] = ["Thiếu địa điểm (tối đa 200 ký tự)."] });
    var room = store.Current.Rooms.FirstOrDefault(r => r.Code == code);
    if (room is null) return Problem(404, "Không tìm thấy phòng", $"Không có phòng mã '{input.RoomCode}'.");
    if (Screen.Matches(room, place)) return Results.Ok(room);
    var other = Screen.RoomOf(store.Current.Rooms, place);
    if (other is not null) return Problem(409, "Địa điểm đã gán", $"“{place}” đang thuộc phòng {other.Code}.");
    if (room.Places.Count >= 20) return Invalid(new() { ["place"] = ["Phòng đã có tối đa 20 địa điểm."] });
    var updated = room with { Places = [.. room.Places, place] };
    store.Edit(Ip(ctx), "place.assign", code, d =>
    {
        var i = d.Rooms.FindIndex(r => r.Code == code);
        if (i >= 0) d.Rooms[i] = updated;
        return new { place };
    });
    return Results.Ok(updated);
});

app.MapPost("/api/places/ignore", (PlaceInput input, HttpContext ctx) =>
{
    var place = Clean(input.Place);
    if (place.Length is 0 or > 200) return Invalid(new() { ["place"] = ["Thiếu địa điểm (tối đa 200 ký tự)."] });
    var s = store.Current.Settings;
    if (s.IgnoredPlaces.Any(p => Screen.Norm(p) == Screen.Norm(place))) return Results.NoContent();
    store.Edit(Ip(ctx), "place.ignore", place, d => { d.Settings = s with { IgnoredPlaces = [.. s.IgnoredPlaces, place] }; return null; });
    return Results.NoContent();
});

app.MapDelete("/api/places/ignore", (string place, HttpContext ctx) =>
{
    var s = store.Current.Settings;
    var kept = s.IgnoredPlaces.Where(p => Screen.Norm(p) != Screen.Norm(place)).ToList();
    if (kept.Count == s.IgnoredPlaces.Count) return Results.NoContent();
    store.Edit(Ip(ctx), "place.unignore", place, d => { d.Settings = s with { IgnoredPlaces = kept }; return null; });
    return Results.NoContent();
});

// ---------- Settings, themes, audit ----------

app.MapGet("/api/settings", () => store.Current.Settings);

app.MapPut("/api/settings", (SettingsInput input, HttpContext ctx) =>
{
    var errors = new Dictionary<string, string[]>();
    CheckDisplay(errors, input.Display, store.Current.Themes);
    if (input.Morning is { } mo && mo.End <= mo.Start) errors["morning"] = ["Giờ kết thúc buổi sáng phải sau giờ bắt đầu."];
    if (input.Afternoon is { } af && af.End <= af.Start) errors["afternoon"] = ["Giờ kết thúc buổi chiều phải sau giờ bắt đầu."];
    Len(errors, "org.line1", input.Org?.Line1, 100);
    Len(errors, "org.line2", input.Org?.Line2, 100);
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

// ---------- Themes (data\themes.json) ----------

object ThemeView(Theme t, Data d)
{
    var global = GlobalDisplay(d).Theme;
    return new
    {
        t.Id,
        t.Name,
        builtIn = t.IsBuiltIn,
        modified = t.IsBuiltIn && t != Theme.BuiltIn.First(b => b.Id == t.Id),
        usedGlobally = global == t.Id,
        usedBy = d.Rooms.Where(r => ((r.Display ?? new()).Theme ?? global) == t.Id).Select(r => r.Code),
        contrast = t.Contrast(),
        tokens = t,
    };
}

app.MapGet("/api/themes", () =>
{
    var d = store.Current;
    return new { fileError = store.ThemeError, items = d.Themes.Select(t => ThemeView(t, d)) };
});

app.MapPut("/api/themes/{id}", (string id, Theme input, HttpContext ctx) =>
{
    var old = store.Current.Themes.FirstOrDefault(t => t.Id == id);
    if (old is null) return Problem(404, "Không tìm thấy mẫu", $"Không có mẫu giao diện '{id}'.");
    var theme = input with { Id = id, Name = (input.Name ?? "").Trim() };
    var errors = theme.Problems();
    if (errors.Count > 0) return Invalid(errors);
    store.Edit(Ip(ctx), "theme.update", id, d =>
    {
        var i = d.Themes.FindIndex(t => t.Id == id);
        if (i >= 0) d.Themes[i] = theme;
        return Diff(old, theme);
    });
    return Results.Ok(ThemeView(theme, store.Current));
});

app.MapPost("/api/themes", (NewThemeInput input, HttpContext ctx) =>
{
    var source = store.Current.Themes.FirstOrDefault(t => t.Id == (input.From ?? "official"));
    if (source is null) return Problem(404, "Không tìm thấy mẫu", $"Không có mẫu giao diện '{input.From}'.");
    var name = Clean(input.Name);
    if (name.Length == 0) name = source.Name + " (bản sao)";
    var theme = source with { Id = "mau-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(3)).ToLowerInvariant(), Name = name[..Math.Min(name.Length, 50)] };
    store.Edit(Ip(ctx), "theme.create", theme.Id, d => { d.Themes.Add(theme); return new { from = source.Id, theme.Name }; });
    return Results.Ok(ThemeView(theme, store.Current));
});

app.MapDelete("/api/themes/{id}", (string id, HttpContext ctx) =>
{
    var d = store.Current;
    var theme = d.Themes.FirstOrDefault(t => t.Id == id);
    if (theme is null) return Problem(404, "Không tìm thấy mẫu", $"Không có mẫu giao diện '{id}'.");
    if (theme.IsBuiltIn) return Problem(400, "Không xoá được mẫu gốc", "Mẫu gốc chỉ có thể khôi phục về mặc định.");
    var global = GlobalDisplay(d).Theme == id;
    var rooms = d.Rooms.Where(r => (r.Display ?? new()).Theme == id).Select(r => r.Code).ToList();
    if (global || rooms.Count > 0)
        return Results.Problem(statusCode: 409, title: "Mẫu đang được dùng",
            detail: $"Mẫu “{theme.Name}” đang được dùng bởi {string.Join(", ", (global ? ["cấu hình chung"] : Array.Empty<string>()).Concat(rooms))}.",
            extensions: new Dictionary<string, object?> { ["usedBy"] = rooms, ["usedGlobally"] = global });
    store.Edit(Ip(ctx), "theme.delete", id, x => { x.Themes.RemoveAll(t => t.Id == id); return theme; });
    return Results.NoContent();
});

app.MapPost("/api/themes/{id}/reset", (string id, HttpContext ctx) =>
{
    var original = Theme.BuiltIn.FirstOrDefault(t => t.Id == id);
    if (original is null) return Problem(400, "Không phải mẫu gốc", "Chỉ mẫu gốc mới khôi phục được.");
    var old = store.Current.Themes.First(t => t.Id == id);
    store.Edit(Ip(ctx), "theme.reset", id, d =>
    {
        var i = d.Themes.FindIndex(t => t.Id == id);
        if (i >= 0) d.Themes[i] = original;
        return Diff(old, original);
    });
    return Results.Ok(ThemeView(original, store.Current));
});

app.MapGet("/api/audit", (int? limit) => store.ReadAudit(Math.Clamp(limit ?? 100, 1, 1000)));

app.Logger.LogInformation("Dữ liệu: {Dir}. Màn hình: cổng {Screen}. Quản trị: cổng {Admin}, IP được phép: {Allow}",
    store.Dir, cfg.ScreenPort, cfg.AdminPort, cfg.AdminAllow.Count == 0 ? "chỉ máy chủ" : string.Join(", ", cfg.AdminAllow));
app.Run();

// ---------- Helpers ----------

static DisplaySettings GlobalDisplay(Data d) => d.Settings.Display.Over(DisplaySettings.Defaults);

static object PublicView(Meeting m) =>
    new { m.Id, m.Date, m.Start, m.End, m.EndEstimated, m.Title, m.Chair, m.Participants, m.Note, m.Status };

static object AdminView(Meeting m, IEnumerable<Room> rooms) => new
{
    m.Id, m.Date, m.Start, m.End, m.EndEstimated, m.Title, m.Chair, m.Participants, m.Note, m.Place,
    roomCode = Screen.RoomOf(rooms, m.Place)?.Code,
    m.Status, m.Source, m.ImportId, m.UpdatedAt, m.UpdatedBy,
};

object[] Warnings(Meeting m)
{
    var d = store.Current;
    var room = Screen.RoomOf(d.Rooms, m.Place);
    return Screen.Overlaps(d.Meetings, d.Rooms, m)
        .Select(o => (object)new
        {
            code = "overlap",
            message = $"Trùng giờ với “{o.Title}” ({o.Start:HH:mm} – {o.End:HH:mm}) tại {room?.Code}.",
            meetingId = o.Id,
        })
        .ToArray();
}

static Dictionary<string, string[]> CheckMeeting(MeetingInput i, Data d, out string place)
{
    var e = new Dictionary<string, string[]>();
    place = (i.Place ?? "").Trim();
    if (i.Date is null) e["date"] = ["Thiếu ngày."];
    if (i.Start is null) e["start"] = ["Thiếu giờ bắt đầu."];
    if (i.End is null) e["end"] = ["Thiếu giờ kết thúc."];
    else if (i.Start is not null && i.End <= i.Start) e["end"] = ["Giờ kết thúc phải sau giờ bắt đầu."];
    if (string.IsNullOrWhiteSpace(i.Title)) e["title"] = ["Thiếu nội dung cuộc họp."];
    Len(e, "title", i.Title, 300);
    Len(e, "chair", i.Chair, 200);
    Len(e, "participants", i.Participants, 500);
    Len(e, "note", i.Note, 500);
    Len(e, "place", i.Place, 200);
    if (!string.IsNullOrWhiteSpace(i.RoomCode))
    {
        var room = d.Rooms.FirstOrDefault(r => r.Code == i.RoomCode.Trim().ToUpperInvariant());
        if (room is null) e["roomCode"] = [$"Không có phòng mã '{i.RoomCode}'."];
        else place = room.Name;
    }
    else if (place.Length == 0) e["place"] = ["Chọn phòng hoặc nhập địa điểm."];
    return e;
}

static Dictionary<string, string[]> CheckRoom(RoomInput i, bool creating, IEnumerable<Theme> themes)
{
    var e = new Dictionary<string, string[]>();
    if (creating && !Regex.IsMatch((i.Code ?? "").Trim().ToUpperInvariant(), "^[A-Z0-9_-]{1,32}$"))
        e["code"] = ["Mã phòng chỉ gồm chữ không dấu, số, - hoặc _, tối đa 32 ký tự."];
    if (string.IsNullOrWhiteSpace(i.Name)) e["name"] = ["Thiếu tên phòng."];
    Len(e, "name", i.Name, 100);
    if (i.Places is { Count: > 20 }) e["places"] = ["Tối đa 20 địa điểm."];
    else if (i.Places?.Any(p => p is null || p.Length > 200) == true) e["places"] = ["Mỗi địa điểm tối đa 200 ký tự."];
    CheckDisplay(e, i.Display, themes);
    return e;
}

static void CheckDisplay(Dictionary<string, string[]> e, DisplaySettings? s, IEnumerable<Theme> themes)
{
    if (s is null) return;
    if (s.Theme is not null && !themes.Any(t => t.Id == s.Theme)) e["display.theme"] = ["Không có mẫu giao diện này."];
    if (s.Orientation is not null && !DisplaySettings.Orientations.Contains(s.Orientation)) e["display.orientation"] = ["Giá trị không hợp lệ."];
    if (s.Effect is not null && !DisplaySettings.Effects.Contains(s.Effect)) e["display.effect"] = ["Giá trị không hợp lệ."];
    if (s.EmptyDay is not null && !DisplaySettings.EmptyDays.Contains(s.EmptyDay)) e["display.emptyDay"] = ["Giá trị không hợp lệ."];
    if (s.Skyline is not null && !DisplaySettings.Skylines.Contains(s.Skyline)) e["display.skyline"] = ["Giá trị không hợp lệ."];
    Len(e, "display.footerNote", s.FooterNote, 200);
    Len(e, "display.contact", s.Contact, 200);
}

static Room ToRoom(RoomInput i, string code) => new()
{
    Code = code,
    Name = i.Name!.Trim(),
    Places = (i.Places ?? []).Select(p => p.Trim()).Where(p => p.Length > 0).Distinct().ToList(),
    Display = i.Display ?? new(),
};

static void Len(Dictionary<string, string[]> e, string key, string? value, int max)
{
    if (value is not null && value.Length > max) e.TryAdd(key, [$"Tối đa {max} ký tự."]);
}

static string Clean(string? s) => (s ?? "").Trim();

static string NewId(string prefix) => prefix + Convert.ToHexString(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant();

static IResult Invalid(Dictionary<string, string[]> errors) => Results.ValidationProblem(errors, title: "Dữ liệu không hợp lệ");

static IResult Problem(int status, string title, string detail) => Results.Problem(statusCode: status, title: title, detail: detail);

static Dictionary<string, JsonElement[]> Diff<T>(T a, T b)
{
    var x = JsonSerializer.SerializeToElement(a, Json.Compact);
    var y = JsonSerializer.SerializeToElement(b, Json.Compact);
    return x.EnumerateObject()
        .Where(p => p.Name is not ("updatedAt" or "updatedBy")
                    && y.TryGetProperty(p.Name, out var q) && p.Value.GetRawText() != q.GetRawText())
        .ToDictionary(p => p.Name, p => new[] { p.Value, y.GetProperty(p.Name) });
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

static IPAddress ClientIp(HttpContext ctx)
{
    var ip = ctx.Connection.RemoteIpAddress ?? IPAddress.None;
    return ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip;
}

static string Ip(HttpContext ctx) => ClientIp(ctx).ToString();

static System.Net.IPNetwork ParseNetwork(string s)
{
    s = s.Trim();
    if (s.Contains('/') && System.Net.IPNetwork.TryParse(s, out var net)) return net;
    if (!s.Contains('/') && IPAddress.TryParse(s, out var ip))
        return new System.Net.IPNetwork(ip, ip.AddressFamily == AddressFamily.InterNetwork ? 32 : 128);
    throw new InvalidOperationException(
        $"data\\settings.json: adminAllow có giá trị sai '{s}'. Dùng IP (192.168.1.20) hoặc dải IP (192.168.1.0/24, phần cuối là 0).");
}

record RoomInput(string? Code, string? Name, List<string>? Places, DisplaySettings? Display);

record MeetingInput(
    DateOnly? Date, TimeOnly? Start, TimeOnly? End, string? Title, string? Chair, string? Participants,
    string? Note, string? Place, string? RoomCode, MeetingStatus? Status);

record SettingsInput(Org? Org, DisplaySettings? Display, Session? Morning, Session? Afternoon);

record PlaceInput(string? Place, string? RoomCode);

record NewThemeInput(string? Name, string? From);
