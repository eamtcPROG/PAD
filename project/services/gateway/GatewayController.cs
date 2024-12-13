using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Collections.Concurrent;
using System.Linq;
using Microsoft.Extensions.Configuration;
using System;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using System.IO;
using System.Net.Http.Headers;
using StackExchange.Redis;
using System.Text.Json;
using System.Collections.Generic;

namespace Gateway.Controllers
{
    [ApiController]
    [Route("{serviceName}/{**catchAll}")]
    public class GatewayController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly string _serviceDiscoveryUrl;
        private readonly ConcurrentDictionary<string, CircuitBreakerState> _circuitBreakerStates = new ConcurrentDictionary<string, CircuitBreakerState>();

        private readonly IDatabase _redisDb;

        private const int FailureThreshold = 1;
        private const int MaxRetriesPerInstance = 3;
        private const int OpenStateDuration = 180; // seconds

        public GatewayController(IHttpClientFactory httpClientFactory, IConfiguration configuration,IConnectionMultiplexer redis)
        {
            _httpClientFactory = httpClientFactory;
            _serviceDiscoveryUrl = configuration["ServiceDiscovery:Url"]
                                    ?? throw new ArgumentNullException("ServiceDiscovery:Url");
            _redisDb = redis.GetDatabase();
        }

        [HttpGet, HttpPost, HttpPut, HttpDelete, HttpPatch]
        public async Task<IActionResult> HandleRequest(string serviceName, string catchAll)
        {
            var client = _httpClientFactory.CreateClient();
            var response = await client.GetAsync($"{_serviceDiscoveryUrl}service/{serviceName}");

            if (!response.IsSuccessStatusCode)
            {
                return NotFound($"Service '{serviceName}' not found.");
            }

            var serviceEntries = await response.Content.ReadFromJsonAsync<ServiceEntry[]>();

            if (serviceEntries == null || serviceEntries.Length == 0)
            {
                return NotFound($"No instances found for service '{serviceName}'.");
            }

            var now = DateTime.UtcNow;

            var availableServices = serviceEntries
                .Where(entry =>
                {
                    var instanceCbState = GetCircuitBreakerState(entry.Address);

                    lock (instanceCbState)
                    {
                        if (instanceCbState.Status == CircuitBreakerStatus.Open)
                        {
                            var timeSinceLastChange = (now - instanceCbState.LastStateChangedTime).TotalSeconds;
                            if (timeSinceLastChange >= OpenStateDuration)
                            {
                                instanceCbState.Status = CircuitBreakerStatus.HalfOpen;
                                instanceCbState.LastStateChangedTime = now;
                                Console.WriteLine($"Instance {entry.Address} moved to Half-Open state.");
                            }
                            else
                            {
                                return false;
                            }
                        }
                        return true;
                    }
                })
                .OrderBy(_ => Guid.NewGuid())
                .ToList();

            if (availableServices.Count == 0)
            {
                return StatusCode(503, "All instances are unavailable.");
            }

            Request.EnableBuffering();

            using var memoryStream = new MemoryStream();
            await Request.Body.CopyToAsync(memoryStream);
            memoryStream.Position = 0;

            var requestContent = memoryStream.ToArray();
            Request.Body.Position = 0;

            foreach (var selectedService in availableServices)
            {
                var instanceAddress = selectedService.Address;
                var instanceCbState = GetCircuitBreakerState(instanceAddress);

                for (int attempt = 1; attempt <= MaxRetriesPerInstance; attempt++)
                {

                    lock (instanceCbState)
                    {
                        if (instanceCbState.Status == CircuitBreakerStatus.Open)
                        {
                            var timeSinceLastChange = (now - instanceCbState.LastStateChangedTime).TotalSeconds;
                            if (timeSinceLastChange >= OpenStateDuration)
                            {
                                instanceCbState.Status = CircuitBreakerStatus.HalfOpen;
                                instanceCbState.LastStateChangedTime = now;
                                Console.WriteLine($"Instance {instanceAddress} moved to Half-Open state.");
                            }
                            else
                            {
                                Console.WriteLine($"Instance {instanceAddress} is in Open state. Skipping.");
                                continue;
                            }
                        }
                    }
                    Console.WriteLine($"Forwarding request to {instanceAddress} (attempt {attempt})");
                    var result = await ForwardRequestToService(instanceAddress, catchAll, requestContent);

                    if (result != null)
                    {
                        ResetCircuitBreaker(instanceAddress);
                        return result;
                    }
                    else
                    {
                        HandleFailure(instanceAddress);
                    }
                }


            }

            return StatusCode(503, "Service unavailable.");
        }

        private async Task<IActionResult?> ForwardRequestToService(string selectedServiceAddress, string catchAll, byte[] requestContent)
        {
            try
            {
                var targetUrl = $"{selectedServiceAddress}/{catchAll}{Request.QueryString}";

                var client = _httpClientFactory.CreateClient();

                var forwardRequest = new HttpRequestMessage
                {
                    Method = new HttpMethod(Request.Method),
                    RequestUri = new Uri(targetUrl)
                };

                if (Request.Method != HttpMethod.Get.Method && Request.Method != HttpMethod.Delete.Method)
                {
                    forwardRequest.Content = new ByteArrayContent(requestContent);
                    if (Request.ContentType != null)
                    {
                        forwardRequest.Content.Headers.ContentType = new MediaTypeHeaderValue(Request.ContentType);
                    }
                }

                foreach (var header in Request.Headers)
                {
                    forwardRequest.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
                }

                HttpResponseMessage forwardResponse = await client.SendAsync(forwardRequest);

                if ((int)forwardResponse.StatusCode >= 500)
                {
                    return null;
                }

                foreach (var header in forwardResponse.Headers)
                {
                    Response.Headers[header.Key] = header.Value.ToArray();
                }

                foreach (var header in forwardResponse.Content.Headers)
                {
                    Response.Headers[header.Key] = header.Value.ToArray();
                }

                Response.StatusCode = (int)forwardResponse.StatusCode;
                var responseContent = await forwardResponse.Content.ReadAsByteArrayAsync();
                return File(responseContent, forwardResponse.Content.Headers.ContentType?.ToString() ?? "application/octet-stream");
            }
            catch (Exception)
            {
                return null;
            }
        }

        private void HandleFailure(string instanceAddress)
        {
            var instanceCbState = GetCircuitBreakerState(instanceAddress);

            lock (instanceCbState)
            {
                instanceCbState.FailureCount++;

                if (instanceCbState.FailureCount >= FailureThreshold)
                {
                    instanceCbState.Status = CircuitBreakerStatus.Open;
                    instanceCbState.LastStateChangedTime = DateTime.UtcNow;
                }
                SetCircuitBreakerState(instanceAddress, instanceCbState);
            }
            Console.WriteLine($"Instance {instanceAddress} moved to Open state.");
        }

        private void ResetCircuitBreaker(string instanceAddress)
        {
            var instanceCbState = GetCircuitBreakerState(instanceAddress);

            lock (instanceCbState)
            {
                instanceCbState.Status = CircuitBreakerStatus.Closed;
                instanceCbState.FailureCount = 0;
                instanceCbState.LastStateChangedTime = DateTime.UtcNow;

                SetCircuitBreakerState(instanceAddress, instanceCbState);
            }            
        }

        private CircuitBreakerState GetCircuitBreakerState(string instanceAddress)
        {
            if (_circuitBreakerStates.TryGetValue(instanceAddress, out var state))
            {
                return state;
            }

            var redisValue = _redisDb.StringGet(instanceAddress);
            if (redisValue.HasValue)
            {
                state = JsonSerializer.Deserialize<CircuitBreakerState>(redisValue);
                _circuitBreakerStates[instanceAddress] = state;
                return state;
            }

            state = new CircuitBreakerState();
            _circuitBreakerStates[instanceAddress] = state;
            return state;
        }

        private void SetCircuitBreakerState(string instanceAddress, CircuitBreakerState state)
        {
            _circuitBreakerStates[instanceAddress] = state;
            var serializedState = JsonSerializer.Serialize(state);
            _redisDb.StringSet(instanceAddress, serializedState);
        }

        private class CircuitBreakerState
        {
            public int FailureCount { get; set; }
            public CircuitBreakerStatus Status { get; set; } = CircuitBreakerStatus.Closed;
            public DateTime LastStateChangedTime { get; set; } = DateTime.UtcNow;
        }

        private enum CircuitBreakerStatus
        {
            Closed,
            Open,
            HalfOpen
        }

        public class ServiceEntry
        {
            public string Key { get; set; } = string.Empty;
            public string Address { get; set; } = string.Empty;
        }
    }
}
