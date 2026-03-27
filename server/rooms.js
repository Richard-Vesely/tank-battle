const C = require('../shared/constants');
const { rooms, playerToRoom, getIo } = require('./state');

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(mode, deathPenalty, mapSize, vanilla, dominationTarget) {
  const code = generateRoomCode();
  const seed = Date.now();
  const mapDef = C.MAP_SIZES[mapSize] || C.MAP_SIZES.small;
  const room = {
    code,
    mode: mode || C.MODE_DOMINATION,
    deathPenalty: deathPenalty || C.DEATH_KEEP_UPGRADES,
    mapSize: mapSize || 'small',
    vanilla: !!vanilla,
    dominationTarget: (typeof dominationTarget === 'number' && dominationTarget > 0) ? dominationTarget : C.DOMINATION_WIN_SCORE,
    mapWidth: mapDef.width,
    mapHeight: mapDef.height,
    state: 'waiting',
    players: new Map(),
    bullets: [],
    powerups: [],
    mines: [],
    creditPickups: [],
    lastCreditSpawn: 0,
    map: null,
    mapSeed: seed,
    scores: {},
    captureZones: [],
    domScores: {},
    round: 0,
    lastPowerupSpawn: 0,
    bulletIdCounter: 0,
    mineIdCounter: 0,
    tickInterval: null,
    broadcastInterval: null,
    spawnPoints: C.generateSpawnPoints(mapDef.width, mapDef.height, C.MAX_PLAYERS),
  };
  rooms.set(code, room);
  return room;
}

function hasConnectedPlayers(room) {
  const io = getIo();
  for (const [id] of room.players) {
    if (io.sockets.sockets.get(id)) return true;
  }
  return false;
}

function findQuickPlayRoom() {
  for (const [code, room] of rooms) {
    if (room.state === 'waiting' && room.players.size < C.MAX_PLAYERS && hasConnectedPlayers(room)) {
      return room;
    }
  }
  return null;
}

function getPlayersInfo(room) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push({ id, name: p.name, color: p.color, colorIndex: p.colorIndex, ready: p.ready });
  }
  return players;
}

function getPlayerColorIndex(room) {
  const used = new Set();
  for (const [, p] of room.players) used.add(p.colorIndex);
  for (let i = 0; i < C.MAX_PLAYERS; i++) {
    if (!used.has(i)) return i;
  }
  return 0;
}

function startCleanupInterval() {
  setInterval(() => {
    for (const [code, room] of rooms) {
      if (!hasConnectedPlayers(room)) {
        clearInterval(room.tickInterval);
        clearInterval(room.broadcastInterval);
        for (const [id] of room.players) playerToRoom.delete(id);
        rooms.delete(code);
      }
    }
  }, 10000);
}

module.exports = {
  createRoom, findQuickPlayRoom, getPlayersInfo, getPlayerColorIndex,
  hasConnectedPlayers, startCleanupInterval,
};
