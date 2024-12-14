const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
// const axios = require("axios");
const { Order, Payment } = require("./models");
const Redis = require("ioredis");
const os = require("os");
const httpClient = require("./httpclient");
const logger = require("./logger");

const INSTANCE_ID = os.hostname();
const app = express();
app.use(bodyParser.json());
app.use(cors());

const redisClient = new Redis.Cluster(
  [
    { host: 'redis1', port: 7001 },
    { host: 'redis2', port: 7002 },
    { host: 'redis3', port: 7003 },
  ],
  {
    scaleReads: 'all',
  }
);

// redisClient.on('connect', () => {
//   console.log('Successfully connected to Redis');
// });

redisClient.connect().then(()=>{
  logger.log('Redis connected')
}).catch((e)=>{
  logger.error('Error redis ',e);
})



// redisClient.on('reconnecting', (delay) => {
//   console.log(`Reconnecting to Redis, delay: ${delay} ms`);
// });

// redisClient.on('error', (err) => {
//   console.error('Redis connection error:', err);
// });
// redisClient.connect().catch((err) => {
//   logger.error("Error connecting to Redis:", err);
// });

process.on("SIGINT", () => {
  redisClient.quit();
});

// Common code for all services
const MAX_CONCURRENT_TASKS = 10;
const TASK_TIMEOUT = 5000;

let currentTaskCount = 0;

// Timeout Middleware
const timeoutMiddleware = (timeout) => {
  return (req, res, next) => {
    // Set a timer to trigger the timeout
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ message: "Request Timeout" });
      }
    }, timeout);

    // Clear the timer when the response is finished
    res.on("finish", () => {
      clearTimeout(timer);
    });

    // Clear the timer if the connection is closed
    res.on("close", () => {
      clearTimeout(timer);
    });

    next();
  };
};
// Task Manager Middleware
const taskManagerMiddleware = (req, res, next) => {
  if (currentTaskCount >= MAX_CONCURRENT_TASKS) {
    return res
      .status(503)
      .json({ message: "Server too busy. Try again later." });
  }
  currentTaskCount++;
  res.on("finish", () => {
    currentTaskCount--;
  });
  next();
};

// Apply Middlewares
app.use(taskManagerMiddleware);
app.use(timeoutMiddleware(TASK_TIMEOUT));
app.use((req, res, next) => {
  res.append("X-Instance-Id", INSTANCE_ID);
  next();
});

const SERVICE_DISCOVERY_URL =
  process.env.SERVICE_DISCOVERY_URL ||
  "http://servicediscovery:8080/api/ServiceDiscovery";

const getUserServiceAddress = async () => {
  const config = {
    method: "get",
    url: `${SERVICE_DISCOVERY_URL}/service/user`,
    timeout: TASK_TIMEOUT, // Optional: Set specific timeout for this request
  };

  try {
    // const response = await axios.get(`${SERVICE_DISCOVERY_URL}/service/user`);
    const response = await httpClient(config);
    logger.log("User service address:", response.data);
    if (!response.data || !response.data.length) {
      throw new Error("User service not found");
    }

    return response.data[0]; // Address includes IP and port
  } catch (error) {
    logger.error("Error fetching user service address:", error.message);
    throw error; // Handle error appropriately
  }
};

// Status Endpoint
app.get("/status", async (req, res) => {
  //  await new Promise(resolve => setTimeout(resolve, 6000));
  // throw new Error("Test error");
  // return res.status(500).json({ message: "Test error" });
  res.json({ status: "Ticket Order service is up and running!" });
});

const addOrderSaga = async (req, res, next) => {
  const orderData = req.body;
  try {
    const newOrder = new Order(orderData);
    await newOrder.save();

    // Invalidate the cache
    await redisClient.del("orders"); // Remove cached list of orders
    await redisClient.set(
      `order:${newOrder._id}`,
      JSON.stringify(newOrder.toObject()) // Convert to plain object
    ); // Cache the new order
    console.log("Order added")
    res.status(201).json(newOrder);
  } catch (err) {
    next(err); // Correct variable name
  }
}

const deleteOrderSaga = async (req, res, next) => {
  const { id } = req.body;
  try {
    await Order.findByIdAndDelete(id);
    await redisClient.del("orders"); // Remove cached list of orders
    await redisClient.del(`order:${id}`); // Remove cached order
    res.status(200).json({ message: "Order deleted" });
  } catch (err) {
    next(err);
  }
}

app.post("/order-saga", addOrderSaga);
app.post("/delete-order-saga", deleteOrderSaga);

// Add Order
app.post("/order", async (req, res, next) => {
  const orderData = req.body;
  try {
    const newOrder = new Order(orderData);
    await newOrder.save();

    // Invalidate the cache
    await redisClient.del("orders"); // Remove cached list of orders
    await redisClient.set(
      `order:${newOrder._id}`,
      JSON.stringify(newOrder.toObject()) // Convert to plain object
    ); // Cache the new order
    
    res.status(201).json(newOrder);
  } catch (err) {
    next(err); // Correct variable name
  }
});

// Get All Orders
app.get("/order", async (req, res, next) => {
  try {
    // await new Promise((resolve) => setTimeout(resolve, 6000));
    const cachedOrders = await redisClient.get("orders");

    if (cachedOrders) {
      console.log("From redis")
      return res.json(JSON.parse(cachedOrders));
    } else {
      const orders = await Order.find().lean(); 

      await redisClient.set("orders", JSON.stringify(orders)); 

      console.log("From database")
      res.json(orders);
    }
  } catch (err) {
    next(err);
  }
});

app.get("/circuit-test/:id", async (req, res, next) => {
  const { id } = req.params;

  try {
    if (id == "1") {
      return res.status(500).json({ message: "Test error" });
    } else {
      return res.json({ message: "Test success" });
    }
  } catch (err) {
    next(err);
  }
});

// Get Order by ID
app.get("/order/:id", async (req, res, next) => {
  const { id } = req.params;

  try {
    const cachedOrder = await redisClient.get(`order:${id}`);

    if (cachedOrder) {
      return res.json(JSON.parse(cachedOrder));
    } else {
      const order = await Order.findById(id).lean(); // Use lean()

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      await redisClient.set(`order:${id}`, JSON.stringify(order)); // Safe to stringify
      res.json(order);
    }
  } catch (err) {
    next(err);
  }
});

// Create Order with User
app.post("/order/create-with-user", async (req, res, next) => {
  const { user_id, orderData } = req.body;

  try {
    const url = await getUserServiceAddress();
    if (!url) {
      return res.status(500).json({ message: "User service not found" });
    }

    logger.log(req, req.body, user_id, orderData);
    // const response = await axios.get(`${url}/user/${user_id}`);
    const config = {
      method: "get",
      url: `${url}/user/${user_id}`,
      timeout: TASK_TIMEOUT,
    };
    const response = await httpClient(config);
    const user = response.data;

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const newOrder = new Order({ ...orderData, user_id });
    await newOrder.save();

    // Invalidate the cache
    await redisClient.del("orders");
    await redisClient.set(
      `order:${newOrder._id}`,

      JSON.stringify(newOrder.toObject()) // Convert to plain object
    );

    res.status(201).json({
      message: "Order created with user",
      order: newOrder,
      user,
    });
  } catch (err) {
    next(err);
  }
});

// Payment Endpoints
app.post("/payment", async (req, res, next) => {
  const paymentData = req.body;

  try {
    if (
      !paymentData.order_id ||
      !paymentData.amount ||
      !paymentData.payment_method
    ) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const newPayment = new Payment(paymentData);
    await newPayment.save();

    await Order.findByIdAndUpdate(paymentData.order_id, {
      order_status: "paid",
    });

    res.status(201).json(newPayment);
  } catch (err) {
    next(err);
  }
});

app.get("/payment/:id", async (req, res, next) => {
  const { id } = req.params;

  try {
    const payment = await Payment.findById(id).lean(); // Use lean()

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json(payment);
  } catch (err) {
    next(err);
  }
});

// Error Handling Middleware (Should be last)
app.use((err, req, res, next) => {
  logger.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = app;
