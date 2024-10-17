using Microsoft.AspNetCore.Mvc;

namespace ServiceDiscovery.Controllers
{
    [ApiController]
    [Route("status")]
    public class StatusController : ControllerBase
    {
        [HttpGet]
        public IActionResult GetStatus()
        {
            return Ok(new { status = "Service Discovery is up and running!" });
        }
    }
}
