using System.Text.Json;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Conditions;
using FlaUI.Core.Definitions;

namespace CTraderAgent.Automation;

public sealed class UiStrategy
{
    public string By { get; set; } = "Name"; // Name | AutomationId | ClassName
    public string Value { get; set; } = "";
}

public sealed class UiElementDef
{
    public string Description { get; set; } = "";
    public List<UiStrategy> Strategies { get; set; } = new();
}

/// <summary>
/// Loads agent/uimap.json and resolves elements against a FlaUI ConditionFactory.
/// Keeping every selector data-driven means recalibrating against a new cTrader
/// version is a JSON edit, not a code change/recompile.
/// </summary>
public sealed class UiMap
{
    private readonly Dictionary<string, UiElementDef> _elements;

    private UiMap(Dictionary<string, UiElementDef> elements) => _elements = elements;

    public static UiMap LoadFromFile(string path)
    {
        var doc = JsonDocument.Parse(File.ReadAllText(path));
        var elements = new Dictionary<string, UiElementDef>();
        foreach (var prop in doc.RootElement.GetProperty("elements").EnumerateObject())
        {
            var def = new UiElementDef
            {
                Description = prop.Value.TryGetProperty("description", out var d) ? d.GetString() ?? "" : ""
            };
            foreach (var s in prop.Value.GetProperty("strategies").EnumerateArray())
            {
                def.Strategies.Add(new UiStrategy
                {
                    By = s.GetProperty("by").GetString() ?? "Name",
                    Value = s.GetProperty("value").GetString() ?? ""
                });
            }
            elements[prop.Name] = def;
        }
        return new UiMap(elements);
    }

    /// <summary>
    /// Finds an element by its logical name (e.g. "StartButton"). Placeholders like
    /// {botName} in the configured value are substituted from <paramref name="substitutions"/>.
    /// Tries each configured strategy in order, first match wins.
    /// </summary>
    public AutomationElement? Find(AutomationElement root, string logicalName, IReadOnlyDictionary<string, string>? substitutions = null)
    {
        if (!_elements.TryGetValue(logicalName, out var def))
            throw new KeyNotFoundException($"uimap.json has no element named '{logicalName}'.");

        foreach (var strategy in def.Strategies)
        {
            var value = Substitute(strategy.Value, substitutions);
            var cf = root.ConditionFactory;
            Condition condition = strategy.By switch
            {
                "AutomationId" => cf.ByAutomationId(value),
                "ClassName" => cf.ByClassName(value),
                _ => cf.ByName(value)
            };

            var found = root.FindFirstDescendant(condition);
            if (found is not null) return found;
        }

        return null;
    }

    public AutomationElement FindRequired(AutomationElement root, string logicalName, IReadOnlyDictionary<string, string>? substitutions = null)
    {
        return Find(root, logicalName, substitutions)
               ?? throw new InvalidOperationException(
                   $"Could not locate UI element '{logicalName}' ({_elements[logicalName].Description}). " +
                   $"Run `dotnet run -- --inspect` and update uimap.json — see docs/CALIBRATION.md.");
    }

    private static string Substitute(string template, IReadOnlyDictionary<string, string>? substitutions)
    {
        if (substitutions is null) return template;
        foreach (var (key, value) in substitutions)
            template = template.Replace("{" + key + "}", value);
        return template;
    }
}
