namespace CTraderAgent.Config;

public sealed class CTraderConfig
{
    public string ExecutablePath { get; set; } = "";
    public string ProcessName { get; set; } = "cTrader";
    public int StartupTimeoutSeconds { get; set; } = 60;
    public bool AttachIfAlreadyRunning { get; set; } = true;

    /// <summary>
    /// Whether to drive the backtest "settings" popup (starting capital, commission, data mode).
    /// Off by default until that popup's UI selectors are calibrated via a second --inspect;
    /// while off, backtests use cTrader's current values for those fields.
    /// </summary>
    public bool DriveBacktestSettingsPopup { get; set; } = false;
}

public sealed class AgentSettings
{
    public string JobsRoot { get; set; } = "../jobs";
    public string ReportsRoot { get; set; } = "../reports";
    public int PollIntervalSeconds { get; set; } = 10;
    public int RunTimeoutMinutes { get; set; } = 180;
    public int MaxConsecutiveFailuresBeforePause { get; set; } = 3;
}

public sealed class NotificationSettings
{
    public string WebhookUrl { get; set; } = "";
    public bool NotifyOnSuccess { get; set; } = true;
    public bool NotifyOnFailure { get; set; } = true;
}

public sealed class LoggingSettings
{
    public string Directory { get; set; } = "../logs";
    public string MinimumLevel { get; set; } = "Information";
}

public sealed class AppConfig
{
    public CTraderConfig CTrader { get; set; } = new();
    public AgentSettings Agent { get; set; } = new();
    public NotificationSettings Notifications { get; set; } = new();
    public LoggingSettings Logging { get; set; } = new();
}
