using Microsoft.AspNetCore.Mvc;
using ServiceDiscovery;
using StackExchange.Redis;
using System.Text.Json;

namespace ServiceDiscovery.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ServiceDiscoveryController : ControllerBase
    {
        private readonly IServiceRepository _repository;

        public ServiceDiscoveryController(IServiceRepository repository)
        {
            _repository = repository;
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] ServiceInstance instance)
        {
            if (string.IsNullOrEmpty(instance.ServiceName) || string.IsNullOrEmpty(instance.Address))
            {
                return BadRequest("ServiceName and Address are required.");
            }

            await _repository.RegisterServiceAsync(instance);
            return Ok("Service registered successfully.");
        }

        [HttpDelete("deregister")]
        public async Task<IActionResult> Deregister([FromBody] ServiceInstance instance)
        {
            if (string.IsNullOrEmpty(instance.ServiceName) || string.IsNullOrEmpty(instance.Address))
            {
                return BadRequest("ServiceName and Address are required.");
            }

            await _repository.DeregisterServiceAsync(instance);
            return Ok("Service deregistered successfully.");
        }

        // [HttpGet("service/{serviceName}")]
        // public async Task<IActionResult> GetService(string serviceName)
        // {
        //     var address = await _repository.GetServiceAsync(serviceName);
        //     if (address == null)
        //     {
        //         return NotFound("Service not found.");
        //     }

        //     return Ok(new { Address = address });
        // }

        [HttpGet("service/{serviceName}")]
        public async Task<IActionResult> GetService(string serviceName)
        {
            // Modify the repository to get all service addresses
            var serviceAddresses = await _repository.GetAllServicesAsync(serviceName);

            if (serviceAddresses == null || !serviceAddresses.Any())
            {
                return NotFound("Service not found.");
            }

            return Ok(serviceAddresses);
        }
    }
}
