// Shared server state — singleton accessed by all modules
const rooms = new Map();
const playerToRoom = new Map();
let io = null;

function init(socketIo) {
  io = socketIo;
}

function getIo() {
  return io;
}

module.exports = { rooms, playerToRoom, init, getIo };
