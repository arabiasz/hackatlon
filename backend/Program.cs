using System.Net;
using RaportDependencies.Api.Services;

var builder = WebApplication.CreateBuilder(args);
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? ["http://localhost:4200"];

builder.Services.AddControllers();
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
        {
            if (corsOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
            {
                return true;
            }

            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
            {
                return false;
            }

            return uri.Scheme is "http" or "https"
                && (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
                    || IPAddress.TryParse(uri.Host, out var address) && IPAddress.IsLoopback(address));
        });

        policy.AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<IDependencySnapshotProvider, SqlServerDependencySnapshotProvider>();
builder.Services.AddSingleton<DependencyGraphService>();
builder.Services.AddSingleton<DependencyExportService>();

var app = builder.Build();

app.UseRouting();
app.UseCors("frontend");
app.UseAuthorization();

app.MapMethods("/api/{**path}", [HttpMethods.Options], () => Results.NoContent())
    .RequireCors("frontend");
app.MapControllers()
    .RequireCors("frontend");
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.Run();
