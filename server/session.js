// Session / rejoin logic — owns the identity maps, phrase credentials, and
// the connect/disconnect/rejoin flow. Data (the Maps themselves) lives in
// state.js; this module is where the policy around them lives.
const { randomUUID } = require('crypto');
const { playerToRoom, socketToPlayerId, playerIdToSocket, phraseKeyToPlayerId } = require('./state');
const { getPlayersInfo } = require('./rooms');
const { removePlayerFromRoom } = require('./combat');

const GRACE_PERIOD_MS = 60_000;
const MAX_PHRASE_LENGTH = 24;
const DEBUG = process.env.DEBUG_SESSION === '1';

function debug(...args) { if (DEBUG) console.log('[session]', ...args); }

function allocatePlayerId() {
  return randomUUID();
}

function getPlayerId(socket) {
  return socketToPlayerId.get(socket.id);
}

function bindSocket(socket, playerId) {
  socketToPlayerId.set(socket.id, playerId);
  playerIdToSocket.set(playerId, socket.id);
}

function clearSocketBinding(socketId) {
  socketToPlayerId.delete(socketId);
}

function normalizePhrase(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_PHRASE_LENGTH);
}

// Registers a globally-unique rejoin credential for this player.
// Returns true if bound (or opted out with empty phrase), false on collision.
function registerPhrase(player, playerId, rawPhrase) {
  const phrase = normalizePhrase(rawPhrase);
  if (!phrase) return true;
  if (phraseKeyToPlayerId.has(phrase)) return false;
  player.phrase = phrase;
  phraseKeyToPlayerId.set(phrase, playerId);
  return true;
}

// Handles a rejoinRoom socket event. On success returns { room, player, playerId }
// and the caller is responsible for emitting whatever state is appropriate
// (roomJoined vs gameStart). On failure emits 'sessionInvalid' and returns null.
function handleRejoin(io, socket, phrase) {
  const normalizedPhrase = normalizePhrase(phrase);
  debug(`rejoin socket=${socket.id} phrase=${normalizedPhrase ? '(' + normalizedPhrase.length + ' chars)' : '(none)'}`);
  if (!normalizedPhrase) { socket.emit('sessionInvalid'); return null; }
  const playerId = phraseKeyToPlayerId.get(normalizedPhrase);
  if (!playerId) { socket.emit('sessionInvalid'); return null; }
  const room = playerToRoom.get(playerId);
  if (!room) { socket.emit('sessionInvalid'); return null; }
  const player = room.players.get(playerId);
  if (!player || player.phrase !== normalizedPhrase) { socket.emit('sessionInvalid'); return null; }

  // Take over any socket currently bound to this player. Covers the race where
  // the tab was just closed but the server hasn't processed the disconnect yet.
  const prevSocketId = playerIdToSocket.get(playerId);
  if (prevSocketId && prevSocketId !== socket.id) {
    const prevSocket = io.sockets.sockets.get(prevSocketId);
    if (prevSocket) {
      socketToPlayerId.delete(prevSocketId);
      prevSocket.disconnect(true);
    }
  }

  if (player.graceTimer) { clearTimeout(player.graceTimer); player.graceTimer = null; }
  player.disconnected = false;
  player.disconnectedAt = 0;

  bindSocket(socket, playerId);
  socket.join(room.code);
  debug(`rejoin OK playerId=${playerId} state=${room.state}`);
  return { room, player, playerId };
}

// Handles a socket disconnect. If the player has a rejoin phrase and is in a
// real match, we keep them in the room with a grace timer. Otherwise we remove
// them immediately.
function handleDisconnect(io, socket) {
  debug(`disconnect socket=${socket.id}`);
  const playerId = socketToPlayerId.get(socket.id);
  socketToPlayerId.delete(socket.id);
  if (!playerId) return;

  // If the socket was already replaced by a rejoin, don't touch the player.
  const currentBoundSocket = playerIdToSocket.get(playerId);
  if (currentBoundSocket && currentBoundSocket !== socket.id) {
    debug(`playerId=${playerId} already rebound to ${currentBoundSocket} — no-op`);
    return;
  }
  playerIdToSocket.delete(playerId);

  const room = playerToRoom.get(playerId);
  if (!room) return;
  const player = room.players.get(playerId);
  if (!player) return;

  // Practice tanks are disposable; phrase-less players can't rejoin — either
  // way the slot should free up immediately.
  if (room.practice || !player.phrase) {
    removePlayerFromRoom(playerId);
    return;
  }

  player.disconnected = true;
  player.disconnectedAt = Date.now();
  player.input = {};

  io.to(room.code).emit('playerDisconnected', { id: playerId, players: getPlayersInfo(room) });

  player.graceTimer = setTimeout(() => {
    player.graceTimer = null;
    removePlayerFromRoom(playerId);
  }, GRACE_PERIOD_MS);
}

module.exports = {
  GRACE_PERIOD_MS,
  allocatePlayerId,
  getPlayerId,
  bindSocket,
  clearSocketBinding,
  normalizePhrase,
  registerPhrase,
  handleRejoin,
  handleDisconnect,
};
