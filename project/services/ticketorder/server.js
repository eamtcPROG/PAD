const app = require('./index');
const mongoose = require('mongoose');
// const axios = require('axios');
const httpClient = require('./httpclient');
const process = require('process');

const mongoURI = process.env.MONGO_URI || process.env.MONGO_URL;

const SERVICE_DISCOVERY_URL = process.env.SERVICE_DISCOVERY_URL || 'http://servicediscovery:5002/api/ServiceDiscovery';
const SERVICE_NAME = process.env.SERVICE_NAME || 'ticketorder';
const SERVICE_PORT = process.env.SERVICE_PORT || 4000;
const SERVICE_ADDRESS = `${process.env.SERVICE_ADDRESS}:${SERVICE_PORT}` || `http://ticketorder:${SERVICE_PORT}`;

const registerService = async () => {
  try {
    console.log("Service address",SERVICE_ADDRESS)
    const response = await httpClient({
      method: 'post',
      url: `${SERVICE_DISCOVERY_URL}/register`,
      data: {
        ServiceName: SERVICE_NAME,
        Address: SERVICE_ADDRESS,
      },
    });
    // const response = await axios.post(`${SERVICE_DISCOVERY_URL}/register`, {
    //   ServiceName: SERVICE_NAME,
    //   Address: SERVICE_ADDRESS,
    // });
    console.log(`Service registered successfully: ${response.data}`);
  } catch (error) {
    console.error('Error registering service:', error.message);
  }
};


const deregisterService = async () => {
  try {
    const response = await httpClient({
      method: 'delete',
      url: `${SERVICE_DISCOVERY_URL}/deregister`,
      data: {
        ServiceName: SERVICE_NAME,
        Address: SERVICE_ADDRESS,
      },
    });
    // const response = await axios.delete(`${SERVICE_DISCOVERY_URL}/deregister`, {
    //   data: {
    //     ServiceName: SERVICE_NAME,
    //     Address: SERVICE_ADDRESS,
    //   },
    // });
    console.log(`Service deregistered successfully: ${response.data}`);
  } catch (error) {
    console.error('Error deregistering service:', error.message);
  }
};

mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    console.log("Connected to MongoDB");
    
    await registerService();
    app.listen(SERVICE_PORT, () => {
      console.log(`Listening on port ${SERVICE_PORT}`);
    });

    const gracefulShutdown = async () => {
      console.log('Shutting down gracefully...');
      await deregisterService();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    };

  
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
