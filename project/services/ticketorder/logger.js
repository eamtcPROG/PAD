const logger = {
  log: (...message) => {
    console.log(`[${new Date().toISOString()}] [INFO] [ticketorder] ${message.join(" ")}`);
  },
  error: (...message) => {
    console.error(`[${new Date().toISOString()}] [ERROR] [ticketorder] ${message.join(" ")}`);
  },
};
module.exports = logger;
