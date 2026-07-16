using CTraderAgent.Jobs;

namespace CTraderAgent.Automation;

public interface ICTraderDriver : IDisposable
{
    /// <summary>Launches cTrader if not running, or attaches to the existing instance.</summary>
    void EnsureRunning();

    /// <summary>Drives the full UI flow for one job and returns its result. Does not throw on run failure; failure is reported in JobResult.</summary>
    JobResult RunJob(Job job, string reportsDir);

    /// <summary>
    /// Dumps the UI Automation tree of every cTrader top-level window (main window + any open
    /// popups/dialogs) to a text file, for selector calibration. Waits <paramref name="delaySeconds"/>
    /// before dumping so you can arrange the UI (e.g. open the settings popup) first.
    /// </summary>
    void DumpUiTree(string outputPath, int delaySeconds = 0);
}
