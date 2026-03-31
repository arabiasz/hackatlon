using System.Text.Json.Serialization;

namespace RaportDependencies.Api.Models;

public sealed record DependencyGraphRequest
{
    public List<string> Procedures { get; init; } = [];
    public bool IncludeTransitive { get; init; } = true;
    public int MaxDepth { get; init; } = 4;
}

public sealed record DependencyGraphResponse(
    IReadOnlyList<DependencyNode> Nodes,
    IReadOnlyList<DependencyEdge> Edges,
    DependencyGraphSummary Summary,
    DateTimeOffset GeneratedAtUtc);

public sealed record DependencyGraphSummary(
    int RequestedProcedures,
    int ResolvedProcedures,
    int Nodes,
    int Edges,
    int PermissionHints,
    int MaxObservedDepth);

public sealed record DependencyNode(
    string Id,
    string Database,
    string Schema,
    string Name,
    string FullName,
    DependencyNodeType Type,
    string SourceType,
    int Depth,
    bool IsEntryPoint,
    bool IsUnresolved,
    bool RequiresPermissionCheck,
    IReadOnlyList<string> PermissionHints);

public sealed record DependencyEdge(
    string Id,
    string SourceId,
    string TargetId,
    bool IsTransitive,
    int Depth);

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum DependencyNodeType
{
    Procedure,
    Table,
    View,
    Function,
    Synonym,
    External,
    Unknown
}
