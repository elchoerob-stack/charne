using CTraderAgent.Jobs;
using Serilog;

namespace CTraderAgent.Automation;

/// <summary>
/// Logs every step a real run would take without touching cTrader at all.
/// Used to validate job files, queue mechanics, and reporting/notification
/// plumbing before pointing the agent at a live cTrader Automate instance.
/// </summary>
public sealed class DryRunCTraderDriver : ICTraderDriver
{
    private readonly ILogger _log;

    public DryRunCTraderDriver(ILogger log) => _log = log;

    public void EnsureRunning() => _log.Information("[dry-run] Would ensure cTrader is running.");

    public JobResult RunJob(Job job, string reportsDir)
    {
        _log.Information("[dry-run] Would run {Type} job {JobId} on instance '{Instance}' ({Symbol} {Timeframe}, {From:d} - {To:d}), starting capital {Capital}",
            job.Type, job.Id, job.InstanceName, job.Symbol, job.Timeframe,
            job.FromDate.ToDateTime(TimeOnly.MinValue), job.ToDate.ToDateTime(TimeOnly.MinValue), job.StartingCapital);

        if (job.Type == JobType.Backtest)
        {
            foreach (var (name, value) in job.Parameters)
                _log.Information("[dry-run]   parameter {Name} = {Value}", name, value);
        }
        else
        {
            foreach (var range in job.ParameterRanges)
            {
                if (range.IsValueList)
                    _log.Information("[dry-run]   parameter {Name} values [{Values}]", range.Name, string.Join(", ", range.Values));
                else
                    _log.Information("[dry-run]   parameter {Name} range {Min}..{Max} step {Step}", range.Name, range.Min, range.Max, range.Step);
            }
        }

        Directory.CreateDirectory(Path.Combine(reportsDir, job.Id));

        return new JobResult
        {
            JobId = job.Id,
            Success = true,
            StartedAt = DateTimeOffset.UtcNow,
            FinishedAt = DateTimeOffset.UtcNow,
            Summary = new Dictionary<string, string> { ["Note"] = "dry-run: no real backtest was executed" }
        };
    }

    public void DumpUiTree(string outputPath, int delaySeconds = 0)
        => _log.Warning("[dry-run] --inspect has no effect in dry-run mode; run without --dry-run to dump the real UI tree.");

    public void Dispose() { }
}
