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

            // 1. Ensure the target cBot instance is open in the editor.
            EnsureInstanceOpen(window, job);

            // 2. Switch to the Backtesting or Optimisation tab.
            var tabItemName = job.Type == JobType.Backtest ? "BacktestingTabItem" : "OptimisationTabItem";
            var tabItem = _uiMap.FindRequired(window, tabItemName);
            if (tabItem.Patterns.SelectionItem.IsSupported)
                tabItem.Patterns.SelectionItem.Pattern.Select();
            else
                tabItem.Click();
            Thread.Sleep(500);

            if (job.Type == JobType.Optimization)
                throw new NotSupportedException(
                    "Optimisation is not calibrated yet — the Optimisation tab wasn't captured in the first --inspect. " +
                    "Run --inspect with the Optimisation tab active and its Parameters dialog open, then this path can be wired up. " +
                    "Backtest jobs work now.");

            // 3. Backtesting settings popup (best-effort until re-inspected): starting capital, commission, data.
            ConfigureBacktestSettings(window, tabItem, job);

            // 4. Date range (dd/MM/yyyy) + turn Visual Mode off for speed.
            SetDateRange(tabItem, job.FromDate, job.ToDate);
            DisableVisualMode(tabItem);

            // 5. Fixed parameter values.
            SetFixedParameters(window, job.Parameters);

            // 6. Start and wait.
            Activate(_uiMap.FindRequired(tabItem, "StartButton"));
            _log.Information("Backtest started for job {JobId}; waiting for completion…", job.Id);
            WaitForCompletion(tabItem, TimeSpan.FromMinutes(RunTimeoutMinutes), job.Type);

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

    private void EnsureInstanceOpen(Window window, Job job)
    {
        // Primary, reliable path: a cBot editor is already open (its Backtesting tab exists).
        // We verify the loaded instance's symbol/timeframe against the job when they're provided.
        var openTab = _uiMap.Find(window, "BacktestingTabItem");
        if (openTab is not null)
        {
            var symbol = _uiMap.Find(window, "RealtimeSymbolText")?.AsLabel().Text;
            var timeframe = _uiMap.Find(window, "RealtimeTimeframeText")?.AsLabel().Text;
            _log.Information("Using the already-open cBot editor (symbol={Symbol}, timeframe={Timeframe}).", symbol, timeframe);

            if (!string.IsNullOrWhiteSpace(job.Symbol) && symbol is not null &&
                !symbol.Contains(job.Symbol, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"The open cBot is on '{symbol}', but job {job.Id} expects symbol '{job.Symbol}'. " +
                    $"Open the correct instance in cTrader, or correct the job's symbol.");

            if (!string.IsNullOrWhiteSpace(job.Timeframe) && timeframe is not null &&
                !string.Equals(timeframe, job.Timeframe, StringComparison.OrdinalIgnoreCase))
                _log.Warning("Open timeframe '{Open}' differs from job timeframe '{Job}'; proceeding with the open instance.", timeframe, job.Timeframe);

            return;
        }

        // Best-effort auto-open: filter the cBots list by name and open the single result.
        // (Bot names aren't exposed directly to UI Automation, so we drive the search box.)
        _log.Information("No cBot editor open; attempting to open '{Instance}' via the Algo search box.", job.InstanceName);
        _uiMap.Find(window, "AlgoTab")?.AsButton().Invoke();
        Thread.Sleep(500);

        var search = _uiMap.Find(window, "AlgoSearchField");
        if (search is not null && !string.IsNullOrWhiteSpace(job.InstanceName))
        {
            SetText(search, job.InstanceName);
            Thread.Sleep(1000);

            var list = _uiMap.Find(window, "AlgoInstancesList");
            var settingsButton = list?.FindFirstDescendant(cf => cf.ByAutomationId("SettingsButton_AId"));
            if (settingsButton is not null)
            {
                settingsButton.AsButton().Invoke();
                Thread.Sleep(1000);
                if (_uiMap.Find(window, "BacktestingTabItem") is not null) return;
            }
        }

        throw new InvalidOperationException(
            $"Could not open a cBot editor for '{job.InstanceName}'. As a reliable fallback, open the cBot manually in " +
            $"cTrader (Algo → click the instance) so its Backtesting tab is visible, then requeue the job. " +
            $"Auto-open by name is best-effort and may need calibration (docs/CALIBRATION.md).");
    }

    private void ConfigureBacktestSettings(Window window, AutomationElement tabItem, Job job)
    {
        // The settings popup wasn't captured in the first inspect, so driving it is gated off by
        // default (CTrader.DriveBacktestSettingsPopup in appsettings.json). Until it's calibrated,
        // the backtest runs over the correct date range using cTrader's current capital/commission.
        if (!_config.DriveBacktestSettingsPopup)
        {
            _log.Information("Skipping backtest settings popup (not calibrated yet); using cTrader's current starting capital / commission / data. Enable CTrader.DriveBacktestSettingsPopup once calibrated.");
            return;
        }

        try
        {
            var gear = _uiMap.Find(tabItem, "BacktestSettingsButton");
            if (gear is null)
            {
                _log.Warning("Backtest settings gear not found within the Backtesting tab; using cTrader's current values.");
                return;
            }
            Activate(gear);
            Thread.Sleep(500);

            var capital = _uiMap.Find(window, "StartingCapitalField");
            if (capital is not null) SetText(capital, job.StartingCapital.ToString(CultureInfo.InvariantCulture));
            else _log.Warning("Starting-capital field not found (settings popup not calibrated); leaving cTrader's current value.");

            var autoCommission = _uiMap.Find(window, "ApplyCommissionAutomaticallyCheckbox")?.AsCheckBox();
            if (autoCommission is not null && autoCommission.IsChecked != job.ApplyCommissionAutomatically)
                autoCommission.Click();

            if (!job.ApplyCommissionAutomatically)
            {
                var commissionField = _uiMap.Find(window, "CommissionField");
                if (commissionField is not null) SetText(commissionField, job.Commission.ToString(CultureInfo.InvariantCulture));
            }

            if (!string.IsNullOrWhiteSpace(job.DataMode))
                _uiMap.Find(window, "DataModeDropdown")?.AsComboBox().Select(job.DataMode);

            Activate(gear); // re-click to dismiss the popup
            Thread.Sleep(300);
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "Backtest settings popup could not be fully driven; continuing with cTrader's current settings.");
        }
    }

    private void SetDateRange(AutomationElement tabItem, DateOnly from, DateOnly to)
    {
        // cTrader shows dates as dd/MM/yyyy. The editable text box is a child of each DatePickerEx.
        var fromPicker = _uiMap.FindRequired(tabItem, "FromDatePicker");
        var toPicker = _uiMap.FindRequired(tabItem, "ToDatePicker");
        SetText(DatePickerTextBox(fromPicker), from.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture));
        SetText(DatePickerTextBox(toPicker), to.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture));
    }

    private AutomationElement DatePickerTextBox(AutomationElement picker)
        => _uiMap.Find(picker, "DatePickerTextBox")
           ?? picker.FindFirstDescendant(cf => cf.ByControlType(ControlType.Edit))
           ?? throw new InvalidOperationException("Date picker text box not found inside DatePickerEx.");

    private void DisableVisualMode(AutomationElement tabItem)
    {
        var el = _uiMap.Find(tabItem, "VisualModeCheckbox");
        if (el is null)
        {
            _log.Warning("Visual Mode checkbox not found; the backtest may run in (slow) visual mode.");
            return;
        }
        var visual = el.AsCheckBox();

        // cTrader's Visual Mode checkbox reacts to a real mouse click, NOT to the UIA Toggle/Invoke
        // pattern (the app handles the click event, not the bound property), so use a physical
        // Click(). Loop until it reads clearly off; `!= false` also handles an indeterminate read.
        for (var attempt = 0; attempt < 3 && visual.IsChecked != false; attempt++)
        {
            el.Click();
            Thread.Sleep(500);
        }

        if (visual.IsChecked == false)
            _log.Information("Visual Mode is off — backtest will run at full speed.");
        else
            _log.Warning("Could not confirm Visual Mode is off; the backtest may run slowly in visual mode.");
    }

    private void SetFixedParameters(Window window, Dictionary<string, double> parameters)
    {
        if (parameters.Count == 0) return;
        var panel = _uiMap.FindRequired(window, "ParametersPanel");

        // The Parameters panel is a FLAT ordered list: each label TextBlock is immediately followed
        // by its value control (Edit for numbers, ComboBox for enums). Walk the children in order.
        var children = panel.FindAllChildren();
        foreach (var (name, value) in parameters)
        {
            var labelIndex = Array.FindIndex(children, c =>
                SafeControlType(c) == ControlType.Text &&
                string.Equals(SafeName(c), name, StringComparison.OrdinalIgnoreCase));

            if (labelIndex < 0)
            {
                _log.Warning("Parameter '{Name}' not found in the Parameters panel; skipping.", name);
                continue;
            }

            var valueControl = children.Skip(labelIndex + 1)
                .FirstOrDefault(c => SafeControlType(c) is ControlType.Edit or ControlType.ComboBox);

            if (valueControl is null)
            {
                _log.Warning("No value control found after parameter '{Name}'; skipping.", name);
                continue;
            }

            var text = value.ToString(CultureInfo.InvariantCulture);
            if (SafeControlType(valueControl) == ControlType.ComboBox)
                valueControl.AsComboBox().Select(text);
            else
                SetText(valueControl, text);
        }
    }

    private void WaitForCompletion(AutomationElement tabItem, TimeSpan timeout, JobType type)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        var sawRunning = false;

        while (DateTime.UtcNow < deadline)
        {
            // The Start (Play) button is disabled while a run is in progress and re-enables when
            // it finishes. We first confirm we saw it disabled (run actually started), then treat
            // re-enabling as completion — this avoids returning instantly before the run spins up.
            var startButton = _uiMap.Find(tabItem, "StartButton")?.AsButton();
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

        var panel = _uiMap.Find(window, "BacktestReportPanel");
        if (panel is null)
        {
            _log.Warning("Backtest report panel not located; summary will be empty until BacktestReportPanel is calibrated (re-inspect after a completed run — docs/CALIBRATION.md).");
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

    // Some cTrader buttons don't expose the Invoke pattern (only respond to a real mouse click),
    // while others only expose Invoke. Try Invoke first, fall back to Click.
    private static void Activate(AutomationElement element)
    {
        if (element.Patterns.Invoke.IsSupported)
            element.Patterns.Invoke.Pattern.Invoke();
        else
            element.Click();
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

    // Some cTrader elements throw when a UIA property is unsupported (seen in the inspect dump),
    // so read ControlType/Name defensively.
    private static ControlType SafeControlType(AutomationElement element)
    {
        try { return element.ControlType; }
        catch { return ControlType.Custom; }
    }

    private static string SafeName(AutomationElement element)
    {
        try { return element.Name ?? ""; }
        catch { return ""; }
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
