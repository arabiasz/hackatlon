namespace RaportDependencies.Api.Models;

public sealed record DatabaseObjectDescriptor(
    string Database,
    string Schema,
    string Name,
    string SourceType,
    bool IsUnresolved = false,
    bool IsAmbiguous = false,
    bool IsCallerDependent = false)
{
    public string NormalizedDatabase => Database.Trim();
    public string NormalizedSchema => string.IsNullOrWhiteSpace(Schema) ? "dbo" : Schema.Trim();
    public string NormalizedName => Name.Trim();
    public string FullName => string.Join(".", new[] { NormalizedDatabase, NormalizedSchema, NormalizedName }.Where(static part => !string.IsNullOrWhiteSpace(part)));
    public string Key => string.Join("::", new[] { string.IsNullOrWhiteSpace(NormalizedDatabase) ? "(current)" : NormalizedDatabase, NormalizedSchema, NormalizedName }.Select(static part => part.ToLowerInvariant()));
    public DependencyNodeType NodeType => MapNodeType(SourceType);

    public static DatabaseObjectDescriptor ParseProcedureInput(string rawValue)
    {
        if (string.IsNullOrWhiteSpace(rawValue))
        {
            throw new ArgumentException("Procedure name cannot be empty.", nameof(rawValue));
        }

        var cleaned = rawValue.Trim()
            .Replace("[", string.Empty, StringComparison.Ordinal)
            .Replace("]", string.Empty, StringComparison.Ordinal)
            .Replace("\"", string.Empty, StringComparison.Ordinal);

        var parts = cleaned.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        return parts.Length switch
        {
            1 => new DatabaseObjectDescriptor(string.Empty, "dbo", parts[0], "SQL_STORED_PROCEDURE"),
            2 => new DatabaseObjectDescriptor(string.Empty, parts[0], parts[1], "SQL_STORED_PROCEDURE"),
            >= 3 => new DatabaseObjectDescriptor(parts[^3], parts[^2], parts[^1], "SQL_STORED_PROCEDURE"),
            _ => throw new ArgumentException($"Unsupported procedure name '{rawValue}'.", nameof(rawValue))
        };
    }

    private static DependencyNodeType MapNodeType(string sourceType)
    {
        if (string.IsNullOrWhiteSpace(sourceType))
        {
            return DependencyNodeType.Unknown;
        }

        return sourceType.ToUpperInvariant() switch
        {
            var value when value.Contains("PROCEDURE", StringComparison.Ordinal) => DependencyNodeType.Procedure,
            var value when value.Contains("VIEW", StringComparison.Ordinal) => DependencyNodeType.View,
            var value when value.Contains("TABLE", StringComparison.Ordinal) => DependencyNodeType.Table,
            var value when value.Contains("FUNCTION", StringComparison.Ordinal) => DependencyNodeType.Function,
            var value when value.Contains("SYNONYM", StringComparison.Ordinal) => DependencyNodeType.Synonym,
            var value when value.Contains("EXTERNAL", StringComparison.Ordinal) => DependencyNodeType.External,
            _ => DependencyNodeType.Unknown
        };
    }
}

public sealed record DatabaseObjectDependency(
    DatabaseObjectDescriptor Source,
    DatabaseObjectDescriptor Target);

public sealed record DependencySnapshot(
    DatabaseObjectDescriptor Procedure,
    IReadOnlyList<DatabaseObjectDependency> Dependencies,
    bool Found);
