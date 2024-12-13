using Microsoft.Extensions.Logging;
using StackExchange.Redis;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;
using System.Linq;

namespace ServiceDiscovery
{
    public class ServiceEntry
{
    public string Key { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
}
    public interface IServiceRepository
    {
        Task RegisterServiceAsync(ServiceInstance instance);
        Task DeregisterServiceAsync(ServiceInstance instance);
        Task<string?> GetServiceAsync(string serviceName);
        Task<IEnumerable<ServiceEntry>> GetAllServicesAsync(string serviceName);
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
            _logger = logger;
        }

        private string GetServiceKey(string serviceName) => $"sd:services:{serviceName}";

        public async Task RegisterServiceAsync(ServiceInstance instance)
        {
         string key = GetServiceKey(instance.ServiceName);

    // Check the current type of the key
    var keyType = await _db.KeyTypeAsync(key);
    if (keyType != RedisType.Hash && keyType != RedisType.None)
    {
        throw new InvalidOperationException($"Key {key} is of type {keyType}, expected Hash.");
    }

    // Generate a unique identifier for the instance
    string uniqueInstanceId = $"{instance.Address}-{Guid.NewGuid()}";

    // Store the instance information in a hash for better structure
    await _db.HashSetAsync(key, uniqueInstanceId, instance.Address);

            _logger.LogInformation($"[{DateTime.UtcNow:O}] [INFO] [servicediscovery] Service {instance.ServiceName} registered with unique ID {uniqueInstanceId} and address {instance.Address}");
        }

        public async Task DeregisterServiceAsync(ServiceInstance instance)
        {
            string key = GetServiceKey(instance.ServiceName);

            // Retrieve all instance IDs
            var entries = await _db.HashGetAllAsync(key);

            // Find the entry matching the instance address
            var entryToRemove = entries.FirstOrDefault(entry => entry.Value == instance.Address);

            if (entryToRemove.Name.HasValue)
            {
                // Remove the specific instance
                await _db.HashDeleteAsync(key, entryToRemove.Name);

                _logger.LogInformation($"[{DateTime.UtcNow:O}] [INFO] [servicediscovery] Service {instance.ServiceName} deregistered with unique ID {entryToRemove.Name} and address {instance.Address}");
            }
            else
            {
                _logger.LogInformation($"[{DateTime.UtcNow:O}] [INFO] [servicediscovery] Service instance with address {instance.Address} not found for deregistration.");
            }
        }

        public async Task<string?> GetServiceAsync(string serviceName)
        {
            string key = GetServiceKey(serviceName);
            var entries = await _db.HashGetAllAsync(key);

            if (entries.Length == 0)
            {
                _logger.LogInformation($"[{DateTime.UtcNow:O}] [INFO] [servicediscovery] No services found for {serviceName}");
                return null;
            }

            // Log all registered services
            _logger.LogInformation($"[{DateTime.UtcNow:O}] [INFO] [servicediscovery] Services registered for {serviceName}:");
            foreach (var entry in entries)
            {
                _logger.LogInformation($"[{DateTime.UtcNow:O}] [INFO] [servicediscovery] - {entry.Value}");
            }

            // Simple random selection
            var random = new Random();
            int index = random.Next(entries.Length);

            var selectedService = entries[index].Value.ToString();

            _logger.LogInformation($"[{DateTime.UtcNow:O}] [INFO] [servicediscovery] Selected service: {selectedService}");

            return selectedService;
        }

        public async Task<IEnumerable<ServiceEntry>> GetAllServicesAsync(string serviceName)
{
    string key = GetServiceKey(serviceName);
    var entries = await _db.HashGetAllAsync(key);

    foreach (var entry in entries)
    {
        _logger.LogInformation($"[{DateTime.UtcNow:O}] [INFO] [servicediscovery] Service: {entry.Value}");
    }

    return entries.Select(entry => new ServiceEntry
    {
        Key = entry.Name.ToString(),
        Address = entry.Value.ToString()
    }).ToList();
}
    }
}
