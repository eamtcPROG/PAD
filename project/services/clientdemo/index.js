const express = require('express');
const http = require('http');
const { io } = require('socket.io-client');
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();

const SERVICE_PORT = process.env.SERVICE_PORT || 6000;
const SOCKET_SERVER_URL = process.env.SOCKET_SERVER_URL || 'http://localhost:4001';
const port = SERVICE_PORT;

app.use(bodyParser.json());
app.use(cors());

app.get('/', (req, res) => {
  res.send(`
    <h1>Socket.IO Client Demo</h1>
    <p>Use the following endpoints to interact:</p>
    <ul>
      <li><code>POST /subscribe</code> - Subscribe to an event</li>
      <li><code>POST /unsubscribe</code> - Unsubscribe from an event</li>
    </ul>
    <p>Check the server console for incoming event reminders.</p>
  `);
});

// Initialize Socket.IO client with environment variable
const socket = io(SOCKET_SERVER_URL, { // Updated
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('Connected to Socket.IO server');
});

socket.on('eventReminder', (data) => {
  console.log('Received event reminder:', data);
});

socket.on('error', (error) => {
  console.error('Received error from server:', error);
});

socket.on('disconnect', () => {
  console.log('Disconnected from Socket.IO server');
});

app.post('/subscribe', (req, res) => {
  const { eventId } = req.body; // Updated to send only eventId

  if (!eventId) {
    return res.status(400).json({ message: 'eventId is required.' });
  }

  socket.emit('subscribeToEvent', { eventId }); // Send only eventId
  console.log(`Subscribed to event ${eventId}`);

  res.json({ message: `Subscribed to event ${eventId}` });
});

app.post('/unsubscribe', (req, res) => {
  const { eventId } = req.body;

  if (!eventId) {
    return res.status(400).json({ message: 'eventId is required.' });
  }

  socket.emit('unsubscribeFromEvent', eventId);
  console.log(`Unsubscribed from event ${eventId}`);

  res.json({ message: `Unsubscribed from event ${eventId}` });
});

const server = http.createServer(app);
server.listen(port, () => {
  console.log(`Client app listening at http://localhost:${port}`);
});
