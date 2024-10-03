const express = require("express");

const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const sequelize = require("./config/database");
const User = require("./models/user");
const Event = require("./models/event");

const app = express();
app.use(bodyParser.json());
app.use(cors());

sequelize
  .sync({ alter: true })
  .then(() => {
    console.log("PostgreSQL connected and models synchronized");
  })
  .catch((err) => {
    console.error("Unable to connect to the database:", err);
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
  res.json({ status: "User service is up and running!" });
});

app.post("/user", taskManagerMiddleware, async (req, res) => {
  try {
    const user = await executeTaskWithTimeout(
      () => User.create(req.body),
      TASK_TIMEOUT
    ); 
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/user/register", taskManagerMiddleware, async (req, res) => {
  const { email, password } = req.body;

  try {
    
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    
    const existingUser = await executeTaskWithTimeout(() => User.findOne({ where: { email } }), TASK_TIMEOUT);
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists." });
    }

    
    const newUser = await executeTaskWithTimeout(() => User.create({ email, password }), TASK_TIMEOUT);

    
    res.status(201).json({ id: newUser.id, email: newUser.email });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/user/login", taskManagerMiddleware, async (req, res) => {
  const { email, password } = req.body;

  try {
    
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    
    const user = await executeTaskWithTimeout(() => User.findOne({ where: { email } }), TASK_TIMEOUT);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    
    if (user.password !== password) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    
    res.status(200).json({ message: "Login successful", user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/user/:id", taskManagerMiddleware, async (req, res) => {
  const { id } = req.params;  

  try {
    
    const user = await executeTaskWithTimeout(() => User.findByPk(id), TASK_TIMEOUT);

    if (!user) {
      return res.status(404).json({ message: "User not found." });  
    }

    
    res.json({ id: user.id, email: user.email });
  } catch (err) {
    res.status(500).json({ message: err.message });  
  }
});

app.get("/user", taskManagerMiddleware, async (req, res) => {
  try {
    const users = await executeTaskWithTimeout(() => User.findAll(), TASK_TIMEOUT);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/event", taskManagerMiddleware, async (req, res) => {
  const eventData = req.body;

  try {
    
    if (!eventData.name || !eventData.date_time || !eventData.venue || !eventData.total_seats) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    
    const newEvent = await executeTaskWithTimeout(() => Event.create(eventData), TASK_TIMEOUT);
    res.status(201).json(newEvent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/event", taskManagerMiddleware, async (req, res) => {
  try {
    const events = await executeTaskWithTimeout(() => Event.findAll(), TASK_TIMEOUT);
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/event/:id", taskManagerMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const event = await executeTaskWithTimeout(() => Event.findByPk(id), TASK_TIMEOUT);

    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    res.json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


app.listen(4001, () => {
  console.log("Listening on 4001");
});
