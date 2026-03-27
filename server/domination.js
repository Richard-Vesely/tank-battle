const C = require('../shared/constants');
const { getIo } = require('./state');
const { endGame } = require('./combat');

function updateCaptureZones(room, dt) {
  const io = getIo();
  for (const zone of room.captureZones) {
    const playersInZone = [];
    for (const [id, p] of room.players) {
      if (!p.alive) continue;
      if (C.distSq(p.x / C.TILE_SIZE, p.y / C.TILE_SIZE, zone.x, zone.y) <= C.CAPTURE_ZONE_RADIUS * C.CAPTURE_ZONE_RADIUS) {
        playersInZone.push(id);
      }
    }

    zone.contested = playersInZone.length > 1;

    if (playersInZone.length === 1 && !zone.contested) {
      const capturer = playersInZone[0];
      if (zone.owner !== capturer) {
        if (!zone.captureProgress[capturer]) zone.captureProgress[capturer] = 0;
        zone.captureProgress[capturer] += dt;

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

    // Only award points if no enemy is standing in the zone
    if (zone.owner && room.domScores[zone.owner] !== undefined) {
      const enemyPresent = playersInZone.some(id => id !== zone.owner);
      if (!enemyPresent) {
        room.domScores[zone.owner] += C.DOMINATION_POINTS_PER_SEC * dt;
      }
    }
  }

  const winScore = room.dominationTarget || C.DOMINATION_WIN_SCORE;
  for (const [id, score] of Object.entries(room.domScores)) {
    if (score >= winScore) {
      endGame(room, id);
      return;
    }
  }
}

module.exports = { updateCaptureZones };
