using CTraderAgent.Jobs;

namespace CTraderAgent.Automation;

public interface ICTraderDriver : IDisposable
{
    /// <summary>Launches cTrader if not running, or attaches to the existing instance.</summary>
    void EnsureRunning();

    /// <summary>Drives the full UI flow for one job and returns its result. Does not throw on run failure; failure is reported in JobResult.</summary>
    JobResult RunJob(Job job, string reportsDir);

    /// <summary>Dumps the current UI Automation tree of the cTrader window to a text file, for selector calibration.</summary>
    void DumpUiTree(string outputPath);
}
