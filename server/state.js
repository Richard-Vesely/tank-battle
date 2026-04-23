// Shared server state — singleton accessed by all modules
const rooms = new Map();
const playerToRoom = new Map();

// Rejoin support: stable player id survives socket disconnect/reconnect.
// On first join, a player's socket.id is adopted as their permanent playerId.
// On reconnect, a new socket.id is bound to the same playerId via these maps.
const socketToPlayerId = new Map();  // current socket.id -> permanent player id
const playerIdToSocket = new Map();  // permanent player id -> current socket.id
const tokenToPlayerId = new Map();   // rejoin token -> permanent player id

let io = null;

function init(socketIo) {
  io = socketIo;
}

function getIo() {
  return io;
}

module.exports = {
  rooms, playerToRoom,
  socketToPlayerId, playerIdToSocket, tokenToPlayerId,
  init, getIo,
};
