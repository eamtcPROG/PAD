// server.js
const app = require('./index');
const mongoose = require('mongoose');

const mongoURI = process.env.MONGO_URI || process.env.MONGO_URL;

mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB");
    
    app.listen(4000, () => {
      console.log("Listening on 4000");
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
