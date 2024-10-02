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
    ); // Apply timeout
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(4001, () => {
  console.log("Listening on 4001");
});
