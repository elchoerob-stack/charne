using System.Diagnostics;
using System.Globalization;
using CTraderAgent.Config;
using CTraderAgent.Jobs;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.UIA3;
using Serilog;

namespace CTraderAgent.Automation;

/// <summary>
/// Drives the real cTrader Automate desktop UI via Windows UI Automation (FlaUI/UIA3).
/// Requires an interactive Windows desktop session — this cannot run as a headless
/// SYSTEM service. See docs/SETUP.md.
/// </summary>
public sealed class CTraderDriver : ICTraderDriver
{
    private readonly CTraderConfig _config;
    private readonly UiMap _uiMap;
    private readonly ILogger _log;
    private UIA3Automation? _automation;
    private Application? _app;

    public CTraderDriver(CTraderConfig config, UiMap uiMap, ILogger log)
    {
        _config = config;
        _uiMap = uiMap;
        _log = log;
    }

    public void EnsureRunning()
    {
        _automation ??= new UIA3Automation();

        if (_config.AttachIfAlreadyRunning)
        {
            var existing = Process.GetProcessesByName(_config.ProcessName).FirstOrDefault();
            if (existing is not null)
            {
                _log.Information("Attaching to existing cTrader process (PID {Pid})", existing.Id);
                _app = Application.Attach(existing);
                return;
            }
        }

        if (!File.Exists(_config.ExecutablePath))
            throw new FileNotFoundException(
                $"cTrader executable not found at '{_config.ExecutablePath}'. Update CTrader.ExecutablePath in appsettings.json.");

        _log.Information("Launching cTrader from {Path}", _config.ExecutablePath);
        _app = Application.Launch(_config.ExecutablePath);

        var deadline = DateTime.UtcNow.AddSeconds(_config.StartupTimeoutSeconds);
        while (DateTime.UtcNow < deadline)
        {
            if (GetMainWindowOrNull() is not null) return;
            Thread.Sleep(1000);
        }

        throw new TimeoutException($"cTrader did not present a main window within {_config.StartupTimeoutSeconds}s of launch.");
    }

    public JobResult RunJob(Job job, string reportsDir)
    {
        var result = new JobResult { JobId = job.Id, StartedAt = DateTimeOffset.UtcNow };
        try
        {
            var window = GetMainWindow();

            _uiMap.FindRequired(window, "AutomateTab").AsButton().Invoke();
            SelectBot(window, job.BotName);

            var panelName = job.Type == JobType.Backtest ? "BacktestingSubTab" : "OptimizationSubTab";
            _uiMap.FindRequired(window, panelName).AsButton().Invoke();

            ConfigureCommonSettings(window, job);

            if (job.Type == JobType.Backtest)
                SetFixedParameters(window, job.Parameters);
            else
                SetParameterRanges(window, job.ParameterRanges, job.OptimizationCriteria);

            _uiMap.FindRequired(window, "StartButton").AsButton().Invoke();
            WaitForCompletion(window, TimeSpan.FromMinutes(180));

            Directory.CreateDirectory(reportsDir);
            var exportPath = ExportReport(window, job, reportsDir);

            result.Success = true;
            result.RawReportPath = exportPath;
            result.Summary = ReadSummaryFromResultsPanel(window, job.Type);
            if (job.Type == JobType.Optimization)
                result.TopResults = ReadTopOptimizationResults(window, job.TopN);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Job {JobId} failed", job.Id);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }
        finally
        {
            result.FinishedAt = DateTimeOffset.UtcNow;
        }

        return result;
    }

    public void DumpUiTree(string outputPath)
    {
        var window = GetMainWindow();
        using var writer = new StreamWriter(outputPath);
        WriteElementTree(window, writer, 0);
        _log.Information("UI tree dumped to {Path}", outputPath);
    }

    // ── internals ──────────────────────────────────────────────────────────

    private Window GetMainWindow()
        => GetMainWindowOrNull() ?? throw new InvalidOperationException("cTrader main window not found. Call EnsureRunning() first.");

    private Window? GetMainWindowOrNull()
    {
        if (_app is null || _automation is null) return null;
        try
        {
            return _app.GetMainWindow(_automation);
        }
        catch
        {
            return null;
        }
    }

    private void SelectBot(Window window, string botName)
    {
        var list = _uiMap.FindRequired(window, "BotList");
        var item = _uiMap.Find(list, "BotListItem", new Dictionary<string, string> { ["botName"] = botName })
                   ?? throw new InvalidOperationException(
                       $"cBot '{botName}' was not found in the Automate bot list. Check spelling/casing, and that it's loaded in cTrader Automate.");
        item.Click();
    }

    private void ConfigureCommonSettings(Window window, Job job)
    {
        _uiMap.FindRequired(window, "SymbolDropdown").AsComboBox().Select(job.Symbol);
        _uiMap.FindRequired(window, "TimeframeDropdown").AsComboBox().Select(job.Timeframe);
        _uiMap.FindRequired(window, "FromDatePicker").Patterns.Value.Pattern.SetValue(
            job.FromDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        _uiMap.FindRequired(window, "ToDatePicker").Patterns.Value.Pattern.SetValue(
            job.ToDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        _uiMap.FindRequired(window, "InitialBalanceField").AsTextBox().Text = job.InitialBalance.ToString(CultureInfo.InvariantCulture);
        var spreadDropdown = _uiMap.Find(window, "SpreadModeDropdown");
        spreadDropdown?.AsComboBox().Select(job.SpreadModel);
    }

    private void SetFixedParameters(Window window, Dictionary<string, double> parameters)
    {
        var grid = _uiMap.FindRequired(window, "ParametersGrid");
        foreach (var (name, value) in parameters)
        {
            var row = _uiMap.Find(grid, "ParameterRow", new Dictionary<string, string> { ["parameterName"] = name });
            if (row is null)
            {
                _log.Warning("Parameter '{Name}' not found on cBot's parameters grid; skipping.", name);
                continue;
            }
            var valueBox = row.FindFirstDescendant(cf => cf.ByControlType(ControlType.Edit));
            if (valueBox is not null) valueBox.AsTextBox().Text = value.ToString(CultureInfo.InvariantCulture);
        }
    }

    private void SetParameterRanges(Window window, List<ParameterRange> ranges, string optimizationCriteria)
    {
        var grid = _uiMap.FindRequired(window, "ParametersGrid");
        foreach (var range in ranges)
        {
            var row = _uiMap.Find(grid, "ParameterRow", new Dictionary<string, string> { ["parameterName"] = range.Name });
            if (row is null)
            {
                _log.Warning("Parameter '{Name}' not found on cBot's parameters grid; skipping.", range.Name);
                continue;
            }

            var enableCheckbox = row.FindFirstDescendant(cf => cf.ByControlType(ControlType.CheckBox));
            enableCheckbox?.AsCheckBox().IsChecked = true;

            var editBoxes = row.FindAllDescendants(cf => cf.ByControlType(ControlType.Edit));
            // Convention (calibrate in docs/CALIBRATION.md if your cTrader version orders these differently):
            // editBoxes[0] = Min, editBoxes[1] = Max, editBoxes[2] = Step
            if (editBoxes.Length >= 3)
            {
                editBoxes[0].AsTextBox().Text = range.Min.ToString(CultureInfo.InvariantCulture);
                editBoxes[1].AsTextBox().Text = range.Max.ToString(CultureInfo.InvariantCulture);
                editBoxes[2].AsTextBox().Text = range.Step.ToString(CultureInfo.InvariantCulture);
            }
            else
            {
                _log.Warning("Expected 3 editable fields (min/max/step) for parameter '{Name}', found {Count}.", range.Name, editBoxes.Length);
            }
        }

        var criteriaDropdown = _uiMap.Find(window, "OptimizationCriteriaDropdown");
        criteriaDropdown?.AsComboBox().Select(optimizationCriteria);
    }

    private void WaitForCompletion(Window window, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            var status = _uiMap.Find(window, "StatusText")?.AsLabel().Text;
            if (status is not null &&
                (status.Contains("Completed", StringComparison.OrdinalIgnoreCase) ||
                 status.Contains("Finished", StringComparison.OrdinalIgnoreCase)))
                return;

            if (status is not null && status.Contains("Error", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"cTrader reported an error status: '{status}'");

            var startButton = _uiMap.Find(window, "StartButton");
            if (startButton is not null && startButton.AsButton().IsEnabled)
            {
                // Start button re-enabling is our fallback completion signal if StatusText isn't found/mapped correctly.
                return;
            }

            Thread.Sleep(2000);
        }

        throw new TimeoutException($"Backtest/optimization run did not complete within {timeout.TotalMinutes} minutes.");
    }

    private string ExportReport(Window window, Job job, string reportsDir)
    {
        var jobReportDir = Path.Combine(reportsDir, job.Id);
        Directory.CreateDirectory(jobReportDir);

        var exportButton = _uiMap.Find(window, "ExportButton");
        exportButton?.AsButton().Invoke();

        // NOTE: cTrader's native export dialog is a separate OS file-save dialog which
        // requires its own selector calibration (path field + save button) once you've
        // confirmed the export button's exact behavior on your version. Tracked in
        // docs/CALIBRATION.md — until calibrated, this records that export was requested.
        var marker = Path.Combine(jobReportDir, "export-requested.txt");
        File.WriteAllText(marker, $"Export requested at {DateTimeOffset.UtcNow:O} for job {job.Id}.");
        return marker;
    }

    private Dictionary<string, string> ReadSummaryFromResultsPanel(Window window, JobType type)
    {
        var summary = new Dictionary<string, string>();
        var panel = _uiMap.Find(window, "ResultsPanel");
        if (panel is null) return summary;

        foreach (var label in panel.FindAllDescendants(cf => cf.ByControlType(ControlType.Text)))
        {
            var text = label.AsLabel().Text;
            if (string.IsNullOrWhiteSpace(text) || !text.Contains(':')) continue;
            var parts = text.Split(':', 2);
            summary[parts[0].Trim()] = parts[1].Trim();
        }
        return summary;
    }

    private List<Dictionary<string, string>> ReadTopOptimizationResults(Window window, int topN)
    {
        var results = new List<Dictionary<string, string>>();
        var grid = _uiMap.Find(window, "OptimizationResultsGrid");
        if (grid is null) return results;

        var dataGrid = grid.AsGrid();
        var headers = dataGrid.Header.Columns.Select(h => h.Text).ToArray();
        var rows = dataGrid.Rows.Take(topN);
        foreach (var row in rows)
        {
            var rowDict = new Dictionary<string, string>();
            for (var i = 0; i < headers.Length && i < row.Cells.Length; i++)
                rowDict[headers[i]] = row.Cells[i].Value ?? "";
            results.Add(rowDict);
        }
        return results;
    }

    private static void WriteElementTree(AutomationElement element, StreamWriter writer, int depth)
    {
        try
        {
            var indent = new string(' ', depth * 2);
            writer.WriteLine($"{indent}[{element.ControlType}] Name='{element.Name}' AutomationId='{element.AutomationId}' ClassName='{element.ClassName}'");
            foreach (var child in element.FindAllChildren())
                WriteElementTree(child, writer, depth + 1);
        }
        catch (Exception ex)
        {
            writer.WriteLine($"{new string(' ', depth * 2)}<error reading element: {ex.Message}>");
        }
    }

    public void Dispose()
    {
        _automation?.Dispose();
    }
}
