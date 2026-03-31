using Microsoft.Data.SqlClient;
using RaportDependencies.Api.Models;

namespace RaportDependencies.Api.Services;

public sealed class SqlServerDependencySnapshotProvider(IConfiguration configuration) : IDependencySnapshotProvider
{
    private const string ResolveProcedureSql = """
        SELECT TOP (1)
            DB_NAME() AS DatabaseName,
            schemas.name AS SchemaName,
            objects.name AS ObjectName,
            objects.type_desc AS ObjectType
        FROM sys.objects AS objects
        INNER JOIN sys.schemas AS schemas ON schemas.schema_id = objects.schema_id
        WHERE objects.type IN ('P', 'PC')
          AND objects.object_id = OBJECT_ID(@fullName);
        """;

    private const string LoadDependenciesSql = """
        SELECT
            DB_NAME() AS ReferencingDatabase,
            sourceSchemas.name AS ReferencingSchema,
            sourceObjects.name AS ReferencingName,
            sourceObjects.type_desc AS ReferencingType,
            COALESCE(dependencies.referenced_database_name, DB_NAME()) AS ReferencedDatabase,
            COALESCE(targetSchemas.name, dependencies.referenced_schema_name, 'dbo') AS ReferencedSchema,
            COALESCE(targetObjects.name, dependencies.referenced_entity_name, CONCAT('unresolved-', sourceObjects.object_id)) AS ReferencedName,
            COALESCE(
                targetObjects.type_desc,
                CASE
                    WHEN dependencies.referenced_database_name IS NOT NULL THEN 'EXTERNAL_OBJECT'
                    WHEN dependencies.referenced_id IS NULL THEN 'UNKNOWN_OBJECT'
                    ELSE dependencies.referenced_class_desc
                END
            ) AS ReferencedType,
            CAST(CASE WHEN dependencies.referenced_id IS NULL THEN 1 ELSE 0 END AS bit) AS IsUnresolved,
            dependencies.is_ambiguous AS IsAmbiguous,
            dependencies.is_caller_dependent AS IsCallerDependent
        FROM sys.sql_expression_dependencies AS dependencies
        INNER JOIN sys.objects AS sourceObjects ON sourceObjects.object_id = dependencies.referencing_id
        INNER JOIN sys.schemas AS sourceSchemas ON sourceSchemas.schema_id = sourceObjects.schema_id
        LEFT JOIN sys.objects AS targetObjects ON targetObjects.object_id = dependencies.referenced_id
        LEFT JOIN sys.schemas AS targetSchemas ON targetSchemas.schema_id = targetObjects.schema_id
        WHERE dependencies.referencing_id = OBJECT_ID(@fullName)
          AND dependencies.referenced_entity_name IS NOT NULL;
        """;

    public async Task<DependencySnapshot> GetSnapshotAsync(DatabaseObjectDescriptor procedure, CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("RaportDatabase");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:RaportDatabase is not configured.");
        }

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        var resolvedProcedure = await ResolveProcedureAsync(connection, procedure, cancellationToken);
        if (resolvedProcedure is null)
        {
            return new DependencySnapshot(procedure with { IsUnresolved = true }, [], false);
        }

        var dependencies = await LoadDependenciesAsync(connection, resolvedProcedure, cancellationToken);
        return new DependencySnapshot(resolvedProcedure, dependencies, true);
    }

    private static async Task<DatabaseObjectDescriptor?> ResolveProcedureAsync(
        SqlConnection connection,
        DatabaseObjectDescriptor requestedProcedure,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(ResolveProcedureSql, connection);
        command.Parameters.AddWithValue("@fullName", BuildLookupName(requestedProcedure));

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new DatabaseObjectDescriptor(
            reader.GetString(reader.GetOrdinal("DatabaseName")),
            reader.GetString(reader.GetOrdinal("SchemaName")),
            reader.GetString(reader.GetOrdinal("ObjectName")),
            reader.GetString(reader.GetOrdinal("ObjectType")));
    }

    private static async Task<IReadOnlyList<DatabaseObjectDependency>> LoadDependenciesAsync(
        SqlConnection connection,
        DatabaseObjectDescriptor procedure,
        CancellationToken cancellationToken)
    {
        var dependencies = new List<DatabaseObjectDependency>();

        await using var command = new SqlCommand(LoadDependenciesSql, connection);
        command.Parameters.AddWithValue("@fullName", BuildLookupName(procedure));

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var source = new DatabaseObjectDescriptor(
                reader.GetString(reader.GetOrdinal("ReferencingDatabase")),
                reader.GetString(reader.GetOrdinal("ReferencingSchema")),
                reader.GetString(reader.GetOrdinal("ReferencingName")),
                reader.GetString(reader.GetOrdinal("ReferencingType")));

            var target = new DatabaseObjectDescriptor(
                reader.GetString(reader.GetOrdinal("ReferencedDatabase")),
                reader.GetString(reader.GetOrdinal("ReferencedSchema")),
                reader.GetString(reader.GetOrdinal("ReferencedName")),
                reader.GetString(reader.GetOrdinal("ReferencedType")),
                reader.GetBoolean(reader.GetOrdinal("IsUnresolved")),
                reader.GetBoolean(reader.GetOrdinal("IsAmbiguous")),
                reader.GetBoolean(reader.GetOrdinal("IsCallerDependent")));

            dependencies.Add(new DatabaseObjectDependency(source, target));
        }

        return dependencies;
    }

    private static string BuildLookupName(DatabaseObjectDescriptor procedure)
        => $"[{procedure.NormalizedSchema}].[{procedure.NormalizedName}]";
}
