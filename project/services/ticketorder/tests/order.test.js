jest.mock('redis');

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../index");
const { Order, Payment } = require("../models");

jest.mock("axios");
const axios = require("axios");

describe("Ticket Order Service", () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  afterEach(async () => {
    // Clear collections after each test
    await Order.deleteMany();
    await Payment.deleteMany();
  });

  test("GET /status should return service status", async () => {
    const res = await request(app).get("/status");
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty(
      "status",
      "Ticket Order service is up and running!"
    );
  });

  test("POST /order should create a new order", async () => {
    const orderData = {
      user_id: "user123",
      event_id: "event123",
      quantity: 2,
      total_price: 200,
      order_status: "pending",
    };
    const res = await request(app).post("/order").send(orderData);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty("_id");
    expect(res.body).toMatchObject(orderData);
  });

  test("GET /order should return all orders", async () => {
    const orders = [
      {
        user_id: "user1",
        event_id: "event1",
        quantity: 1,
        total_price: 100,
        order_status: "pending",
      },
      {
        user_id: "user2",
        event_id: "event2",
        quantity: 2,
        total_price: 200,
        order_status: "pending",
      },
    ];
    await Order.insertMany(orders);

    const res = await request(app).get("/order");
    expect(res.statusCode).toEqual(200);
    expect(res.body.length).toEqual(2);
  });

  test("GET /order/:id should return order by ID", async () => {
    const order = new Order({
      user_id: "user123",
      event_id: "event123",
      quantity: 2,
      total_price: 200,
      order_status: "pending",
    });
    await order.save();

    const res = await request(app).get(`/order/${order._id}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("_id", order._id.toString());
    expect(res.body).toHaveProperty("user_id", "user123");
  });

  test("GET /order/:id should return 404 for non-existent order", async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/order/${nonExistentId}`);
    expect(res.statusCode).toEqual(404);
    expect(res.body).toHaveProperty("message", "Order not found");
  });

  test("POST /order/create-with-user should create order with user", async () => {
    axios.get.mockResolvedValue({
      data: { id: "user123", email: "user@example.com" },
    });

    const orderData = {
      event_id: "event123",
      quantity: 2,
      total_price: 200,
      order_status: "pending",
    };
    const res = await request(app)
      .post("/order/create-with-user")
      .send({ user_id: "user123", orderData });

    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty("message", "Order created with user");
    expect(res.body.order).toHaveProperty("user_id", "user123");
    expect(res.body.user).toHaveProperty("email", "user@example.com");
  });

  test("POST /order/create-with-user should return 404 if user not found", async () => {
    axios.get.mockResolvedValue({ data: null });

    const orderData = {
      event_id: "event123",
      quantity: 2,
      total_price: 200,
      order_status: "pending",
    };
    const res = await request(app)
      .post("/order/create-with-user")
      .send({ user_id: "nonexistent", orderData });

    expect(res.statusCode).toEqual(404);
    expect(res.body).toHaveProperty("message", "User not found");
  });

  test("POST /payment should create a new payment and update order status", async () => {
    const order = new Order({
      user_id: "user123",
      event_id: "event123",
      quantity: 2,
      total_price: 200,
      order_status: "pending",
    });
    await order.save();

    const paymentData = {
      order_id: order._id.toString(),
      amount: 200,
      payment_method: "credit_card",
      payment_status: "completed",
    };

    const res = await request(app).post("/payment").send(paymentData);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty("_id");
    expect(res.body).toMatchObject(paymentData);

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.order_status).toEqual("paid");
  });

  test("GET /payment/:id should return payment by ID", async () => {
    const payment = new Payment({
      order_id: "order123",
      amount: 100,
      payment_method: "credit_card",
      payment_status: "completed",
    });
    await payment.save();

    const res = await request(app).get(`/payment/${payment._id}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("_id", payment._id.toString());
    expect(res.body).toHaveProperty("payment_status", "completed");
  });
});
