const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const C = require('./shared/constants');
const { generateMap } = require('./shared/map-generator');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

function createRoom(mode, deathPenalty) {
  const code = generateRoomCode();
  const seed = Date.now();
  const room = {
    code,
    mode: mode || C.MODE_DOMINATION,
    deathPenalty: deathPenalty || C.DEATH_KEEP_UPGRADES,
    state: 'waiting',
    players: new Map(),
    bullets: [],
    powerups: [],
    mines: [],
    smokes: [],
    creditPickups: [],
    lastCreditSpawn: 0,
    lastPassiveIncome: 0,
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
  };
  rooms.set(code, room);
  return room;
}

function findQuickPlayRoom() {
  for (const [code, room] of rooms) {
    if (room.state === 'waiting' && room.players.size < C.MAX_PLAYERS) {
      let hasConnected = false;
      for (const [id] of room.players) {
        if (io.sockets.sockets.get(id)) { hasConnected = true; break; }
      }
      if (hasConnected) return room;
    }
  }
  return null;
}

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

      // In practice mode, if the real player leaves, tear down the whole room
      if (room.practice) {
        clearInterval(room.tickInterval);
        clearInterval(room.broadcastInterval);
        rooms.delete(code);
        return;
      }

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

// ─── Player Factory ───────────────────────────────────────────
function createPlayer(name, colorIndex) {
  return {
    name: (name || 'Player').substring(0, 16),
    colorIndex,
    color: C.TANK_COLORS[colorIndex],
    ready: false,
    x: 0, y: 0, angle: 0,
    hp: C.TANK_MAX_HP,
    maxHp: C.TANK_MAX_HP,
    alive: false,
    input: {},
    lastFire: 0,
    powerup: null,
    powerupTimer: 0,
    shieldActive: false,
    lives: C.FFA_LIVES,
    respawnTimer: 0,
    // v2: Upgrades
    currency: 0,
    upgrades: {},  // { damage: 1, radar: 2, ... }
    // v2: Ability cooldowns
    dashCooldown: 0,
    teleportCooldown: 0,
    empCooldown: 0,
    smokeCooldown: 0,
    mineCooldown: 0,
    // v2: Status effects
    empDisabled: false,
    empTimer: 0,
    stealthVisible: true,  // whether this player is visible (computed per-viewer)
    // v2: Regen timer
    regenTimer: 0,
  };
}

// ─── Upgrade Helpers ──────────────────────────────────────────
function getUpgradeLevel(player, key) {
  return player.upgrades[key] || 0;
}

function getUpgradeValue(key, level) {
  if (level <= 0) return null;
  const def = C.UPGRADES[key];
  if (!def) return null;
  return def.values[level - 1];
}

function getPlayerDamage(player) {
  const lvl = getUpgradeLevel(player, 'damage');
  return lvl > 0 ? getUpgradeValue('damage', lvl) : C.BULLET_DAMAGE;
}

function getPlayerFireCooldown(player) {
  const lvl = getUpgradeLevel(player, 'reload');
  if (player.powerup === C.POWERUP_RAPID) return C.RAPID_FIRE_COOLDOWN;
  return lvl > 0 ? getUpgradeValue('reload', lvl) : C.FIRE_COOLDOWN;
}

function getPlayerBulletSpeed(player) {
  const lvl = getUpgradeLevel(player, 'bulletSpeed');
  return lvl > 0 ? getUpgradeValue('bulletSpeed', lvl) : C.BULLET_SPEED;
}

function getPlayerSpeed(player) {
  const lvl = getUpgradeLevel(player, 'speed');
  let spd = lvl > 0 ? getUpgradeValue('speed', lvl) : C.TANK_SPEED;
  if (player.powerup === C.POWERUP_SPEED) spd *= C.SPEED_BOOST;
  return spd;
}

function getPlayerRotation(player) {
  const lvl = getUpgradeLevel(player, 'rotation');
  return lvl > 0 ? getUpgradeValue('rotation', lvl) : C.TANK_ROTATION_SPEED;
}

function getPlayerMaxHp(player) {
  const lvl = getUpgradeLevel(player, 'maxHp');
  return lvl > 0 ? getUpgradeValue('maxHp', lvl) : C.TANK_MAX_HP;
}

function getPlayerArmor(player) {
  const lvl = getUpgradeLevel(player, 'armor');
  return lvl > 0 ? getUpgradeValue('armor', lvl) : 1.0;
}

function getPlayerRegen(player) {
  const lvl = getUpgradeLevel(player, 'regen');
  return lvl > 0 ? getUpgradeValue('regen', lvl) : 0;
}

function getPlayerRicochet(player) {
  const lvl = getUpgradeLevel(player, 'ricochet');
  return lvl > 0 ? getUpgradeValue('ricochet', lvl) : C.BULLET_MAX_RICOCHETS;
}

function getPlayerVision(player) {
  const lvl = getUpgradeLevel(player, 'radar');
  return C.BASE_VISION + (lvl > 0 ? lvl : 0);
}

function getPlayerStealth(player) {
  return getUpgradeLevel(player, 'stealth');
}

function hasUpgrade(player, key) {
  return getUpgradeLevel(player, key) > 0;
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
  player.maxHp = getPlayerMaxHp(player);
  player.hp = player.maxHp;
  player.alive = true;
  player.lastFire = 0;
  player.respawnTimer = 0;
  player.powerup = null;
  player.powerupTimer = 0;
  player.shieldActive = false;
  player.empDisabled = false;
  player.empTimer = 0;
  player.regenTimer = 0;
}

function startGame(room) {
  room.state = 'playing';
  room.bullets = [];
  room.powerups = [];
  room.mines = [];
  room.smokes = [];
  room.creditPickups = [];
  room.lastCreditSpawn = Date.now();
  room.lastPassiveIncome = Date.now();
  room.round++;
  room.lastPowerupSpawn = Date.now();

  room.mapSeed = Date.now();
  room.map = generateMap(C.MAP_WIDTH, C.MAP_HEIGHT, room.mapSeed, C.CAPTURE_ZONES);

  // Reset scores
  room.scores = {};
  room.domScores = {};

  // Init capture zones for domination
  room.captureZones = C.CAPTURE_ZONES.map(z => ({
    x: z.x, y: z.y, label: z.label,
    owner: null,
    captureProgress: {},  // { playerId: seconds }
    contested: false
  }));

  for (const [id] of room.players) {
    room.scores[id] = 0;
    room.domScores[id] = 0;
    const p = room.players.get(id);
    p.lives = C.FFA_LIVES;
    p.currency = 0;
    p.upgrades = {};
    spawnTank(room, id);
  }

  // Build initial player list for gameStart
  const startPlayers = [];
  for (const [id, p] of room.players) {
    startPlayers.push(serializePlayer(id, p, true));
  }

  io.to(room.code).emit('gameStart', {
    map: room.map,
    mapSeed: room.mapSeed,
    mode: room.mode,
    deathPenalty: room.deathPenalty,
    practice: room.practice || false,
    captureZones: room.captureZones.map(z => ({ x: z.x, y: z.y, label: z.label })),
    players: startPlayers
  });

  const tickMs = 1000 / C.TICK_RATE;
  let lastTick = Date.now();

  room.tickInterval = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    updateGame(room, dt, now);
  }, tickMs);

  room.broadcastInterval = setInterval(() => {
    broadcastState(room);
  }, 1000 / C.BROADCAST_RATE);
}

// ─── Fog of War: per-player visibility ────────────────────────
function isVisibleTo(viewer, target, room) {
  const visionZones = getPlayerVision(viewer);
  const stealthZones = getPlayerStealth(target);

  // Calculate distance in tiles
  const dx = (target.x - viewer.x) / C.TILE_SIZE;
  const dy = (target.y - viewer.y) / C.TILE_SIZE;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Determine which zone the target is in
  let targetZone;
  if (dist <= C.FOG_ZONE_1) targetZone = 1;
  else if (dist <= C.FOG_ZONE_2) targetZone = 2;
  else if (dist <= C.FOG_ZONE_3) targetZone = 3;
  else if (dist <= C.FOG_ZONE_4) targetZone = 4;
  else return false; // Beyond all zones

  // Viewer can see zones 1 through visionZones
  if (targetZone > visionZones) return false;

  // Stealth: target invisible in zones > (max - stealth)
  // Stealth 1 = invisible in zone 4+, Stealth 2 = invisible in zones 3+, etc.
  const visibleMinZone = stealthZones + 1;  // stealth 0 = visible everywhere, stealth 1 = only visible in zone 1
  // Actually: stealth N means visible only in first (4-N) zones
  // Stealth 0: visible in zones 1,2,3,4
  // Stealth 1: visible in zones 1,2,3
  // Stealth 2: visible in zones 1,2
  // Stealth 3: visible in zone 1 only
  const maxVisibleZone = 4 - stealthZones;
  if (targetZone > maxVisibleZone) return false;

  return true;
}

function broadcastState(room) {
  // Send per-player customized state (fog of war)
  for (const [viewerId, viewer] of room.players) {
    const state = getGameStateForPlayer(room, viewerId);
    const socket = io.sockets.sockets.get(viewerId);
    if (socket) socket.emit('gameState', state);
  }
}

function getGameStateForPlayer(room, viewerId) {
  const viewer = room.players.get(viewerId);
  const players = [];

  for (const [id, p] of room.players) {
    if (id === viewerId) {
      // Always see yourself fully
      players.push(serializePlayer(id, p, true));
    } else if (!viewer || !viewer.alive) {
      // Dead players see everything (spectator)
      players.push(serializePlayer(id, p, true));
    } else if (p.alive && isVisibleTo(viewer, p, room)) {
      players.push(serializePlayer(id, p, true));
    } else if (p.alive) {
      // Hidden — send minimal info (player exists but position unknown)
      players.push(serializePlayer(id, p, false));
    } else {
      players.push(serializePlayer(id, p, true));
    }
  }

  // Filter bullets by visibility
  const visibleBullets = viewer && viewer.alive
    ? room.bullets.filter(b => {
        const dx = (b.x - viewer.x) / C.TILE_SIZE;
        const dy = (b.y - viewer.y) / C.TILE_SIZE;
        return Math.sqrt(dx*dx + dy*dy) <= C.FOG_ZONE_4;
      })
    : room.bullets;

  return {
    players,
    bullets: visibleBullets.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, owner: b.owner })),
    powerups: room.powerups,
    creditPickups: room.creditPickups.map(c => ({ x: c.x, y: c.y, value: c.value })),
    mines: viewer && viewer.alive
      ? room.mines.filter(m => m.owner === viewerId || isVisibleTo(viewer, m, room))
      : room.mines,
    smokes: room.smokes.map(s => ({ x: s.x, y: s.y, radius: C.SMOKE_RADIUS, remaining: s.remaining })),
    scores: room.scores,
    domScores: room.domScores,
    captureZones: room.captureZones.map(z => ({ x: z.x, y: z.y, label: z.label, owner: z.owner, contested: z.contested })),
    fogCenter: viewer ? { x: viewer.x, y: viewer.y } : null,
    visionZones: viewer ? getPlayerVision(viewer) : 4
  };
}

function serializePlayer(id, p, visible) {
  if (!visible) {
    return { id, name: p.name, colorIndex: p.colorIndex, alive: p.alive, visible: false };
  }
  return {
    id, name: p.name,
    x: p.x, y: p.y, angle: p.angle,
    hp: p.hp, maxHp: p.maxHp,
    alive: p.alive,
    colorIndex: p.colorIndex,
    powerup: p.powerup,
    shieldActive: p.shieldActive,
    lives: p.lives,
    currency: p.currency,
    upgrades: p.upgrades,
    empDisabled: p.empDisabled,
    visible: true
  };
}

// ─── Main Update Loop ─────────────────────────────────────────
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

    // EMP disable timer
    if (p.empDisabled) {
      p.empTimer -= dt * 1000;
      if (p.empTimer <= 0) {
        p.empDisabled = false;
      }
      continue; // Can't do anything while EMP'd
    }

    // Regen
    const regenRate = getPlayerRegen(p);
    if (regenRate > 0) {
      p.regenTimer += dt;
      if (p.regenTimer >= 1) {
        p.hp = Math.min(p.hp + regenRate, p.maxHp);
        p.regenTimer = 0;
      }
    }

    // Movement
    const speed = getPlayerSpeed(p);
    const rotSpeed = getPlayerRotation(p);

    if (p.input) {
      if (p.input.left) p.angle -= rotSpeed * dt;
      if (p.input.right) p.angle += rotSpeed * dt;

      if (p.input.up || p.input.down) {
        const dir = p.input.up ? 1 : -1;
        const rad = (p.angle * Math.PI) / 180;
        const nx = p.x + Math.sin(rad) * speed * dt * dir;
        const ny = p.y - Math.cos(rad) * speed * dt * dir;

        if (!collidesWithMap(room, p, nx, ny, C.TANK_SIZE / 2) &&
            !collidesWithTanks(room, id, nx, ny)) {
          p.x = nx;
          p.y = ny;
        } else {
          if (!collidesWithMap(room, p, nx, p.y, C.TANK_SIZE / 2) &&
              !collidesWithTanks(room, id, nx, p.y)) {
            p.x = nx;
          } else if (!collidesWithMap(room, p, p.x, ny, C.TANK_SIZE / 2) &&
                     !collidesWithTanks(room, id, p.x, ny)) {
            p.y = ny;
          }
        }
      }

      // Shooting
      if (p.input.fire) {
        const cooldown = getPlayerFireCooldown(p);
        if (now - p.lastFire >= cooldown) {
          fireBullet(room, id, now);
          p.lastFire = now;
        }
      }

      // Abilities
      if (p.input.dash && hasUpgrade(p, 'dash') && p.dashCooldown <= 0) {
        performDash(room, id);
        p.dashCooldown = C.DASH_COOLDOWN;
      }
      if (p.input.teleport && hasUpgrade(p, 'teleport') && p.teleportCooldown <= 0) {
        performTeleport(room, id);
        p.teleportCooldown = C.TELEPORT_COOLDOWN;
      }
      if (p.input.emp && hasUpgrade(p, 'emp') && p.empCooldown <= 0) {
        performEMP(room, id);
        p.empCooldown = C.EMP_COOLDOWN;
      }
      if (p.input.smoke && hasUpgrade(p, 'smoke') && p.smokeCooldown <= 0) {
        performSmoke(room, id);
        p.smokeCooldown = C.SMOKE_COOLDOWN;
      }
      if (p.input.mine && hasUpgrade(p, 'mine') && p.mineCooldown <= 0) {
        placeMine(room, id);
        p.mineCooldown = C.MINE_COOLDOWN;
      }
    }

    // Cooldown timers
    if (p.dashCooldown > 0) p.dashCooldown -= dt * 1000;
    if (p.teleportCooldown > 0) p.teleportCooldown -= dt * 1000;
    if (p.empCooldown > 0) p.empCooldown -= dt * 1000;
    if (p.smokeCooldown > 0) p.smokeCooldown -= dt * 1000;
    if (p.mineCooldown > 0) p.mineCooldown -= dt * 1000;

    // Powerup timer
    if (p.powerup && p.powerup !== C.POWERUP_HEAL) {
      p.powerupTimer -= dt * 1000;
      if (p.powerupTimer <= 0) {
        p.powerup = null;
        p.shieldActive = false;
      }
    }
  }

  // Update bot AI
  if (room.practice) updateBots(room, dt, now);

  // Update bullets
  updateBullets(room, dt);

  // Update mines
  updateMines(room);

  // Update smokes
  for (let i = room.smokes.length - 1; i >= 0; i--) {
    room.smokes[i].remaining -= dt * 1000;
    if (room.smokes[i].remaining <= 0) room.smokes.splice(i, 1);
  }

  // Spawn power-ups
  if (now - room.lastPowerupSpawn >= C.POWERUP_SPAWN_INTERVAL && room.powerups.length < C.POWERUP_MAX_ON_MAP) {
    spawnPowerup(room);
    room.lastPowerupSpawn = now;
  }

  // Powerup pickup
  for (let i = room.powerups.length - 1; i >= 0; i--) {
    const pu = room.powerups[i];
    for (const [pid, p] of room.players) {
      if (!p.alive) continue;
      const dx = pu.x - p.x, dy = pu.y - p.y;
      if (Math.sqrt(dx*dx + dy*dy) < (C.TANK_SIZE/2 + C.POWERUP_SIZE/2)) {
        applyPowerup(p, pu.type);
        room.powerups.splice(i, 1);
        io.to(room.code).emit('powerupCollected', { id: pid, type: pu.type });
        break;
      }
    }
  }

  // Passive credit income (every few seconds)
  if (now - room.lastPassiveIncome >= C.PASSIVE_INCOME_INTERVAL) {
    room.lastPassiveIncome = now;
    for (const [id, p] of room.players) {
      if (!p.alive) continue;
      p.currency += C.PASSIVE_INCOME_AMOUNT;
    }
  }

  // Spawn credit pickups
  if (now - room.lastCreditSpawn >= C.CREDIT_SPAWN_INTERVAL && room.creditPickups.length < C.CREDIT_MAX_ON_MAP) {
    spawnCreditPickup(room);
    room.lastCreditSpawn = now;
  }

  // Credit pickup collection
  for (let i = room.creditPickups.length - 1; i >= 0; i--) {
    const cr = room.creditPickups[i];
    for (const [pid, p] of room.players) {
      if (!p.alive) continue;
      const dx = cr.x - p.x, dy = cr.y - p.y;
      if (Math.sqrt(dx*dx + dy*dy) < (C.TANK_SIZE/2 + 10)) {
        p.currency += cr.value;
        io.to(room.code).emit('creditCollected', { id: pid, value: cr.value, total: p.currency });
        room.creditPickups.splice(i, 1);
        break;
      }
    }
  }

  // Domination: capture zones
  if (room.mode === C.MODE_DOMINATION) {
    updateCaptureZones(room, dt);
  }
}

function updateBullets(room, dt) {
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    const rad = (b.angle * Math.PI) / 180;
    b.x += Math.sin(rad) * b.speed * dt;
    b.y -= Math.cos(rad) * b.speed * dt;

    const tileX = Math.floor(b.x / C.TILE_SIZE);
    const tileY = Math.floor(b.y / C.TILE_SIZE);

    if (tileX < 0 || tileX >= C.MAP_WIDTH || tileY < 0 || tileY >= C.MAP_HEIGHT) {
      room.bullets.splice(i, 1);
      continue;
    }

    const tile = room.map[tileY][tileX];
    if (tile === C.TILE_WALL || tile === C.TILE_STEEL || tile === C.TILE_BRICK) {
      if (tile === C.TILE_BRICK) {
        room.map[tileY][tileX] = C.TILE_EMPTY;
        io.to(room.code).emit('tileDestroyed', { x: tileX, y: tileY });
      }

      if (b.ricochets < b.maxRicochets && tile !== C.TILE_BRICK) {
        const prevTileX = Math.floor((b.x - Math.sin(rad) * b.speed * dt) / C.TILE_SIZE);
        const prevTileY = Math.floor((b.y + Math.cos(rad) * b.speed * dt) / C.TILE_SIZE);
        if (prevTileX !== tileX) b.angle = -b.angle;
        if (prevTileY !== tileY) b.angle = 180 - b.angle;
        b.ricochets++;
        const newRad = (b.angle * Math.PI) / 180;
        b.x += Math.sin(newRad) * 4;
        b.y -= Math.cos(newRad) * 4;
      } else {
        room.bullets.splice(i, 1);
      }
      continue;
    }

    // Player collision
    let hit = false;
    for (const [pid, p] of room.players) {
      if (pid === b.owner && b.ricochets === 0) continue;
      if (!p.alive) continue;

      const dx = b.x - p.x, dy = b.y - p.y;
      if (Math.sqrt(dx*dx + dy*dy) < C.TANK_SIZE / 2) {
        if (p.shieldActive) {
          p.shieldActive = false;
          p.powerup = null;
          io.to(room.code).emit('shieldBreak', { id: pid });
        } else {
          const dmg = Math.round(b.damage * getPlayerArmor(p));
          p.hp -= dmg;
          io.to(room.code).emit('playerHit', { id: pid, hp: p.hp, by: b.owner, dmg });

          if (p.hp <= 0) {
            killPlayer(room, pid, b.owner);
          }
        }
        room.bullets.splice(i, 1);
        hit = true;
        break;
      }
    }

    if (!hit) {
      b.age += dt;
      if (b.age > 5) room.bullets.splice(i, 1);
    }
  }
}

function killPlayer(room, victimId, killerId) {
  const victim = room.players.get(victimId);
  victim.alive = false;
  victim.hp = 0;

  if (killerId && killerId !== victimId) {
    room.scores[killerId] = (room.scores[killerId] || 0) + 1;
    const killer = room.players.get(killerId);
    if (killer) {
      killer.currency += C.KILL_CURRENCY;
      io.to(room.code).emit('currencyEarned', { id: killerId, amount: C.KILL_CURRENCY, total: killer.currency });
    }
  }

  // Death penalty
  if (room.deathPenalty === C.DEATH_LOSE_ALL) {
    victim.upgrades = {};
    victim.currency = 0;
  }

  if (room.mode === C.MODE_FFA) victim.lives--;

  io.to(room.code).emit('playerKilled', { id: victimId, by: killerId, scores: room.scores });

  if (canRespawn(room, victimId)) {
    victim.respawnTimer = C.RESPAWN_TIME;
  }
  checkWinCondition(room);
}

function updateMines(room) {
  for (let i = room.mines.length - 1; i >= 0; i--) {
    const m = room.mines[i];
    for (const [pid, p] of room.players) {
      if (pid === m.owner) continue;
      if (!p.alive) continue;
      const dx = m.x - p.x, dy = m.y - p.y;
      if (Math.sqrt(dx*dx + dy*dy) < C.MINE_RADIUS) {
        // Explode mine
        const dmg = Math.round(C.MINE_DAMAGE * getPlayerArmor(p));
        p.hp -= dmg;
        io.to(room.code).emit('mineExploded', { x: m.x, y: m.y, victim: pid });
        if (p.hp <= 0) killPlayer(room, pid, m.owner);
        room.mines.splice(i, 1);
        break;
      }
    }
  }
}

function updateCaptureZones(room, dt) {
  for (const zone of room.captureZones) {
    const playersInZone = [];
    for (const [id, p] of room.players) {
      if (!p.alive) continue;
      const dx = (p.x / C.TILE_SIZE) - zone.x;
      const dy = (p.y / C.TILE_SIZE) - zone.y;
      if (Math.sqrt(dx*dx + dy*dy) <= C.CAPTURE_ZONE_RADIUS) {
        playersInZone.push(id);
      }
    }

    zone.contested = playersInZone.length > 1;

    if (playersInZone.length === 1 && !zone.contested) {
      const capturer = playersInZone[0];
      if (zone.owner !== capturer) {
        if (!zone.captureProgress[capturer]) zone.captureProgress[capturer] = 0;
        zone.captureProgress[capturer] += dt;

        // Reset other progress
        for (const key of Object.keys(zone.captureProgress)) {
          if (key !== capturer) zone.captureProgress[key] = Math.max(0, zone.captureProgress[key] - dt * 2);
        }

        if (zone.captureProgress[capturer] >= C.CAPTURE_RATE) {
          zone.owner = capturer;
          zone.captureProgress = {};
          io.to(room.code).emit('zoneCaptured', { label: zone.label, owner: capturer });
        }
      }
    }

    // Award domination points
    if (zone.owner && room.domScores[zone.owner] !== undefined) {
      room.domScores[zone.owner] += C.DOMINATION_POINTS_PER_SEC * dt;
    }
  }

  // Check domination win
  for (const [id, score] of Object.entries(room.domScores)) {
    if (score >= C.DOMINATION_WIN_SCORE) {
      endGame(room, id);
      return;
    }
  }
}

// ─── Abilities ────────────────────────────────────────────────
function performDash(room, playerId) {
  const p = room.players.get(playerId);
  const rad = (p.angle * Math.PI) / 180;
  const nx = p.x + Math.sin(rad) * C.DASH_DISTANCE;
  const ny = p.y - Math.cos(rad) * C.DASH_DISTANCE;
  // Clamp to valid position
  if (!collidesWithMap(room, p, nx, ny, C.TANK_SIZE / 2)) {
    p.x = nx;
    p.y = ny;
  }
  io.to(room.code).emit('abilityUsed', { id: playerId, ability: 'dash' });
}

function performTeleport(room, playerId) {
  const p = room.players.get(playerId);
  // Teleport to a random empty spot within range
  let attempts = 0;
  while (attempts < 20) {
    const angle = Math.random() * Math.PI * 2;
    const dist = C.TELEPORT_RANGE * (0.5 + Math.random() * 0.5);
    const nx = p.x + Math.cos(angle) * dist;
    const ny = p.y + Math.sin(angle) * dist;
    if (!collidesWithMap(room, p, nx, ny, C.TANK_SIZE / 2)) {
      p.x = nx;
      p.y = ny;
      io.to(room.code).emit('abilityUsed', { id: playerId, ability: 'teleport', x: nx, y: ny });
      return;
    }
    attempts++;
  }
}

function performEMP(room, playerId) {
  const p = room.players.get(playerId);
  for (const [id, other] of room.players) {
    if (id === playerId || !other.alive) continue;
    const dx = other.x - p.x, dy = other.y - p.y;
    if (Math.sqrt(dx*dx + dy*dy) <= C.EMP_RADIUS) {
      other.empDisabled = true;
      other.empTimer = C.EMP_DURATION;
    }
  }
  io.to(room.code).emit('abilityUsed', { id: playerId, ability: 'emp', x: p.x, y: p.y });
}

function performSmoke(room, playerId) {
  const p = room.players.get(playerId);
  room.smokes.push({ x: p.x, y: p.y, owner: playerId, remaining: C.SMOKE_DURATION });
  io.to(room.code).emit('abilityUsed', { id: playerId, ability: 'smoke', x: p.x, y: p.y });
}

function placeMine(room, playerId) {
  const p = room.players.get(playerId);
  room.mines.push({
    id: room.mineIdCounter++,
    owner: playerId,
    x: p.x, y: p.y
  });
  io.to(room.code).emit('minePlaced', { owner: playerId, x: p.x, y: p.y });
}

// ─── Collision ────────────────────────────────────────────────
function collidesWithMap(room, player, x, y, radius) {
  const minTX = Math.floor((x - radius) / C.TILE_SIZE);
  const maxTX = Math.floor((x + radius) / C.TILE_SIZE);
  const minTY = Math.floor((y - radius) / C.TILE_SIZE);
  const maxTY = Math.floor((y + radius) / C.TILE_SIZE);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (tx < 0 || tx >= C.MAP_WIDTH || ty < 0 || ty >= C.MAP_HEIGHT) return true;
      const tile = room.map[ty][tx];
      if (tile === C.TILE_WALL || tile === C.TILE_STEEL) {
        const closestX = Math.max(tx * C.TILE_SIZE, Math.min(x, (tx + 1) * C.TILE_SIZE));
        const closestY = Math.max(ty * C.TILE_SIZE, Math.min(y, (ty + 1) * C.TILE_SIZE));
        const ddx = x - closestX, ddy = y - closestY;
        if (ddx*ddx + ddy*ddy < radius*radius) return true;
      }
      if (tile === C.TILE_BRICK) {
        // Brick breaker upgrade lets you drive through bricks
        if (player && hasUpgrade(player, 'breaker')) {
          room.map[ty][tx] = C.TILE_EMPTY;
          io.to(room.code).emit('tileDestroyed', { x: tx, y: ty });
          continue;
        }
        const closestX = Math.max(tx * C.TILE_SIZE, Math.min(x, (tx + 1) * C.TILE_SIZE));
        const closestY = Math.max(ty * C.TILE_SIZE, Math.min(y, (ty + 1) * C.TILE_SIZE));
        const ddx = x - closestX, ddy = y - closestY;
        if (ddx*ddx + ddy*ddy < radius*radius) return true;
      }
    }
  }
  return false;
}

function collidesWithTanks(room, selfId, x, y) {
  for (const [id, p] of room.players) {
    if (id === selfId || !p.alive) continue;
    const dx = x - p.x, dy = y - p.y;
    if (Math.sqrt(dx*dx + dy*dy) < C.TANK_SIZE) return true;
  }
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────
function canRespawn(room, playerId) {
  if (room.practice) return true; // Always respawn in practice
  const p = room.players.get(playerId);
  if (room.mode === C.MODE_FFA) return p.lives > 0;
  return true;
}

function fireBullet(room, playerId, now) {
  const p = room.players.get(playerId);
  const rad = (p.angle * Math.PI) / 180;
  const bx = p.x + Math.sin(rad) * (C.TANK_SIZE / 2 + 4);
  const by = p.y - Math.cos(rad) * (C.TANK_SIZE / 2 + 4);
  const bulletData = {
    id: room.bulletIdCounter++,
    owner: playerId,
    x: bx, y: by,
    angle: p.angle,
    speed: getPlayerBulletSpeed(p),
    damage: getPlayerDamage(p),
    maxRicochets: getPlayerRicochet(p),
    ricochets: 0,
    age: 0
  };

  room.bullets.push(bulletData);

  // Double shot
  if (hasUpgrade(p, 'doubleShot')) {
    const offset = 8;
    room.bullets.push({
      ...bulletData,
      id: room.bulletIdCounter++,
      x: bx + Math.cos(rad) * offset,
      y: by + Math.sin(rad) * offset
    });
  }

  io.to(room.code).emit('bulletFired', { owner: playerId });
}

function spawnPowerup(room) {
  const types = [C.POWERUP_SPEED, C.POWERUP_RAPID, C.POWERUP_SHIELD, C.POWERUP_HEAL];
  const type = types[Math.floor(Math.random() * types.length)];
  let x, y, attempts = 0;
  do {
    x = 3 + Math.floor(Math.random() * (C.MAP_WIDTH - 6));
    y = 3 + Math.floor(Math.random() * (C.MAP_HEIGHT - 6));
    attempts++;
  } while (room.map[y][x] !== C.TILE_EMPTY && attempts < 50);
  if (attempts >= 50) return;
  const pu = { type, x: x * C.TILE_SIZE + C.TILE_SIZE / 2, y: y * C.TILE_SIZE + C.TILE_SIZE / 2 };
  room.powerups.push(pu);
  io.to(room.code).emit('powerupSpawned', pu);
}

function spawnCreditPickup(room) {
  const isGold = Math.random() < 0.25; // 25% chance of gold (50 CR), else silver (25 CR)
  const value = isGold ? 50 : 25;
  let x, y, attempts = 0;
  do {
    x = 3 + Math.floor(Math.random() * (C.MAP_WIDTH - 6));
    y = 3 + Math.floor(Math.random() * (C.MAP_HEIGHT - 6));
    attempts++;
  } while (room.map[y][x] !== C.TILE_EMPTY && attempts < 50);
  if (attempts >= 50) return;
  const cr = { id: Date.now(), value, x: x * C.TILE_SIZE + C.TILE_SIZE / 2, y: y * C.TILE_SIZE + C.TILE_SIZE / 2 };
  room.creditPickups.push(cr);
  io.to(room.code).emit('creditSpawned', cr);
}

function applyPowerup(player, type) {
  if (type === C.POWERUP_HEAL) {
    player.hp = Math.min(player.hp + 50, player.maxHp);
  } else {
    player.powerup = type;
    player.powerupTimer = C.POWERUP_DURATION;
    if (type === C.POWERUP_SHIELD) player.shieldActive = true;
  }
}

function checkWinCondition(room) {
  if (room.state !== 'playing') return;
  if (room.practice) return; // No win condition in practice

  if (room.mode === C.MODE_ROUNDS) {
    for (const [id, score] of Object.entries(room.scores)) {
      if (score >= C.ROUNDS_TO_WIN) { endGame(room, id); return; }
    }
  } else if (room.mode === C.MODE_FFA) {
    const alive = [];
    for (const [id, p] of room.players) {
      if (p.lives > 0 || p.alive) alive.push(id);
    }
    if (alive.length <= 1 && room.players.size >= 2) {
      endGame(room, alive[0] || null);
    }
  }
  // Domination checked in updateCaptureZones
}

function endGame(room, winnerId) {
  room.state = 'gameOver';
  clearInterval(room.tickInterval);
  clearInterval(room.broadcastInterval);
  const winner = room.players.get(winnerId);
  io.to(room.code).emit('gameOver', {
    winnerId,
    winnerName: winner ? winner.name : 'Nobody',
    scores: room.scores,
    domScores: room.domScores
  });
  setTimeout(() => {
    if (rooms.has(room.code)) {
      room.state = 'waiting';
      room.bullets = [];
      room.powerups = [];
      room.mines = [];
      room.smokes = [];
      for (const [id, p] of room.players) p.ready = false;
      io.to(room.code).emit('returnToLobby', { players: getPlayersInfo(room) });
    }
  }, 5000);
}

// ─── Bot AI ───────────────────────────────────────────────────
function createBot(name, colorIndex) {
  const bot = createPlayer(name, colorIndex);
  bot.isBot = true;
  bot.botState = {
    dirChangeTimer: 0,
    dirChangeCooldown: 1 + Math.random() * 2,
    moving: true,
    turning: 0,    // -1, 0, 1
    firing: false,
    fireTimer: 0,
    fireCooldown: 1.5 + Math.random(),
  };
  return bot;
}

function updateBots(room, dt, now) {
  for (const [id, p] of room.players) {
    if (!p.isBot || !p.alive) continue;

    const bs = p.botState;

    // Direction change timer
    bs.dirChangeTimer += dt;
    if (bs.dirChangeTimer >= bs.dirChangeCooldown) {
      bs.dirChangeTimer = 0;
      bs.dirChangeCooldown = 1 + Math.random() * 2.5;
      bs.moving = Math.random() > 0.15;
      bs.turning = Math.random() < 0.3 ? 0 : (Math.random() < 0.5 ? -1 : 1);
    }

    // Try to face nearest real player
    let nearestDist = Infinity;
    let nearestAngle = null;
    for (const [oid, op] of room.players) {
      if (oid === id || !op.alive || op.isBot) continue;
      const dx = op.x - p.x, dy = op.y - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestAngle = (Math.atan2(dx, -dy) * 180 / Math.PI);
      }
    }

    // If a player is somewhat close, turn toward them and fire
    if (nearestAngle !== null && nearestDist < 12 * C.TILE_SIZE) {
      let diff = nearestAngle - p.angle;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      bs.turning = diff > 5 ? 1 : diff < -5 ? -1 : 0;
      if (Math.abs(diff) < 20) bs.firing = true;
      else bs.firing = false;
    } else {
      // Random firing
      bs.fireTimer += dt;
      if (bs.fireTimer >= bs.fireCooldown) {
        bs.fireTimer = 0;
        bs.fireCooldown = 1.5 + Math.random() * 2;
        bs.firing = true;
      } else {
        bs.firing = false;
      }
    }

    // Set bot input
    p.input = {
      up: bs.moving,
      down: false,
      left: bs.turning < 0,
      right: bs.turning > 0,
      fire: bs.firing,
    };

    // If bot hits a wall, reverse direction
    const rad = (p.angle * Math.PI) / 180;
    const testX = p.x + Math.sin(rad) * (C.TANK_SIZE / 2 + 4);
    const testY = p.y - Math.cos(rad) * (C.TANK_SIZE / 2 + 4);
    if (collidesWithMap(room, p, testX, testY, C.TANK_SIZE / 2)) {
      bs.turning = Math.random() < 0.5 ? -1 : 1;
      bs.dirChangeTimer = 0;
    }
  }
}

function startPractice(room, socketId) {
  // Give player starting currency
  const player = room.players.get(socketId);
  if (player) player.currency = 500;

  // Add 3 bots
  const botNames = ['Bot Alpha', 'Bot Bravo', 'Bot Charlie'];
  for (let i = 0; i < 3; i++) {
    const colorIndex = getPlayerColorIndex(room);
    const bot = createBot(botNames[i], colorIndex);
    const botId = `bot-${i}-${Date.now()}`;
    room.players.set(botId, bot);
    room.scores[botId] = 0;
    room.domScores[botId] = 0;
  }

  room.practice = true;
  startGame(room);

  // Override: give practice player currency after startGame resets it
  if (player) player.currency = 500;
}

// ─── Socket.IO Events ─────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('createRoom', ({ name, mode, deathPenalty }) => {
    removePlayerFromRoom(socket.id);
    const room = createRoom(mode, deathPenalty);
    const colorIndex = getPlayerColorIndex(room);
    const player = createPlayer(name, colorIndex);
    room.players.set(socket.id, player);
    room.scores[socket.id] = 0;
    room.domScores[socket.id] = 0;
    socket.join(room.code);
    socket.emit('roomCreated', { code: room.code, players: getPlayersInfo(room), you: socket.id, mode: room.mode, deathPenalty: room.deathPenalty });
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
    room.scores[socket.id] = 0;
    room.domScores[socket.id] = 0;
    socket.join(room.code);
    socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: socket.id });
    socket.to(room.code).emit('playerJoined', { id: socket.id, players: getPlayersInfo(room) });
  });

  socket.on('quickPlay', ({ name }) => {
    let room = findQuickPlayRoom();
    if (!room) room = createRoom(C.MODE_DOMINATION, C.DEATH_KEEP_UPGRADES);
    removePlayerFromRoom(socket.id);
    const colorIndex = getPlayerColorIndex(room);
    const player = createPlayer(name, colorIndex);
    room.players.set(socket.id, player);
    room.scores[socket.id] = 0;
    room.domScores[socket.id] = 0;
    socket.join(room.code);
    socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: socket.id });
    socket.to(room.code).emit('playerJoined', { id: socket.id, players: getPlayersInfo(room) });
  });

  socket.on('startPractice', ({ name }) => {
    removePlayerFromRoom(socket.id);
    const room = createRoom(C.MODE_DOMINATION, C.DEATH_KEEP_UPGRADES);
    const colorIndex = 0;
    const player = createPlayer(name || 'Player', colorIndex);
    room.players.set(socket.id, player);
    room.scores[socket.id] = 0;
    room.domScores[socket.id] = 0;
    socket.join(room.code);
    socket.emit('roomJoined', { code: room.code, players: getPlayersInfo(room), mode: room.mode, deathPenalty: room.deathPenalty, you: socket.id });
    // Start practice immediately
    startPractice(room, socket.id);
  });

  socket.on('toggleReady', () => {
    for (const [code, room] of rooms) {
      const player = room.players.get(socket.id);
      if (player) {
        player.ready = !player.ready;
        io.to(code).emit('playerReady', { id: socket.id, ready: player.ready, players: getPlayersInfo(room) });
        if (room.players.size >= C.MIN_PLAYERS) {
          let allReady = true;
          for (const [, p] of room.players) { if (!p.ready) { allReady = false; break; } }
          if (allReady) startGame(room);
        }
        return;
      }
    }
  });

  socket.on('input', (input) => {
    for (const [, room] of rooms) {
      const player = room.players.get(socket.id);
      if (player) { player.input = input; return; }
    }
  });

  socket.on('purchaseUpgrade', ({ key }) => {
    for (const [, room] of rooms) {
      const player = room.players.get(socket.id);
      if (!player || room.state !== 'playing') continue;

      const def = C.UPGRADES[key];
      if (!def) return;

      const currentLevel = getUpgradeLevel(player, key);
      if (currentLevel >= def.maxLevel) return;

      const cost = def.costs[currentLevel];
      if (player.currency < cost) return;

      player.currency -= cost;
      player.upgrades[key] = currentLevel + 1;

      // Apply immediate effects
      if (key === 'maxHp') {
        player.maxHp = getPlayerMaxHp(player);
        player.hp = Math.min(player.hp + 30, player.maxHp);
      }

      socket.emit('upgradeSuccess', {
        key,
        level: player.upgrades[key],
        currency: player.currency,
        upgrades: player.upgrades
      });
      return;
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    removePlayerFromRoom(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tank Battle v2 server running on http://localhost:${PORT}`);
});
