// services/servicediscovery/Program.cs
using ServiceDiscovery;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

// Configure Redis Connection
builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
{
    var configuration = builder.Configuration.GetValue<string>("Redis:Configuration") ?? "redis:6379";
    return ConnectionMultiplexer.Connect(configuration);
});

// Register the Service Repository
builder.Services.AddScoped<IServiceRepository, ServiceRepository>();



var app = builder.Build();


app.MapControllers();

app.Run();
