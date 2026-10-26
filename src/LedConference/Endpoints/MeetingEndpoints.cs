using static LedConference.Api;

namespace LedConference;

public static class MeetingEndpoints
{
    public static void MapMeetings(this WebApplication app)
    {
        app.MapGet("/api/meetings", (DateOnly? from, DateOnly? to, string? room, Store store) =>
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
                .Select(m => Views.Admin(m, d.Rooms));
            return Results.Ok(new { from = f, to = t, items });
        });

        app.MapPost("/api/meetings", (MeetingInput input, HttpContext ctx, Store store) =>
        {
            var errors = Validation.Meeting(input, store.Current, out var place);
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
                ShowNote = input.ShowNote ?? true,
                Contact = Clean(input.Contact),
                ShowContact = input.ShowContact ?? false,
                Place = place,
                Status = input.Status ?? MeetingStatus.Normal,
                Source = "manual",
                UpdatedAt = DateTime.Now,
                UpdatedBy = Ip(ctx),
            };
            store.Edit(Ip(ctx), "meeting.create", m.Id, d => { d.Meetings.Add(m); return m; });
            return Results.Ok(new { meeting = Views.Admin(m, store.Current.Rooms), warnings = Warnings(store.Current, m) });
        });

        app.MapPut("/api/meetings/{id}", (string id, MeetingInput input, HttpContext ctx, Store store) =>
        {
            var old = store.Current.Meetings.FirstOrDefault(m => m.Id == id);
            if (old is null) return Problem(404, "Không tìm thấy cuộc họp", $"Không có cuộc họp '{id}'.");
            var errors = Validation.Meeting(input, store.Current, out var place);
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
                ShowNote = input.ShowNote ?? old.ShowNote,
                Contact = Clean(input.Contact),
                ShowContact = input.ShowContact ?? old.ShowContact,
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
            return Results.Ok(new { meeting = Views.Admin(m, store.Current.Rooms), warnings = Warnings(store.Current, m) });
        });

        app.MapDelete("/api/meetings/{id}", (string id, HttpContext ctx, Store store) =>
        {
            var old = store.Current.Meetings.FirstOrDefault(m => m.Id == id);
            if (old is null) return Problem(404, "Không tìm thấy cuộc họp", $"Không có cuộc họp '{id}'.");
            store.Edit(Ip(ctx), "meeting.delete", id, d => { d.Meetings.RemoveAll(m => m.Id == id); return old; });
            return Results.NoContent();
        });
    }

    // Saved anyway; the admin page shows these next to the form.
    static object[] Warnings(Data d, Meeting m)
    {
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
}
