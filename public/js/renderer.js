// Retro pixel-art renderer v2 — with fog of war, capture zones, new effects
const Renderer = (() => {
  let canvas, ctx;

  const COLORS = {
    bg: '#1a1a1a',
    wall: '#555555', wallHighlight: '#6a6a6a', wallShadow: '#404040',
    brick: '#c0392b', brickHighlight: '#e74c3c', brickShadow: '#962d22', brickLine: '#a0301f',
    steel: '#7f8c8d', steelHighlight: '#95a5a6', steelShadow: '#606b6c',
    ground: '#3d3d2e', groundDot: '#35352a',
    bullet: '#FFD700', bulletGlow: '#FFA500',
    fog: 'rgba(0,0,0,',  // alpha appended per zone
  };

  const POWERUP_COLORS = { speed: '#00BCD4', rapid: '#FF5722', shield: '#9C27B0', heal: '#4CAF50' };
  const POWERUP_ICONS = { speed: 'SPD', rapid: 'RPD', shield: 'SHD', heal: '+HP' };
  const ZONE_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63']; // per player

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const mapW = CONSTANTS.MAP_WIDTH * CONSTANTS.TILE_SIZE;
    const mapH = CONSTANTS.MAP_HEIGHT * CONSTANTS.TILE_SIZE;
    const scaleX = window.innerWidth / mapW;
    const scaleY = window.innerHeight / mapH;
    const scale = Math.min(scaleX, scaleY);
    canvas.width = Math.floor(mapW * scale);
    canvas.height = Math.floor(mapH * scale);
    canvas.style.position = 'absolute';
    canvas.style.left = Math.floor((window.innerWidth - canvas.width) / 2) + 'px';
    canvas.style.top = Math.floor((window.innerHeight - canvas.height) / 2) + 'px';
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function clear() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, CONSTANTS.MAP_WIDTH * CONSTANTS.TILE_SIZE, CONSTANTS.MAP_HEIGHT * CONSTANTS.TILE_SIZE);
  }

  function drawMap(map) {
    const T = CONSTANTS.TILE_SIZE;
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        const tile = map[y][x];
        const px = x * T, py = y * T;
        if (tile === CONSTANTS.TILE_EMPTY) {
          ctx.fillStyle = COLORS.ground;
          ctx.fillRect(px, py, T, T);
          ctx.fillStyle = COLORS.groundDot;
          if ((x + y) % 3 === 0) { ctx.fillRect(px + 4, py + 4, 2, 2); ctx.fillRect(px + 14, py + 20, 2, 2); }
          if ((x + y) % 5 === 0) ctx.fillRect(px + 22, py + 8, 2, 2);
        } else if (tile === CONSTANTS.TILE_WALL) {
          drawWallTile(px, py, T);
        } else if (tile === CONSTANTS.TILE_BRICK) {
          drawBrickTile(px, py, T);
        } else if (tile === CONSTANTS.TILE_STEEL) {
          drawSteelTile(px, py, T);
        }
      }
    }
  }

  function drawWallTile(px, py, T) {
    ctx.fillStyle = COLORS.wall; ctx.fillRect(px, py, T, T);
    ctx.fillStyle = COLORS.wallHighlight; ctx.fillRect(px, py, T, 2); ctx.fillRect(px, py, 2, T);
    ctx.fillStyle = COLORS.wallShadow; ctx.fillRect(px, py+T-2, T, 2); ctx.fillRect(px+T-2, py, 2, T);
  }

  function drawBrickTile(px, py, T) {
    ctx.fillStyle = COLORS.brick; ctx.fillRect(px, py, T, T);
    ctx.fillStyle = COLORS.brickLine;
    ctx.fillRect(px, py+7, T, 1); ctx.fillRect(px, py+15, T, 1); ctx.fillRect(px, py+23, T, 1);
    ctx.fillRect(px+8, py, 1, 8); ctx.fillRect(px+24, py, 1, 8);
    ctx.fillRect(px+16, py+8, 1, 8); ctx.fillRect(px+8, py+16, 1, 8);
    ctx.fillRect(px+24, py+16, 1, 8); ctx.fillRect(px+16, py+24, 1, 8);
    ctx.fillStyle = COLORS.brickHighlight; ctx.fillRect(px, py, T, 1); ctx.fillRect(px, py, 1, T);
  }

  function drawSteelTile(px, py, T) {
    ctx.fillStyle = COLORS.steel; ctx.fillRect(px, py, T, T);
    ctx.fillStyle = COLORS.steelHighlight; ctx.fillRect(px, py, T, 2); ctx.fillRect(px, py, 2, T);
    ctx.fillStyle = COLORS.steelShadow; ctx.fillRect(px+T-2, py, 2, T); ctx.fillRect(px, py+T-2, T, 2);
    ctx.fillStyle = COLORS.steelHighlight;
    ctx.fillRect(px+4, py+4, 3, 3); ctx.fillRect(px+T-7, py+4, 3, 3);
    ctx.fillRect(px+4, py+T-7, 3, 3); ctx.fillRect(px+T-7, py+T-7, 3, 3);
  }

  // ─── Fog of War (simple radial) ─────────────────────────────
  function drawFogOfWar(centerX, centerY, visionZones) {
    const T = CONSTANTS.TILE_SIZE;
    const mapW = CONSTANTS.MAP_WIDTH * T;
    const mapH = CONSTANTS.MAP_HEIGHT * T;
    const maxRadius = visionZones * T * 3.5;

    ctx.save();

    // Dark overlay with circular cutout
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(mapW, 0);
    ctx.lineTo(mapW, mapH);
    ctx.lineTo(0, mapH);
    ctx.closePath();

    // Cut out visible circle (counter-clockwise for hole)
    ctx.moveTo(centerX + maxRadius, centerY);
    for (let a = 0; a <= Math.PI * 2; a += 0.1) {
      ctx.lineTo(centerX + Math.cos(-a) * maxRadius, centerY + Math.sin(-a) * maxRadius);
    }
    ctx.closePath();

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fill();

    // Soft fade at the edge
    const gradient = ctx.createRadialGradient(centerX, centerY, maxRadius * 0.6, centerX, centerY, maxRadius);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.8, 'rgba(0,0,0,0.15)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ─── Capture Zones ─────────────────────────────────────────
  function drawCaptureZone(zone, players) {
    const T = CONSTANTS.TILE_SIZE;
    const cx = zone.x * T;
    const cy = zone.y * T;
    const radius = CONSTANTS.CAPTURE_ZONE_RADIUS * T;

    ctx.save();
    const ownerColor = zone.owner ? getPlayerColor(zone.owner, players) : '#666';
    const pulse = 0.15 + Math.sin(Date.now() / 500) * 0.05;

    // Zone circle
    ctx.globalAlpha = pulse;
    ctx.fillStyle = ownerColor;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = ownerColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Label
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#FFF';
    ctx.font = '10px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(zone.label, cx, cy);

    ctx.restore();
  }

  function getPlayerColor(playerId, players) {
    const p = players.find(pl => pl.id === playerId);
    return p ? CONSTANTS.TANK_COLORS[p.colorIndex] : '#666';
  }

  // ─── Tank ──────────────────────────────────────────────────
  function drawTank(x, y, angle, colorIndex, hp, maxHp, alive, name, shieldActive, empDisabled, upgrades) {
    if (!alive) return;

    const color = CONSTANTS.TANK_COLORS[colorIndex];
    const size = CONSTANTS.TANK_SIZE;
    const hs = size / 2;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);

    // Tracks
    ctx.fillStyle = darkenColor(color, 0.5);
    ctx.fillRect(-hs, -hs, 4, size);
    ctx.fillRect(hs - 4, -hs, 4, size);
    ctx.fillStyle = darkenColor(color, 0.35);
    for (let i = 0; i < size; i += 4) {
      ctx.fillRect(-hs, -hs + i, 4, 2);
      ctx.fillRect(hs - 4, -hs + i, 4, 2);
    }

    // Body
    ctx.fillStyle = empDisabled ? '#555' : color;
    ctx.fillRect(-hs + 4, -hs + 2, size - 8, size - 4);
    ctx.fillStyle = lightenColor(empDisabled ? '#555' : color, 0.2);
    ctx.fillRect(-hs + 4, -hs + 2, size - 8, 2);
    ctx.fillRect(-hs + 4, -hs + 2, 2, size - 4);
    ctx.fillStyle = darkenColor(empDisabled ? '#555' : color, 0.2);
    ctx.fillRect(-hs + 4, hs - 4, size - 8, 2);
    ctx.fillRect(hs - 6, -hs + 2, 2, size - 4);

    // Turret
    ctx.fillStyle = lightenColor(color, 0.15);
    ctx.fillRect(-5, -5, 10, 10);

    // Barrel
    ctx.fillStyle = darkenColor(color, 0.3);
    ctx.fillRect(-2, -hs - 4, 4, hs);
    ctx.fillStyle = '#888';
    ctx.fillRect(-3, -hs - 4, 6, 3);

    // Double barrel indicator
    if (upgrades && upgrades.doubleShot) {
      ctx.fillStyle = darkenColor(color, 0.3);
      ctx.fillRect(3, -hs - 4, 3, hs - 2);
      ctx.fillRect(-6, -hs - 4, 3, hs - 2);
    }

    ctx.restore();

    // Shield
    if (shieldActive) {
      ctx.save();
      ctx.strokeStyle = '#9C27B0';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, hs + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // EMP disabled indicator
    if (empDisabled) {
      ctx.save();
      ctx.strokeStyle = '#FF0';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4 + Math.sin(Date.now() / 100) * 0.4;
      for (let i = 0; i < 4; i++) {
        const a = (Date.now() / 200 + i * 1.57);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (hs+2), y + Math.sin(a) * (hs+2));
        ctx.lineTo(x + Math.cos(a) * (hs+8), y + Math.sin(a) * (hs+8));
        ctx.stroke();
      }
      ctx.restore();
    }

    // HP bar
    const mhp = maxHp || CONSTANTS.TANK_MAX_HP;
    if (hp < mhp) {
      const barW = 26, barH = 3;
      ctx.fillStyle = '#222';
      ctx.fillRect(x - barW/2, y - hs - 9, barW, barH);
      const ratio = hp / mhp;
      ctx.fillStyle = ratio > 0.5 ? '#4CAF50' : ratio > 0.25 ? '#FF9800' : '#f44336';
      ctx.fillRect(x - barW/2, y - hs - 9, barW * ratio, barH);
    }

    // Name
    ctx.fillStyle = '#fff';
    ctx.font = '5px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText(name || '', x, y + hs + 9);
  }

  function drawBullet(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = COLORS.bulletGlow;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(-3, -3, 6, 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.bullet;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.fillStyle = '#FFF';
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  function drawPowerup(x, y, type) {
    const size = CONSTANTS.POWERUP_SIZE;
    const color = POWERUP_COLORS[type] || '#FFF';
    const pulse = Math.sin(Date.now() / 300) * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = darkenColor(color, 0.5);
    ctx.fillRect(-size/2 - pulse/2, -size/2 - pulse/2, size + pulse, size + pulse);
    ctx.fillStyle = color;
    ctx.fillRect(-size/2 + 2, -size/2 + 2, size - 4, size - 4);
    ctx.fillStyle = '#FFF';
    ctx.font = '6px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWERUP_ICONS[type] || '?', 0, 1);
    ctx.restore();
  }

  function drawCreditPickup(x, y, value) {
    const pulse = Math.sin(Date.now() / 250) * 2;
    ctx.save();
    ctx.translate(x, y);

    // Glow
    ctx.globalAlpha = 0.3 + Math.sin(Date.now() / 400) * 0.1;
    ctx.fillStyle = value >= 50 ? '#FFD700' : '#C0C0C0';
    ctx.beginPath();
    ctx.arc(0, 0, 10 + pulse, 0, Math.PI * 2);
    ctx.fill();

    // Coin body
    ctx.globalAlpha = 1;
    ctx.fillStyle = value >= 50 ? '#FFD700' : '#B0B0B0';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();

    // Inner circle
    ctx.fillStyle = value >= 50 ? '#FFA000' : '#888';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    // CR label
    ctx.fillStyle = '#FFF';
    ctx.font = '5px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CR', 0, 0);

    ctx.restore();
  }

  function drawMine(x, y, isOwn) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = isOwn ? '#FF5722' : '#c62828';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = '#FF0';
    ctx.fillRect(-2, -2, 4, 4);
    if (isOwn) {
      ctx.strokeStyle = '#FF5722';
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, CONSTANTS.MINE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSmoke(x, y, radius) {
    ctx.save();
    ctx.globalAlpha = 0.4 + Math.sin(Date.now() / 300) * 0.1;
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawDeathExplosion(x, y, progress) {
    const maxR = 20;
    const r = maxR * progress;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = '#FF5722';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFD700';
    ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.fillStyle = i % 2 ? '#FF5722' : '#FFD700';
      ctx.fillRect(x + Math.cos(a) * r * 1.2 - 2, y + Math.sin(a) * r * 1.2 - 2, 4, 4);
    }
    ctx.restore();
  }

  function drawEMPBlast(x, y, progress) {
    ctx.save();
    ctx.globalAlpha = (1 - progress) * 0.5;
    ctx.strokeStyle = '#00BCD4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, CONSTANTS.EMP_RADIUS * progress, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawTeleportEffect(x, y, progress) {
    ctx.save();
    ctx.globalAlpha = (1 - progress) * 0.7;
    ctx.fillStyle = '#E040FB';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + progress * 3;
      const d = 15 * progress;
      ctx.fillRect(x + Math.cos(a) * d - 2, y + Math.sin(a) * d - 2, 4, 4);
    }
    ctx.restore();
  }

  function darkenColor(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.floor(r*(1-amount))},${Math.floor(g*(1-amount))},${Math.floor(b*(1-amount))})`;
  }

  function lightenColor(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.min(255,Math.floor(r+(255-r)*amount))},${Math.min(255,Math.floor(g+(255-g)*amount))},${Math.min(255,Math.floor(b+(255-b)*amount))})`;
  }

  return {
    init, resize, clear, drawMap, drawFogOfWar,
    drawCaptureZone, drawTank, drawBullet, drawPowerup, drawCreditPickup,
    drawMine, drawSmoke, drawDeathExplosion, drawEMPBlast, drawTeleportEffect
  };
})();
