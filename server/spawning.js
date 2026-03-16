const C = require('../shared/constants');
const { getIo } = require('./state');

function findEmptyTile(room, margin) {
  let x, y, attempts = 0;
  do {
    x = margin + Math.floor(Math.random() * (room.mapWidth - margin * 2));
    y = margin + Math.floor(Math.random() * (room.mapHeight - margin * 2));
    attempts++;
  } while (room.map[y][x] !== C.TILE_EMPTY && attempts < 50);
  return attempts < 50 ? { x, y } : null;
}

function spawnPowerup(room) {
  const io = getIo();
  const types = [C.POWERUP_SPEED, C.POWERUP_RAPID, C.POWERUP_SHIELD, C.POWERUP_HEAL];
  const type = types[Math.floor(Math.random() * types.length)];
  const tile = findEmptyTile(room, 3);
  if (!tile) return;
  const pu = { type, x: tile.x * C.TILE_SIZE + C.TILE_SIZE / 2, y: tile.y * C.TILE_SIZE + C.TILE_SIZE / 2 };
  room.powerups.push(pu);
  io.to(room.code).emit('powerupSpawned', pu);
}

function spawnCreditPickup(room) {
  const io = getIo();
  const isGold = Math.random() < 0.25;
  const value = isGold ? 50 : 25;
  const tile = findEmptyTile(room, 3);
  if (!tile) return;
  const cr = { id: Date.now(), value, x: tile.x * C.TILE_SIZE + C.TILE_SIZE / 2, y: tile.y * C.TILE_SIZE + C.TILE_SIZE / 2 };
  room.creditPickups.push(cr);
  io.to(room.code).emit('creditSpawned', cr);
}

module.exports = { findEmptyTile, spawnPowerup, spawnCreditPickup };
