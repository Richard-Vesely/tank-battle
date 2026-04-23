const crypto = require('crypto');
const C = require('../shared/constants');
const { rooms, playerToRoom, socketToPlayerId, playerIdToSocket, tokenToPlayerId } = require('./state');
const { createRoom, findQuickPlayRoom, getPlayersInfo, getPlayerColorIndex } = require('./rooms');
const { createPlayer, getStatLevel, getAbilityLevel, getPlayerMaxHp } = require('./player');
const { removePlayerFromRoom } = require('./combat');
const { startGame, startPractice, serializePlayer } = require('./game');

const GRACE_PERIOD_MS = 60_000;

function getPlayerId(socket) {
  return socketToPlayerId.get(socket.id);
}

function bindSocket(socket, playerId) {
  socketToPlayerId.set(socket.id, playerId);
  playerIdToSocket.set(playerId, socket.id);
}

function issueToken(playerId) {
  const token = crypto.randomUUID();
  tokenToPlayerId.set(token, playerId);
  return token;
}

function registerHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('createRoom', ({ name, mode, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      removePlayerFromRoom(getPlayerId(socket));
      const room = createRoom(mode, deathPenalty, mapSize, vanilla, dominationTarget);
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      const playerId = socket.id;
      const token = issueToken(playerId);
      player.token = token;
      room.players.set(playerId, player);
      playerToRoom.set(playerId, room);
      bindSocket(socket, playerId);
      room.scores[playerId] = 0;
      room.domScores[playerId] = 0;
      socket.join(room.code);
      socket.emit('roomCreated', { code: room.code, players: getPlayersInfo(room), you: playerId, token, mode: room.mode, deathPenalty: room.deathPenalty, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
    });

    socket.on('joinRoom', ({ name, code }) => {
      const room = rooms.get((code || '').toUpperCase());
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.state !== 'waiting') return socket.emit('error', { message: 'Game in progress' });
      if (room.players.size >= C.MAX_PLAYERS) return socket.emit('error', { message: 'Room full' });

      removePlayerFromRoom(getPlayerId(socket));
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      const playerId = socket.id;
      const token = issueToken(playerId);
      player.token = token;
      room.players.set(playerId, player);
      playerToRoom.set(playerId, room);
      bindSocket(socket, playerId);
      room.scores[playerId] = 0;
      room.domScores[playerId] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: playerId, token, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      socket.to(room.code).emit('playerJoined', { id: playerId, players: getPlayersInfo(room) });
    });

    socket.on('quickPlay', ({ name }) => {
      let room = findQuickPlayRoom();
      if (!room) room = createRoom(C.MODE_DOMINATION, C.DEATH_KEEP_UPGRADES, 'small');
      removePlayerFromRoom(getPlayerId(socket));
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      const playerId = socket.id;
      const token = issueToken(playerId);
      player.token = token;
      room.players.set(playerId, player);
      playerToRoom.set(playerId, room);
      bindSocket(socket, playerId);
      room.scores[playerId] = 0;
      room.domScores[playerId] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: playerId, token, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      socket.to(room.code).emit('playerJoined', { id: playerId, players: getPlayersInfo(room) });
    });

    socket.on('startPractice', ({ name, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      removePlayerFromRoom(getPlayerId(socket));
      const room = createRoom(C.MODE_DOMINATION, deathPenalty || C.DEATH_KEEP_UPGRADES, mapSize || 'small', vanilla, dominationTarget);
      const colorIndex = 0;
      const player = createPlayer(name || 'Player', colorIndex);
      const playerId = socket.id;
      // Practice doesn't support rejoin — no token issued
      room.players.set(playerId, player);
      playerToRoom.set(playerId, room);
      bindSocket(socket, playerId);
      room.scores[playerId] = 0;
      room.domScores[playerId] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: playerId, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      startPractice(room, playerId);
    });

    socket.on('rejoinRoom', ({ roomCode, token }) => {
      console.log(`[rejoinRoom] socket=${socket.id} roomCode=${roomCode} token=${token ? token.slice(0, 8) + '...' : '(none)'}`);
      if (!roomCode || !token) { console.log('[rejoinRoom] missing args'); return socket.emit('sessionInvalid'); }
      const playerId = tokenToPlayerId.get(token);
      if (!playerId) { console.log('[rejoinRoom] unknown token'); return socket.emit('sessionInvalid'); }
      const room = playerToRoom.get(playerId);
      if (!room || room.code !== roomCode.toUpperCase()) { console.log('[rejoinRoom] no room for this token'); return socket.emit('sessionInvalid'); }
      const player = room.players.get(playerId);
      if (!player || player.token !== token) { console.log('[rejoinRoom] player/token mismatch'); return socket.emit('sessionInvalid'); }

      // Kick whichever socket is currently bound (if any) so we take over cleanly.
      // This also handles the race where the tab was just closed but the server
      // hasn't processed the disconnect yet.
      const prevSocketId = playerIdToSocket.get(playerId);
      if (prevSocketId && prevSocketId !== socket.id) {
        const prevSocket = io.sockets.sockets.get(prevSocketId);
        if (prevSocket) {
          // Don't let the prev socket's disconnect logic run its grace path,
          // because we're immediately replacing it.
          socketToPlayerId.delete(prevSocketId);
          prevSocket.disconnect(true);
        }
      }

      // Clear grace timer (if one exists)
      if (player.graceTimer) { clearTimeout(player.graceTimer); player.graceTimer = null; }
      player.disconnected = false;
      player.disconnectedAt = 0;

      // Rebind new socket to the existing permanent playerId
      bindSocket(socket, playerId);
      socket.join(room.code);
      console.log(`[rejoinRoom] OK playerId=${playerId} state=${room.state}`);

      // Deliver appropriate state to the rejoining client
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
        // 'waiting' or 'gameOver' — land in the waiting screen
        socket.emit('roomJoined', {
          code: room.code,
          players: getPlayersInfo(room),
          mode: room.mode,
          deathPenalty: room.deathPenalty,
          you: playerId,
          token,
          mapSize: room.mapSize,
          vanilla: room.vanilla,
          dominationTarget: room.dominationTarget,
        });
      }

      // Tell the rest of the room
      socket.to(room.code).emit('playerReconnected', { id: playerId, players: getPlayersInfo(room) });
    });

    socket.on('leaveRoom', () => {
      const playerId = getPlayerId(socket);
      if (!playerId) return;
      const room = playerToRoom.get(playerId);
      if (room) {
        const player = room.players.get(playerId);
        if (player && player.token) tokenToPlayerId.delete(player.token);
        if (player && player.graceTimer) { clearTimeout(player.graceTimer); player.graceTimer = null; }
      }
      removePlayerFromRoom(playerId);
      socketToPlayerId.delete(socket.id);
    });

    socket.on('changeColor', ({ colorIndex }) => {
      const playerId = getPlayerId(socket); if (!playerId) return;
      const room = playerToRoom.get(playerId);
      if (!room || room.state !== 'waiting') return;
      const player = room.players.get(playerId);
      if (!player) return;
      if (typeof colorIndex !== 'number' || colorIndex < 0 || colorIndex >= C.TANK_COLORS.length) return;
      // Check if color is already taken by another player
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

      // Reset ready status when settings change
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

    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      const playerId = socketToPlayerId.get(socket.id);
      socketToPlayerId.delete(socket.id);
      if (!playerId) return;

      // If another socket has already taken over this player (via rejoinRoom that
      // arrived BEFORE this disconnect event), silently drop — the player is already
      // live on the new socket.
      const currentBoundSocket = playerIdToSocket.get(playerId);
      if (currentBoundSocket && currentBoundSocket !== socket.id) {
        console.log(`[disconnect] playerId=${playerId} already rebound to ${currentBoundSocket} — no-op`);
        return;
      }
      playerIdToSocket.delete(playerId);

      const room = playerToRoom.get(playerId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;

      // Practice mode has no rejoin — remove immediately
      if (room.practice) {
        if (player.token) tokenToPlayerId.delete(player.token);
        removePlayerFromRoom(playerId);
        return;
      }

      // Mark as disconnected, freeze tank, start grace timer
      player.disconnected = true;
      player.disconnectedAt = Date.now();
      player.input = {};

      io.to(room.code).emit('playerDisconnected', { id: playerId, players: getPlayersInfo(room) });

      player.graceTimer = setTimeout(() => {
        if (player.token) tokenToPlayerId.delete(player.token);
        player.graceTimer = null;
        removePlayerFromRoom(playerId);
      }, GRACE_PERIOD_MS);
    });
  });
}

module.exports = { registerHandlers };
