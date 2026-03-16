const C = require('../shared/constants');
const { createPlayer } = require('./player');
const { collidesWithMap } = require('./physics');

function createBot(name, colorIndex) {
  const bot = createPlayer(name, colorIndex);
  bot.isBot = true;
  bot.botState = {
    dirChangeTimer: 0,
    dirChangeCooldown: 1 + Math.random() * 2,
    moving: true,
    turning: 0,
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

    bs.dirChangeTimer += dt;
    if (bs.dirChangeTimer >= bs.dirChangeCooldown) {
      bs.dirChangeTimer = 0;
      bs.dirChangeCooldown = 1 + Math.random() * 2.5;
      bs.moving = Math.random() > 0.15;
      bs.turning = Math.random() < 0.3 ? 0 : (Math.random() < 0.5 ? -1 : 1);
    }

    let nearestDist = Infinity;
    let nearestAngle = null;
    for (const [oid, op] of room.players) {
      if (oid === id || !op.alive || op.isBot) continue;
      if (op.activeEffects && op.activeEffects.hide) continue;
      const dx = op.x - p.x, dy = op.y - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestAngle = (Math.atan2(dx, -dy) * 180 / Math.PI);
      }
    }

    if (nearestAngle !== null && nearestDist < 12 * C.TILE_SIZE) {
      let diff = nearestAngle - p.angle;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      bs.turning = diff > 5 ? 1 : diff < -5 ? -1 : 0;
      if (Math.abs(diff) < 20) bs.firing = true;
      else bs.firing = false;
    } else {
      bs.fireTimer += dt;
      if (bs.fireTimer >= bs.fireCooldown) {
        bs.fireTimer = 0;
        bs.fireCooldown = 1.5 + Math.random() * 2;
        bs.firing = true;
      } else {
        bs.firing = false;
      }
    }

    p.input = {
      up: bs.moving,
      down: false,
      left: bs.turning < 0,
      right: bs.turning > 0,
      fire: bs.firing,
    };

    const rad = C.degToRad(p.angle);
    const testX = p.x + Math.sin(rad) * (C.TANK_SIZE / 2 + 4);
    const testY = p.y - Math.cos(rad) * (C.TANK_SIZE / 2 + 4);
    if (collidesWithMap(room, p, testX, testY, C.TANK_SIZE / 2)) {
      bs.turning = Math.random() < 0.5 ? -1 : 1;
      bs.dirChangeTimer = 0;
    }
  }
}

module.exports = { createBot, updateBots };
