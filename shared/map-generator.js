// Procedural map generator for the tank game v2
// Generates strategic maps with steel chokepoints and capture zones

function generateMap(width, height, seed, captureZones) {
  const rng = createRNG(seed || Date.now());
  const map = [];

  // Initialize with empty tiles
  for (let y = 0; y < height; y++) {
    map[y] = [];
    for (let x = 0; x < width; x++) {
      map[y][x] = 0;
    }
  }

  // Border walls
  for (let x = 0; x < width; x++) {
    map[0][x] = 1;
    map[height - 1][x] = 1;
  }
  for (let y = 0; y < height; y++) {
    map[y][0] = 1;
    map[y][width - 1] = 1;
  }

  // Spawn zones (4x4 clear around each spawn)
  const spawnZones = [
    { x: 3, y: 3 },
    { x: width - 4, y: height - 4 },
    { x: width - 4, y: 3 },
    { x: 3, y: height - 4 }
  ];

  // Capture zones to keep mostly clear
  const capZones = captureZones || [];

  function isProtected(tx, ty) {
    for (const sp of spawnZones) {
      if (Math.abs(tx - sp.x) <= 3 && Math.abs(ty - sp.y) <= 3) return true;
    }
    for (const cz of capZones) {
      const dist = Math.sqrt((tx - cz.x) ** 2 + (ty - cz.y) ** 2);
      if (dist <= 3.5) return true;
    }
    return false;
  }

  // ─── Steel structures (chokepoints) ─────────────────────
  // Create major steel wall formations that define lanes and chokepoints

  // Central cross structure
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  // Horizontal steel walls through center area
  for (let i = -4; i <= 4; i++) {
    if (Math.abs(i) <= 1) continue; // Gap in the middle
    const tx = cx + i;
    if (!isProtected(tx, cy - 2)) map[cy - 2][tx] = 3;
    if (!isProtected(tx, cy + 2)) map[cy + 2][tx] = 3;
  }

  // Vertical steel walls
  for (let i = -3; i <= 3; i++) {
    if (Math.abs(i) <= 1) continue;
    if (!isProtected(cx - 5, cy + i)) map[cy + i][cx - 5] = 3;
    if (!isProtected(cx + 5, cy + i)) map[cy + i][cx + 5] = 3;
  }

  // Corner bunkers (L-shaped steel)
  const bunkerOffsets = [
    { bx: 8, by: 6 },
    { bx: width - 9, by: 6 },
    { bx: 8, by: height - 7 },
    { bx: width - 9, by: height - 7 }
  ];
  for (const b of bunkerOffsets) {
    const shapes = [
      [0,0],[1,0],[2,0],[0,1],[0,2]
    ];
    const rot = rng() > 0.5;
    for (const [dx, dy] of shapes) {
      const fx = rot ? b.bx + dy : b.bx + dx;
      const fy = rot ? b.by + dx : b.by + dy;
      if (fx > 0 && fx < width - 1 && fy > 0 && fy < height - 1 && !isProtected(fx, fy)) {
        map[fy][fx] = 3;
      }
    }
  }

  // Random steel pillars scattered across map
  const numPillars = 6 + Math.floor(rng() * 5);
  for (let i = 0; i < numPillars; i++) {
    const px = 4 + Math.floor(rng() * (width - 8));
    const py = 4 + Math.floor(rng() * (height - 8));
    if (!isProtected(px, py) && map[py][px] === 0) {
      map[py][px] = 3;
      // Sometimes make 2x1 or 1x2
      if (rng() > 0.5) {
        const dx = rng() > 0.5 ? 1 : 0;
        const dy = dx ? 0 : 1;
        if (px+dx < width-1 && py+dy < height-1 && !isProtected(px+dx, py+dy)) {
          map[py+dy][px+dx] = 3;
        }
      }
    }
  }

  // ─── Steel lane walls ──────────────────────────────────
  // Create horizontal lanes across the map
  const laneY1 = Math.floor(height * 0.33);
  const laneY2 = Math.floor(height * 0.66);
  for (let x = 6; x < width - 6; x++) {
    // Lane 1 - leave gaps
    if (x % 7 < 5 && !isProtected(x, laneY1)) {
      map[laneY1][x] = 3;
    }
    // Lane 2 - offset gaps
    if ((x + 3) % 7 < 5 && !isProtected(x, laneY2)) {
      map[laneY2][x] = 3;
    }
  }

  // ─── Brick fill ─────────────────────────────────────────
  // Add brick walls for destructible cover
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      if (map[y][x] !== 0) continue;
      if (isProtected(x, y)) continue;

      const noise = rng();

      // Brick clusters near steel walls
      if (isNearSteel(map, x, y, width, height) && noise < 0.3) {
        map[y][x] = 2;
        continue;
      }

      // Scattered bricks
      if (noise > 0.93) {
        map[y][x] = 2;
      }
    }
  }

  // A few brick wall segments
  const numBrickWalls = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < numBrickWalls; i++) {
    const horizontal = rng() > 0.5;
    const length = 3 + Math.floor(rng() * 4);
    const sx = 4 + Math.floor(rng() * (width - 10));
    const sy = 4 + Math.floor(rng() * (height - 10));
    for (let j = 0; j < length; j++) {
      const tx = horizontal ? sx + j : sx;
      const ty = horizontal ? sy : sy + j;
      if (tx > 0 && tx < width-1 && ty > 0 && ty < height-1 && !isProtected(tx, ty) && map[ty][tx] === 0) {
        map[ty][tx] = 2;
      }
    }
  }

  // Ensure connectivity
  ensureConnectivity(map, spawnZones, width, height);

  return map;
}

function isNearSteel(map, x, y, width, height) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && map[ny][nx] === 3) return true;
    }
  }
  return false;
}

function ensureConnectivity(map, spawnZones, width, height) {
  const visited = Array.from({ length: height }, () => new Array(width).fill(false));
  const queue = [{ x: spawnZones[0].x, y: spawnZones[0].y }];
  visited[spawnZones[0].y][spawnZones[0].x] = true;
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]];

  while (queue.length > 0) {
    const { x, y } = queue.shift();
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
        if (map[ny][nx] === 0 || map[ny][nx] === 2) {
          visited[ny][nx] = true;
          if (map[ny][nx] === 0) queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  for (let i = 1; i < spawnZones.length; i++) {
    const sp = spawnZones[i];
    if (!visited[sp.y][sp.x]) {
      carvePath(map, sp.x, sp.y, spawnZones[0].x, spawnZones[0].y);
    }
  }
}

function carvePath(map, x1, y1, x2, y2) {
  let cx = x1, cy = y1;
  while (cx !== x2 || cy !== y2) {
    if (map[cy][cx] === 2 || map[cy][cx] === 3) map[cy][cx] = 0;
    if (cx < x2) cx++;
    else if (cx > x2) cx--;
    else if (cy < y2) cy++;
    else if (cy > y2) cy--;
  }
}

function createRNG(seed) {
  let s = seed | 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateMap };
}
