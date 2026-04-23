const C = require('../shared/constants');
const { getIo } = require('./state');
const { getPlayerArmor } = require('./player');
const { killPlayer } = require('./combat');

function placeMine(room, playerId, damage) {
  const io = getIo();
  const p = room.players.get(playerId);
  room.mines.push({
    id: room.mineIdCounter++,
    owner: playerId,
    x: p.x, y: p.y,
    damage: damage
  });
  io.to(room.code).emit('minePlaced', { owner: playerId, x: p.x, y: p.y });
}

function updateMines(room) {
  const io = getIo();
  for (let i = room.mines.length - 1; i >= 0; i--) {
    const m = room.mines[i];
    for (const [pid, p] of room.players) {
      if (pid === m.owner) continue;
      if (!p.alive) continue;
      if (p.disconnected) continue;
      if (C.withinDist(m.x, m.y, p.x, p.y, C.MINE_RADIUS)) {
        io.to(room.code).emit('mineExploded', { x: m.x, y: m.y, victim: pid });
        if (!(p.activeEffects && p.activeEffects.shield)) {
          const dmg = Math.round(m.damage * getPlayerArmor(p));
          p.hp -= dmg;
          if (p.hp <= 0) killPlayer(room, pid, m.owner);
        }
        room.mines.splice(i, 1);
        break;
      }
    }
  }
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

module.exports = { placeMine, updateMines, applyPowerup };
