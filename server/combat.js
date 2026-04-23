const C = require('../shared/constants');
const { rooms, playerToRoom, playerIdToSocket, phraseKeyToPlayerId, getIo } = require('./state');
const { getPlayerMaxHp, getPlayerArmor, getAbilityLevel, getCoinBoostMult } = require('./player');
const { getPlayersInfo } = require('./rooms');

function spawnTank(room, playerId) {
  const player = room.players.get(playerId);
  if (!player || player.alive) return;
  const spawnIdx = player.colorIndex % room.spawnPoints.length;
  const sp = room.spawnPoints[spawnIdx];
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

function canRespawn(room, playerId) {
  if (room.practice) return true;
  const p = room.players.get(playerId);
  if (room.mode === C.MODE_FFA) return p.lives > 0;
  return true;
}

function killPlayer(room, victimId, killerId) {
  const io = getIo();
  const victim = room.players.get(victimId);
  victim.alive = false;
  victim.hp = 0;
  victim.activeEffects = {};

  if (killerId && killerId !== victimId) {
    room.scores[killerId] = (room.scores[killerId] || 0) + 1;
    const killer = room.players.get(killerId);
    if (killer && !room.vanilla) {
      let earnedCR = C.KILL_CURRENCY;

      if (killer.activeEffects.vampire) {
        const vLvl = getAbilityLevel(killer, 'vampire');
        earnedCR = Math.round(C.KILL_CURRENCY * C.getAbilityValue('vampire', 'killCRMult', vLvl));
        const healPct = C.getAbilityValue('vampire', 'healPercent', vLvl);
        const healAmt = Math.floor(killer.maxHp * healPct);
        killer.hp = Math.min(killer.hp + healAmt, killer.maxHp);
        io.to(room.code).emit('vampireProc', { id: killerId, heal: healAmt, earnedCR });
      }

      earnedCR = Math.round(earnedCR * getCoinBoostMult(killer));
      killer.currency += earnedCR;
      io.to(room.code).emit('currencyEarned', { id: killerId, amount: earnedCR, total: killer.currency });
    }
  }

  if (room.deathPenalty === C.DEATH_LOSE_ALL) {
    victim.stats = {};
    victim.abilities = {};
    victim.abilityCooldowns = {};
    victim.currency = room.vanilla ? 0 : C.DEATH_RESPAWN_CURRENCY;
  }

  if (room.mode === C.MODE_FFA) victim.lives--;

  io.to(room.code).emit('playerKilled', { id: victimId, by: killerId, scores: room.scores });

  if (canRespawn(room, victimId)) {
    victim.respawnTimer = C.RESPAWN_TIME;
  }
  checkWinCondition(room);
}

function checkWinCondition(room) {
  if (room.state !== 'playing') return;
  if (room.practice) return;

  if (room.mode === C.MODE_ROUNDS) {
    for (const [id, score] of Object.entries(room.scores)) {
      if (score >= C.ROUNDS_TO_WIN) { endGame(room, id); return; }
    }
  } else if (room.mode === C.MODE_FFA) {
    const alive = [];
    let activePlayers = 0;
    for (const [id, p] of room.players) {
      if (p.disconnected) continue;
      activePlayers++;
      if (p.lives > 0 || p.alive) alive.push(id);
    }
    if (alive.length <= 1 && activePlayers >= 2) {
      endGame(room, alive[0] || null);
    }
  }
}

function endGame(room, winnerId) {
  const io = getIo();
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
      io.to(room.code).emit('returnToLobby', {
        players: getPlayersInfo(room),
        mode: room.mode,
        deathPenalty: room.deathPenalty,
        mapSize: room.mapSize,
        vanilla: room.vanilla,
        dominationTarget: room.dominationTarget,
      });
    }
  }, 5000);
}

function removePlayerFromRoom(playerId) {
  if (!playerId) return;
  const io = getIo();
  const room = playerToRoom.get(playerId);
  if (!room) return;

  const player = room.players.get(playerId);
  if (player) {
    if (player.graceTimer) { clearTimeout(player.graceTimer); player.graceTimer = null; }
    if (player.phraseKey) phraseKeyToPlayerId.delete(player.phraseKey);
  }
  playerIdToSocket.delete(playerId);
  playerToRoom.delete(playerId);
  room.players.delete(playerId);
  io.to(room.code).emit('playerLeft', { id: playerId, players: getPlayersInfo(room) });

  if (room.practice) {
    clearInterval(room.tickInterval);
    clearInterval(room.broadcastInterval);
    for (const [id] of room.players) playerToRoom.delete(id);
    rooms.delete(room.code);
    return;
  }

  if (room.players.size === 0) {
    clearInterval(room.tickInterval);
    clearInterval(room.broadcastInterval);
    rooms.delete(room.code);
  } else if (room.state === 'playing') {
    checkWinCondition(room);
  }
}

module.exports = {
  spawnTank, canRespawn, killPlayer, checkWinCondition, endGame, removePlayerFromRoom,
};
