using Gateway;
var builder = WebApplication.CreateBuilder(args);


builder.Configuration.AddJsonFile("appsettings.Development.json", optional: false, reloadOnChange: true);

// Add services to the container.
builder.Services.AddControllers();

// Add HttpClient for forwarding requests
builder.Services.AddHttpClient();


var app = builder.Build();

app.UseRouting();

app.MapControllers();

app.Run();
