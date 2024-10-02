const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Order schema
const orderSchema = new Schema({
  id: String,
  user_id: String,
  event_id: String,
  quantity: Number,
  total_price: Number,
  order_status: String,
  payment_details: {
    method: String,
    status: String,
  },
});

// Payment schema
const paymentSchema = new Schema({
  id: String,
  order_id: String,
  amount: Number,
  payment_method: String,
  payment_status: String,
});

// Notification schema
const notificationSchema = new Schema({
  user_id: String,
  message: String,
});

// Models
const Order = mongoose.model("Order", orderSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const Notification = mongoose.model("Notification", notificationSchema);

module.exports = { Order, Payment, Notification };
