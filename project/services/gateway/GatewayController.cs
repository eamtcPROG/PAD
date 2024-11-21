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

        private const int FailureThreshold = 1;
        private const int MaxRetriesPerInstance = 3;
        private const int OpenStateDuration = 15; // seconds

        public GatewayController(IHttpClientFactory httpClientFactory, IConfiguration configuration)
        {
            _httpClientFactory = httpClientFactory;
            _serviceDiscoveryUrl = configuration["ServiceDiscovery:Url"]
                                    ?? throw new ArgumentNullException("ServiceDiscovery:Url");
        }

        [HttpGet, HttpPost, HttpPut, HttpDelete, HttpPatch]
        public async Task<IActionResult> HandleRequest(string serviceName, string catchAll)
        {
            // Fetch the service addresses from Service Discovery
            var client = _httpClientFactory.CreateClient();
            var response = await client.GetAsync($"{_serviceDiscoveryUrl}service/{serviceName}");

            if (!response.IsSuccessStatusCode)
            {
                return NotFound($"Service '{serviceName}' not found.");
            }

            // Deserialize the response as an array of strings
            var serviceAddresses = await response.Content.ReadFromJsonAsync<string[]>();

            if (serviceAddresses == null || serviceAddresses.Length == 0)
            {
                return NotFound($"No instances found for service '{serviceName}'.");
            }

            var now = DateTime.UtcNow;

            // Get circuit breaker state for the service
            var cbState = _circuitBreakerStates.GetOrAdd(serviceName, new CircuitBreakerState
            {
                Status = CircuitBreakerStatus.Closed,
                FailureCount = 0,
                LastStateChangedTime = now
            });

            if (cbState.Status == CircuitBreakerStatus.Open)
            {
                // Check if the open duration has passed
                if ((now - cbState.LastStateChangedTime).TotalSeconds >= OpenStateDuration)
                {
                    // Move to Half-Open
                    cbState.Status = CircuitBreakerStatus.HalfOpen;
                    cbState.LastStateChangedTime = now;
                    Console.WriteLine($"Circuit breaker for service '{serviceName}' moved to Half-Open state.");
                }
                else
                {
                    // Still in Open state
                    return StatusCode(503, $"Circuit breaker is open for service '{serviceName}'.");
                }
            }

            // Randomize the service addresses
            var availableServices = serviceAddresses.OrderBy(s => Guid.NewGuid()).ToList();

            // Enable buffering to allow multiple reads of the request body
            Request.EnableBuffering();

            using var memoryStream = new MemoryStream();
            await Request.Body.CopyToAsync(memoryStream);
            memoryStream.Position = 0;

            // Store the content for reuse
            var requestContent = memoryStream.ToArray();

            // Reset the position of the request body
            Request.Body.Position = 0;

            foreach (var selectedService in availableServices)
            {
                Console.WriteLine($"Trying to forward request to service '{serviceName}' instance at {selectedService}.");

                for (int attempt = 1; attempt <= MaxRetriesPerInstance; attempt++)
                {
                    var result = await ForwardRequestToService(selectedService, catchAll, requestContent);

                    if (result != null)
                    {
                        // Successful request
                        if (cbState.Status == CircuitBreakerStatus.HalfOpen || cbState.Status == CircuitBreakerStatus.Open)
                        {
                            ResetCircuitBreaker(serviceName);
                        }
                        return result;
                    }
                    else
                    {
                        Console.WriteLine($"Attempt {attempt} failed for service '{serviceName}' instance at {selectedService}.");

                        if (attempt == MaxRetriesPerInstance)
                        {
                            // After MaxRetriesPerInstance, move on to next service instance
                            Console.WriteLine($"Moving to next service instance after {MaxRetriesPerInstance} attempts.");
                        }
                    }
                }
            }

            // After all service instances have been tried and failed
            // Increment failure count for the service
            HandleFailure(serviceName);

            // Check if failure count reaches threshold
            if (_circuitBreakerStates[serviceName].FailureCount >= FailureThreshold)
            {
                cbState.Status = CircuitBreakerStatus.Open;
                cbState.LastStateChangedTime = DateTime.UtcNow;
                Console.WriteLine($"Circuit breaker for service '{serviceName}' opened.");
            }

            return StatusCode(503, "Service unavailable.");
        }

        private async Task<IActionResult?> ForwardRequestToService(string selectedService, string catchAll, byte[] requestContent)
        {
            try
            {
                // Build the target URL
                var targetUrl = $"{selectedService}/{catchAll}{Request.QueryString}";

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
                    Console.WriteLine($"Server error {forwardResponse.StatusCode} for service {selectedService}");
                    // Server error
                    return null;
                }
                else
                {
                    // Success
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
            }
            catch (Exception ex)
            {
                // Log exception
                Console.WriteLine($"Error forwarding request to {selectedService}: {ex.Message}");
                return null;
            }
        }

        private void HandleFailure(string serviceName)
        {
            var now = DateTime.UtcNow;

            var cbState = _circuitBreakerStates.GetOrAdd(serviceName, new CircuitBreakerState
            {
                Status = CircuitBreakerStatus.Closed,
                FailureCount = 0,
                LastStateChangedTime = now
            });

            cbState.FailureCount++;

            Console.WriteLine($"Failure count for service '{serviceName}': {cbState.FailureCount}");

            if (cbState.Status == CircuitBreakerStatus.HalfOpen || cbState.Status == CircuitBreakerStatus.Closed)
            {
                if (cbState.FailureCount >= FailureThreshold)
                {
                    cbState.Status = CircuitBreakerStatus.Open;
                    cbState.LastStateChangedTime = now;
                    Console.WriteLine($"Circuit breaker for service '{serviceName}' tripped to Open state.");
                }
            }
            else if (cbState.Status == CircuitBreakerStatus.HalfOpen)
            {
                // Failure in Half-Open state, trip back to Open
                cbState.Status = CircuitBreakerStatus.Open;
                cbState.LastStateChangedTime = now;
                cbState.FailureCount = 0;
                Console.WriteLine($"Circuit breaker for service '{serviceName}' returned to Open state from Half-Open.");
            }
        }

        private void ResetCircuitBreaker(string serviceName)
        {
            var cbState = _circuitBreakerStates.GetOrAdd(serviceName, new CircuitBreakerState
            {
                Status = CircuitBreakerStatus.Closed,
                FailureCount = 0,
                LastStateChangedTime = DateTime.UtcNow
            });

            cbState.Status = CircuitBreakerStatus.Closed;
            cbState.FailureCount = 0;
            cbState.LastStateChangedTime = DateTime.UtcNow;
            Console.WriteLine($"Circuit breaker for service '{serviceName}' reset to Closed state.");
        }

        private class CircuitBreakerState
        {
            public int FailureCount { get; set; }
            public CircuitBreakerStatus Status { get; set; }
            public DateTime LastStateChangedTime { get; set; }
        }

        private enum CircuitBreakerStatus
        {
            Closed,
            Open,
            HalfOpen
        }
    }
}
