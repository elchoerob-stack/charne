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

            // 1. Open the target cBot instance (already on the desired symbol+timeframe).
            OpenInstance(window, job.InstanceName);

            // 2. Switch to the Backtesting or Optimisation tab.
            var tabName = job.Type == JobType.Backtest ? "BacktestingTab" : "OptimisationTab";
            _uiMap.FindRequired(window, tabName).Click();

            // 3. Backtesting settings dialog: starting capital, commission, data mode.
            ConfigureBacktestSettings(window, job);

            // 4. Date range (dd/MM/yyyy) + turn Visual Mode off for speed.
            SetDateRange(window, job.FromDate, job.ToDate);
            DisableVisualMode(window);

            // 5. Parameters.
            if (job.Type == JobType.Backtest)
                SetFixedParameters(window, job.Parameters);
            else
                ConfigureOptimisation(window, job);

            // 6. Start and wait.
            _uiMap.FindRequired(window, "StartButton").AsButton().Invoke();
            WaitForCompletion(window, TimeSpan.FromMinutes(RunTimeoutMinutes), job.Type);

            // 7. Collect results.
            Directory.CreateDirectory(Path.Combine(reportsDir, job.Id));
            if (job.Type == JobType.Backtest)
            {
                result.Summary = ReadBacktestSummary(window);
            }
            else
            {
                result.TopResults = ReadTopOptimizationResults(window, job.TopN, job.OptimizationCriteria);
                if (result.TopResults.Count > 0)
                    result.Summary = new Dictionary<string, string>(result.TopResults[0]);
            }

            result.Success = true;
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

    private const int RunTimeoutMinutes = 180;

    private void OpenInstance(Window window, string instanceName)
    {
        // Make sure the Algo section (cBots list) is showing, then open the instance's editor.
        _uiMap.Find(window, "AlgoSidebarItem")?.Click();

        var row = _uiMap.Find(window, "CBotInstanceRow", new Dictionary<string, string> { ["instanceName"] = instanceName })
                  ?? throw new InvalidOperationException(
                      $"cBot instance '{instanceName}' was not found in the Algo cBots list. " +
                      $"Check spelling/casing, and that the instance exists on the symbol+timeframe you intend to test.");
        row.Click();
    }

    private void ConfigureBacktestSettings(Window window, Job job)
    {
        // Open the Backtesting settings popup (gear icon).
        _uiMap.FindRequired(window, "BacktestSettingsButton").AsButton().Invoke();

        SetText(_uiMap.FindRequired(window, "StartingCapitalField"), job.StartingCapital.ToString(CultureInfo.InvariantCulture));

        var autoCommission = _uiMap.Find(window, "ApplyCommissionAutomaticallyCheckbox")?.AsCheckBox();
        if (autoCommission is not null)
            autoCommission.IsChecked = job.ApplyCommissionAutomatically;

        if (!job.ApplyCommissionAutomatically)
        {
            var commissionField = _uiMap.Find(window, "CommissionField");
            if (commissionField is not null)
                SetText(commissionField, job.Commission.ToString(CultureInfo.InvariantCulture));
        }

        if (!string.IsNullOrWhiteSpace(job.DataMode))
            _uiMap.Find(window, "DataModeDropdown")?.AsComboBox().Select(job.DataMode);

        // Dismiss the popup (explicit close if mapped, otherwise clicking the tab again closes it).
        var close = _uiMap.Find(window, "SettingsDialogCloseButton");
        if (close is not null) close.AsButton().Invoke();
        else _uiMap.Find(window, "BacktestSettingsButton")?.AsButton().Invoke();
    }

    private void SetDateRange(Window window, DateOnly from, DateOnly to)
    {
        // cTrader shows dates as dd/MM/yyyy.
        SetText(_uiMap.FindRequired(window, "FromDatePicker"), from.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture));
        SetText(_uiMap.FindRequired(window, "ToDatePicker"), to.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture));
    }

    private void DisableVisualMode(Window window)
    {
        var visual = _uiMap.Find(window, "VisualModeCheckbox")?.AsCheckBox();
        if (visual is not null) visual.IsChecked = false;
    }

    private void SetFixedParameters(Window window, Dictionary<string, double> parameters)
    {
        if (parameters.Count == 0) return;
        var panel = _uiMap.FindRequired(window, "ParametersPanel");
        foreach (var (name, value) in parameters)
        {
            var row = _uiMap.Find(panel, "ParameterRow", new Dictionary<string, string> { ["parameterName"] = name });
            if (row is null)
            {
                _log.Warning("Parameter '{Name}' not found on the Parameters panel; skipping.", name);
                continue;
            }
            var valueBox = row.FindFirstDescendant(cf => cf.ByControlType(ControlType.Edit));
            if (valueBox is not null) SetText(valueBox, value.ToString(CultureInfo.InvariantCulture));
        }
    }

    private void ConfigureOptimisation(Window window, Job job)
    {
        // Optional Genetic Algorithm mode.
        if (job.UseGeneticAlgorithm)
            _uiMap.Find(window, "GeneticAlgorithmButton")?.AsButton().Invoke();

        // Open the Optimisation Parameters dialog (sliders icon) that holds the ranges + timeframe.
        _uiMap.FindRequired(window, "OptimisationParamsButton").AsButton().Invoke();

        if (job.OptimizationTimeframes.Count > 0)
        {
            var tfField = _uiMap.Find(window, "OptTimeframeField");
            if (tfField is not null) SetText(tfField, string.Join("; ", job.OptimizationTimeframes));
        }

        foreach (var range in job.ParameterRanges)
        {
            var row = _uiMap.Find(window, "OptParameterRow", new Dictionary<string, string> { ["parameterName"] = range.Name });
            if (row is null)
            {
                _log.Warning("Parameter '{Name}' not found in the Optimisation Parameters dialog; skipping.", range.Name);
                continue;
            }

            // Tick the include checkbox for this parameter.
            var enableCheckbox = row.FindFirstDescendant(cf => cf.ByControlType(ControlType.CheckBox));
            if (enableCheckbox is not null) enableCheckbox.AsCheckBox().IsChecked = true;

            var editBoxes = row.FindAllDescendants(cf => cf.ByControlType(ControlType.Edit));
            if (range.IsValueList)
            {
                // Boolean/enum parameter: a single value-list field, e.g. "Yes, No".
                if (editBoxes.Length >= 1) SetText(editBoxes[0], string.Join(", ", range.Values));
                else _log.Warning("Expected a value-list field for parameter '{Name}', found none.", range.Name);
            }
            else if (editBoxes.Length >= 3)
            {
                // Numeric parameter: Min / Max / Step, in that left-to-right order.
                SetText(editBoxes[0], range.Min.ToString(CultureInfo.InvariantCulture));
                SetText(editBoxes[1], range.Max.ToString(CultureInfo.InvariantCulture));
                SetText(editBoxes[2], range.Step.ToString(CultureInfo.InvariantCulture));
            }
            else
            {
                _log.Warning("Expected 3 fields (Min/Max/Step) for numeric parameter '{Name}', found {Count}.", range.Name, editBoxes.Length);
            }
        }

        // Close the Parameters dialog by re-clicking the button that opened it.
        _uiMap.Find(window, "OptimisationParamsButton")?.AsButton().Invoke();
    }

    private void WaitForCompletion(Window window, TimeSpan timeout, JobType type)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        var sawRunning = false;

        while (DateTime.UtcNow < deadline)
        {
            // The Start (Play) button is disabled while a run is in progress and re-enables when
            // it finishes. We first confirm we saw it disabled (run actually started), then treat
            // re-enabling as completion — this avoids returning instantly before the run spins up.
            var startButton = _uiMap.Find(window, "StartButton")?.AsButton();
            if (startButton is not null)
            {
                if (!startButton.IsEnabled) sawRunning = true;
                else if (sawRunning) return;
            }

            Thread.Sleep(2000);
        }

        throw new TimeoutException($"{type} run did not complete within {timeout.TotalMinutes} minutes.");
    }

    private Dictionary<string, string> ReadBacktestSummary(Window window)
    {
        var summary = new Dictionary<string, string>();

        // Open the backtest report if there's a dedicated button for it.
        _uiMap.Find(window, "BacktestReportButton")?.AsButton().Invoke();

        var panel = _uiMap.Find(window, "BacktestReportPanel");
        if (panel is null)
        {
            _log.Warning("Backtest report panel not located; summary will be empty until BacktestReportPanel is calibrated (docs/CALIBRATION.md).");
            return summary;
        }

        // The report shows "Label: value" style text runs (Net profit, Profit factor, Max drawdown, etc).
        foreach (var label in panel.FindAllDescendants(cf => cf.ByControlType(ControlType.Text)))
        {
            var text = label.AsLabel().Text;
            if (string.IsNullOrWhiteSpace(text) || !text.Contains(':')) continue;
            var parts = text.Split(':', 2);
            summary[parts[0].Trim()] = parts[1].Trim();
        }
        return summary;
    }

    private List<Dictionary<string, string>> ReadTopOptimizationResults(Window window, int topN, string criteria)
    {
        var results = new List<Dictionary<string, string>>();
        var grid = _uiMap.Find(window, "OptimizationResultsGrid");
        if (grid is null)
        {
            _log.Warning("Optimisation results grid not located; top results will be empty until OptimisationResultsGrid is calibrated (docs/CALIBRATION.md).");
            return results;
        }

        var dataGrid = grid.AsGrid();
        var header = dataGrid.Header;
        if (header is null)
        {
            _log.Warning("Optimisation results grid has no readable header; cannot map columns. Calibrate OptimisationResultsGrid (docs/CALIBRATION.md).");
            return results;
        }
        var headers = header.Columns.Select(h => h.Text).ToArray();
        foreach (var row in dataGrid.Rows)
        {
            var rowDict = new Dictionary<string, string>();
            for (var i = 0; i < headers.Length && i < row.Cells.Length; i++)
                rowDict[headers[i]] = row.Cells[i].Value ?? "";
            results.Add(rowDict);
        }

        // Rank by the requested criteria column (descending) when present, then take top N.
        var criteriaColumn = headers.FirstOrDefault(h => string.Equals(h, criteria, StringComparison.OrdinalIgnoreCase));
        if (criteriaColumn is not null)
        {
            results = results
                .OrderByDescending(r => ParseNumber(r.GetValueOrDefault(criteriaColumn, "")))
                .ToList();
        }

        return results.Take(topN).ToList();
    }

    private static double ParseNumber(string s)
    {
        // Strip currency symbols, spaces and thousands separators before parsing.
        var cleaned = new string(s.Where(c => char.IsDigit(c) || c is '.' or '-').ToArray());
        return double.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : double.MinValue;
    }

    private static void SetText(AutomationElement element, string value)
    {
        // Prefer the ValuePattern (reliable for text fields); fall back to focus + type.
        if (element.Patterns.Value.IsSupported)
        {
            element.Patterns.Value.Pattern.SetValue(value);
            return;
        }
        element.AsTextBox().Text = value;
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
