// Shared server state — singleton accessed by all modules
const rooms = new Map();
const playerToRoom = new Map();

// Rejoin support: stable player id survives socket disconnect/reconnect.
// On first join, a player's socket.id is adopted as their permanent playerId.
// On reconnect, a new socket.id is bound to the same playerId via these maps.
const socketToPlayerId = new Map();  // current socket.id -> permanent player id
const playerIdToSocket = new Map();  // permanent player id -> current socket.id
// Rejoin credential: user-supplied phrase, scoped by room code. Key format: `${ROOMCODE}:${phrase}`
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
