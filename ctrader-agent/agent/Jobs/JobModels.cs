using System.Text.Json.Serialization;

namespace CTraderAgent.Jobs;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum JobType
{
    Backtest,
    Optimization
}

public sealed class ParameterRange
{
    public string Name { get; set; } = "";
    public double Min { get; set; }
    public double Max { get; set; }
    public double Step { get; set; }
}

/// <summary>
/// Unified job definition. For a Backtest job, use Parameters (fixed values).
/// For an Optimization job, use ParameterRanges instead.
/// </summary>
public sealed class Job
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public JobType Type { get; set; } = JobType.Backtest;
    public string BotName { get; set; } = "";
    public string Symbol { get; set; } = "";
    public string Timeframe { get; set; } = "";
    public DateOnly FromDate { get; set; }
    public DateOnly ToDate { get; set; }
    public decimal InitialBalance { get; set; } = 10000;
    public string SpreadModel { get; set; } = "Real";
    public decimal Commission { get; set; } = 0;

    // Backtest-only
    public Dictionary<string, double> Parameters { get; set; } = new();

    // Optimization-only
    public List<ParameterRange> ParameterRanges { get; set; } = new();
    public string OptimizationCriteria { get; set; } = "NetProfit";
    public int TopN { get; set; } = 10;

    public string ReportName { get; set; } = "";

    public void Validate()
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(BotName)) errors.Add("botName is required");
        if (string.IsNullOrWhiteSpace(Symbol)) errors.Add("symbol is required");
        if (string.IsNullOrWhiteSpace(Timeframe)) errors.Add("timeframe is required");
        if (FromDate == default) errors.Add("fromDate is required");
        if (ToDate == default) errors.Add("toDate is required");
        if (ToDate < FromDate) errors.Add("toDate must be on or after fromDate");
        if (Type == JobType.Optimization && ParameterRanges.Count == 0)
            errors.Add("optimization jobs require at least one entry in parameterRanges");
        foreach (var range in ParameterRanges)
        {
            if (range.Step <= 0) errors.Add($"parameterRanges['{range.Name}'].step must be > 0");
            if (range.Max < range.Min) errors.Add($"parameterRanges['{range.Name}'].max must be >= min");
        }

        if (errors.Count > 0)
            throw new InvalidOperationException($"Job '{Id}' failed validation: {string.Join("; ", errors)}");
    }
}

public sealed class JobResult
{
    public string JobId { get; set; } = "";
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset FinishedAt { get; set; }
    public string? RawReportPath { get; set; }
    public Dictionary<string, string> Summary { get; set; } = new();
    public List<Dictionary<string, string>> TopResults { get; set; } = new();
}
