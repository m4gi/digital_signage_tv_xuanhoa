namespace LedConference;

// themes.json may be edited by hand on the server; reload it shortly after it changes.
public sealed class ThemeWatcher(Store store, ILogger<ThemeWatcher> log) : IHostedService, IDisposable
{
    FileSystemWatcher? watcher;
    Timer? reload;

    public Task StartAsync(CancellationToken ct)
    {
        if (store.ThemeError is { } error) log.LogError("{Error} Đang dùng các mẫu gốc.", error);
        reload = new Timer(_ =>
        {
            if (store.ReloadThemes() is { } e) log.LogError("{Error} Giữ nguyên các mẫu đang dùng.", e);
        });
        watcher = new FileSystemWatcher(store.Dir, "themes.json")
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName,
            EnableRaisingEvents = true,
        };
        // Editors write in several steps: wait until the file has been quiet for half a second.
        void Changed(object? sender, FileSystemEventArgs e) => reload.Change(500, Timeout.Infinite);
        watcher.Changed += Changed;
        watcher.Created += Changed;
        watcher.Renamed += Changed;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;

    public void Dispose()
    {
        watcher?.Dispose();
        reload?.Dispose();
    }
}
