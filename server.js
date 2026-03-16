const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const state = require('./server/state');
const { startCleanupInterval } = require('./server/rooms');
const { registerHandlers } = require('./server/handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://ardoremy.cz", "https://www.ardoremy.cz", "http://localhost:8080", "http://localhost:5173"],
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

state.init(io);
startCleanupInterval();
registerHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tank Battle v3 server running on http://localhost:${PORT}`);
});
