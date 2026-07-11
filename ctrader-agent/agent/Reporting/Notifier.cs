using System.Net.Http.Json;
using CTraderAgent.Config;
using CTraderAgent.Jobs;
using Serilog;

namespace CTraderAgent.Reporting;

/// <summary>
/// Optional webhook ping (e.g. a Slack Incoming Webhook URL) after each job.
/// No-ops if NotificationSettings.WebhookUrl is left blank.
/// </summary>
public sealed class Notifier
{
    private readonly NotificationSettings _settings;
    private readonly ILogger _log;
    private static readonly HttpClient Http = new();

    public Notifier(NotificationSettings settings, ILogger log)
    {
        _settings = settings;
        _log = log;
    }

    public async Task NotifyAsync(Job job, JobResult result)
    {
        if (string.IsNullOrWhiteSpace(_settings.WebhookUrl)) return;
        if (result.Success && !_settings.NotifyOnSuccess) return;
        if (!result.Success && !_settings.NotifyOnFailure) return;

        var text = result.Success
            ? $"✅ {job.Type} '{job.BotName}' ({job.Symbol} {job.Timeframe}) finished."
            : $"❌ {job.Type} '{job.BotName}' ({job.Symbol} {job.Timeframe}) failed: {result.ErrorMessage}";

        try
        {
            var response = await Http.PostAsJsonAsync(_settings.WebhookUrl, new { text });
            if (!response.IsSuccessStatusCode)
                _log.Warning("Notification webhook returned {Status}", response.StatusCode);
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "Failed to send notification webhook");
        }
    }
}
