namespace LedConference;

// Deletes data older than Settings.RetentionDays (meetings, imported files, audit lines): at startup, then every 12 hours.
public sealed class RetentionCleanup(Store store, ILogger<RetentionCleanup> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(12));
        do
        {
            try
            {
                var days = store.Current.Settings.RetentionDays;
                if (days > 0)
                {
                    var cutoff = DateOnly.FromDateTime(DateTime.Now).AddDays(-days);
                    store.Prune(cutoff);
                    store.Audit.Prune(cutoff);
                }
            }
            catch (Exception e)
            {
                log.LogError(e, "Tự xoá dữ liệu cũ thất bại");
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }
}
