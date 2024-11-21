const logger = {
  log: (...message) => {
    console.log(`[${new Date().toISOString()}] [INFO] [user] ${message.join(' ')}`);
  },
  error: (...message) => {
    console.error(`[${new Date().toISOString()}] [ERROR] [user] ${message.join(' ')}`);
  },
};
module.exports = logger;