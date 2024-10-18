using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Collections.Concurrent;

namespace Gateway.Controllers
{
    [ApiController]
    [Route("{serviceName}/{**catchAll}")]
    public class GatewayController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly string _serviceDiscoveryUrl;
        private readonly ConcurrentDictionary<string, int> _serviceCounters = new ConcurrentDictionary<string, int>();

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

            // Implement round-robin selection for load balancing
            var serviceIndex = _serviceCounters.AddOrUpdate(serviceName, 0, (key, oldValue) => (oldValue + 1) % serviceAddresses.Length);
            var selectedService = serviceAddresses[serviceIndex];

            // Log the selected service for verification
            Console.WriteLine($"Forwarding request to service '{serviceName}' instance at {selectedService}.");

            // Build the target URL
            var targetUrl = $"{selectedService}/{catchAll}{Request.QueryString}";

            // Enable buffering to allow multiple reads of the request body
            Request.EnableBuffering();

            using var memoryStream = new MemoryStream();
            await Request.Body.CopyToAsync(memoryStream);
            memoryStream.Position = 0;

            var forwardRequest = new HttpRequestMessage
            {
                Method = new HttpMethod(Request.Method),
                RequestUri = new Uri(targetUrl)
            };

            if (Request.Method != HttpMethod.Get.Method && Request.Method != HttpMethod.Delete.Method)
            {
                forwardRequest.Content = new StreamContent(memoryStream);
                if (Request.ContentType != null)
                {
                    forwardRequest.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(Request.ContentType);
                }
            }

            foreach (var header in Request.Headers)
            {
                forwardRequest.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
            }

            var forwardResponse = await client.SendAsync(forwardRequest);

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
}
