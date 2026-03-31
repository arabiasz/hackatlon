using RaportDependencies.Api.Models;
using RaportDependencies.Api.Services;

namespace backend.tests.Services;

public sealed class DependencyGraphServiceTests
{
    [Fact]
    public async Task BuildAsync_FollowsNestedProcedures_WhenTransitiveModeIsEnabled()
    {
        var root = new DatabaseObjectDescriptor("RaportDb", "dbo", "usp_root", "SQL_STORED_PROCEDURE");
        var nested = new DatabaseObjectDescriptor("RaportDb", "audit", "usp_nested", "SQL_STORED_PROCEDURE");
        var table = new DatabaseObjectDescriptor("RaportDb", "audit", "PenaltyEvents", "USER_TABLE");

        var provider = new FakeSnapshotProvider(new[]
        {
            new DependencySnapshot(root, [new DatabaseObjectDependency(root, nested)], true),
            new DependencySnapshot(nested, [new DatabaseObjectDependency(nested, table)], true)
        });

        var service = new DependencyGraphService(provider);
        var graph = await service.BuildAsync(new DependencyGraphRequest
        {
            Procedures = ["dbo.usp_root"],
            IncludeTransitive = true,
            MaxDepth = 4
        }, CancellationToken.None);

        Assert.Contains(graph.Nodes, static node => node.Name == "PenaltyEvents");
        Assert.Equal(2, graph.Edges.Count);
        Assert.Equal(2, graph.Summary.MaxObservedDepth);
    }

    [Fact]
    public async Task BuildAsync_AddsPermissionHints_ForCrossSchemaViewsAndUnknownNodes()
    {
        var root = new DatabaseObjectDescriptor("RaportDb", "dbo", "usp_root", "SQL_STORED_PROCEDURE");
        var view = new DatabaseObjectDescriptor("RaportDb", "security", "vw_sensitive", "VIEW");
        var unknown = new DatabaseObjectDescriptor("RaportDb", "dbo", "mystery", "UNKNOWN_OBJECT", IsUnresolved: true);

        var provider = new FakeSnapshotProvider(new[]
        {
            new DependencySnapshot(root,
            [
                new DatabaseObjectDependency(root, view),
                new DatabaseObjectDependency(root, unknown)
            ], true)
        });

        var service = new DependencyGraphService(provider);
        var graph = await service.BuildAsync(new DependencyGraphRequest
        {
            Procedures = ["dbo.usp_root"],
            IncludeTransitive = false,
            MaxDepth = 2
        }, CancellationToken.None);

        var viewNode = Assert.Single(graph.Nodes, static node => node.Name == "vw_sensitive");
        var unknownNode = Assert.Single(graph.Nodes, static node => node.Name == "mystery");

        Assert.True(viewNode.RequiresPermissionCheck);
        Assert.Contains(viewNode.PermissionHints, static hint => hint.Contains("innym schemacie", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(viewNode.PermissionHints, static hint => hint.Contains("pośredni", StringComparison.OrdinalIgnoreCase));

        Assert.True(unknownNode.RequiresPermissionCheck);
        Assert.Contains(unknownNode.PermissionHints, static hint => hint.Contains("nie rozwiązały", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void ParseProcedureInput_DefaultsSchemaToDbo()
    {
        var descriptor = DatabaseObjectDescriptor.ParseProcedureInput("usp_demo");

        Assert.Equal("dbo", descriptor.NormalizedSchema);
        Assert.Equal("usp_demo", descriptor.NormalizedName);
    }

    private sealed class FakeSnapshotProvider(IEnumerable<DependencySnapshot> snapshots) : IDependencySnapshotProvider
    {
        private readonly Dictionary<string, DependencySnapshot> snapshots = snapshots.ToDictionary(
            static snapshot => KeyFor(snapshot.Procedure),
            StringComparer.OrdinalIgnoreCase);

        public Task<DependencySnapshot> GetSnapshotAsync(DatabaseObjectDescriptor procedure, CancellationToken cancellationToken)
        {
            if (snapshots.TryGetValue(KeyFor(procedure), out var snapshot))
            {
                return Task.FromResult(snapshot);
            }

            return Task.FromResult(new DependencySnapshot(procedure with { IsUnresolved = true }, [], false));
        }

        private static string KeyFor(DatabaseObjectDescriptor descriptor)
            => $"{descriptor.NormalizedSchema}::{descriptor.NormalizedName}".ToLowerInvariant();
    }
}
