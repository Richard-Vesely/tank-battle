const C = require('../shared/constants');
const { rooms, playerToRoom } = require('./state');
const { createRoom, findQuickPlayRoom, getPlayersInfo, getPlayerColorIndex } = require('./rooms');
const { createPlayer, getStatLevel, getAbilityLevel, getPlayerMaxHp } = require('./player');
const { removePlayerFromRoom } = require('./combat');
const { startGame, startPractice, serializePlayer } = require('./game');
const {
  allocatePlayerId, getPlayerId, bindSocket, clearSocketBinding,
  registerPhrase, handleRejoin, handleDisconnect,
} = require('./session');

// Attaches a fresh player to a room: creates player, allocates UUID, registers
// phrase, wires up identity maps, scores, and socket. Returns { playerId, player }
// on success, or null on phrase collision (an error is emitted to the socket).
function attachPlayerToRoom({ socket, room, name, phrase, colorIndex }) {
  const player = createPlayer(name, colorIndex);
  const playerId = allocatePlayerId();
  if (!registerPhrase(player, playerId, phrase)) {
    socket.emit('error', { message: 'Toto heslo už někdo používá. Zkus jiné.' });
    return null;
  }
  room.players.set(playerId, player);
  playerToRoom.set(playerId, room);
  bindSocket(socket, playerId);
  room.scores[playerId] = 0;
  room.domScores[playerId] = 0;
  socket.join(room.code);
  return { playerId, player };
}

// Payload sent back to a client whenever they land in a room (create/join/quickPlay/rejoin-waiting).
function roomJoinedPayload(room, playerId) {
  return {
    code: room.code,
    players: getPlayersInfo(room),
    mode: room.mode,
    deathPenalty: room.deathPenalty,
    you: playerId,
    mapSize: room.mapSize,
    vanilla: room.vanilla,
    dominationTarget: room.dominationTarget,
  };
}

function registerHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('createRoom', ({ name, phrase, mode, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      removePlayerFromRoom(getPlayerId(socket));
      const room = createRoom(mode, deathPenalty, mapSize, vanilla, dominationTarget);
      const colorIndex = getPlayerColorIndex(room);
      const attached = attachPlayerToRoom({ socket, room, name, phrase, colorIndex });
      if (!attached) return;
      socket.emit('roomCreated', roomJoinedPayload(room, attached.playerId));
    });

    socket.on('joinRoom', ({ name, phrase, code }) => {
      const room = rooms.get((code || '').toUpperCase());
      if (!room) return socket.emit('error', { message: 'Místnost nenalezena' });
      if (room.state !== 'waiting') return socket.emit('error', { message: 'Hra už začala' });
      if (room.players.size >= C.MAX_PLAYERS) return socket.emit('error', { message: 'Místnost je plná' });

      removePlayerFromRoom(getPlayerId(socket));
      const colorIndex = getPlayerColorIndex(room);
      const attached = attachPlayerToRoom({ socket, room, name, phrase, colorIndex });
      if (!attached) return;
      socket.emit('roomJoined', roomJoinedPayload(room, attached.playerId));
      socket.to(room.code).emit('playerJoined', { id: attached.playerId, players: getPlayersInfo(room) });
    });

    socket.on('quickPlay', ({ name, phrase }) => {
      let room = findQuickPlayRoom();
      if (!room) room = createRoom(C.MODE_DOMINATION, C.DEATH_KEEP_UPGRADES, 'small');
      removePlayerFromRoom(getPlayerId(socket));
      const colorIndex = getPlayerColorIndex(room);
      const attached = attachPlayerToRoom({ socket, room, name, phrase, colorIndex });
      if (!attached) return;
      socket.emit('roomJoined', roomJoinedPayload(room, attached.playerId));
      socket.to(room.code).emit('playerJoined', { id: attached.playerId, players: getPlayersInfo(room) });
    });

    socket.on('startPractice', ({ name, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      removePlayerFromRoom(getPlayerId(socket));
      const room = createRoom(C.MODE_DOMINATION, deathPenalty || C.DEATH_KEEP_UPGRADES, mapSize || 'small', vanilla, dominationTarget);
      // Practice doesn't support rejoin — phrase is always empty.
      const attached = attachPlayerToRoom({ socket, room, name: name || 'Player', phrase: null, colorIndex: 0 });
      if (!attached) return;
      socket.emit('roomJoined', roomJoinedPayload(room, attached.playerId));
      startPractice(room, attached.playerId);
    });

    socket.on('rejoinRoom', ({ phrase }) => {
      const result = handleRejoin(io, socket, phrase);
      if (!result) return;
      const { room, playerId } = result;

      if (room.state === 'playing') {
        // rejoinSuccess first so the client sets myId before gameStart renders
        socket.emit('rejoinSuccess', { you: playerId, code: room.code });
        const players = [];
        for (const [id, p] of room.players) players.push(serializePlayer(id, p));
        socket.emit('gameStart', {
          map: room.map,
          mapSeed: room.mapSeed,
          mapWidth: room.mapWidth,
          mapHeight: room.mapHeight,
          mode: room.mode,
          deathPenalty: room.deathPenalty,
          practice: room.practice || false,
          vanilla: room.vanilla || false,
          dominationTarget: room.dominationTarget || C.DOMINATION_WIN_SCORE,
          captureZones: room.captureZones.map(z => ({ x: z.x, y: z.y, label: z.label })),
          players,
        });
      } else {
        socket.emit('roomJoined', roomJoinedPayload(room, playerId));
      }

      socket.to(room.code).emit('playerReconnected', { id: playerId, players: getPlayersInfo(room) });
    });

    socket.on('leaveRoom', () => {
      const playerId = getPlayerId(socket);
      if (!playerId) return;
      removePlayerFromRoom(playerId);
      clearSocketBinding(socket.id);
    });

    socket.on('changeColor', ({ colorIndex }) => {
      const playerId = getPlayerId(socket); if (!playerId) return;
      const room = playerToRoom.get(playerId);
      if (!room || room.state !== 'waiting') return;
      const player = room.players.get(playerId);
      if (!player) return;
      if (typeof colorIndex !== 'number' || colorIndex < 0 || colorIndex >= C.TANK_COLORS.length) return;
      for (const [id, p] of room.players) {
        if (id !== playerId && p.colorIndex === colorIndex) {
          socket.emit('error', { message: 'Tuhle barvu už má někdo jiný' });
          return;
        }
      }
      player.colorIndex = colorIndex;
      io.to(room.code).emit('colorChanged', { id: playerId, players: getPlayersInfo(room) });
    });

    socket.on('updateRoomSettings', ({ mode, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      const playerId = getPlayerId(socket); if (!playerId) return;
      const room = playerToRoom.get(playerId);
      if (!room || room.state !== 'waiting') return;

      if (mode && [C.MODE_FFA, C.MODE_ROUNDS, C.MODE_DOMINATION].includes(mode)) room.mode = mode;
      if (deathPenalty && [C.DEATH_KEEP_UPGRADES, C.DEATH_LOSE_ALL].includes(deathPenalty)) room.deathPenalty = deathPenalty;
      if (mapSize && C.MAP_SIZES[mapSize]) {
        room.mapSize = mapSize;
        room.mapWidth = C.MAP_SIZES[mapSize].width;
        room.mapHeight = C.MAP_SIZES[mapSize].height;
        room.spawnPoints = C.generateSpawnPoints(room.mapWidth, room.mapHeight, C.MAX_PLAYERS);
      }
      if (typeof vanilla === 'boolean') room.vanilla = vanilla;
      if (typeof dominationTarget === 'number' && dominationTarget > 0) room.dominationTarget = dominationTarget;

      for (const [, p] of room.players) p.ready = false;

      io.to(room.code).emit('roomSettingsUpdated', {
        mode: room.mode,
        deathPenalty: room.deathPenalty,
        mapSize: room.mapSize,
        vanilla: room.vanilla,
        dominationTarget: room.dominationTarget,
        players: getPlayersInfo(room),
      });
    });

    socket.on('toggleReady', () => {
      const playerId = getPlayerId(socket); if (!playerId) return;
      const room = playerToRoom.get(playerId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;
      player.ready = !player.ready;
      io.to(room.code).emit('playerReady', { id: playerId, ready: player.ready, players: getPlayersInfo(room) });
      if (room.players.size >= C.MIN_PLAYERS) {
        let allReady = true;
        for (const [, p] of room.players) { if (!p.ready) { allReady = false; break; } }
        if (allReady) startGame(room);
      }
    });

    socket.on('input', (input) => {
      const playerId = getPlayerId(socket); if (!playerId) return;
      const room = playerToRoom.get(playerId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (player && !player.disconnected) player.input = input;
    });

    socket.on('purchase', ({ type, key }) => {
      const playerId = getPlayerId(socket); if (!playerId) return;
      const room = playerToRoom.get(playerId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player || room.state !== 'playing') return;
      if (room.vanilla) return;

      if (type === 'stat') {
        const def = C.STATS[key];
        if (!def) return;
        const currentLevel = getStatLevel(player, key);
        const cost = C.getStatCost(key, currentLevel);
        if (player.currency < cost) return;
        player.currency -= cost;
        player.stats[key] = currentLevel + 1;
        if (key === 'defense') {
          player.maxHp = getPlayerMaxHp(player);
          player.hp = Math.min(player.hp + 30, player.maxHp);
        }
        socket.emit('upgradeSuccess', { type: 'stat', key, level: player.stats[key], currency: player.currency, stats: player.stats, abilities: player.abilities });
      } else if (type === 'ability') {
        const def = C.ABILITIES[key];
        if (!def) return;
        const currentLevel = getAbilityLevel(player, key);
        const cost = C.getAbilityCost(key, currentLevel);
        if (player.currency < cost) return;
        player.currency -= cost;
        player.abilities[key] = currentLevel + 1;
        socket.emit('upgradeSuccess', { type: 'ability', key, level: player.abilities[key], currency: player.currency, stats: player.stats, abilities: player.abilities });
      }
    });

    socket.on('disconnect', () => handleDisconnect(io, socket));
  });
}

module.exports = { registerHandlers };
