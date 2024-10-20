using Microsoft.Extensions.Logging;
using StackExchange.Redis;
using System.Text.Json;

namespace ServiceDiscovery
{
    public interface IServiceRepository
    {
        Task RegisterServiceAsync(ServiceInstance instance);
        Task DeregisterServiceAsync(ServiceInstance instance);
        Task<string?> GetServiceAsync(string serviceName);

        Task<IEnumerable<string>> GetAllServicesAsync(string serviceName);
    }

    public class ServiceRepository : IServiceRepository
    {
        private readonly IConnectionMultiplexer _redis;
        private readonly IDatabase _db;
        private readonly ILogger<ServiceRepository> _logger;

        public ServiceRepository(IConnectionMultiplexer redis, ILogger<ServiceRepository> logger)
        {
            _redis = redis;
            _db = _redis.GetDatabase();
            _logger = logger;  // Inject logger
        }

        private string GetServiceKey(string serviceName) => $"services:{serviceName}";

        public async Task RegisterServiceAsync(ServiceInstance instance)
        {
            string key = GetServiceKey(instance.ServiceName);
            await _db.SetAddAsync(key, instance.Address);
            // Optionally set an expiration to handle stale entries
            await _db.KeyExpireAsync(key, TimeSpan.FromHours(1));
            _logger.LogInformation($"Service {instance.ServiceName} registered with address {instance.Address}");
        }

        public async Task DeregisterServiceAsync(ServiceInstance instance)
        {
            string key = GetServiceKey(instance.ServiceName);
            await _db.SetRemoveAsync(key, instance.Address);
            _logger.LogInformation($"Service {instance.ServiceName} deregistered with address {instance.Address}");
        }

        public async Task<string?> GetServiceAsync(string serviceName)
        {
            string key = GetServiceKey(serviceName);
            var services = await _db.SetMembersAsync(key);

            if (services.Length == 0)
            {
                _logger.LogWarning($"No services found for {serviceName}");
                return null;
            }

            // Log all registered services
            _logger.LogInformation($"Services registered for {serviceName}:");
            foreach (var service in services)
            {
                _logger.LogInformation($" - {service}");
            }

            // Simple round-robin or random selection
            var random = new Random();
            int index = random.Next(services.Length);

            _logger.LogInformation($"Selected service: {services[index]}");

            return services[index];
        }

        public async Task<IEnumerable<string>> GetAllServicesAsync(string serviceName)
    {
        string key = GetServiceKey(serviceName);
        var services = await _db.SetMembersAsync(key);
        return services.Select(s => s.ToString()).ToList();
    }
    }
}
