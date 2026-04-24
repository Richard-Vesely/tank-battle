const C = require('../shared/constants');
const { rooms, playerToRoom, socketToPlayerId, playerIdToSocket, phraseKeyToPlayerId } = require('./state');
const { createRoom, findQuickPlayRoom, getPlayersInfo, getPlayerColorIndex } = require('./rooms');
const { createPlayer, getStatLevel, getAbilityLevel, getPlayerMaxHp } = require('./player');
const { removePlayerFromRoom } = require('./combat');
const { startGame, startPractice, serializePlayer } = require('./game');

const GRACE_PERIOD_MS = 60_000;
const MAX_PHRASE_LENGTH = 24;

function getPlayerId(socket) {
  return socketToPlayerId.get(socket.id);
}

function bindSocket(socket, playerId) {
  socketToPlayerId.set(socket.id, playerId);
  playerIdToSocket.set(playerId, socket.id);
}

function normalizePhrase(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, MAX_PHRASE_LENGTH);
  return trimmed;
}

// Registers phrase as a globally-unique rejoin credential. Returns true if ok,
// false if phrase is already taken by any player on the server.
function registerPhrase(room, player, rawPhrase) {
  const phrase = normalizePhrase(rawPhrase);
  if (!phrase) return true;  // empty = player opted out of rejoin
  if (phraseKeyToPlayerId.has(phrase)) return false;
  player.phrase = phrase;
  player.phraseKey = phrase;
  phraseKeyToPlayerId.set(phrase, null);  // placeholder; caller sets real playerId below
  return true;
}

// Completes phrase registration after we know the playerId
function finalizePhrase(player, playerId) {
  if (player.phraseKey) phraseKeyToPlayerId.set(player.phraseKey, playerId);
}

function registerHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('createRoom', ({ name, phrase, mode, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      removePlayerFromRoom(getPlayerId(socket));
      const room = createRoom(mode, deathPenalty, mapSize, vanilla, dominationTarget);
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      const playerId = socket.id;
      // A brand-new room can't have phrase collisions, so registerPhrase always returns true here.
      registerPhrase(room, player, phrase);
      finalizePhrase(player, playerId);
      room.players.set(playerId, player);
      playerToRoom.set(playerId, room);
      bindSocket(socket, playerId);
      room.scores[playerId] = 0;
      room.domScores[playerId] = 0;
      socket.join(room.code);
      socket.emit('roomCreated', { code: room.code, players: getPlayersInfo(room), you: playerId, hasPhrase: !!player.phrase, mode: room.mode, deathPenalty: room.deathPenalty, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
    });

    socket.on('joinRoom', ({ name, phrase, code }) => {
      const room = rooms.get((code || '').toUpperCase());
      if (!room) return socket.emit('error', { message: 'Místnost nenalezena' });
      if (room.state !== 'waiting') return socket.emit('error', { message: 'Hra už začala' });
      if (room.players.size >= C.MAX_PLAYERS) return socket.emit('error', { message: 'Místnost je plná' });

      removePlayerFromRoom(getPlayerId(socket));
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      const playerId = socket.id;
      if (!registerPhrase(room, player, phrase)) {
        return socket.emit('error', { message: 'Toto heslo už někdo používá. Zkus jiné.' });
      }
      finalizePhrase(player, playerId);
      room.players.set(playerId, player);
      playerToRoom.set(playerId, room);
      bindSocket(socket, playerId);
      room.scores[playerId] = 0;
      room.domScores[playerId] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: playerId, hasPhrase: !!player.phrase, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      socket.to(room.code).emit('playerJoined', { id: playerId, players: getPlayersInfo(room) });
    });

    socket.on('quickPlay', ({ name, phrase }) => {
      let room = findQuickPlayRoom();
      if (!room) room = createRoom(C.MODE_DOMINATION, C.DEATH_KEEP_UPGRADES, 'small');
      removePlayerFromRoom(getPlayerId(socket));
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      const playerId = socket.id;
      if (!registerPhrase(room, player, phrase)) {
        return socket.emit('error', { message: 'Toto heslo už někdo používá. Zkus jiné.' });
      }
      finalizePhrase(player, playerId);
      room.players.set(playerId, player);
      playerToRoom.set(playerId, room);
      bindSocket(socket, playerId);
      room.scores[playerId] = 0;
      room.domScores[playerId] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: playerId, hasPhrase: !!player.phrase, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      socket.to(room.code).emit('playerJoined', { id: playerId, players: getPlayersInfo(room) });
    });

    socket.on('startPractice', ({ name, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      removePlayerFromRoom(getPlayerId(socket));
      const room = createRoom(C.MODE_DOMINATION, deathPenalty || C.DEATH_KEEP_UPGRADES, mapSize || 'small', vanilla, dominationTarget);
      const colorIndex = 0;
      const player = createPlayer(name || 'Player', colorIndex);
      const playerId = socket.id;
      // Practice doesn't support rejoin — no phrase needed
      room.players.set(playerId, player);
      playerToRoom.set(playerId, room);
      bindSocket(socket, playerId);
      room.scores[playerId] = 0;
      room.domScores[playerId] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: playerId, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      startPractice(room, playerId);
    });

    socket.on('rejoinRoom', ({ phrase }) => {
      const normalizedPhrase = normalizePhrase(phrase);
      console.log(`[rejoinRoom] socket=${socket.id} phrase=${normalizedPhrase ? '(' + normalizedPhrase.length + ' chars)' : '(none)'}`);
      if (!normalizedPhrase) { console.log('[rejoinRoom] missing phrase'); return socket.emit('sessionInvalid'); }
      const playerId = phraseKeyToPlayerId.get(normalizedPhrase);
      if (!playerId) { console.log('[rejoinRoom] unknown phrase'); return socket.emit('sessionInvalid'); }
      const room = playerToRoom.get(playerId);
      if (!room) { console.log('[rejoinRoom] no room for this phrase'); return socket.emit('sessionInvalid'); }
      const player = room.players.get(playerId);
      if (!player || player.phrase !== normalizedPhrase) { console.log('[rejoinRoom] player/phrase mismatch'); return socket.emit('sessionInvalid'); }

      // Kick whichever socket is currently bound (if any) so we take over cleanly.
      // This also handles the race where the tab was just closed but the server
      // hasn't processed the disconnect yet.
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
      console.log(`[rejoinRoom] OK playerId=${playerId} state=${room.state}`);

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
        socket.emit('roomJoined', {
          code: room.code,
          players: getPlayersInfo(room),
          mode: room.mode,
          deathPenalty: room.deathPenalty,
          you: playerId,
          hasPhrase: true,
          mapSize: room.mapSize,
          vanilla: room.vanilla,
          dominationTarget: room.dominationTarget,
        });
      }

      socket.to(room.code).emit('playerReconnected', { id: playerId, players: getPlayersInfo(room) });
    });

    socket.on('leaveRoom', () => {
      const playerId = getPlayerId(socket);
      if (!playerId) return;
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

    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      const playerId = socketToPlayerId.get(socket.id);
      socketToPlayerId.delete(socket.id);
      if (!playerId) return;

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

      if (room.practice) {
        removePlayerFromRoom(playerId);
        return;
      }

      // Players who didn't set a phrase can't rejoin — remove immediately so their
      // slot frees up for the rest of the round.
      if (!player.phrase) {
        removePlayerFromRoom(playerId);
        return;
      }

      // Mark as disconnected, freeze tank, start grace timer
      player.disconnected = true;
      player.disconnectedAt = Date.now();
      player.input = {};

      io.to(room.code).emit('playerDisconnected', { id: playerId, players: getPlayersInfo(room) });

      player.graceTimer = setTimeout(() => {
        player.graceTimer = null;
        removePlayerFromRoom(playerId);
      }, GRACE_PERIOD_MS);
    });
  });
}

module.exports = { registerHandlers };
