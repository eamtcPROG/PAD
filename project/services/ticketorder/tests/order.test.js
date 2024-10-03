const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { Order } = require("../models");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  // Pass the in-memory MongoDB URI to the app
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
});

afterAll(async () => {
  await mongoose.connection.close();
  await mongoServer.stop();
});

describe("Order routes", () => {

  it("should create a new order", async () => {
    const res = await request(app)
      .post("/order")
      .send({
        user_id: "test_user_id",
        event_id: "test_event_id",
        quantity: 2,
        total_price: 50,
        order_status: "pending",
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty("_id");
    expect(res.body.order_status).toBe("pending");
  });

  it("should retrieve all orders", async () => {
    const res = await request(app).get("/order");
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("should retrieve an order by ID", async () => {
    const newOrder = new Order({
      user_id: "test_user_id",
      event_id: "test_event_id",
      quantity: 2,
      total_price: 50,
      order_status: "pending",
    });
    await newOrder.save();

    const res = await request(app).get(`/order/${newOrder._id}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("_id");
    expect(res.body._id).toBe(String(newOrder._id));
  });

  it("should return 404 when order is not found", async () => {
    const res = await request(app).get("/order/614c0b12345a1234567b1234");
    expect(res.statusCode).toEqual(404);
    expect(res.body.message).toBe("Order not found");
  });
});
