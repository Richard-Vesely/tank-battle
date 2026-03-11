const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const C = require('./shared/constants');
const { generateMap } = require('./shared/map-generator');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// ─── Room Management ──────────────────────────────────────────
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(mode, hostSocket) {
  const code = generateRoomCode();
  const seed = Date.now();
  const room = {
    code,
    mode,
    state: 'waiting', // waiting, playing, roundEnd, gameOver
    players: new Map(),
    bullets: [],
    powerups: [],
    map: generateMap(C.MAP_WIDTH, C.MAP_HEIGHT, seed),
    mapSeed: seed,
    scores: {},
    round: 0,
    lastPowerupSpawn: 0,
    bulletIdCounter: 0,
    tickInterval: null,
    broadcastInterval: null,
  };
  rooms.set(code, room);
  return room;
}

function findQuickPlayRoom() {
  for (const [code, room] of rooms) {
    if (room.state === 'waiting' && room.players.size < C.MAX_PLAYERS) {
      // Only join rooms where at least one player is actually connected
      let hasConnected = false;
      for (const [id] of room.players) {
        if (io.sockets.sockets.get(id)) { hasConnected = true; break; }
      }
      if (hasConnected) return room;
    }
  }
  return null;
}

// Clean up rooms with no connected players periodically
setInterval(() => {
  for (const [code, room] of rooms) {
    let hasConnected = false;
    for (const [id] of room.players) {
      if (io.sockets.sockets.get(id)) { hasConnected = true; break; }
    }
    if (!hasConnected) {
      clearInterval(room.tickInterval);
      clearInterval(room.broadcastInterval);
      rooms.delete(code);
    }
  }
}, 10000);

function removePlayerFromRoom(socketId) {
  for (const [code, room] of rooms) {
    if (room.players.has(socketId)) {
      room.players.delete(socketId);
      io.to(code).emit('playerLeft', { id: socketId, players: getPlayersInfo(room) });

      if (room.players.size === 0) {
        clearInterval(room.tickInterval);
        clearInterval(room.broadcastInterval);
        rooms.delete(code);
      } else if (room.state === 'playing') {
        checkWinCondition(room);
      }
      return;
    }
  }
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

// ─── Game Logic ───────────────────────────────────────────────

function spawnTank(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;
  const spawnIdx = player.colorIndex % C.SPAWN_POINTS.length;
  const sp = C.SPAWN_POINTS[spawnIdx];
  player.x = sp.x * C.TILE_SIZE + C.TILE_SIZE / 2;
  player.y = sp.y * C.TILE_SIZE + C.TILE_SIZE / 2;
  player.angle = 0;
  player.hp = C.TANK_MAX_HP;
  player.alive = true;
  player.lastFire = 0;
  player.respawnTimer = 0;
  player.powerup = null;
  player.powerupTimer = 0;
  player.shieldActive = false;
}

function startGame(room) {
  room.state = 'playing';
  room.bullets = [];
  room.powerups = [];
  room.round++;
  room.lastPowerupSpawn = Date.now();

  // Reset map for new round
  room.mapSeed = Date.now();
  room.map = generateMap(C.MAP_WIDTH, C.MAP_HEIGHT, room.mapSeed);

  // Reset scores for new game
  room.scores = {};
  for (const [id] of room.players) {
    room.scores[id] = 0;
    const p = room.players.get(id);
    p.lives = C.FFA_LIVES;
    spawnTank(room, id);
  }

  io.to(room.code).emit('gameStart', {
    map: room.map,
    mapSeed: room.mapSeed,
    mode: room.mode,
    players: getGameState(room).players
  });

  // Start game loop
  const tickMs = 1000 / C.TICK_RATE;
  let lastTick = Date.now();

  room.tickInterval = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    updateGame(room, dt, now);
  }, tickMs);

  room.broadcastInterval = setInterval(() => {
    io.to(room.code).emit('gameState', getGameState(room));
  }, 1000 / C.BROADCAST_RATE);
}

function updateGame(room, dt, now) {
  if (room.state !== 'playing') return;

  // Update players
  for (const [id, p] of room.players) {
    if (!p.alive) {
      if (p.respawnTimer > 0) {
        p.respawnTimer -= dt * 1000;
        if (p.respawnTimer <= 0 && canRespawn(room, id)) {
          spawnTank(room, id);
        }
      }
      continue;
    }

    // Apply input
    const speed = p.powerup === C.POWERUP_SPEED ? C.TANK_SPEED * C.SPEED_BOOST : C.TANK_SPEED;

    if (p.input) {
      if (p.input.left) p.angle -= C.TANK_ROTATION_SPEED * dt;
      if (p.input.right) p.angle += C.TANK_ROTATION_SPEED * dt;

      if (p.input.up || p.input.down) {
        const dir = p.input.up ? 1 : -1;
        const rad = (p.angle * Math.PI) / 180;
        const nx = p.x + Math.sin(rad) * speed * dt * dir;
        const ny = p.y - Math.cos(rad) * speed * dt * dir;

        // Collision check
        if (!collidesWithMap(room.map, nx, ny, C.TANK_SIZE / 2) &&
            !collidesWithTanks(room, id, nx, ny)) {
          p.x = nx;
          p.y = ny;
        } else {
          // Try sliding along axes
          if (!collidesWithMap(room.map, nx, p.y, C.TANK_SIZE / 2) &&
              !collidesWithTanks(room, id, nx, p.y)) {
            p.x = nx;
          } else if (!collidesWithMap(room.map, p.x, ny, C.TANK_SIZE / 2) &&
                     !collidesWithTanks(room, id, p.x, ny)) {
            p.y = ny;
          }
        }
      }

      // Shooting
      if (p.input.fire) {
        const cooldown = p.powerup === C.POWERUP_RAPID ? C.RAPID_FIRE_COOLDOWN : C.FIRE_COOLDOWN;
        if (now - p.lastFire >= cooldown) {
          fireBullet(room, id, now);
          p.lastFire = now;
        }
      }
    }

    // Update powerup timer
    if (p.powerup && p.powerup !== C.POWERUP_HEAL) {
      p.powerupTimer -= dt * 1000;
      if (p.powerupTimer <= 0) {
        p.powerup = null;
        p.shieldActive = false;
      }
    }
  }

  // Update bullets
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    const rad = (b.angle * Math.PI) / 180;
    b.x += Math.sin(rad) * C.BULLET_SPEED * dt;
    b.y -= Math.cos(rad) * C.BULLET_SPEED * dt;

    // Check wall collision
    const tileX = Math.floor(b.x / C.TILE_SIZE);
    const tileY = Math.floor(b.y / C.TILE_SIZE);

    if (tileX < 0 || tileX >= C.MAP_WIDTH || tileY < 0 || tileY >= C.MAP_HEIGHT) {
      room.bullets.splice(i, 1);
      continue;
    }

    const tile = room.map[tileY][tileX];
    if (tile === C.TILE_WALL || tile === C.TILE_STEEL || tile === C.TILE_BRICK) {
      if (tile === C.TILE_BRICK) {
        // Destroy brick
        room.map[tileY][tileX] = C.TILE_EMPTY;
        io.to(room.code).emit('tileDestroyed', { x: tileX, y: tileY });
      }

      // Ricochet
      if (b.ricochets < C.BULLET_MAX_RICOCHETS && tile !== C.TILE_BRICK) {
        // Determine ricochet direction
        const prevTileX = Math.floor((b.x - Math.sin(rad) * C.BULLET_SPEED * dt) / C.TILE_SIZE);
        const prevTileY = Math.floor((b.y + Math.cos(rad) * C.BULLET_SPEED * dt) / C.TILE_SIZE);

        if (prevTileX !== tileX) {
          b.angle = -b.angle; // Reflect horizontal
        }
        if (prevTileY !== tileY) {
          b.angle = 180 - b.angle; // Reflect vertical
        }
        b.ricochets++;
        // Push bullet back slightly
        const newRad = (b.angle * Math.PI) / 180;
        b.x += Math.sin(newRad) * 4;
        b.y -= Math.cos(newRad) * 4;
      } else {
        room.bullets.splice(i, 1);
      }
      continue;
    }

    // Check player collision
    let hit = false;
    for (const [pid, p] of room.players) {
      if (pid === b.owner && b.ricochets === 0) continue; // Can't hit self unless ricocheted
      if (!p.alive) continue;

      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < C.TANK_SIZE / 2) {
        if (p.shieldActive) {
          // Shield absorbs hit
          p.shieldActive = false;
          p.powerup = null;
          io.to(room.code).emit('shieldBreak', { id: pid });
        } else {
          p.hp -= C.BULLET_DAMAGE;
          io.to(room.code).emit('playerHit', { id: pid, hp: p.hp, by: b.owner });

          if (p.hp <= 0) {
            p.alive = false;
            p.hp = 0;
            const killer = room.players.get(b.owner);
            if (killer && b.owner !== pid) {
              room.scores[b.owner] = (room.scores[b.owner] || 0) + 1;
            }

            if (room.mode === C.MODE_FFA) {
              p.lives--;
            }

            io.to(room.code).emit('playerKilled', {
              id: pid,
              by: b.owner,
              scores: room.scores
            });

            if (canRespawn(room, pid)) {
              p.respawnTimer = C.RESPAWN_TIME;
            }

            checkWinCondition(room);
          }
        }
        room.bullets.splice(i, 1);
        hit = true;
        break;
      }
    }

    // Bullet timeout (off screen or too old)
    if (!hit) {
      b.age += dt;
      if (b.age > 5) {
        room.bullets.splice(i, 1);
      }
    }
  }

  // Spawn power-ups
  if (now - room.lastPowerupSpawn >= C.POWERUP_SPAWN_INTERVAL && room.powerups.length < C.POWERUP_MAX_ON_MAP) {
    spawnPowerup(room);
    room.lastPowerupSpawn = now;
  }

  // Check powerup pickup
  for (let i = room.powerups.length - 1; i >= 0; i--) {
    const pu = room.powerups[i];
    for (const [pid, p] of room.players) {
      if (!p.alive) continue;
      const dx = pu.x - p.x;
      const dy = pu.y - p.y;
      if (Math.sqrt(dx * dx + dy * dy) < (C.TANK_SIZE / 2 + C.POWERUP_SIZE / 2)) {
        applyPowerup(p, pu.type);
        room.powerups.splice(i, 1);
        io.to(room.code).emit('powerupCollected', { id: pid, type: pu.type, index: i });
        break;
      }
    }
  }
}

function canRespawn(room, playerId) {
  const p = room.players.get(playerId);
  if (room.mode === C.MODE_FFA) return p.lives > 0;
  return true; // rounds mode always respawns
}

function fireBullet(room, playerId, now) {
  const p = room.players.get(playerId);
  const rad = (p.angle * Math.PI) / 180;
  room.bullets.push({
    id: room.bulletIdCounter++,
    owner: playerId,
    x: p.x + Math.sin(rad) * (C.TANK_SIZE / 2 + 4),
    y: p.y - Math.cos(rad) * (C.TANK_SIZE / 2 + 4),
    angle: p.angle,
    ricochets: 0,
    age: 0
  });
  io.to(room.code).emit('bulletFired', { owner: playerId });
}

function spawnPowerup(room) {
  const types = [C.POWERUP_SPEED, C.POWERUP_RAPID, C.POWERUP_SHIELD, C.POWERUP_HEAL];
  const type = types[Math.floor(Math.random() * types.length)];

  // Find random empty tile
  let x, y;
  let attempts = 0;
  do {
    x = 2 + Math.floor(Math.random() * (C.MAP_WIDTH - 4));
    y = 2 + Math.floor(Math.random() * (C.MAP_HEIGHT - 4));
    attempts++;
  } while (room.map[y][x] !== C.TILE_EMPTY && attempts < 50);

  if (attempts >= 50) return;

  const pu = {
    type,
    x: x * C.TILE_SIZE + C.TILE_SIZE / 2,
    y: y * C.TILE_SIZE + C.TILE_SIZE / 2
  };
  room.powerups.push(pu);
  io.to(room.code).emit('powerupSpawned', pu);
}

function applyPowerup(player, type) {
  if (type === C.POWERUP_HEAL) {
    player.hp = Math.min(player.hp + 40, C.TANK_MAX_HP);
  } else {
    player.powerup = type;
    player.powerupTimer = C.POWERUP_DURATION;
    if (type === C.POWERUP_SHIELD) {
      player.shieldActive = true;
    }
  }
}

function collidesWithMap(map, x, y, radius) {
  // Check tiles around the position
  const minTX = Math.floor((x - radius) / C.TILE_SIZE);
  const maxTX = Math.floor((x + radius) / C.TILE_SIZE);
  const minTY = Math.floor((y - radius) / C.TILE_SIZE);
  const maxTY = Math.floor((y + radius) / C.TILE_SIZE);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (tx < 0 || tx >= C.MAP_WIDTH || ty < 0 || ty >= C.MAP_HEIGHT) return true;
      const tile = map[ty][tx];
      if (tile === C.TILE_WALL || tile === C.TILE_BRICK || tile === C.TILE_STEEL) {
        // AABB vs circle collision
        const closestX = Math.max(tx * C.TILE_SIZE, Math.min(x, (tx + 1) * C.TILE_SIZE));
        const closestY = Math.max(ty * C.TILE_SIZE, Math.min(y, (ty + 1) * C.TILE_SIZE));
        const dx = x - closestX;
        const dy = y - closestY;
        if (dx * dx + dy * dy < radius * radius) return true;
      }
    }
  }
  return false;
}

function collidesWithTanks(room, selfId, x, y) {
  for (const [id, p] of room.players) {
    if (id === selfId || !p.alive) continue;
    const dx = x - p.x;
    const dy = y - p.y;
    if (Math.sqrt(dx * dx + dy * dy) < C.TANK_SIZE) return true;
  }
  return false;
}

function checkWinCondition(room) {
  if (room.state !== 'playing') return;

  if (room.mode === C.MODE_ROUNDS) {
    // Check if anyone reached the kill target
    for (const [id, score] of Object.entries(room.scores)) {
      if (score >= C.ROUNDS_TO_WIN) {
        endGame(room, id);
        return;
      }
    }
  } else {
    // FFA: check if only one player has lives left
    const alive = [];
    for (const [id, p] of room.players) {
      if (p.lives > 0 || p.alive) alive.push(id);
    }
    if (alive.length <= 1 && room.players.size >= 2) {
      endGame(room, alive[0] || null);
      return;
    }
  }
}

function endGame(room, winnerId) {
  room.state = 'gameOver';
  clearInterval(room.tickInterval);
  clearInterval(room.broadcastInterval);

  const winner = room.players.get(winnerId);
  io.to(room.code).emit('gameOver', {
    winnerId,
    winnerName: winner ? winner.name : 'Nobody',
    scores: room.scores
  });

  // Return to lobby after 5 seconds
  setTimeout(() => {
    if (rooms.has(room.code)) {
      room.state = 'waiting';
      room.bullets = [];
      room.powerups = [];
      for (const [id, p] of room.players) {
        p.ready = false;
      }
      io.to(room.code).emit('returnToLobby', { players: getPlayersInfo(room) });
    }
  }, 5000);
}

function getGameState(room) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push({
      id,
      name: p.name,
      x: p.x,
      y: p.y,
      angle: p.angle,
      hp: p.hp,
      alive: p.alive,
      colorIndex: p.colorIndex,
      powerup: p.powerup,
      shieldActive: p.shieldActive,
      lives: p.lives
    });
  }
  return {
    players,
    bullets: room.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, owner: b.owner })),
    powerups: room.powerups,
    scores: room.scores
  };
}

// ─── Socket.IO Events ─────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('createRoom', ({ name, mode }) => {
    removePlayerFromRoom(socket.id);
    const room = createRoom(mode || C.MODE_FFA);
    const colorIndex = getPlayerColorIndex(room);

    room.players.set(socket.id, {
      name: (name || 'Player').substring(0, 16),
      colorIndex,
      color: C.TANK_COLORS[colorIndex],
      ready: false,
      x: 0, y: 0, angle: 0,
      hp: C.TANK_MAX_HP,
      alive: false,
      input: {},
      lastFire: 0,
      powerup: null,
      powerupTimer: 0,
      shieldActive: false,
      lives: C.FFA_LIVES
    });

    room.scores[socket.id] = 0;
    socket.join(room.code);

    socket.emit('roomCreated', {
      code: room.code,
      players: getPlayersInfo(room),
      you: socket.id
    });
  });

  socket.on('joinRoom', ({ name, code }) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.state !== 'waiting') return socket.emit('error', { message: 'Game already in progress' });
    if (room.players.size >= C.MAX_PLAYERS) return socket.emit('error', { message: 'Room is full' });

    removePlayerFromRoom(socket.id);
    const colorIndex = getPlayerColorIndex(room);

    room.players.set(socket.id, {
      name: (name || 'Player').substring(0, 16),
      colorIndex,
      color: C.TANK_COLORS[colorIndex],
      ready: false,
      x: 0, y: 0, angle: 0,
      hp: C.TANK_MAX_HP,
      alive: false,
      input: {},
      lastFire: 0,
      powerup: null,
      powerupTimer: 0,
      shieldActive: false,
      lives: C.FFA_LIVES
    });

    room.scores[socket.id] = 0;
    socket.join(room.code);

    socket.emit('roomJoined', {
      code: room.code,
      players: getPlayersInfo(room),
      mode: room.mode,
      you: socket.id
    });

    socket.to(room.code).emit('playerJoined', {
      id: socket.id,
      players: getPlayersInfo(room)
    });
  });

  socket.on('quickPlay', ({ name }) => {
    let room = findQuickPlayRoom();
    if (!room) {
      room = createRoom(C.MODE_ROUNDS);
    }

    removePlayerFromRoom(socket.id);
    const colorIndex = getPlayerColorIndex(room);

    room.players.set(socket.id, {
      name: (name || 'Player').substring(0, 16),
      colorIndex,
      color: C.TANK_COLORS[colorIndex],
      ready: false,
      x: 0, y: 0, angle: 0,
      hp: C.TANK_MAX_HP,
      alive: false,
      input: {},
      lastFire: 0,
      powerup: null,
      powerupTimer: 0,
      shieldActive: false,
      lives: C.FFA_LIVES
    });

    room.scores[socket.id] = 0;
    socket.join(room.code);

    socket.emit('roomJoined', {
      code: room.code,
      players: getPlayersInfo(room),
      mode: room.mode,
      you: socket.id
    });

    socket.to(room.code).emit('playerJoined', {
      id: socket.id,
      players: getPlayersInfo(room)
    });
  });

  socket.on('toggleReady', () => {
    for (const [code, room] of rooms) {
      const player = room.players.get(socket.id);
      if (player) {
        player.ready = !player.ready;
        io.to(code).emit('playerReady', { id: socket.id, ready: player.ready, players: getPlayersInfo(room) });

        // Check if all players ready and enough players
        if (room.players.size >= C.MIN_PLAYERS) {
          let allReady = true;
          for (const [, p] of room.players) {
            if (!p.ready) { allReady = false; break; }
          }
          if (allReady) startGame(room);
        }
        return;
      }
    }
  });

  socket.on('input', (input) => {
    for (const [, room] of rooms) {
      const player = room.players.get(socket.id);
      if (player) {
        player.input = input;
        return;
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    removePlayerFromRoom(socket.id);
  });
});

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tank Battle server running on http://localhost:${PORT}`);
});
