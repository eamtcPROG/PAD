const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const { Order, Payment, Notification } = require("./models");
const app = express();
app.use(bodyParser.json());
app.use(cors());

const mongoURI = process.env.MONGO_URI;
mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1); // Exit the process if MongoDB connection fails
  });

// Common code for all services
const MAX_CONCURRENT_TASKS = 10;
const TASK_TIMEOUT = 5000;

let currentTaskCount = 0;

const executeTaskWithTimeout = (taskFn, timeout) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Task timed out"));
    }, timeout);

    taskFn()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
};

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
//

app.get("/status", (req, res) => {
  res.json({ status: "Ticket Order service is up and running!" });
});
//Add order
app.post("/order", taskManagerMiddleware, async (req, res) => {
  const orderData = req.body;
  try {
    const newOrder = new Order(orderData);
    await executeTaskWithTimeout(() => newOrder.save(), TASK_TIMEOUT);
    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all orders
app.get("/order", taskManagerMiddleware, async (req, res) => {
  try {
    const orders = await executeTaskWithTimeout(
      () => Order.find(),
      TASK_TIMEOUT
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(4000, () => {
  console.log("Listening on 4000");
});
