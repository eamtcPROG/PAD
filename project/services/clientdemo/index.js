const express = require('express');
const socketIOClient = require('socket.io-client');
const bodyParser = require("body-parser");
const cors = require("cors");
const Docker = require('dockerode');
const WebSocket = require('ws');

const app = express();

const SERVICE_PORT = process.env.SERVICE_PORT || 6000;
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

// Initialize Dockerode
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Function to find a single User Service container
const findSingleUserService = async () => {
  try {
    const containers = await docker.listContainers({
      all: false,
      filters: {
        label: ['service=user'], // Filter by label
      },
    });

    if (containers.length === 0) {
      console.error('No User Service containers found with label service=user');
      return null;
    }

    // Select the first container found
    const container = containers[0];
    console.log(`Selected container: ${container.Names[0]} on port ${container.Ports[0].PublicPort}`);

    const portInfo = container.Ports.find(p => p.PrivatePort === 4001 && p.Type === 'tcp');
    if (!portInfo || !portInfo.PublicPort) {
      console.error(`No port mapping found for container ${container.Names[0]}`);
      return null;
    }

    const host = container.Names[0]; // Adjust if Docker is on a different host
    const socketUrl = `ws:/${host}:${4005}`;
    console.log(`Connecting to User Service at ${socketUrl}`);

    return socketUrl;
  } catch (error) {
    console.error('Error discovering User Service:', error);
    return null;
  }
};

let ws;

const initializeWebSocket = async () => {
  const socketUrl = await findSingleUserService();

  if (!socketUrl) {
    console.error('Unable to find User Service. Retrying in 5 seconds...');
    setTimeout(initializeWebSocket, 5000);
    return;
  }

  if (ws) {
    ws.terminate(); // Close existing connection
  }

  ws = new WebSocket(socketUrl);

  ws.on('open', () => {
    console.log(`Connected to WebSocket server at ${socketUrl}`);
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'eventReminder') {
        console.log('Received event reminder:', message.payload);
      } else {
        console.log('Received unknown message type:', message.type);
      }
    } catch (err) {
      console.error('Error parsing message:', err);
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error:`, error.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`WebSocket connection closed: [${code}] ${reason}`);
    // Attempt to reconnect after a delay
    setTimeout(initializeWebSocket, 5000);
  });
};

// Subscription Endpoints
app.post('/subscribe', (req, res) => {
  const { eventId } = req.body;

  if (!eventId) {
    return res.status(400).json({ message: 'eventId is required.' });
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    const message = JSON.stringify({
      type: 'subscribeToEvent',
      payload: { eventId },
    });
    ws.send(message);
    console.log(`Subscribed to event ${eventId}`);
    res.json({ message: `Subscribed to event ${eventId}` });
  } else {
    res.status(500).json({ message: 'WebSocket is not connected to User Service.' });
  }
});

app.post('/unsubscribe', (req, res) => {
  const { eventId } = req.body;

  if (!eventId) {
    return res.status(400).json({ message: 'eventId is required.' });
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    const message = JSON.stringify({
      type: 'unsubscribeFromEvent',
      payload: { eventId },
    });
    ws.send(message);
    console.log(`Unsubscribed from event ${eventId}`);
    res.json({ message: `Unsubscribed from event ${eventId}` });
  } else {
    res.status(500).json({ message: 'WebSocket is not connected to User Service.' });
  }
});

// Start the Client Server
app.listen(port, () => {
  console.log(`Client app listening at http://localhost:${port}`);
});

// Initialize WebSocket connection on startup
initializeWebSocket();