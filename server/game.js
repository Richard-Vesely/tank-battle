const C = require('../shared/constants');
const { generateMap } = require('../shared/map-generator');
const { getIo } = require('./state');
const { getPlayersInfo, getPlayerColorIndex } = require('./rooms');
const {
  getPlayerSpeed, getPlayerRotation, getPlayerFireCooldown,
  hasAbility, getAbilityLevel, getCoinBoostMult, getRegenRate, getCooldownReduction,
} = require('./player');
const { spawnTank, canRespawn } = require('./combat');
const { fireBullet, updateBullets, collidesWithMap, collidesWithTanks } = require('./physics');
const { placeMine, updateMines, applyPowerup } = require('./abilities');
const { spawnPowerup, spawnCreditPickup } = require('./spawning');
const { updateCaptureZones } = require('./domination');
const { createBot, updateBots } = require('./bots');

function serializePlayer(id, p) {
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
  };
}

function getGameState(room) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push(serializePlayer(id, p));
  }

  return {
    players,
    bullets: room.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, owner: b.owner })),
    powerups: room.powerups,
    creditPickups: room.creditPickups.map(c => ({ x: c.x, y: c.y, value: c.value })),
    mines: room.mines,
    scores: room.scores,
    domScores: room.domScores,
    captureZones: room.captureZones.map(z => ({ x: z.x, y: z.y, label: z.label, owner: z.owner, contested: z.contested })),
  };
}

function broadcastState(room) {
  const io = getIo();
  const state = getGameState(room);
  for (const [viewerId] of room.players) {
    const socket = io.sockets.sockets.get(viewerId);
    if (socket) {
      state.myId = viewerId;
      socket.emit('gameState', state);
    }
  }
}

function startGame(room) {
  const io = getIo();
  room.state = 'playing';
  room.bullets = [];
  room.powerups = [];
  room.mines = [];
  room.creditPickups = [];
  room.lastCreditSpawn = Date.now();
  room.round++;
  room.lastPowerupSpawn = Date.now();

  room.mapSeed = Date.now();
  const captureZoneDefs = C.generateCaptureZones(room.mapWidth, room.mapHeight);
  room.map = generateMap(room.mapWidth, room.mapHeight, room.mapSeed, captureZoneDefs, room.spawnPoints);

  room.scores = {};
  room.domScores = {};

  room.captureZones = captureZoneDefs.map(z => ({
    x: z.x, y: z.y, label: z.label,
    owner: null,
    captureProgress: {},
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
    spawnTank(room, id);
  }

  const startPlayers = [];
  for (const [id, p] of room.players) {
    startPlayers.push(serializePlayer(id, p));
  }

  io.to(room.code).emit('gameStart', {
    map: room.map,
    mapSeed: room.mapSeed,
    mapWidth: room.mapWidth,
    mapHeight: room.mapHeight,
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

function updateGame(room, dt, now) {
  if (room.state !== 'playing') return;
  const io = getIo();

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

    for (const key of Object.keys(p.activeEffects)) {
      p.activeEffects[key].remaining -= dt * 1000;
      if (p.activeEffects[key].remaining <= 0) {
        delete p.activeEffects[key];
      }
    }

    for (const key of Object.keys(p.abilityCooldowns)) {
      if (p.abilityCooldowns[key] > 0) {
        p.abilityCooldowns[key] -= dt * 1000;
        if (p.abilityCooldowns[key] < 0) p.abilityCooldowns[key] = 0;
      }
    }

    const speed = getPlayerSpeed(p);
    const rotSpeed = getPlayerRotation(p);

    if (p.input) {
      if (p.input.left) p.angle -= rotSpeed * dt;
      if (p.input.right) p.angle += rotSpeed * dt;

      if (p.input.up || p.input.down) {
        const dir = p.input.up ? 1 : -1;
        const rad = C.degToRad(p.angle);
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

      if (p.input.fire) {
        const cooldown = getPlayerFireCooldown(p);
        if (now - p.lastFire >= cooldown) {
          fireBullet(room, id, now);
          p.lastFire = now;
        }
      }

      const durationKeys = { berserk: 'berserk', speedBoost: 'speedBoost', vampire: 'vampire', hide: 'hide', shield: 'shield' };
      for (const [inputKey, abilityKey] of Object.entries(durationKeys)) {
        if (p.input[inputKey] && hasAbility(p, abilityKey) && !p.activeEffects[abilityKey] &&
            (p.abilityCooldowns[abilityKey] || 0) <= 0) {
          const def = C.ABILITIES[abilityKey];
          const lvl = getAbilityLevel(p, abilityKey);
          p.activeEffects[abilityKey] = { remaining: def.duration };
          p.abilityCooldowns[abilityKey] = Math.max(1000, C.getAbilityValue(abilityKey, 'cooldown', lvl) - getCooldownReduction(p));
          io.to(room.code).emit('abilityUsed', { id, ability: abilityKey });
        }
      }

      if (p.input.regenBurst && hasAbility(p, 'regenBurst') && (p.abilityCooldowns.regenBurst || 0) <= 0) {
        const lvl = getAbilityLevel(p, 'regenBurst');
        const healAmt = Math.round(C.getAbilityValue('regenBurst', 'healAmount', lvl));
        p.hp = Math.min(p.hp + healAmt, p.maxHp);
        p.abilityCooldowns.regenBurst = Math.max(1000, C.getAbilityValue('regenBurst', 'cooldown', lvl) - getCooldownReduction(p));
        io.to(room.code).emit('abilityUsed', { id, ability: 'regenBurst', x: p.x, y: p.y });
      }

      if (p.input.mine && hasAbility(p, 'mine') && (p.abilityCooldowns.mine || 0) <= 0) {
        const lvl = getAbilityLevel(p, 'mine');
        const mineDmg = Math.round(C.getAbilityValue('mine', 'damage', lvl));
        placeMine(room, id, mineDmg);
        p.abilityCooldowns.mine = Math.max(1000, C.getAbilityValue('mine', 'cooldown', lvl) - getCooldownReduction(p));
      }
    }

    if (p.powerup && p.powerup !== C.POWERUP_HEAL) {
      p.powerupTimer -= dt * 1000;
      if (p.powerupTimer <= 0) {
        p.powerup = null;
        p.shieldActive = false;
      }
    }

    // Regeneration stat
    const regenRate = getRegenRate(p);
    if (regenRate > 0 && p.hp < p.maxHp) {
      p.hp = Math.min(p.hp + regenRate * dt, p.maxHp);
    }
  }

  if (room.practice) updateBots(room, dt, now);

  updateBullets(room, dt);
  updateMines(room);

  if (now - room.lastPowerupSpawn >= C.POWERUP_SPAWN_INTERVAL && room.powerups.length < C.POWERUP_MAX_ON_MAP) {
    spawnPowerup(room);
    room.lastPowerupSpawn = now;
  }

  for (let i = room.powerups.length - 1; i >= 0; i--) {
    const pu = room.powerups[i];
    for (const [pid, p] of room.players) {
      if (!p.alive) continue;
      if (C.withinDist(pu.x, pu.y, p.x, p.y, C.TANK_SIZE/2 + C.POWERUP_SIZE/2)) {
        applyPowerup(p, pu.type);
        room.powerups.splice(i, 1);
        io.to(room.code).emit('powerupCollected', { id: pid, type: pu.type });
        break;
      }
    }
  }

  const creditMax = C.getCreditMaxOnMap(room.players.size);
  if (now - room.lastCreditSpawn >= C.CREDIT_SPAWN_INTERVAL && room.creditPickups.length < creditMax) {
    spawnCreditPickup(room);
    room.lastCreditSpawn = now;
  }

  for (let i = room.creditPickups.length - 1; i >= 0; i--) {
    const cr = room.creditPickups[i];
    for (const [pid, p] of room.players) {
      if (!p.alive) continue;
      if (C.withinDist(cr.x, cr.y, p.x, p.y, C.TANK_SIZE/2 + 10)) {
        const boostedValue = Math.round(cr.value * getCoinBoostMult(p));
        p.currency += boostedValue;
        io.to(room.code).emit('creditCollected', { id: pid, value: boostedValue, total: p.currency });
        room.creditPickups.splice(i, 1);
        break;
      }
    }
  }

  if (room.mode === C.MODE_DOMINATION) {
    updateCaptureZones(room, dt);
  }
}

function startPractice(room, socketId) {
  const player = room.players.get(socketId);
  if (player) player.currency = 500;

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

  if (player) player.currency = 500;
  for (const [id, p] of room.players) {
    if (p.isBot) {
      p.stats = {};
      p.abilities = {};
      p.abilityCooldowns = {};
      p.activeEffects = {};
    }
  }
}

module.exports = { startGame, updateGame, broadcastState, startPractice };
