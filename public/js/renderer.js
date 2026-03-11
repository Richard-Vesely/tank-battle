// Retro pixel-art renderer for the tank game
const Renderer = (() => {
  let canvas, ctx;
  let cameraX = 0, cameraY = 0;

  const COLORS = {
    bg: '#2d2d2d',
    wall: '#555555',
    wallHighlight: '#6a6a6a',
    wallShadow: '#404040',
    brick: '#c0392b',
    brickHighlight: '#e74c3c',
    brickShadow: '#962d22',
    brickLine: '#a0301f',
    steel: '#7f8c8d',
    steelHighlight: '#95a5a6',
    steelShadow: '#606b6c',
    ground: '#3d3d2e',
    groundDot: '#35352a',
    bullet: '#FFD700',
    bulletGlow: '#FFA500',
    muzzleFlash: '#FFFFFF',
  };

  const POWERUP_COLORS = {
    speed: '#00BCD4',
    rapid: '#FF5722',
    shield: '#9C27B0',
    heal: '#4CAF50'
  };

  const POWERUP_ICONS = {
    speed: 'SPD',
    rapid: 'RPD',
    shield: 'SHD',
    heal: '+HP'
  };

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const mapPixelW = CONSTANTS.MAP_WIDTH * CONSTANTS.TILE_SIZE;
    const mapPixelH = CONSTANTS.MAP_HEIGHT * CONSTANTS.TILE_SIZE;

    // Scale to fit window
    const scaleX = window.innerWidth / mapPixelW;
    const scaleY = window.innerHeight / mapPixelH;
    const scale = Math.min(scaleX, scaleY);

    canvas.width = Math.floor(mapPixelW * scale);
    canvas.height = Math.floor(mapPixelH * scale);
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
        const px = x * T;
        const py = y * T;

        if (tile === CONSTANTS.TILE_EMPTY) {
          // Ground with subtle pixel pattern
          ctx.fillStyle = COLORS.ground;
          ctx.fillRect(px, py, T, T);
          // Pixel dots for texture
          ctx.fillStyle = COLORS.groundDot;
          if ((x + y) % 3 === 0) {
            ctx.fillRect(px + 4, py + 4, 2, 2);
            ctx.fillRect(px + 14, py + 20, 2, 2);
          }
          if ((x + y) % 5 === 0) {
            ctx.fillRect(px + 22, py + 8, 2, 2);
          }
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
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(px, py, T, T);
    // Highlight top-left edges
    ctx.fillStyle = COLORS.wallHighlight;
    ctx.fillRect(px, py, T, 2);
    ctx.fillRect(px, py, 2, T);
    // Shadow bottom-right edges
    ctx.fillStyle = COLORS.wallShadow;
    ctx.fillRect(px, py + T - 2, T, 2);
    ctx.fillRect(px + T - 2, py, 2, T);
  }

  function drawBrickTile(px, py, T) {
    ctx.fillStyle = COLORS.brick;
    ctx.fillRect(px, py, T, T);

    // Brick pattern
    ctx.fillStyle = COLORS.brickLine;
    // Horizontal mortar lines
    ctx.fillRect(px, py + 7, T, 1);
    ctx.fillRect(px, py + 15, T, 1);
    ctx.fillRect(px, py + 23, T, 1);
    // Vertical mortar lines (offset per row)
    ctx.fillRect(px + 8, py, 1, 8);
    ctx.fillRect(px + 24, py, 1, 8);
    ctx.fillRect(px + 16, py + 8, 1, 8);
    ctx.fillRect(px + 8, py + 16, 1, 8);
    ctx.fillRect(px + 24, py + 16, 1, 8);
    ctx.fillRect(px + 16, py + 24, 1, 8);

    // Highlight
    ctx.fillStyle = COLORS.brickHighlight;
    ctx.fillRect(px, py, T, 1);
    ctx.fillRect(px, py, 1, T);
  }

  function drawSteelTile(px, py, T) {
    ctx.fillStyle = COLORS.steel;
    ctx.fillRect(px, py, T, T);

    // Riveted steel look
    ctx.fillStyle = COLORS.steelHighlight;
    ctx.fillRect(px, py, T, 2);
    ctx.fillRect(px, py, 2, T);
    ctx.fillStyle = COLORS.steelShadow;
    ctx.fillRect(px + T - 2, py, 2, T);
    ctx.fillRect(px, py + T - 2, T, 2);

    // Corner rivets
    ctx.fillStyle = COLORS.steelHighlight;
    ctx.fillRect(px + 4, py + 4, 3, 3);
    ctx.fillRect(px + T - 7, py + 4, 3, 3);
    ctx.fillRect(px + 4, py + T - 7, 3, 3);
    ctx.fillRect(px + T - 7, py + T - 7, 3, 3);
  }

  function drawTank(x, y, angle, colorIndex, hp, alive, name, shieldActive) {
    if (!alive) return;

    const color = CONSTANTS.TANK_COLORS[colorIndex];
    const size = CONSTANTS.TANK_SIZE;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);

    // Tank body (retro pixel style)
    const hs = size / 2;

    // Tracks (darker)
    ctx.fillStyle = darkenColor(color, 0.5);
    ctx.fillRect(-hs, -hs, 4, size);
    ctx.fillRect(hs - 4, -hs, 4, size);
    // Track detail
    ctx.fillStyle = darkenColor(color, 0.35);
    for (let i = 0; i < size; i += 4) {
      ctx.fillRect(-hs, -hs + i, 4, 2);
      ctx.fillRect(hs - 4, -hs + i, 4, 2);
    }

    // Main body
    ctx.fillStyle = color;
    ctx.fillRect(-hs + 4, -hs + 2, size - 8, size - 4);

    // Body highlight
    ctx.fillStyle = lightenColor(color, 0.2);
    ctx.fillRect(-hs + 4, -hs + 2, size - 8, 2);
    ctx.fillRect(-hs + 4, -hs + 2, 2, size - 4);

    // Body shadow
    ctx.fillStyle = darkenColor(color, 0.2);
    ctx.fillRect(-hs + 4, hs - 4, size - 8, 2);
    ctx.fillRect(hs - 6, -hs + 2, 2, size - 4);

    // Turret
    ctx.fillStyle = lightenColor(color, 0.15);
    ctx.fillRect(-5, -5, 10, 10);

    // Cannon barrel
    ctx.fillStyle = darkenColor(color, 0.3);
    ctx.fillRect(-2, -hs - 4, 4, hs);

    // Cannon tip
    ctx.fillStyle = '#888';
    ctx.fillRect(-3, -hs - 4, 6, 3);

    ctx.restore();

    // Shield effect
    if (shieldActive) {
      ctx.save();
      ctx.strokeStyle = '#9C27B0';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, size / 2 + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // HP bar above tank
    if (hp < CONSTANTS.TANK_MAX_HP) {
      const barW = 24;
      const barH = 3;
      const barX = x - barW / 2;
      const barY = y - size / 2 - 8;
      ctx.fillStyle = '#333';
      ctx.fillRect(barX, barY, barW, barH);
      const hpRatio = hp / CONSTANTS.TANK_MAX_HP;
      ctx.fillStyle = hpRatio > 0.5 ? '#4CAF50' : hpRatio > 0.25 ? '#FF9800' : '#f44336';
      ctx.fillRect(barX, barY, barW * hpRatio, barH);
    }

    // Name below tank
    ctx.fillStyle = '#fff';
    ctx.font = '6px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText(name || '', x, y + size / 2 + 10);
  }

  function drawBullet(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);

    // Glow
    ctx.fillStyle = COLORS.bulletGlow;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(-3, -3, 6, 6);
    ctx.globalAlpha = 1;

    // Core
    ctx.fillStyle = COLORS.bullet;
    ctx.fillRect(-2, -2, 4, 4);

    // Bright center pixel
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

    // Background box
    ctx.fillStyle = darkenColor(color, 0.5);
    ctx.fillRect(-size/2 - pulse/2, -size/2 - pulse/2, size + pulse, size + pulse);

    // Inner box
    ctx.fillStyle = color;
    ctx.fillRect(-size/2 + 2, -size/2 + 2, size - 4, size - 4);

    // Icon text
    ctx.fillStyle = '#FFF';
    ctx.font = '6px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWERUP_ICONS[type] || '?', 0, 1);

    ctx.restore();
  }

  function drawDeathExplosion(x, y, progress) {
    const maxR = 20;
    const r = maxR * progress;
    ctx.save();
    ctx.globalAlpha = 1 - progress;

    // Outer explosion
    ctx.fillStyle = '#FF5722';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner explosion
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Center
    ctx.fillStyle = '#FFF';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Pixel debris
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = r * 1.2;
      ctx.fillStyle = i % 2 ? '#FF5722' : '#FFD700';
      ctx.fillRect(x + Math.cos(a) * d - 2, y + Math.sin(a) * d - 2, 4, 4);
    }

    ctx.restore();
  }

  function drawRespawnTimer(x, y, timeLeft) {
    ctx.save();
    ctx.fillStyle = '#FFF';
    ctx.globalAlpha = 0.6;
    ctx.font = '12px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(timeLeft / 1000).toString(), x, y);
    ctx.restore();
  }

  // Color utility functions
  function darkenColor(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.floor(r * (1 - amount))},${Math.floor(g * (1 - amount))},${Math.floor(b * (1 - amount))})`;
  }

  function lightenColor(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.min(255, Math.floor(r + (255 - r) * amount))},${Math.min(255, Math.floor(g + (255 - g) * amount))},${Math.min(255, Math.floor(b + (255 - b) * amount))})`;
  }

  return {
    init,
    resize,
    clear,
    drawMap,
    drawTank,
    drawBullet,
    drawPowerup,
    drawDeathExplosion,
    drawRespawnTimer
  };
})();
