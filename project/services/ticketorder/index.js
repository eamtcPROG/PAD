const express = require("express");

const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());
app.use(cors());

app.get("/status", (req, res) => {
  res.json({ status: "Ticket Order service is up and running!" });
});

app.listen(4000, () => {
  console.log("Listening on 4000");
});
