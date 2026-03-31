using System.Text;
using System.Text.Json;
using RaportDependencies.Api.Models;

namespace RaportDependencies.Api.Services;

public sealed class DependencyExportService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public string ToJson(DependencyGraphResponse graph)
        => JsonSerializer.Serialize(graph, JsonOptions);

    public string ToCsv(DependencyGraphResponse graph)
    {
        var nodeIndex = graph.Nodes.ToDictionary(static node => node.Id, StringComparer.OrdinalIgnoreCase);
        var builder = new StringBuilder();
        builder.AppendLine("source,target,sourceType,targetType,depth,isTransitive,targetRequiresPermissionCheck,permissionHints");

        foreach (var edge in graph.Edges)
        {
            if (!nodeIndex.TryGetValue(edge.SourceId, out var source) || !nodeIndex.TryGetValue(edge.TargetId, out var target))
            {
                continue;
            }

            builder.Append(Csv(source.FullName));
            builder.Append(',');
            builder.Append(Csv(target.FullName));
            builder.Append(',');
            builder.Append(Csv(source.Type.ToString()));
            builder.Append(',');
            builder.Append(Csv(target.Type.ToString()));
            builder.Append(',');
            builder.Append(edge.Depth);
            builder.Append(',');
            builder.Append(edge.IsTransitive);
            builder.Append(',');
            builder.Append(target.RequiresPermissionCheck);
            builder.Append(',');
            builder.AppendLine(Csv(string.Join(" | ", target.PermissionHints)));
        }

        return builder.ToString();
    }

    private static string Csv(string value)
        => $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
}
