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
    // v2: Stats & Abilities
    currency: 0,
    stats: {},            // { firepower: 2, mobility: 1, ... }
    abilities: {},        // { berserk: 1, mine: 2, ... }
    abilityCooldowns: {}, // { berserk: 0, mine: 3000, ... } (remaining ms)
    activeEffects: {},    // { berserk: { remaining: 5000 }, ... }
    revealZones: [],      // [{ x, y, radius, remaining }]
  };
}

// ─── Stat & Ability Helpers ──────────────────────────────────
function getStatLevel(player, key) {
  return player.stats[key] || 0;
}

function getAbilityLevel(player, key) {
  return player.abilities[key] || 0;
}

function hasAbility(player, key) {
  return getAbilityLevel(player, key) > 0;
}

function getPlayerDamage(player) {
  const lvl = getStatLevel(player, 'firepower');
  let dmg = lvl > 0 ? C.STATS.firepower.damage[lvl - 1] : C.BULLET_DAMAGE;
  if (player.activeEffects.berserk) {
    const aLvl = getAbilityLevel(player, 'berserk');
    dmg *= C.ABILITIES.berserk.damageMult[aLvl - 1];
  }
  return Math.round(dmg);
}

function getPlayerFireCooldown(player) {
  const lvl = getStatLevel(player, 'firepower');
  if (player.powerup === C.POWERUP_RAPID) return C.RAPID_FIRE_COOLDOWN;
  let cd = lvl > 0 ? C.STATS.firepower.fireCooldown[lvl - 1] : C.FIRE_COOLDOWN;
  if (player.activeEffects.berserk) {
    const aLvl = getAbilityLevel(player, 'berserk');
    cd *= C.ABILITIES.berserk.fireRateMult[aLvl - 1];
  }
  return Math.round(cd);
}

function getPlayerBulletSpeed(player) {
  const lvl = getStatLevel(player, 'firepower');
  return lvl > 0 ? C.STATS.firepower.bulletSpeed[lvl - 1] : C.BULLET_SPEED;
}

function getPlayerSpeed(player) {
  const lvl = getStatLevel(player, 'mobility');
  let spd = lvl > 0 ? C.STATS.mobility.moveSpeed[lvl - 1] : C.TANK_SPEED;
  if (player.activeEffects.speedBoost) {
    const aLvl = getAbilityLevel(player, 'speedBoost');
    spd *= C.ABILITIES.speedBoost.speedMult[aLvl - 1];
  }
  if (player.powerup === C.POWERUP_SPEED) spd *= C.SPEED_BOOST;
  return spd;
}

function getPlayerRotation(player) {
  const lvl = getStatLevel(player, 'mobility');
  return lvl > 0 ? C.STATS.mobility.rotationSpeed[lvl - 1] : C.TANK_ROTATION_SPEED;
}

function getPlayerMaxHp(player) {
  const lvl = getStatLevel(player, 'defense');
  return lvl > 0 ? C.STATS.defense.maxHp[lvl - 1] : C.TANK_MAX_HP;
}

function getPlayerArmor(player) {
  const lvl = getStatLevel(player, 'defense');
  return lvl > 0 ? C.STATS.defense.armor[lvl - 1] : 1.0;
}

function getPlayerVision(player) {
  const lvl = getStatLevel(player, 'perception');
  return lvl > 0 ? C.STATS.perception.visionZones[lvl - 1] : C.BASE_VISION;
}

function getPlayerStealth(player) {
  if (player.activeEffects.hide) {
    const aLvl = getAbilityLevel(player, 'hide');
    return C.ABILITIES.hide.stealthZones[aLvl - 1];
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
  player.maxHp = getPlayerMaxHp(player);
  player.hp = player.maxHp;
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
  room.mines = [];
  room.creditPickups = [];
  room.lastCreditSpawn = Date.now();
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
    p.stats = {};
    p.abilities = {};
    p.abilityCooldowns = {};
    p.activeEffects = {};
    p.revealZones = [];
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

  // Check if target is in a reveal zone
  for (const rz of viewer.revealZones || []) {
    const rdx = target.x - rz.x, rdy = target.y - rz.y;
    if (Math.sqrt(rdx * rdx + rdy * rdy) <= rz.radius) return true;
  }

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
  else return false;

  // Viewer can see zones 1 through visionZones
  if (targetZone > visionZones) return false;

  // Stealth: target invisible in zones > (max - stealth)
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
  // Active effect keys (for rendering VFX on other players)
  const effectKeys = Object.keys(p.activeEffects || {});
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
    stats: p.stats,
    abilities: p.abilities,
    abilityCooldowns: p.abilityCooldowns,
    activeEffects: effectKeys,
    revealZones: p.revealZones,
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

    // Tick active effects (duration abilities)
    for (const key of Object.keys(p.activeEffects)) {
      p.activeEffects[key].remaining -= dt * 1000;
      if (p.activeEffects[key].remaining <= 0) {
        delete p.activeEffects[key];
      }
    }

    // Tick reveal zones
    for (let r = p.revealZones.length - 1; r >= 0; r--) {
      p.revealZones[r].remaining -= dt * 1000;
      if (p.revealZones[r].remaining <= 0) p.revealZones.splice(r, 1);
    }

    // Tick ability cooldowns
    for (const key of Object.keys(p.abilityCooldowns)) {
      if (p.abilityCooldowns[key] > 0) {
        p.abilityCooldowns[key] -= dt * 1000;
        if (p.abilityCooldowns[key] < 0) p.abilityCooldowns[key] = 0;
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

      // Duration abilities (Q/W/E/R)
      const durationKeys = { berserk: 'berserk', speedBoost: 'speedBoost', vampire: 'vampire', hide: 'hide' };
      for (const [inputKey, abilityKey] of Object.entries(durationKeys)) {
        if (p.input[inputKey] && hasAbility(p, abilityKey) && !p.activeEffects[abilityKey] &&
            (p.abilityCooldowns[abilityKey] || 0) <= 0) {
          const def = C.ABILITIES[abilityKey];
          const lvl = getAbilityLevel(p, abilityKey);
          p.activeEffects[abilityKey] = { remaining: def.duration };
          p.abilityCooldowns[abilityKey] = def.cooldown[lvl - 1];
          io.to(room.code).emit('abilityUsed', { id, ability: abilityKey });
        }
      }

      // Instant abilities
      if (p.input.regenBurst && hasAbility(p, 'regenBurst') && (p.abilityCooldowns.regenBurst || 0) <= 0) {
        const lvl = getAbilityLevel(p, 'regenBurst');
        const def = C.ABILITIES.regenBurst;
        p.hp = Math.min(p.hp + def.healAmount[lvl - 1], p.maxHp);
        p.abilityCooldowns.regenBurst = def.cooldown[lvl - 1];
        io.to(room.code).emit('abilityUsed', { id, ability: 'regenBurst', x: p.x, y: p.y });
      }

      if (p.input.reveal && hasAbility(p, 'reveal') && (p.abilityCooldowns.reveal || 0) <= 0) {
        const lvl = getAbilityLevel(p, 'reveal');
        const def = C.ABILITIES.reveal;
        p.revealZones.push({
          x: p.x, y: p.y,
          radius: def.radius[lvl - 1] * C.TILE_SIZE,
          remaining: def.revealDuration[lvl - 1]
        });
        p.abilityCooldowns.reveal = def.cooldown[lvl - 1];
        io.to(room.code).emit('abilityUsed', { id, ability: 'reveal', x: p.x, y: p.y, radius: def.radius[lvl - 1] });
      }

      if (p.input.mine && hasAbility(p, 'mine') && (p.abilityCooldowns.mine || 0) <= 0) {
        const lvl = getAbilityLevel(p, 'mine');
        const def = C.ABILITIES.mine;
        placeMine(room, id, def.damage[lvl - 1]);
        p.abilityCooldowns.mine = def.cooldown[lvl - 1];
      }
      // Snipe is handled via separate socket event (snipeFire)
    }

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
  victim.activeEffects = {};

  if (killerId && killerId !== victimId) {
    room.scores[killerId] = (room.scores[killerId] || 0) + 1;
    const killer = room.players.get(killerId);
    if (killer) {
      let earnedCR = C.KILL_CURRENCY;

      // Vampire bonus: extra CR + heal on kill
      if (killer.activeEffects.vampire) {
        const vLvl = getAbilityLevel(killer, 'vampire');
        const def = C.ABILITIES.vampire;
        const bonusCR = def.bonusCR[vLvl - 1];
        const healAmt = Math.floor(killer.maxHp * def.healPercent[vLvl - 1]);
        earnedCR += bonusCR;
        killer.hp = Math.min(killer.hp + healAmt, killer.maxHp);
        io.to(room.code).emit('vampireProc', { id: killerId, heal: healAmt, bonusCR });
      }

      killer.currency += earnedCR;
      io.to(room.code).emit('currencyEarned', { id: killerId, amount: earnedCR, total: killer.currency });
    }
  }

  // Death penalty
  if (room.deathPenalty === C.DEATH_LOSE_ALL) {
    victim.stats = {};
    victim.abilities = {};
    victim.abilityCooldowns = {};
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
        const dmg = Math.round(m.damage * getPlayerArmor(p));
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
function placeMine(room, playerId, damage) {
  const p = room.players.get(playerId);
  room.mines.push({
    id: room.mineIdCounter++,
    owner: playerId,
    x: p.x, y: p.y,
    damage: damage
  });
  io.to(room.code).emit('minePlaced', { owner: playerId, x: p.x, y: p.y });
}

function performSnipe(room, playerId, targetX, targetY) {
  const p = room.players.get(playerId);
  if (!p || !p.alive) return;
  if (!hasAbility(p, 'snipe')) return;
  if ((p.abilityCooldowns.snipe || 0) > 0) return;

  const lvl = getAbilityLevel(p, 'snipe');
  const def = C.ABILITIES.snipe;
  const damage = def.damage[lvl - 1];
  const radius = def.radius[lvl - 1];

  // Apply area damage at target position
  for (const [pid, target] of room.players) {
    if (pid === playerId || !target.alive) continue;
    const dx = target.x - targetX, dy = target.y - targetY;
    if (Math.sqrt(dx * dx + dy * dy) <= radius) {
      const dmg = Math.round(damage * getPlayerArmor(target));
      target.hp -= dmg;
      io.to(room.code).emit('playerHit', { id: pid, hp: target.hp, by: playerId, dmg });
      if (target.hp <= 0) killPlayer(room, pid, playerId);
    }
  }

  p.abilityCooldowns.snipe = def.cooldown[lvl - 1];
  io.to(room.code).emit('snipeImpact', { x: targetX, y: targetY, radius, by: playerId });
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
  room.bullets.push({
    id: room.bulletIdCounter++,
    owner: playerId,
    x: bx, y: by,
    angle: p.angle,
    speed: getPlayerBulletSpeed(p),
    damage: getPlayerDamage(p),
    maxRicochets: C.BULLET_MAX_RICOCHETS,
    ricochets: 0,
    age: 0
  });
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
  // Ensure bots have the new fields
  for (const [id, p] of room.players) {
    if (p.isBot) {
      p.stats = {};
      p.abilities = {};
      p.abilityCooldowns = {};
      p.activeEffects = {};
      p.revealZones = [];
    }
  }
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

  socket.on('purchase', ({ type, key }) => {
    for (const [, room] of rooms) {
      const player = room.players.get(socket.id);
      if (!player || room.state !== 'playing') continue;

      if (type === 'stat') {
        const def = C.STATS[key];
        if (!def) return;
        const currentLevel = getStatLevel(player, key);
        if (currentLevel >= def.maxLevel) return;
        const cost = def.costs[currentLevel];
        if (player.currency < cost) return;
        player.currency -= cost;
        player.stats[key] = currentLevel + 1;
        // Defense stat: update maxHp and heal a bit
        if (key === 'defense') {
          player.maxHp = getPlayerMaxHp(player);
          player.hp = Math.min(player.hp + 30, player.maxHp);
        }
        socket.emit('upgradeSuccess', { type: 'stat', key, level: player.stats[key], currency: player.currency, stats: player.stats, abilities: player.abilities });
      } else if (type === 'ability') {
        const def = C.ABILITIES[key];
        if (!def) return;
        const currentLevel = getAbilityLevel(player, key);
        if (currentLevel >= def.maxLevel) return;
        const cost = def.costs[currentLevel];
        if (player.currency < cost) return;
        player.currency -= cost;
        player.abilities[key] = currentLevel + 1;
        socket.emit('upgradeSuccess', { type: 'ability', key, level: player.abilities[key], currency: player.currency, stats: player.stats, abilities: player.abilities });
      }
      return;
    }
  });

  socket.on('snipeFire', ({ x, y }) => {
    for (const [, room] of rooms) {
      const player = room.players.get(socket.id);
      if (!player || room.state !== 'playing' || !player.alive) continue;
      performSnipe(room, socket.id, x, y);
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
