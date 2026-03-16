const C = require('../shared/constants');
const { getIo } = require('./state');
const { getPlayerArmor, getPlayerBulletSpeed, getPlayerDamage } = require('./player');
const { killPlayer } = require('./combat');

function fireBullet(room, playerId, now) {
  const io = getIo();
  const p = room.players.get(playerId);
  const rad = C.degToRad(p.angle);
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

function updateBullets(room, dt) {
  const io = getIo();
  const mapW = room.mapWidth;
  const mapH = room.mapHeight;

  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    const rad = C.degToRad(b.angle);
    b.x += Math.sin(rad) * b.speed * dt;
    b.y -= Math.cos(rad) * b.speed * dt;

    const tileX = Math.floor(b.x / C.TILE_SIZE);
    const tileY = Math.floor(b.y / C.TILE_SIZE);

    if (tileX < 0 || tileX >= mapW || tileY < 0 || tileY >= mapH) {
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
        const newRad = C.degToRad(b.angle);
        b.x += Math.sin(newRad) * 4;
        b.y -= Math.cos(newRad) * 4;
      } else {
        room.bullets.splice(i, 1);
      }
      continue;
    }

    let hit = false;
    for (const [pid, p] of room.players) {
      if (pid === b.owner && b.ricochets === 0) continue;
      if (!p.alive) continue;

      if (C.withinDist(b.x, b.y, p.x, p.y, C.TANK_SIZE / 2)) {
        if (p.activeEffects && p.activeEffects.shield) {
          io.to(room.code).emit('shieldBreak', { id: pid });
        } else if (p.shieldActive) {
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

function collidesWithMap(room, player, x, y, radius) {
  const mapW = room.mapWidth;
  const mapH = room.mapHeight;
  const minTX = Math.floor((x - radius) / C.TILE_SIZE);
  const maxTX = Math.floor((x + radius) / C.TILE_SIZE);
  const minTY = Math.floor((y - radius) / C.TILE_SIZE);
  const maxTY = Math.floor((y + radius) / C.TILE_SIZE);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (tx < 0 || tx >= mapW || ty < 0 || ty >= mapH) return true;
      const tile = room.map[ty][tx];
      if (tile === C.TILE_WALL || tile === C.TILE_STEEL || tile === C.TILE_BRICK) {
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
    if (C.withinDist(x, y, p.x, p.y, C.TANK_SIZE)) return true;
  }
  return false;
}

module.exports = { fireBullet, updateBullets, collidesWithMap, collidesWithTanks };
