using System.Text;
using CTraderAgent.Jobs;

namespace CTraderAgent.Reporting;

public static class ReportWriter
{
    public static string WriteSummaryMarkdown(Job job, JobResult result, string reportsDir)
    {
        var dir = Path.Combine(reportsDir, job.Id);
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "summary.md");

        var sb = new StringBuilder();
        sb.AppendLine($"# {job.Type} — {job.InstanceName} ({job.Symbol} {job.Timeframe})");
        sb.AppendLine();
        sb.AppendLine($"- Job ID: `{job.Id}`");
        sb.AppendLine($"- Range: {job.FromDate:yyyy-MM-dd} to {job.ToDate:yyyy-MM-dd}");
        sb.AppendLine($"- Starting capital: {job.StartingCapital}");
        sb.AppendLine($"- Started: {result.StartedAt:u}");
        sb.AppendLine($"- Finished: {result.FinishedAt:u}");
        sb.AppendLine($"- Result: {(result.Success ? "SUCCESS" : "FAILED")}");
        if (!result.Success)
            sb.AppendLine($"- Error: {result.ErrorMessage}");
        sb.AppendLine();

        if (result.Summary.Count > 0)
        {
            sb.AppendLine("## Summary");
            sb.AppendLine();
            sb.AppendLine("| Metric | Value |");
            sb.AppendLine("|---|---|");
            foreach (var (k, v) in result.Summary)
                sb.AppendLine($"| {k} | {v} |");
            sb.AppendLine();
        }

        if (result.TopResults.Count > 0)
        {
            sb.AppendLine($"## Top {result.TopResults.Count} optimization results");
            sb.AppendLine();
            var headers = result.TopResults[0].Keys.ToList();
            sb.AppendLine("| " + string.Join(" | ", headers) + " |");
            sb.AppendLine("|" + string.Join("|", headers.Select(_ => "---")) + "|");
            foreach (var row in result.TopResults)
                sb.AppendLine("| " + string.Join(" | ", headers.Select(h => row.GetValueOrDefault(h, ""))) + " |");
        }

        File.WriteAllText(path, sb.ToString());
        return path;
    }
}
