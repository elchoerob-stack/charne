using System.Text.Json;

namespace CTraderAgent.Jobs;

public static class JobSerializer
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
    };

    public static Job LoadFromFile(string path)
    {
        var text = File.ReadAllText(path);
        var job = JsonSerializer.Deserialize<Job>(text, Options)
                   ?? throw new InvalidOperationException($"Job file '{path}' deserialized to null.");
        job.Validate();
        return job;
    }

    public static void SaveResult(JobResult result, string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(result, Options));
    }
}
