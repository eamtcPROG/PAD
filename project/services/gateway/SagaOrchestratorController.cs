using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

[ApiController]
[Route("saga")]
public class SagaOrchestratorController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _serviceDiscoveryUrl;

    public SagaOrchestratorController(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration
    )
    {
        _httpClientFactory = httpClientFactory;
        _serviceDiscoveryUrl =
            configuration["ServiceDiscovery:Url"]
            ?? throw new ArgumentNullException("ServiceDiscovery:Url");
    }

    [HttpPost]
    public async Task<IActionResult> ExecuteSaga([FromBody] dynamic orderData)
    {
        var httpClient = _httpClientFactory.CreateClient();
        string iduser = string.Empty;
        string idorder = string.Empty;
        string url = string.Empty;
        try
        {
            url = await GetService("ticketorder");
            Console.WriteLine($"TicketOrder service URL: {url}");
            var createOrderResponse = await httpClient.PostAsync(
                $"{url}/order-saga",
                new StringContent(
                    JsonSerializer.Serialize(orderData),
                    Encoding.UTF8,
                    "application/json"
                )
            );

            if (!createOrderResponse.IsSuccessStatusCode)
            {
                throw new Exception("Failed to create order in TicketOrder service.");
            }

            var orderResponseContent = await createOrderResponse.Content.ReadAsStringAsync();
            var createdOrder = JsonSerializer.Deserialize<JsonElement>(orderResponseContent);

            Console.WriteLine($"Order created successfully. {createdOrder}");
            idorder = createdOrder.GetProperty("_id").GetString();
            iduser = orderData.GetProperty("user_id").GetString();

            var userData = new { id = iduser };

            url = await GetService("user");
            var increaseOrderResponse = await httpClient.PostAsync(
                $"{url}/user/increase-for-saga",
                new StringContent(
                    JsonSerializer.Serialize(userData),
                    Encoding.UTF8,
                    "application/json"
                )
            );

            if (!increaseOrderResponse.IsSuccessStatusCode)
            {
                throw new Exception("Rolled back the order creation due to user service failure.");
            }

            Console.WriteLine("User order count updated successfully.");
            return Ok(new { message = "Saga executed successfully." });
        }
        catch (Exception ex)
        {
            await Compensate(idorder, iduser);
            Console.WriteLine($"Saga failed: {ex.Message}");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private async Task<string> GetService(string serviceName)
    {
        var client = _httpClientFactory.CreateClient();
        var response = await client.GetAsync($"{_serviceDiscoveryUrl}service/{serviceName}");

        if (!response.IsSuccessStatusCode)
        {
            throw new Exception($"Service '{serviceName}' not found.");
        }

        var serviceEntries = await response.Content.ReadFromJsonAsync<ServiceEntry[]>();

        if (serviceEntries == null || serviceEntries.Length == 0)
        {
            throw new Exception($"No instances found for service '{serviceName}'.");
        }

        return serviceEntries[0].Address;
    }

    private async Task Compensate(string orderId, string userId)
    {
        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            if (!string.IsNullOrEmpty(orderId))
            {
                var url = await GetService("ticketorder");
                await httpClient.PostAsync(
                    $"{url}/delete-order-saga",
                    new StringContent(
                        JsonSerializer.Serialize(new { id = orderId }),
                        Encoding.UTF8,
                        "application/json"
                    )
                );
                Console.WriteLine("Compensation executed: Order deleted successfully.");
            }

            if (!string.IsNullOrEmpty(userId))
            {
                var url = await GetService("user");
                await httpClient.PostAsync(
                    $"{url}/user/decrease-for-saga",
                    new StringContent(
                        JsonSerializer.Serialize(new { id = userId }),
                        Encoding.UTF8,
                        "application/json"
                    )
                );
                Console.WriteLine(
                    "Compensation executed: User order count decreased successfully."
                );
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Compensation failed: {ex.Message}");
        }
    }

    public class ServiceEntry
    {
        public string Key { get; set; } = string.Empty;
        public string Address { get; set; } = string.Empty;
    }
}
