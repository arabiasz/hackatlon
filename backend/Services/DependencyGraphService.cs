using RaportDependencies.Api.Models;

namespace RaportDependencies.Api.Services;

public sealed class DependencyGraphService(IDependencySnapshotProvider snapshotProvider)
{
    public async Task<DependencyGraphResponse> BuildAsync(
        DependencyGraphRequest request,
        CancellationToken cancellationToken)
    {
        var requestedProcedures = request.Procedures
            .Where(static procedure => !string.IsNullOrWhiteSpace(procedure))
            .Select(static procedure => DatabaseObjectDescriptor.ParseProcedureInput(procedure))
            .DistinctBy(static procedure => procedure.Key)
            .ToList();

        var nodes = new Dictionary<string, DependencyNode>(StringComparer.OrdinalIgnoreCase);
        var edges = new Dictionary<string, DependencyEdge>(StringComparer.OrdinalIgnoreCase);
        var visitedProcedures = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<(DatabaseObjectDescriptor Procedure, int Depth, bool IsEntryPoint)>();

        foreach (var procedure in requestedProcedures)
        {
            queue.Enqueue((procedure, 0, true));
        }

        var resolvedRoots = 0;
        var rootSchemas = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var rootDatabases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        while (queue.Count > 0)
        {
            var (requestedProcedure, depth, isEntryPoint) = queue.Dequeue();
            if (depth > request.MaxDepth)
            {
                continue;
            }

            var snapshot = await snapshotProvider.GetSnapshotAsync(requestedProcedure, cancellationToken);
            var resolvedProcedure = snapshot.Found
                ? snapshot.Procedure
                : requestedProcedure with { IsUnresolved = true };

            if (snapshot.Found && isEntryPoint)
            {
                resolvedRoots++;
            }

            if (isEntryPoint)
            {
                rootSchemas.Add(resolvedProcedure.NormalizedSchema);

                if (!string.IsNullOrWhiteSpace(resolvedProcedure.NormalizedDatabase))
                {
                    rootDatabases.Add(resolvedProcedure.NormalizedDatabase);
                }
            }

            UpsertNode(nodes, resolvedProcedure, depth, isEntryPoint);

            if (!snapshot.Found || !visitedProcedures.Add(resolvedProcedure.Key))
            {
                continue;
            }

            foreach (var dependency in snapshot.Dependencies)
            {
                UpsertNode(nodes, dependency.Source, depth, isEntryPoint && dependency.Source.Key.Equals(resolvedProcedure.Key, StringComparison.OrdinalIgnoreCase));

                var dependencyDepth = Math.Min(depth + 1, request.MaxDepth);
                UpsertNode(nodes, dependency.Target, dependencyDepth, false);

                var edgeId = $"{dependency.Source.Key}->{dependency.Target.Key}";
                edges.TryAdd(edgeId, new DependencyEdge(edgeId, dependency.Source.Key, dependency.Target.Key, depth > 0, dependencyDepth));

                if (request.IncludeTransitive &&
                    dependencyDepth < request.MaxDepth &&
                    dependency.Target.NodeType == DependencyNodeType.Procedure &&
                    !dependency.Target.IsUnresolved)
                {
                    queue.Enqueue((dependency.Target, dependencyDepth, false));
                }
            }
        }

        var evaluatedNodes = nodes.Values
            .Select(node => ApplyPermissionHints(node, rootSchemas, rootDatabases))
            .OrderBy(static node => node.Depth)
            .ThenByDescending(static node => node.IsEntryPoint)
            .ThenBy(static node => node.Type)
            .ThenBy(static node => node.FullName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var summary = new DependencyGraphSummary(
            RequestedProcedures: requestedProcedures.Count,
            ResolvedProcedures: resolvedRoots,
            Nodes: evaluatedNodes.Count,
            Edges: edges.Count,
            PermissionHints: evaluatedNodes.Count(static node => node.RequiresPermissionCheck),
            MaxObservedDepth: evaluatedNodes.Count == 0 ? 0 : evaluatedNodes.Max(static node => node.Depth));

        return new DependencyGraphResponse(
            evaluatedNodes,
            edges.Values.OrderBy(static edge => edge.Depth).ThenBy(static edge => edge.Id, StringComparer.OrdinalIgnoreCase).ToList(),
            summary,
            DateTimeOffset.UtcNow);
    }

    private static void UpsertNode(
        IDictionary<string, DependencyNode> nodes,
        DatabaseObjectDescriptor descriptor,
        int depth,
        bool isEntryPoint)
    {
        var normalizedNode = new DependencyNode(
            descriptor.Key,
            descriptor.NormalizedDatabase,
            descriptor.NormalizedSchema,
            descriptor.NormalizedName,
            descriptor.FullName,
            descriptor.NodeType,
            descriptor.SourceType,
            depth,
            isEntryPoint,
            descriptor.IsUnresolved || descriptor.IsAmbiguous || descriptor.IsCallerDependent,
            false,
            []);

        if (!nodes.TryGetValue(descriptor.Key, out var existingNode))
        {
            nodes[descriptor.Key] = normalizedNode;
            return;
        }

        nodes[descriptor.Key] = existingNode with
        {
            Database = string.IsNullOrWhiteSpace(existingNode.Database) ? normalizedNode.Database : existingNode.Database,
            Schema = string.IsNullOrWhiteSpace(existingNode.Schema) ? normalizedNode.Schema : existingNode.Schema,
            Name = string.IsNullOrWhiteSpace(existingNode.Name) ? normalizedNode.Name : existingNode.Name,
            FullName = string.IsNullOrWhiteSpace(existingNode.FullName) ? normalizedNode.FullName : existingNode.FullName,
            Type = existingNode.Type == DependencyNodeType.Unknown ? normalizedNode.Type : existingNode.Type,
            SourceType = string.IsNullOrWhiteSpace(existingNode.SourceType) ? normalizedNode.SourceType : existingNode.SourceType,
            Depth = Math.Min(existingNode.Depth, normalizedNode.Depth),
            IsEntryPoint = existingNode.IsEntryPoint || normalizedNode.IsEntryPoint,
            IsUnresolved = existingNode.IsUnresolved || normalizedNode.IsUnresolved
        };
    }

    private static DependencyNode ApplyPermissionHints(
        DependencyNode node,
        IReadOnlySet<string> rootSchemas,
        IReadOnlySet<string> rootDatabases)
    {
        var hints = new List<string>();

        if (node.IsUnresolved)
        {
            hints.Add("Metadane SQL Server nie rozwiązały tej zależności jednoznacznie.");
        }

        if (!node.IsEntryPoint && rootSchemas.Count > 0 && !rootSchemas.Contains(node.Schema))
        {
            hints.Add("Obiekt znajduje się w innym schemacie niż procedura startowa.");
        }

        if (!node.IsEntryPoint &&
            rootDatabases.Count > 0 &&
            !string.IsNullOrWhiteSpace(node.Database) &&
            !rootDatabases.Contains(node.Database))
        {
            hints.Add("Obiekt znajduje się w innej bazie niż procedura startowa.");
        }

        if (!node.IsEntryPoint && (node.Type == DependencyNodeType.View || node.Type == DependencyNodeType.Procedure))
        {
            hints.Add("Obiekt pośredni może ukrywać dodatkowy dostęp do danych.");
        }

        if (node.Type == DependencyNodeType.Unknown)
        {
            hints.Add("Typ obiektu nie został rozpoznany i wymaga ręcznej weryfikacji.");
        }

        return node with
        {
            RequiresPermissionCheck = hints.Count > 0,
            PermissionHints = hints.Distinct(StringComparer.OrdinalIgnoreCase).ToList()
        };
    }
}
