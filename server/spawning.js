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

function isNearCaptureZone(room, tx, ty, minTiles) {
  if (!room.captureZones || room.captureZones.length === 0) return false;
  const minSq = minTiles * minTiles;
  for (const z of room.captureZones) {
    if (C.distSq(tx, ty, z.x, z.y) < minSq) return true;
  }
  return false;
}

function findEmptyTileAwayFromZones(room, margin, exclusionTiles) {
  for (let i = 0; i < 30; i++) {
    const tile = findEmptyTile(room, margin);
    if (!tile) return null;
    if (!isNearCaptureZone(room, tile.x, tile.y, exclusionTiles)) return tile;
  }
  return null;
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
  // In domination, keep credits away from capture zones so there's a reason to leave them.
  const tile = room.mode === C.MODE_DOMINATION
    ? findEmptyTileAwayFromZones(room, 3, C.CREDIT_ZONE_EXCLUSION_TILES)
    : findEmptyTile(room, 3);
  if (!tile) return;
  const cr = { id: Date.now(), value, x: tile.x * C.TILE_SIZE + C.TILE_SIZE / 2, y: tile.y * C.TILE_SIZE + C.TILE_SIZE / 2 };
  room.creditPickups.push(cr);
  io.to(room.code).emit('creditSpawned', cr);
}

module.exports = { findEmptyTile, spawnPowerup, spawnCreditPickup };
