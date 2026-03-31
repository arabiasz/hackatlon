using RaportDependencies.Api.Services;

var builder = WebApplication.CreateBuilder(args);
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? ["http://localhost:4200"];

builder.Services.AddControllers();
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
    {
        policy.WithOrigins(corsOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<IDependencySnapshotProvider, SqlServerDependencySnapshotProvider>();
builder.Services.AddSingleton<DependencyGraphService>();
builder.Services.AddSingleton<DependencyExportService>();

var app = builder.Build();

app.UseCors("frontend");
app.UseAuthorization();

app.MapControllers();
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.Run();
