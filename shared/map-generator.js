// Procedural map generator for the tank game
// Generates a grid-based map with destructible brick walls and indestructible steel

function generateMap(width, height, seed) {
  const rng = createRNG(seed || Date.now());
  const map = [];

  // Initialize with empty tiles
  for (let y = 0; y < height; y++) {
    map[y] = [];
    for (let x = 0; x < width; x++) {
      map[y][x] = 0; // TILE_EMPTY
    }
  }

  // Border walls (indestructible)
  for (let x = 0; x < width; x++) {
    map[0][x] = 1;          // TILE_WALL
    map[height - 1][x] = 1;
  }
  for (let y = 0; y < height; y++) {
    map[y][0] = 1;
    map[y][width - 1] = 1;
  }

  // Spawn zones to keep clear (3x3 around each spawn point)
  const spawnZones = [
    { x: 2, y: 2 },
    { x: width - 3, y: height - 3 },
    { x: width - 3, y: 2 },
    { x: 2, y: height - 3 }
  ];

  function isInSpawnZone(tx, ty) {
    for (const sp of spawnZones) {
      if (Math.abs(tx - sp.x) <= 2 && Math.abs(ty - sp.y) <= 2) return true;
    }
    return false;
  }

  // Generate symmetric-ish brick clusters
  // Place brick walls in a semi-random pattern
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      if (isInSpawnZone(x, y)) continue;

      // Create patterns: clusters and corridors
      const noise = rng();

      // Grid-aligned structures every few tiles
      if (x % 4 === 0 && y % 4 === 0) {
        if (noise < 0.25) {
          // Place a small brick cluster (cross or L shape)
          placeBrickCluster(map, x, y, width, height, rng, isInSpawnZone);
        } else if (noise < 0.5) {
          // Place steel block
          if (!isInSpawnZone(x, y)) {
            map[y][x] = 3; // TILE_STEEL
          }
        }
      }

      // Scattered individual bricks
      if (noise > 0.94 && map[y][x] === 0 && !isInSpawnZone(x, y)) {
        map[y][x] = 2; // TILE_BRICK
      }
    }
  }

  // Add some horizontal and vertical brick walls for corridors
  const numWalls = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < numWalls; i++) {
    const horizontal = rng() > 0.5;
    const length = 3 + Math.floor(rng() * 5);
    const sx = 3 + Math.floor(rng() * (width - 8));
    const sy = 3 + Math.floor(rng() * (height - 8));

    for (let j = 0; j < length; j++) {
      const tx = horizontal ? sx + j : sx;
      const ty = horizontal ? sy : sy + j;
      if (tx > 0 && tx < width - 1 && ty > 0 && ty < height - 1) {
        if (!isInSpawnZone(tx, ty) && map[ty][tx] === 0) {
          map[ty][tx] = 2; // TILE_BRICK
        }
      }
    }
  }

  // Ensure paths exist between spawn points using simple flood-fill check
  ensureConnectivity(map, spawnZones, width, height);

  return map;
}

function placeBrickCluster(map, cx, cy, width, height, rng, isInSpawnZone) {
  const patterns = [
    // Cross
    [[0,0],[1,0],[-1,0],[0,1],[0,-1]],
    // Horizontal line
    [[0,0],[1,0],[2,0]],
    // Vertical line
    [[0,0],[0,1],[0,2]],
    // L shape
    [[0,0],[1,0],[0,1]],
    // Square
    [[0,0],[1,0],[0,1],[1,1]]
  ];

  const pattern = patterns[Math.floor(rng() * patterns.length)];
  for (const [dx, dy] of pattern) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1) {
      if (!isInSpawnZone(nx, ny)) {
        map[ny][nx] = 2; // TILE_BRICK
      }
    }
  }
}

function ensureConnectivity(map, spawnZones, width, height) {
  // Simple BFS to check if all spawn points are reachable from the first one
  const visited = Array.from({ length: height }, () => new Array(width).fill(false));
  const queue = [{ x: spawnZones[0].x, y: spawnZones[0].y }];
  visited[spawnZones[0].y][spawnZones[0].x] = true;

  const dirs = [[0,1],[0,-1],[1,0],[-1,0]];

  while (queue.length > 0) {
    const { x, y } = queue.shift();
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
        if (map[ny][nx] === 0 || map[ny][nx] === 2) {
          visited[ny][nx] = true;
          // Only traverse through empty tiles for connectivity
          if (map[ny][nx] === 0) {
            queue.push({ x: nx, y: ny });
          }
        }
      }
    }
  }

  // For each unreachable spawn, carve a path
  for (let i = 1; i < spawnZones.length; i++) {
    const sp = spawnZones[i];
    if (!visited[sp.y][sp.x]) {
      // Carve a path from this spawn to the first spawn
      carvePath(map, sp.x, sp.y, spawnZones[0].x, spawnZones[0].y, width, height);
    }
  }
}

function carvePath(map, x1, y1, x2, y2, width, height) {
  let cx = x1;
  let cy = y1;
  while (cx !== x2 || cy !== y2) {
    if (map[cy][cx] === 2) map[cy][cx] = 0;
    if (cx < x2) cx++;
    else if (cx > x2) cx--;
    else if (cy < y2) cy++;
    else if (cy > y2) cy--;
  }
}

// Simple seeded RNG (mulberry32)
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
