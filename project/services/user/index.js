const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const sequelize = require("./config/database");
const User = require("./models/user");
const Event = require("./models/event");
const redis = require("redis");

// Initialize Express App
const app = express();

// Apply Global Middlewares
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

// Handle Redis Client Shutdown Gracefully
process.on("SIGINT", () => {
  redisClient.quit();
});

// Synchronize Sequelize Models with PostgreSQL
sequelize
  .sync({ alter: true })
  .then(() => {
    console.log("PostgreSQL connected and models synchronized");
  })
  .catch((err) => {
    console.error("Unable to connect to the database:", err);
  });

// Configuration Constants
const MAX_CONCURRENT_TASKS = 10;
const TASK_TIMEOUT = 5000; // 5 seconds

let currentTaskCount = 0;

// Task Manager Middleware
const taskManagerMiddleware = (req, res, next) => {
  if (currentTaskCount >= MAX_CONCURRENT_TASKS) {
    return res
      .status(503)
      .json({ message: "Server too busy. Try again later." });
  }

  currentTaskCount++;

  // Decrement task count when response finishes or connection closes
  res.on("finish", () => {
    currentTaskCount--;
  });

  res.on("close", () => {
    currentTaskCount--;
  });

  next();
};

// Timeout Middleware
const timeoutMiddleware = (timeout) => {
  return (req, res, next) => {
    // Set a timer to trigger the timeout
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        console.log(`Request timed out: ${req.method} ${req.originalUrl}`);
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

// Apply Global Middlewares
app.use(taskManagerMiddleware);
app.use(timeoutMiddleware(TASK_TIMEOUT));

// Status Endpoint
app.get("/status", (req, res) => {
  res.json({ status: "User service is up and running!" });
});

// Create a New User
app.post("/user", async (req, res, next) => {
  try {
    const user = await User.create(req.body);

    // Invalidate and Update Redis Cache
    await redisClient.del("users"); // Remove cached list of users
    await redisClient.setEx(
      `user:${user.id}`,
      3600,
      JSON.stringify({ id: user.id, email: user.email }) // Store only necessary fields
    ); // Cache the new user

    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    next(err); // Pass errors to the error-handling middleware
  }
});

// Register a New User
app.post("/user/register", async (req, res, next) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    // Check if User Already Exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "User with this email already exists." });
    }

    // Create New User
    const newUser = await User.create({ email, password });

    // Invalidate and Update Redis Cache
    await redisClient.del("users");
    await redisClient.setEx(
      `user:${newUser.id}`,
      3600,
      JSON.stringify({ id: newUser.id, email: newUser.email })
    );

    res.status(201).json({ id: newUser.id, email: newUser.email });
  } catch (err) {
    next(err);
  }
});

// User Login
app.post("/user/login", async (req, res, next) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    // Find User by Email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Validate Password (Consider Hashing in Production)
    if (user.password !== password) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    res.status(200).json({
      message: "Login successful",
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    next(err);
  }
});

// Get User by ID
app.get("/user/:id", async (req, res, next) => {
  const { id } = req.params;

  try {
    // Check Redis Cache
    const cachedUser = await redisClient.get(`user:${id}`);

    if (cachedUser) {
      return res.json(JSON.parse(cachedUser));
    } else {
      // Fetch User from Database
      const user = await User.findByPk(id);

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      // Cache the User Data
      await redisClient.setEx(
        `user:${id}`,
        3600,
        JSON.stringify({ id: user.id, email: user.email })
      );

      return res.json({ id: user.id, email: user.email });
    }
  } catch (err) {
    next(err);
  }
});

// Get All Users
app.get("/user", async (req, res, next) => {
  try {
    // Check Redis Cache
    const cachedUsers = await redisClient.get("users");

    if (cachedUsers) {
      return res.json(JSON.parse(cachedUsers));
    } else {
      // Fetch All Users from Database
      const users = await User.findAll({
        attributes: ["id", "email"], // Select only necessary fields
      });

      // Cache the Users Data
      await redisClient.setEx("users", 3600, JSON.stringify(users));

      return res.json(users);
    }
  } catch (err) {
    next(err);
  }
});

// Create a New Event
app.post("/event", async (req, res, next) => {
  const eventData = req.body;

  try {
    const { name, date_time, venue, total_seats } = eventData;

    // Validate Required Fields
    if (!name || !date_time || !venue || !total_seats) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    // Create New Event
    const newEvent = await Event.create(eventData);

    res.status(201).json(newEvent);
  } catch (err) {
    next(err);
  }
});

// Get All Events
app.get("/event", async (req, res, next) => {
  try {
    // await new Promise((resolve) => setTimeout(resolve, 6000));
    const events = await Event.findAll();

    res.json(events);
  } catch (err) {
    next(err);
  }
});

// Get Event by ID
app.get("/event/:id", async (req, res, next) => {
  const { id } = req.params;

  try {
    const event = await Event.findByPk(id);

    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    res.json(event);
  } catch (err) {
    next(err);
  }
});

// Global Error Handling Middleware (Should be Last)
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (!res.headersSent) {
    // If headers are not sent, send a 500 Internal Server Error
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const SERVICE_DISCOVERY_URL = process.env.SERVICE_DISCOVERY_URL || 'http://servicediscovery:5002/api/ServiceDiscovery';
const SERVICE_NAME = process.env.SERVICE_NAME || 'user';
const SERVICE_PORT = process.env.SERVICE_PORT || 4001;
const SERVICE_ADDRESS = `${process.env.SERVICE_ADDRESS}:${SERVICE_PORT}` || `http://user:${SERVICE_PORT}`;

const registerService = async () => {
  try {
    const response = await axios.post(`${SERVICE_DISCOVERY_URL}/register`, {
      ServiceName: SERVICE_NAME,
      Address: SERVICE_ADDRESS,
    });
    console.log(`Service registered successfully: ${response.data}`);
  } catch (error) {
    console.error('Error registering service:', error.message);
  }
};


const deregisterService = async () => {
  try {
    const response = await axios.delete(`${SERVICE_DISCOVERY_URL}/deregister`, {
      data: {
        ServiceName: SERVICE_NAME,
        Address: SERVICE_ADDRESS,
      },
    });
    console.log(`Service deregistered successfully: ${response.data}`);
  } catch (error) {
    console.error('Error deregistering service:', error.message);
  }
};


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

// Start the Server
app.listen(SERVICE_PORT, async () => {
  console.log(`Listening on port ${SERVICE_PORT}`);
  await registerService();
});
