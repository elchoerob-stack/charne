using System.Text.Json;
using CTraderAgent.Automation;
using CTraderAgent.Config;
using CTraderAgent.Jobs;
using CTraderAgent.Queue;
using CTraderAgent.Reporting;
using Serilog;

var baseDir = AppContext.BaseDirectory;
var config = LoadConfig(Path.Combine(baseDir, "appsettings.json"));

// Data paths are resolved against the current working directory (not the build
// output folder, which is nested several levels under agent/bin/<Config>/<TFM>/)
// so the default "../jobs" / "../reports" / "../logs" in appsettings.json land in
// ctrader-agent/jobs, ctrader-agent/reports, ctrader-agent/logs as long as you run
// from the agent/ folder, per docs/SETUP.md. Only appsettings.json/uimap.json
// themselves are loaded relative to the executable (baseDir), since the build
// copies them next to it.
var workingDir = Directory.GetCurrentDirectory();
var logsRoot = Path.GetFullPath(Path.Combine(workingDir, config.Logging.Directory));
Directory.CreateDirectory(logsRoot);
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Is(Enum.Parse<Serilog.Events.LogEventLevel>(config.Logging.MinimumLevel))
    .WriteTo.Console()
    .WriteTo.File(
        Path.Combine(logsRoot, "agent-.log"),
        rollingInterval: RollingInterval.Day)
    .CreateLogger();

var watch = args.Contains("--watch");
var runOnce = args.Contains("--run-once");
var dryRun = args.Contains("--dry-run");
var inspect = args.Contains("--inspect");
var inspectDelaySeconds = ParseDelaySeconds(args);

var jobsRoot = Path.GetFullPath(Path.Combine(workingDir, config.Agent.JobsRoot));
var reportsRoot = Path.GetFullPath(Path.Combine(workingDir, config.Agent.ReportsRoot));
Directory.CreateDirectory(jobsRoot);
Directory.CreateDirectory(reportsRoot);

var uiMap = UiMap.LoadFromFile(Path.Combine(baseDir, "uimap.json"));
ICTraderDriver driver = dryRun
    ? new DryRunCTraderDriver(Log.Logger)
    : new CTraderDriver(config.CTrader, uiMap, Log.Logger);

var notifier = new Notifier(config.Notifications, Log.Logger);
var queue = new FileJobQueue(jobsRoot, Log.Logger);

try
{
    if (inspect)
    {
        driver.EnsureRunning();
        var outPath = Path.Combine(logsRoot, $"ui-tree-{DateTime.UtcNow:yyyyMMddHHmmss}.txt");
        driver.DumpUiTree(outPath, inspectDelaySeconds);
        Log.Information("Done. Open {Path} to find real Name/AutomationId/ClassName values for uimap.json.", outPath);
        return 0;
    }

    if (!watch && !runOnce)
    {
        Log.Information("No mode flag given. Use one of: --watch, --run-once, --inspect (add --dry-run to any of them to simulate without touching cTrader).");
        return 1;
    }

    driver.EnsureRunning();

    var consecutiveFailures = 0;
    do
    {
        var claimed = queue.ClaimNext();
        if (claimed is null)
        {
            if (runOnce)
            {
                Log.Information("No pending jobs.");
                break;
            }
            Thread.Sleep(TimeSpan.FromSeconds(config.Agent.PollIntervalSeconds));
            continue;
        }

        var (filePath, job) = claimed.Value;
        Log.Information("Processing job {JobId} ({Type}) from {File}", job.Id, job.Type, filePath);

        var result = driver.RunJob(job, reportsRoot);
        JobSerializer.SaveResult(result, Path.Combine(reportsRoot, job.Id, "result.json"));
        ReportWriter.WriteSummaryMarkdown(job, result, reportsRoot);
        await notifier.NotifyAsync(job, result);

        if (result.Success)
        {
            queue.MarkDone(filePath);
            consecutiveFailures = 0;
            Log.Information("Job {JobId} completed successfully.", job.Id);
        }
        else
        {
            queue.MarkFailed(filePath);
            consecutiveFailures++;
            Log.Error("Job {JobId} failed: {Error}", job.Id, result.ErrorMessage);

            if (consecutiveFailures >= config.Agent.MaxConsecutiveFailuresBeforePause)
            {
                Log.Error(
                    "{Count} consecutive failures — pausing watch loop. Check cTrader/uimap.json calibration before restarting.",
                    consecutiveFailures);
                break;
            }
        }
    } while (watch);

    return 0;
}
finally
{
    driver.Dispose();
    Log.CloseAndFlush();
}

static AppConfig LoadConfig(string path)
{
    var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
    var text = File.ReadAllText(path);
    return JsonSerializer.Deserialize<AppConfig>(text, options)
           ?? throw new InvalidOperationException($"Failed to load config from '{path}'.");
}

// Parses `--delay <seconds>` or `--delay=<seconds>` from the CLI (used with --inspect).
static int ParseDelaySeconds(string[] args)
{
    for (var i = 0; i < args.Length; i++)
    {
        if (args[i].StartsWith("--delay=", StringComparison.Ordinal) &&
            int.TryParse(args[i]["--delay=".Length..], out var inline))
            return Math.Max(0, inline);

        if (args[i] == "--delay" && i + 1 < args.Length && int.TryParse(args[i + 1], out var next))
            return Math.Max(0, next);
    }
    return 0;
}
