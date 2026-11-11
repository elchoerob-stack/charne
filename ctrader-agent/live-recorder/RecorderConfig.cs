namespace CTraderRecorder;

public sealed class OpenApiConfig
{
    /// <summary>"demo" or "live". Maps to demo.ctraderapi.com / live.ctraderapi.com.</summary>
    public string Host { get; set; } = "demo";
    public int Port { get; set; } = 5035;
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string AccessToken { get; set; } = "";
    /// <summary>Your ctidTraderAccountId. Leave 0 to auto-discover from the access token.</summary>
    public long CtidTraderAccountId { get; set; }
    /// <summary>Extra guard: connecting to the LIVE host requires this to be true (even though the recorder is read-only).</summary>
    public bool AllowLive { get; set; }

    public bool IsLive => Host.Trim().Equals("live", StringComparison.OrdinalIgnoreCase);

    public string ResolveHostName() => IsLive ? "live.ctraderapi.com" : "demo.ctraderapi.com";
}

public sealed class RecorderSettings
{
    public string JournalDir { get; set; } = "../journal";
    public int SnapshotIntervalSeconds { get; set; } = 300;
}

public sealed class LoggingSettings
{
    public string Directory { get; set; } = "../logs";
    public string MinimumLevel { get; set; } = "Information";
}

public sealed class RecorderAppConfig
{
    public OpenApiConfig OpenApi { get; set; } = new();
    public RecorderSettings Recorder { get; set; } = new();
    public LoggingSettings Logging { get; set; } = new();
}
