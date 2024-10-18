using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;

namespace Gateway.Controllers
{
    [ApiController]
    [Route("{serviceName}/{**catchAll}")]
    public class GatewayController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly string _serviceDiscoveryUrl;

        public GatewayController(IHttpClientFactory httpClientFactory, IConfiguration configuration)
        {
            _httpClientFactory = httpClientFactory;
            _serviceDiscoveryUrl = configuration["ServiceDiscovery:Url"]
                                    ?? throw new ArgumentNullException("ServiceDiscovery:Url");
        }


        [HttpGet, HttpPost, HttpPut, HttpDelete, HttpPatch]
        public async Task<IActionResult> HandleRequest(string serviceName, string catchAll)
        {
            // Fetch the service address from Service Discovery
            var client = _httpClientFactory.CreateClient();
            var response = await client.GetAsync($"{_serviceDiscoveryUrl}{serviceName}");

            if (!response.IsSuccessStatusCode)
            {
                return NotFound($"Service '{serviceName}' not found.");
            }

            var serviceInfo = await response.Content.ReadFromJsonAsync<ServiceDiscoveryResponse>();
            if (serviceInfo == null || string.IsNullOrEmpty(serviceInfo.Address))
            {
                return NotFound($"Service '{serviceName}' not found.");
            }

            // Build the target URL
            var targetUrl = $"{serviceInfo.Address}/{catchAll}{Request.QueryString}";

            // Enable buffering to allow multiple reads of the request body
            Request.EnableBuffering();

            // Read the request body into a MemoryStream
            using var memoryStream = new MemoryStream();
            await Request.Body.CopyToAsync(memoryStream);
            memoryStream.Position = 0; // Reset position to read it again

            // Create a new HttpRequestMessage for forwarding
            var forwardRequest = new HttpRequestMessage
            {
                Method = new HttpMethod(Request.Method),
                RequestUri = new Uri(targetUrl)
            };

            // If there's a body (e.g., for POST, PUT requests), copy it
            if (Request.Method != HttpMethod.Get.Method && Request.Method != HttpMethod.Delete.Method)
            {
                forwardRequest.Content = new StreamContent(memoryStream);
                // Ensure content type is correctly forwarded (e.g., application/json)
                if (Request.ContentType != null)
                {
                    forwardRequest.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(Request.ContentType);
                }
            }

            // Copy all request headers
            foreach (var header in Request.Headers)
            {
                forwardRequest.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
            }

            // Send the request to the target service
            var forwardResponse = await client.SendAsync(forwardRequest);

            // Copy response headers from the target service to the gateway response
            foreach (var header in forwardResponse.Headers)
            {
                Response.Headers[header.Key] = header.Value.ToArray();
            }

            foreach (var header in forwardResponse.Content.Headers)
            {
                Response.Headers[header.Key] = header.Value.ToArray();
            }

            // Set the status code
            Response.StatusCode = (int)forwardResponse.StatusCode;

            // Return the response content
            var responseContent = await forwardResponse.Content.ReadAsByteArrayAsync();
            return File(responseContent, forwardResponse.Content.Headers.ContentType?.ToString() ?? "application/octet-stream");
        }

    }

    public class ServiceDiscoveryResponse
    {
        public string Address { get; set; } = string.Empty;
    }
}
