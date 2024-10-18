
const axios = require('axios');
const CircuitBreaker = require('opossum');

const taskTimeoutLimit = 5000; 

const breakerOptions = {
  timeout: taskTimeoutLimit, 
  errorThresholdPercentage: 50, 
  resetTimeout: 10000, 
  rollingCountTimeout: taskTimeoutLimit * 3.5, 
  rollingCountBuckets: 10, 
  volumeThreshold: 3, 
};
const performRequest = async (config) => {
  return axios(config);
};

const circuitBreaker = new CircuitBreaker(performRequest, breakerOptions);


circuitBreaker.on('open', () => {
  console.warn('Circuit breaker opened - stopping requests to the service.');
});
circuitBreaker.on('halfOpen', () => {
  console.info('Circuit breaker half-open - testing service availability.');
});
circuitBreaker.on('close', () => {
  console.log('Circuit breaker closed - service is healthy again.');
});
circuitBreaker.on('fallback', () => {
  console.log('Circuit breaker fallback executed.');
});
circuitBreaker.on('failure', (error) => {
  console.error('Circuit breaker failure:', error.message);
});

circuitBreaker.fallback(() => {
  return { message: 'Service is currently unavailable. Please try again later.' };
});


const httpClient = async (config) => {
  try {
    const response = await circuitBreaker.fire(config);
    return response;
  } catch (error) {
    throw error;
  }
};

module.exports = httpClient;
