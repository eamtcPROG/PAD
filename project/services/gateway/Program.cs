using Gateway;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);


builder.Configuration.AddJsonFile("appsettings.Development.json", optional: false, reloadOnChange: true);

builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
{
    var configuration = builder.Configuration.GetValue<string>("ServiceDiscovery:RedisUrl");
    return ConnectionMultiplexer.Connect(configuration);
});
// Add services to the container.
builder.Services.AddControllers();

// Add HttpClient for forwarding requests
builder.Services.AddHttpClient();


var app = builder.Build();

app.UseRouting();

app.MapControllers();

app.Run();
