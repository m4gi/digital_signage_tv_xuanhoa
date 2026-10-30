using LedConference;

// Composition root: settings, services, middleware and the endpoint groups (one file each in Endpoints\).
var store = new Store(Path.Combine(AppContext.BaseDirectory, "data"));
var cfg = ServerConfig.From(store.Current.Settings);

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
builder.Services.AddSingleton(store);
builder.Services.AddSingleton(cfg);
builder.Services.AddSingleton<ScreenStatus>();
builder.Services.AddSingleton<LogoFiles>();
builder.Services.AddSingleton<EmbeddedAssets>();
builder.Services.AddSingleton<CloudflareAccess>();
builder.Services.AddHostedService<ThemeWatcher>();
builder.Services.AddHostedService<RetentionCleanup>();

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages(); // empty error responses (e.g. malformed JSON) get a ProblemDetails body too
app.UsePortGate(cfg);

app.MapPages();
app.MapLogo();
app.MapScreens();
app.MapRooms();
app.MapMeetings();
app.MapExcel();
app.MapPlaces();
app.MapSettings();
app.MapThemes();

app.Logger.LogInformation("Dữ liệu: {Dir}. Màn hình: cổng {Screen}. Quản trị: cổng {Admin}, IP được phép: {Allow}",
    store.Dir, cfg.ScreenPort, cfg.AdminPort, cfg.AdminAllowText.Count == 0 ? "chỉ máy chủ" : string.Join(", ", cfg.AdminAllowText));
app.Run();
