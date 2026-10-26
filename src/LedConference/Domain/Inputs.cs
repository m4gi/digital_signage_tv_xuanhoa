namespace LedConference;

// Request bodies of the admin API. Every field is optional here; Validation says what is missing.

public sealed record RoomInput(string? Code, string? Name, List<string>? Places, DisplaySettings? Display);

public sealed record MeetingInput(
    DateOnly? Date, TimeOnly? Start, TimeOnly? End, string? Title, string? Chair, string? Participants,
    string? Note, string? Place, string? RoomCode, MeetingStatus? Status, string? Contact = null, bool? ShowContact = null, bool? ShowNote = null);

public sealed record SettingsInput(Org? Org, DisplaySettings? Display, Session? Morning, Session? Afternoon);

public sealed record PlaceInput(string? Place, string? RoomCode);

public sealed record NewThemeInput(string? Name, string? From);
