using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using RaportDependencies.Api.Models;
using RaportDependencies.Api.Services;

namespace RaportDependencies.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class DependenciesController(
    DependencyGraphService graphService,
    DependencyExportService exportService,
    ILogger<DependenciesController> logger) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<DependencyGraphResponse>> BuildGraph(
        [FromBody] DependencyGraphRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Procedures.Count == 0)
        {
            return BadRequest("Request must contain at least one procedure name.");
        }

        var normalizedRequest = request with
        {
            MaxDepth = Math.Clamp(request.MaxDepth, 1, 10)
        };

        try
        {
            var graph = await graphService.BuildAsync(normalizedRequest, cancellationToken);
            return Ok(graph);
        }
        catch (SqlException exception)
        {
            logger.LogError(exception, "Unable to query SQL Server dependency metadata.");
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Database connection failed",
                detail: DescribeSqlException(exception));
        }
        catch (InvalidOperationException exception)
        {
            logger.LogError(exception, "Application configuration is invalid.");
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Backend configuration is incomplete",
                detail: exception.Message);
        }
    }

    [HttpPost("export")]
    public async Task<IActionResult> Export(
        [FromQuery] string format,
        [FromBody] DependencyGraphRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Procedures.Count == 0)
        {
            return BadRequest("Request must contain at least one procedure name.");
        }

        try
        {
            var graph = await graphService.BuildAsync(request with { MaxDepth = Math.Clamp(request.MaxDepth, 1, 10) }, cancellationToken);
            var normalizedFormat = format.Trim().ToLowerInvariant();

            return normalizedFormat switch
            {
                "json" => File(
                    Encoding.UTF8.GetBytes(exportService.ToJson(graph)),
                    "application/json",
                    $"dependency-graph-{DateTime.UtcNow:yyyyMMddHHmmss}.json"),
                "csv" => File(
                    Encoding.UTF8.GetBytes(exportService.ToCsv(graph)),
                    "text/csv",
                    $"dependency-graph-{DateTime.UtcNow:yyyyMMddHHmmss}.csv"),
                _ => BadRequest("Supported export formats: json, csv.")
            };
        }
        catch (SqlException exception)
        {
            logger.LogError(exception, "Unable to export dependency graph because SQL Server is unavailable.");
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Database connection failed",
                detail: DescribeSqlException(exception));
        }
        catch (InvalidOperationException exception)
        {
            logger.LogError(exception, "Application configuration is invalid.");
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Backend configuration is incomplete",
                detail: exception.Message);
        }
    }

    private static string DescribeSqlException(SqlException exception)
        => exception.Number switch
        {
            4060 => "Nie można otworzyć bazy RaportDb dla podanego loginu. Sprawdź nazwę bazy, użytkownika i uprawnienia.",
            18456 => "Logowanie do SQL Server nie powiodło się. Sprawdź login i hasło w connection stringu.",
            _ => "Nie udało się pobrać zależności z SQL Server. Sprawdź działanie instancji i connection string."
        };
}
