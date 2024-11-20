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

namespace Gateway.Controllers
{
    [ApiController]
    [Route("{serviceName}/{**catchAll}")]
    public class GatewayController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly string _serviceDiscoveryUrl;
        private readonly ConcurrentDictionary<string, CircuitBreakerState> _circuitBreakerStates = new ConcurrentDictionary<string, CircuitBreakerState>();

        private const int FailureThreshold = 3;
        private const int OpenStateDuration = 60; // seconds

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

            // Get current time
            var now = DateTime.UtcNow;

            // Filter out service instances whose circuit breaker is Open
            var availableServices = new List<string>();

            foreach (var serviceAddress in serviceAddresses)
            {
                var cbState = _circuitBreakerStates.GetOrAdd(serviceAddress, new CircuitBreakerState
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
                        availableServices.Add(serviceAddress);
                    }
                    else
                    {
                        // Still in Open state
                        continue;
                    }
                }
                else
                {
                    availableServices.Add(serviceAddress);
                }
            }

            if (availableServices.Count == 0)
            {
                return StatusCode(503, "All instances are unavailable.");
            }

            // Randomize the availableServices list
            availableServices = availableServices.OrderBy(s => Guid.NewGuid()).ToList();

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

                var result = await ForwardRequestToService(selectedService, catchAll, requestContent);
                if (result != null)
                {
                    return result;
                }
            }

            // If we reach here, all attempts failed
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
                    // Server error, handle failure
                    HandleFailure(selectedService);
                    return null;
                }
                else
                {
                    // Success, reset failure count
                    ResetFailure(selectedService);

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
                // Handle failure
                HandleFailure(selectedService);
                Console.WriteLine($"Error forwarding request to {selectedService}: {ex.Message}");
                return null;
            }
        }

        private void HandleFailure(string serviceAddress)
        {
            var now = DateTime.UtcNow;

            var cbState = _circuitBreakerStates.GetOrAdd(serviceAddress, new CircuitBreakerState
            {
                Status = CircuitBreakerStatus.Closed,
                FailureCount = 0,
                LastStateChangedTime = now
            });

            cbState.FailureCount++;

            Console.WriteLine($"Request to {serviceAddress} failed. Failure count: {cbState.FailureCount}");

            if (cbState.Status == CircuitBreakerStatus.Closed || cbState.Status == CircuitBreakerStatus.HalfOpen)
            {
                if (cbState.FailureCount >= FailureThreshold)
                {
                    cbState.Status = CircuitBreakerStatus.Open;
                    cbState.LastStateChangedTime = now;
                    Console.WriteLine($"Circuit breaker for {serviceAddress} tripped to Open state.");
                }
            }
            else if (cbState.Status == CircuitBreakerStatus.HalfOpen)
            {
                // Failure in Half-Open state, trip back to Open
                cbState.Status = CircuitBreakerStatus.Open;
                cbState.LastStateChangedTime = now;
                cbState.FailureCount = 0;
                Console.WriteLine($"Circuit breaker for {serviceAddress} returned to Open state from Half-Open.");
            }
        }

        private void ResetFailure(string serviceAddress)
        {
            Console.WriteLine("ResetFailure");
            var cbState = _circuitBreakerStates.GetOrAdd(serviceAddress, new CircuitBreakerState
            {
                Status = CircuitBreakerStatus.Closed,
                FailureCount = 0,
                LastStateChangedTime = DateTime.UtcNow
            });

            if (cbState.Status == CircuitBreakerStatus.HalfOpen || cbState.Status == CircuitBreakerStatus.Open)
            {
                // Successful request in Half-Open or Open state, reset to Closed
                cbState.Status = CircuitBreakerStatus.Closed;
                cbState.FailureCount = 0;
                cbState.LastStateChangedTime = DateTime.UtcNow;
                Console.WriteLine($"Circuit breaker for {serviceAddress} reset to Closed state.");
            }
            else
            {
                // Successful request in Closed state, reset failure count
                cbState.FailureCount = 0;
            }
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