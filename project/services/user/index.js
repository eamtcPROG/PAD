const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
// const axios = require("axios");
const sequelize = require("./config/database");
const User = require("./models/user");
const Event = require("./models/event");
const redis = require("redis");
const os = require("os");
const httpClient = require("./httpclient");
const http = require("http");
const socketIo = require('socket.io');
const WebSocket = require('ws');
const schedule = require("node-cron");

const INSTANCE_ID = os.hostname();
const SERVICE_DISCOVERY_URL =
  process.env.SERVICE_DISCOVERY_URL ||
  "http://servicediscovery:5002/api/ServiceDiscovery";
const SERVICE_NAME = process.env.SERVICE_NAME || "user";
const SERVICE_PORT = process.env.SERVICE_PORT || 4001;
const SERVICE_ADDRESS =
  `${process.env.SERVICE_ADDRESS}:${SERVICE_PORT}` ||
  `http://user:${SERVICE_PORT}`;

// Initialize Express App
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ port: 4005});
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
const TASK_TIMEOUT = 9000; // 5 seconds

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
app.use((req, res, next) => {
  res.append("X-Instance-Id", INSTANCE_ID); // Append the instanceId header
  next();
});

// Status Endpoint
app.get("/status", async (req, res) => {
  //  await new Promise(resolve => setTimeout(resolve, 6000));
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
  await new Promise((resolve) => setTimeout(resolve, 6000));
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
    const { name, date_time, venue, total_seats, due_date } = eventData;

    // Validate Required Fields
    if (!name || !date_time || !venue || !total_seats || !due_date) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    // Create New Event
    const newEvent = await Event.create({
      ...eventData,
      due_date: due_date || 60,
    });

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






app.use((err, req, res, next) => {
  console.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const registerService = async () => {
  const config = {
    method: "post",
    url: `${SERVICE_DISCOVERY_URL}/register`,
    data: {
      ServiceName: SERVICE_NAME,
      Address: SERVICE_ADDRESS,
    },
  };
  try {
    const response = await httpClient(config);
    console.log(`Service registered successfully: ${response.data}`);
  } catch (error) {
    console.error("Error registering service:", error.message);
  }
};

const deregisterService = async () => {
  try {
    const config = {
      method: "delete",
      url: `${SERVICE_DISCOVERY_URL}/deregister`,
      data: {
        ServiceName: SERVICE_NAME,
        Address: SERVICE_ADDRESS,
      },
    };

    const response = await httpClient(config);
    console.log(`Service deregistered successfully: ${response.data}`);
  } catch (error) {
    console.error("Error deregistering service:", error.message);
  }
};

const gracefulShutdown = async () => {
  console.log("Shutting down gracefully...");
  await deregisterService();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
const subscriptions = {};
wss.on('connection', (ws, req) => {
  console.log('Client connected via WebSocket');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      const { type, payload } = message;

      if (type === 'subscribeToEvent') {
        const { eventId } = payload;
        if (!eventId) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'eventId is required to subscribe.' } }));
          return;
        }

        if (!subscriptions[eventId]) {
          subscriptions[eventId] = new Set();
        }
        subscriptions[eventId].add(ws);
        console.log(`Client subscribed to event ${eventId}`);
      } else if (type === 'unsubscribeFromEvent') {
        const { eventId } = payload;
        if (!eventId) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'eventId is required to unsubscribe.' } }));
          return;
        }

        if (subscriptions[eventId]) {
          subscriptions[eventId].delete(ws);
          console.log(`Client unsubscribed from event ${eventId}`);
          if (subscriptions[eventId].size === 0) {
            delete subscriptions[eventId];
          }
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Unknown message type.' } }));
      }
    } catch (err) {
      console.error('Error parsing message:', err);
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid message format.' } }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected from WebSocket');
    // Remove client from all subscriptions
    for (const eventId in subscriptions) {
      subscriptions[eventId].delete(ws);
      if (subscriptions[eventId].size === 0) {
        delete subscriptions[eventId];
      }
    }
  });
});

app.post('/broadcast-event', (req, res) => {
  const { message, eventId } = req.body;

  if (!message || !eventId) {
    return res.status(400).json({ message: 'Message is required.' });
  }

  if (subscriptions[eventId] && subscriptions[eventId].size > 0) {
    subscriptions[eventId].forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'eventReminder',
          payload: {
            eventId: eventId,
            reminder: message,
          },
        }));
      }
    });
    console.log(`Broadcasted message to event ${eventId}: ${message}`);
    res.json({ message: `Broadcasted message to event ${eventId}.` });
  } else {
    console.log(`No subscribers found for event ${eventId}.`);
    res.status(200).json({ message: `No subscribers for event ${eventId}.` });
  }
});

server.listen(SERVICE_PORT,async () => {
  console.log(`Listening on port ${SERVICE_PORT}`);
  await registerService();
});

