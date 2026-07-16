using CTraderAgent.Jobs;
using Serilog;

namespace CTraderAgent.Queue;

/// <summary>
/// Folder-based queue: jobs/pending -> jobs/processing -> jobs/done | jobs/failed.
/// Deliberately simple (no DB, no locking service) since exactly one agent instance
/// is expected to run per machine, driving one interactive cTrader Automate session.
/// </summary>
public sealed class FileJobQueue
{
    private readonly string _pending;
    private readonly string _processing;
    private readonly string _done;
    private readonly string _failed;
    private readonly ILogger _log;

    public FileJobQueue(string jobsRoot, ILogger log)
    {
        _log = log;
        _pending = Path.Combine(jobsRoot, "pending");
        _processing = Path.Combine(jobsRoot, "processing");
        _done = Path.Combine(jobsRoot, "done");
        _failed = Path.Combine(jobsRoot, "failed");
        foreach (var dir in new[] { _pending, _processing, _done, _failed })
            Directory.CreateDirectory(dir);
    }

    /// <summary>Claims the oldest pending job by moving it into processing/, or null if none waiting.</summary>
    public (string filePath, Job job)? ClaimNext()
    {
        var candidate = Directory.EnumerateFiles(_pending, "*.json")
            .OrderBy(File.GetCreationTimeUtc)
            .FirstOrDefault();

        if (candidate is null) return null;

        var claimedPath = Path.Combine(_processing, Path.GetFileName(candidate));
        try
        {
            File.Move(candidate, claimedPath, overwrite: false);
        }
        catch (IOException)
        {
            // Lost a race (or file was mid-write). Skip this tick, try again next poll.
            return null;
        }

        Job job;
        try
        {
            job = JobSerializer.LoadFromFile(claimedPath);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Failed to parse job file {File}, moving to failed/", claimedPath);
            MoveTo(claimedPath, _failed);
            return null;
        }

        return (claimedPath, job);
    }

    public void MarkDone(string processingFilePath) => MoveTo(processingFilePath, _done);

    public void MarkFailed(string processingFilePath) => MoveTo(processingFilePath, _failed);

    private static void MoveTo(string filePath, string targetDir)
    {
        var dest = Path.Combine(targetDir, Path.GetFileName(filePath));
        if (File.Exists(dest))
            dest = Path.Combine(targetDir, $"{Path.GetFileNameWithoutExtension(filePath)}-{DateTime.UtcNow:yyyyMMddHHmmss}.json");
        File.Move(filePath, dest, overwrite: false);
    }
}
