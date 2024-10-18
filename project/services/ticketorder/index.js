const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const { Order, Payment } = require("./models");
const redis = require("redis");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Redis Client Initialization
const redisClient = redis.createClient({
  url: "redis://redis:6379",
});

redisClient.on("error", (err) => {
  console.error("Redis connection error:", err);
});

redisClient.on("connect", () => {
  console.log("Connected to Redis");
});

redisClient.connect().catch((err) => {
  console.error("Error connecting to Redis:", err);
});

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
    res.on('finish', () => {
      clearTimeout(timer);
    });

    // Clear the timer if the connection is closed
    res.on('close', () => {
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

const SERVICE_DISCOVERY_URL = process.env.SERVICE_DISCOVERY_URL || 'http://servicediscovery:8080/api/ServiceDiscovery';

const getUserServiceAddress = async () => {
  try {
    const response = await axios.get(`${SERVICE_DISCOVERY_URL}/service/user`);
    console.log('User service address:', response.data);
    if (!response.data || !response.data.address) {
      throw new Error('User service not found');
    }
    
    return response.data.address; // Address includes IP and port
  } catch (error) {
    console.error('Error fetching user service address:', error.message);
    throw error; // Handle error appropriately
  }
};

// Status Endpoint
app.get("/status", (req, res) => {
  res.json({ status: "Ticket Order service is up and running!" });
});

// Add Order
app.post("/order", async (req, res, next) => {
  const orderData = req.body;
  try {
    const newOrder = new Order(orderData);
    await newOrder.save();

    // Invalidate the cache
    await redisClient.del("orders"); // Remove cached list of orders
    await redisClient.setEx(
      `order:${newOrder._id}`,
      3600,
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
      return res.json(JSON.parse(cachedOrders));
    } else {
      const orders = await Order.find().lean(); // Await and use lean()

      await redisClient.setEx("orders", 3600, JSON.stringify(orders)); // Now safe to stringify
      res.json(orders);
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
      await redisClient.setEx(`order:${id}`, 3600, JSON.stringify(order)); // Safe to stringify
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
    if(!url) {
      return res.status(500).json({ message: "User service not found" });
    }

    console.log(req, req.body,user_id, orderData);
    const response = await axios.get(`${url}/user/${user_id}`);
    const user = response.data;

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const newOrder = new Order({ ...orderData, user_id });
    await newOrder.save(); 

    // Invalidate the cache
    await redisClient.del("orders");
    await redisClient.setEx(
      `order:${newOrder._id}`,
      3600,
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
  console.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = app;
