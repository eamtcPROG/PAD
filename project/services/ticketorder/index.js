// const express = require("express");
// const mongoose = require("mongoose");
// const bodyParser = require("body-parser");
// const cors = require("cors");
// const axios = require("axios");
// const { Order, Payment, Notification } = require("./models");
// const redis = require("redis"); 
// const app = express();

// app.use(bodyParser.json());
// app.use(cors());

// const mongoURI = process.env.MONGO_URI;
// mongoose
//   .connect(mongoURI, {
//     useNewUrlParser: true,
//     useUnifiedTopology: true,
//   })
//   .then(() => console.log("Connected to MongoDB"))
//   .catch((err) => {
//     console.error("MongoDB connection error:", err);
//     process.exit(1);
//   });

// // Redis Client Initialization
// const redisClient = redis.createClient({
//   url: "redis://redis:6379",
// });

// redisClient.on("error", (err) => {
//   console.error("Redis connection error:", err);
// });

// redisClient.on("connect", () => {
//   console.log("Connected to Redis");
// });

// redisClient.connect().catch((err) => {
//   console.error("Error connecting to Redis:", err);
// });

// process.on("SIGINT", () => {
//   redisClient.quit();
// });

// // Common code for all services
// const MAX_CONCURRENT_TASKS = 10;
// const TASK_TIMEOUT = 5000;

// let currentTaskCount = 0;

// const executeTaskWithTimeout = (taskFn, timeout, res) => {
//   return new Promise((resolve, reject) => {
//     const timeoutId = setTimeout(() => {
//       res.set("Connection", "close");
//       reject({ status: 408, message: "Request Timeout" });
//     }, timeout);

//     taskFn()
//       .then((result) => {
//         clearTimeout(timeoutId);
//         resolve(result);
//       })
//       .catch((err) => {
//         clearTimeout(timeoutId);
//         reject(err);
//       });
//   });
// };

// const taskManagerMiddleware = (req, res, next) => {
//   if (currentTaskCount >= MAX_CONCURRENT_TASKS) {
//     return res
//       .status(503)
//       .json({ message: "Server too busy. Try again later." });
//   }
//   currentTaskCount++;
//   res.on("finish", () => {
//     currentTaskCount--;
//   });
//   next();
// };

// app.get("/status", (req, res) => {
//   res.json({ status: "Ticket Order service is up and running!" });
// });

// // Add Order
// app.post("/order", taskManagerMiddleware, async (req, res) => {
//   const orderData = req.body;
//   try {
//     const newOrder = new Order(orderData);
//     await executeTaskWithTimeout(() => newOrder.save(), TASK_TIMEOUT, res);

//     // Invalidate the cache
//     await redisClient.del("orders"); // Remove cached list of orders
//     await redisClient.setEx(
//       `order:${newOrder._id}`,
//       3600,
//       JSON.stringify(newOrder)
//     ); // Cache the new order

//     res.status(201).json(newOrder);
//   } catch (err) {
//     if (err.status === 408) {
//       return res
//         .status(408)
//         .json({ message: "Request Timeout", details: err.message });
//     }
//     res.status(500).json({ message: err.message });
//   }
// });

// // Get All Orders
// app.get("/order", taskManagerMiddleware, async (req, res) => {
//   try {
//     const cachedOrders = await redisClient.get("orders");

//     if (cachedOrders) {
//       return res.json(JSON.parse(cachedOrders));
//     } else {
//       const orders = await executeTaskWithTimeout(
//         () => Order.find(),
//         TASK_TIMEOUT,
//         res
//       );
//       await redisClient.setEx("orders", 3600, JSON.stringify(orders));
//       res.json(orders);
//     }
//   } catch (err) {
//     if (err.status === 408) {
//       return res
//         .status(408)
//         .json({ message: "Request Timeout", details: err.message });
//     }
//     res.status(500).json({ message: err.message });
//   }
// });

// // Get Order by ID
// app.get("/order/:id", taskManagerMiddleware, async (req, res) => {
//   const { id } = req.params;

//   try {
//     const cachedOrder = await redisClient.get(`order:${id}`);

//     if (cachedOrder) {
//       return res.json(JSON.parse(cachedOrder));
//     } else {
//       const order = await executeTaskWithTimeout(
//         () => Order.findById(id),
//         TASK_TIMEOUT,
//         res
//       );
//       if (!order) {
//         return res.status(404).json({ message: "Order not found" });
//       }
//       await redisClient.setEx(
//         `order:${id}`,
//         3600,
//         JSON.stringify(order)
//       );
//       res.json(order);
//     }
//   } catch (err) {
//     if (err.status === 408) {
//       return res
//         .status(408)
//         .json({ message: "Request Timeout", details: err.message });
//     }
//     res.status(500).json({ message: err.message });
//   }
// });

// // Create Order with User
// app.post("/order/create-with-user", taskManagerMiddleware, async (req, res) => {
//   const { user_id, orderData } = req.body;

//   try {
//     const response = await executeTaskWithTimeout(
//       () => axios.get(`http://user:4001/user/${user_id}`),
//       TASK_TIMEOUT,
//       res
//     );

//     const user = response.data;

//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const newOrder = new Order({ ...orderData, user_id });
//     await executeTaskWithTimeout(() => newOrder.save(), TASK_TIMEOUT, res);

//     // Invalidate the cache
//     await redisClient.del("orders");
//     await redisClient.setEx(
//       `order:${newOrder._id}`,
//       3600,
//       JSON.stringify(newOrder)
//     );

//     res.status(201).json({
//       message: "Order created with user",
//       order: newOrder,
//       user,
//     });
//   } catch (err) {
//     if (err.status === 408) {
//       return res
//         .status(408)
//         .json({ message: "Request Timeout", details: err.message });
//     }
//     res.status(500).json({ message: err.message });
//   }
// });

// app.post("/payment", taskManagerMiddleware, async (req, res) => {
//   const paymentData = req.body;

//   try {

//     if (!paymentData.order_id || !paymentData.amount || !paymentData.payment_method) {
//       return res.status(400).json({ message: "Missing required fields." });
//     }


//     const newPayment = new Payment(paymentData);
//     await executeTaskWithTimeout(() => newPayment.save(), TASK_TIMEOUT,res);


//     await executeTaskWithTimeout(() => {
//       return Order.findByIdAndUpdate(paymentData.order_id, { order_status: 'paid' });
//     }, TASK_TIMEOUT);


//     res.status(201).json(newPayment);
//   } catch (err) {
//     if (err.status === 408) {
//       return res
//         .status(408)
//         .json({ message: "Request Timeout", details: err.message });
//     }
//     res.status(500).json({ message: err.message });
//   }
// });


// app.get("/payment/:id", taskManagerMiddleware, async (req, res) => {
//   const { id } = req.params;  

//   try {
//     const payment = await executeTaskWithTimeout(() => Payment.findById(id), TASK_TIMEOUT,res); 

//     if (!payment) {
//       return res.status(404).json({ message: "Payment not found" });  
//     }

//     res.json(payment); 
//   } catch (err) {
//     if (err.status === 408) {
//       return res
//         .status(408)
//         .json({ message: "Request Timeout", details: err.message });
//     }
//     res.status(500).json({ message: err.message }); 
//   }
// });

// app.listen(4000, () => {
//   console.log("Listening on 4000");
// });

// index.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const { Order, Payment, Notification } = require("./models");
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

const executeTaskWithTimeout = (taskFn, timeout, res) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      res.set("Connection", "close");
      reject({ status: 408, message: "Request Timeout" });
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

app.get("/status", (req, res) => {
  res.json({ status: "Ticket Order service is up and running!" });
});

// Add Order
app.post("/order", taskManagerMiddleware, async (req, res) => {
  const orderData = req.body;
  try {
    const newOrder = new Order(orderData);
    await executeTaskWithTimeout(() => newOrder.save(), TASK_TIMEOUT, res);

    // Invalidate the cache
    await redisClient.del("orders"); // Remove cached list of orders
    await redisClient.setEx(
      `order:${newOrder._id}`,
      3600,
      JSON.stringify(newOrder)
    ); // Cache the new order

    res.status(201).json(newOrder);
  } catch (err) {
    if (err.status === 408) {
      return res
        .status(408)
        .json({ message: "Request Timeout", details: err.message });
    }
    res.status(500).json({ message: err.message });
  }
});

// Get All Orders
app.get("/order", taskManagerMiddleware, async (req, res) => {
  try {
    const cachedOrders = await redisClient.get("orders");

    if (cachedOrders) {
      return res.json(JSON.parse(cachedOrders));
    } else {
      const orders = await executeTaskWithTimeout(
        () => Order.find(),
        TASK_TIMEOUT,
        res
      );
      await redisClient.setEx("orders", 3600, JSON.stringify(orders));
      res.json(orders);
    }
  } catch (err) {
    if (err.status === 408) {
      return res
        .status(408)
        .json({ message: "Request Timeout", details: err.message });
    }
    res.status(500).json({ message: err.message });
  }
});

// Get Order by ID
app.get("/order/:id", taskManagerMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const cachedOrder = await redisClient.get(`order:${id}`);

    if (cachedOrder) {
      return res.json(JSON.parse(cachedOrder));
    } else {
      const order = await executeTaskWithTimeout(
        () => Order.findById(id),
        TASK_TIMEOUT,
        res
      );
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      await redisClient.setEx(`order:${id}`, 3600, JSON.stringify(order));
      res.json(order);
    }
  } catch (err) {
    if (err.status === 408) {
      return res
        .status(408)
        .json({ message: "Request Timeout", details: err.message });
    }
    res.status(500).json({ message: err.message });
  }
});

// Create Order with User
app.post(
  "/order/create-with-user",
  taskManagerMiddleware,
  async (req, res) => {
    const { user_id, orderData } = req.body;

    try {
      const response = await executeTaskWithTimeout(
        () => axios.get(`http://user:4001/user/${user_id}`),
        TASK_TIMEOUT,
        res
      );

      const user = response.data;

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const newOrder = new Order({ ...orderData, user_id });
      await executeTaskWithTimeout(() => newOrder.save(), TASK_TIMEOUT, res);

      // Invalidate the cache
      await redisClient.del("orders");
      await redisClient.setEx(
        `order:${newOrder._id}`,
        3600,
        JSON.stringify(newOrder)
      );

      res.status(201).json({
        message: "Order created with user",
        order: newOrder,
        user,
      });
    } catch (err) {
      if (err.status === 408) {
        return res
          .status(408)
          .json({ message: "Request Timeout", details: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  }
);

// Payment Endpoints
app.post("/payment", taskManagerMiddleware, async (req, res) => {
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
    await executeTaskWithTimeout(
      () => newPayment.save(),
      TASK_TIMEOUT,
      res
    );

    await executeTaskWithTimeout(() => {
      return Order.findByIdAndUpdate(paymentData.order_id, {
        order_status: "paid",
      });
    }, TASK_TIMEOUT, res);

    res.status(201).json(newPayment);
  } catch (err) {
    if (err.status === 408) {
      return res
        .status(408)
        .json({ message: "Request Timeout", details: err.message });
    }
    res.status(500).json({ message: err.message });
  }
});

app.get("/payment/:id", taskManagerMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const payment = await executeTaskWithTimeout(
      () => Payment.findById(id),
      TASK_TIMEOUT,
      res
    );

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json(payment);
  } catch (err) {
    if (err.status === 408) {
      return res
        .status(408)
        .json({ message: "Request Timeout", details: err.message });
    }
    res.status(500).json({ message: err.message });
  }
});

module.exports = app;
