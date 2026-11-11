using System.Text.Json;
using Serilog;

namespace CTraderRecorder;

/// <summary>
/// Append-only trade/account journal. Each event is one JSON line in
/// journal/&lt;yyyy-MM-dd&gt;.jsonl, so the record is durable, greppable, and readable
/// by Claude for review. Nothing here places or modifies orders — it only records.
/// </summary>
public sealed class Journal
{
    private readonly string _dir;
    private readonly ILogger _log;
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private readonly object _lock = new();

    public Journal(string dir, ILogger log)
    {
        _dir = dir;
        _log = log;
        Directory.CreateDirectory(_dir);
    }

    public void Record(string eventType, object payload)
    {
        var entry = new
        {
            ts = DateTimeOffset.UtcNow.ToString("O"),
            type = eventType,
            data = payload
        };
        var line = JsonSerializer.Serialize(entry, Json);

        lock (_lock)
        {
            var file = Path.Combine(_dir, $"{DateTime.UtcNow:yyyy-MM-dd}.jsonl");
            File.AppendAllText(file, line + Environment.NewLine);
        }

        _log.Information("journal[{Type}] {Line}", eventType, line);
    }
}
