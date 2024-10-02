const express = require("express");

const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());
app.use(cors());

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
  currentTaskCount++; // Increment task count
  res.on("finish", () => {
    currentTaskCount--; // Decrement task count after the task finishes
  });
  next();
};
//

app.get("/status", (req, res) => {
  res.json({ status: "User service is up and running!" });
});

app.listen(4001, () => {
  console.log("Listening on 4001");
});
