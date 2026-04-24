// Shared server state — singleton accessed by all modules
const rooms = new Map();
const playerToRoom = new Map();

// Rejoin support: stable player id (UUID) survives socket disconnect/reconnect.
// playerId is allocated once per player and never changes; the socket binding
// below is what rebinds when the player reconnects.
const socketToPlayerId = new Map();  // current socket.id -> permanent player id
const playerIdToSocket = new Map();  // permanent player id -> current socket.id
// Rejoin credential: globally-unique user-supplied phrase. Key is the phrase itself.
const phraseKeyToPlayerId = new Map();

let io = null;

function init(socketIo) {
  io = socketIo;
}

function getIo() {
  return io;
}

module.exports = {
  rooms, playerToRoom,
  socketToPlayerId, playerIdToSocket, phraseKeyToPlayerId,
  init, getIo,
};
