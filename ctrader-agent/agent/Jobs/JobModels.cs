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

    /// <summary>
    /// For boolean/enum parameters that cTrader optimises over a value list instead of a
    /// numeric range (e.g. "Yes, No", or "LtfPullback, Breakout"). When set, Min/Max/Step
    /// are ignored and these values are entered into the parameter's value-list field.
    /// </summary>
    public List<string> Values { get; set; } = new();

    [JsonIgnore]
    public bool IsValueList => Values.Count > 0;
}

/// <summary>
/// A backtest or optimization job.
///
/// Symbol/timeframe model (cTrader 5.7): a backtest runs on whatever symbol+timeframe the
/// target cBot INSTANCE's chart is set to, so a Backtest job identifies an existing instance
/// (InstanceName) that is already configured for the symbol+timeframe you want — the agent
/// does not switch charts. Symbol/Timeframe here are informational (recorded in the report)
/// and used to sanity-check the instance where possible. For an Optimization job, timeframe(s)
/// ARE selectable in cTrader's Optimisation Parameters dialog, so OptimizationTimeframes is
/// applied there.
/// </summary>
public sealed class Job
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public JobType Type { get; set; } = JobType.Backtest;

    /// <summary>Display name of the cBot instance to open in the left cBots list (must match exactly).</summary>
    public string InstanceName { get; set; } = "";

    /// <summary>Informational: the symbol the target instance is on (recorded in the report).</summary>
    public string Symbol { get; set; } = "";

    /// <summary>Informational for backtests (instance's chart timeframe); for optimization see OptimizationTimeframes.</summary>
    public string Timeframe { get; set; } = "";

    public DateOnly FromDate { get; set; }
    public DateOnly ToDate { get; set; }

    // Backtesting settings dialog
    public decimal StartingCapital { get; set; } = 10000;
    public decimal Commission { get; set; } = 30;
    public bool ApplyCommissionAutomatically { get; set; } = true;
    /// <summary>Matches cTrader's Data dropdown, e.g. "Tick data from server (accurate)" or "m1 bars from server".</summary>
    public string DataMode { get; set; } = "Tick data from server (accurate)";

    // Backtest-only: fixed parameter values (name as shown in the Parameters panel, e.g. "EMA Fast").
    public Dictionary<string, double> Parameters { get; set; } = new();

    // Optimization-only
    public List<string> OptimizationTimeframes { get; set; } = new();
    public List<ParameterRange> ParameterRanges { get; set; } = new();
    public bool UseGeneticAlgorithm { get; set; } = false;
    /// <summary>Result column to rank passes by (e.g. "Net profit", "Profit factor", "Fitness").</summary>
    public string OptimizationCriteria { get; set; } = "Net profit";
    public int TopN { get; set; } = 10;

    public string ReportName { get; set; } = "";

    public void Validate()
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(InstanceName)) errors.Add("instanceName is required");
        if (FromDate == default) errors.Add("fromDate is required");
        if (ToDate == default) errors.Add("toDate is required");
        if (ToDate < FromDate) errors.Add("toDate must be on or after fromDate");
        if (StartingCapital <= 0) errors.Add("startingCapital must be > 0");

        if (Type == JobType.Optimization && ParameterRanges.Count == 0)
            errors.Add("optimization jobs require at least one entry in parameterRanges");

        foreach (var range in ParameterRanges)
        {
            if (string.IsNullOrWhiteSpace(range.Name)) errors.Add("every parameterRanges entry needs a name");
            if (range.IsValueList) continue; // value lists skip numeric checks
            if (range.Step <= 0) errors.Add($"parameterRanges['{range.Name}'].step must be > 0 (or provide a values list)");
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
