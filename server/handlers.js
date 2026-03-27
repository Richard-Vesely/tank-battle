const C = require('../shared/constants');
const { rooms, playerToRoom } = require('./state');
const { createRoom, findQuickPlayRoom, getPlayersInfo, getPlayerColorIndex } = require('./rooms');
const { createPlayer, getStatLevel, getAbilityLevel, getPlayerMaxHp } = require('./player');
const { removePlayerFromRoom } = require('./combat');
const { startGame, startPractice } = require('./game');

function registerHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('createRoom', ({ name, mode, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      removePlayerFromRoom(socket.id);
      const room = createRoom(mode, deathPenalty, mapSize, vanilla, dominationTarget);
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      room.players.set(socket.id, player);
      playerToRoom.set(socket.id, room);
      room.scores[socket.id] = 0;
      room.domScores[socket.id] = 0;
      socket.join(room.code);
      socket.emit('roomCreated', { code: room.code, players: getPlayersInfo(room), you: socket.id, mode: room.mode, deathPenalty: room.deathPenalty, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
    });

    socket.on('joinRoom', ({ name, code }) => {
      const room = rooms.get(code.toUpperCase());
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.state !== 'waiting') return socket.emit('error', { message: 'Game in progress' });
      if (room.players.size >= C.MAX_PLAYERS) return socket.emit('error', { message: 'Room full' });

      removePlayerFromRoom(socket.id);
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      room.players.set(socket.id, player);
      playerToRoom.set(socket.id, room);
      room.scores[socket.id] = 0;
      room.domScores[socket.id] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: socket.id, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      socket.to(room.code).emit('playerJoined', { id: socket.id, players: getPlayersInfo(room) });
    });

    socket.on('quickPlay', ({ name }) => {
      let room = findQuickPlayRoom();
      if (!room) room = createRoom(C.MODE_DOMINATION, C.DEATH_KEEP_UPGRADES, 'small');
      removePlayerFromRoom(socket.id);
      const colorIndex = getPlayerColorIndex(room);
      const player = createPlayer(name, colorIndex);
      room.players.set(socket.id, player);
      playerToRoom.set(socket.id, room);
      room.scores[socket.id] = 0;
      room.domScores[socket.id] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: socket.id, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      socket.to(room.code).emit('playerJoined', { id: socket.id, players: getPlayersInfo(room) });
    });

    socket.on('startPractice', ({ name, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      removePlayerFromRoom(socket.id);
      const room = createRoom(C.MODE_DOMINATION, deathPenalty || C.DEATH_KEEP_UPGRADES, mapSize || 'small', vanilla, dominationTarget);
      const colorIndex = 0;
      const player = createPlayer(name || 'Player', colorIndex);
      room.players.set(socket.id, player);
      playerToRoom.set(socket.id, room);
      room.scores[socket.id] = 0;
      room.domScores[socket.id] = 0;
      socket.join(room.code);
      socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: socket.id, mapSize: room.mapSize, vanilla: room.vanilla, dominationTarget: room.dominationTarget });
      startPractice(room, socket.id);
    });

    socket.on('changeColor', ({ colorIndex }) => {
      const room = playerToRoom.get(socket.id);
      if (!room || room.state !== 'waiting') return;
      const player = room.players.get(socket.id);
      if (!player) return;
      if (typeof colorIndex !== 'number' || colorIndex < 0 || colorIndex >= C.TANK_COLORS.length) return;
      // Check if color is already taken by another player
      for (const [id, p] of room.players) {
        if (id !== socket.id && p.colorIndex === colorIndex) {
          socket.emit('error', { message: 'Tuhle barvu už má někdo jiný' });
          return;
        }
      }
      player.colorIndex = colorIndex;
      io.to(room.code).emit('colorChanged', { id: socket.id, players: getPlayersInfo(room) });
    });

    socket.on('updateRoomSettings', ({ mode, deathPenalty, mapSize, vanilla, dominationTarget }) => {
      const room = playerToRoom.get(socket.id);
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
      const room = playerToRoom.get(socket.id);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player) return;
      player.ready = !player.ready;
      io.to(room.code).emit('playerReady', { id: socket.id, ready: player.ready, players: getPlayersInfo(room) });
      if (room.players.size >= C.MIN_PLAYERS) {
        let allReady = true;
        for (const [, p] of room.players) { if (!p.ready) { allReady = false; break; } }
        if (allReady) startGame(room);
      }
    });

    socket.on('input', (input) => {
      const room = playerToRoom.get(socket.id);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (player) player.input = input;
    });

    socket.on('purchase', ({ type, key }) => {
      const room = playerToRoom.get(socket.id);
      if (!room) return;
      const player = room.players.get(socket.id);
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
      removePlayerFromRoom(socket.id);
    });
  });
}

module.exports = { registerHandlers };
