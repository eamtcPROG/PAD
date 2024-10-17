// services/servicediscovery/ServiceRepository.cs
using StackExchange.Redis;
using System.Text.Json;

namespace ServiceDiscovery
{
    public interface IServiceRepository
    {
        Task RegisterServiceAsync(ServiceInstance instance);
        Task DeregisterServiceAsync(ServiceInstance instance);
        Task<string?> GetServiceAsync(string serviceName);
    }

    public class ServiceRepository : IServiceRepository
    {
        private readonly IConnectionMultiplexer _redis;
        private readonly IDatabase _db;

        public ServiceRepository(IConnectionMultiplexer redis)
        {
            _redis = redis;
            _db = _redis.GetDatabase();
        }

        private string GetServiceKey(string serviceName) => $"services:{serviceName}";

        public async Task RegisterServiceAsync(ServiceInstance instance)
        {
            string key = GetServiceKey(instance.ServiceName);
            await _db.SetAddAsync(key, instance.Address);
            // Optionally set an expiration to handle stale entries
            await _db.KeyExpireAsync(key, TimeSpan.FromHours(1));
        }

        public async Task DeregisterServiceAsync(ServiceInstance instance)
        {
            string key = GetServiceKey(instance.ServiceName);
            await _db.SetRemoveAsync(key, instance.Address);
        }

        public async Task<string?> GetServiceAsync(string serviceName)
        {
            string key = GetServiceKey(serviceName);
            var services = await _db.SetMembersAsync(key);
            if (services.Length == 0)
                return null;

            // Simple round-robin or random selection
            var random = new Random();
            int index = random.Next(services.Length);
            return services[index];
        }
    }
}
