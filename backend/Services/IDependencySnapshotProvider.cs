using RaportDependencies.Api.Models;

namespace RaportDependencies.Api.Services;

public interface IDependencySnapshotProvider
{
    Task<DependencySnapshot> GetSnapshotAsync(DatabaseObjectDescriptor procedure, CancellationToken cancellationToken);
}
