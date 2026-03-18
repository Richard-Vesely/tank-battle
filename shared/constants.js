// Shared constants between server and client
const CONSTANTS = {
  // Tile size in pixels
  TILE_SIZE: 32,

  // Default map dimensions (in tiles) — used as Small map size
  MAP_WIDTH: 40,
  MAP_HEIGHT: 30,

  // Map size presets: { width, height } in tiles
  MAP_SIZES: {
    small:  { width: 40, height: 30, label: 'Small' },
    medium: { width: 55, height: 42, label: 'Medium' },
    large:  { width: 70, height: 54, label: 'Large' },
  },

  // Tile types
  TILE_EMPTY: 0,
  TILE_WALL: 1,        // Indestructible border/wall
  TILE_BRICK: 2,       // Destructible brick
  TILE_STEEL: 3,       // Indestructible steel block
  TILE_CAPTURE: 4,     // Capture zone floor (visual marker)

  // Tank properties (slower pace)
  TANK_SIZE: 24,
  TANK_SPEED: 75,            // base pixels per second
  TANK_ROTATION_SPEED: 130,  // base degrees per second
  TANK_MAX_HP: 150,          // base HP
  TANK_COLORS: [
    '#4CAF50', '#2196F3', '#FF9800', '#E91E63',
    '#9C27B0', '#00BCD4', '#CDDC39', '#FF5722',
    '#795548', '#607D8B'
  ],
  TANK_NAMES: ['Green', 'Blue', 'Orange', 'Pink', 'Purple', 'Cyan', 'Lime', 'Red', 'Brown', 'Steel'],

  // Bullet properties
  BULLET_SPEED: 200,    // base pixels per second
  BULLET_SIZE: 4,
  BULLET_DAMAGE: 20,    // base damage
  BULLET_MAX_RICOCHETS: 1,
  FIRE_COOLDOWN: 700,   // base ms between shots

  // Power-up types (kept from v1 as map pickups)
  POWERUP_SPEED: 'speed',
  POWERUP_RAPID: 'rapid',
  POWERUP_SHIELD: 'shield',
  POWERUP_HEAL: 'heal',

  // Power-up properties
  POWERUP_SIZE: 20,
  POWERUP_DURATION: 8000,
  POWERUP_SPAWN_INTERVAL: 15000,
  POWERUP_MAX_ON_MAP: 2,

  // Speed boost multiplier
  SPEED_BOOST: 1.5,
  RAPID_FIRE_COOLDOWN: 350,

  // ─── Currency ────────────────────────────────────────────
  KILL_CURRENCY: 100,
  ASSIST_CURRENCY: 30,
  CREDIT_SPAWN_INTERVAL: 8000,
  CREDIT_MAX_ON_MAP_BASE: 5,         // base for 4 players
  CREDIT_MAX_PER_EXTRA_PLAYER: 0.5,  // +0.5 per player above 4 (rounds up)

  // ─── Stats (formula-based, unlimited levels) ───────────
  // cost(level) = baseCost * costMult^level  (level is 0-indexed: buying first upgrade = level 0)
  // value(level) = base * (1 + pctPerLevel)^level   (for increasing stats)
  // value(level) = base * (1 - pctPerLevel)^level   (for decreasing stats like cooldown/armor)
  STATS: {
    firepower: {
      name: 'Firepower', baseCost: 75, costMult: 2,
      base: { damage: 20, fireCooldown: 700, bulletSpeed: 200 },
      pctPerLevel: { damage: 0.10, fireCooldown: 0.08, bulletSpeed: 0.08 },
      // damage increases, fireCooldown decreases, bulletSpeed increases
    },
    mobility: {
      name: 'Mobility', baseCost: 75, costMult: 2,
      base: { moveSpeed: 75, rotationSpeed: 130 },
      pctPerLevel: { moveSpeed: 0.10, rotationSpeed: 0.08 },
    },
    defense: {
      name: 'Defense', baseCost: 75, costMult: 2,
      base: { maxHp: 150, armor: 1.0 },
      pctPerLevel: { maxHp: 0.12, armor: 0.08 },
      // maxHp increases, armor (damage multiplier) decreases
    },
    coinBoost: {
      name: 'Coin Boost', baseCost: 150, costMult: 2,
      // +10% coins from everything per level
      pctPerLevel: { coinMult: 0.10 },
    },
    regeneration: {
      name: 'Regen', baseCost: 75, costMult: 2,
      // +0.5 hp/s per level
      flat: { hpPerSec: 0.5 },
    },
    fasterCooldown: {
      name: 'Fast CD', baseCost: 150, costMult: 2,
      // -1s ability cooldown per level
      flat: { cdReduction: 1000 },
    },
  },

  // Quick-buy key bindings (number keys 1-6)
  QUICKBUY_STATS: ['firepower', 'mobility', 'defense', 'coinBoost', 'regeneration', 'fasterCooldown'],

  // ─── Abilities (formula-based, unlimited levels) ────────
  // cost(level) = baseCost * costMult^level
  // Effects scale per level with percentage gains
  ABILITIES: {
    // Duration abilities (all 5s)
    berserk:    { name: 'Berserk',      key: 'Q', type: 'duration', baseCost: 150, costMult: 2,
      duration: 5000,
      base: { damageMult: 1.5, fireRateMult: 0.75, cooldown: 20000 },
      pctPerLevel: { damageMult: 0.15, fireRateMult: 0.08, cooldown: 2000 },
      // damageMult increases, fireRateMult decreases (faster), cooldown uses flat reduction per level
      cooldownMode: 'flat', // special: subtract pctPerLevel.cooldown ms per level instead of %
    },
    speedBoost: { name: 'Speed Boost',  key: 'W', type: 'duration', baseCost: 150, costMult: 2,
      duration: 5000,
      base: { speedMult: 1.4, cooldown: 18000 },
      pctPerLevel: { speedMult: 0.15, cooldown: 0.08 },
    },
    vampire:    { name: 'Vampire',      key: 'E', type: 'duration', baseCost: 200, costMult: 2,
      duration: 5000,
      base: { killCRMult: 2, healPercent: 0.25, cooldown: 25000 },
      pctPerLevel: { killCRMult: 0.50, healPercent: 0.15, cooldown: 0.08 },
    },
    hide:       { name: 'Hide',         key: 'R', type: 'duration', baseCost: 200, costMult: 2,
      duration: 5000,
      base: { cooldown: 22000 },
      pctPerLevel: { cooldown: 0.08 },
    },
    shield:     { name: 'Shield',       key: 'F', type: 'duration', baseCost: 200, costMult: 2,
      duration: 5000,
      base: { cooldown: 40000 },
      pctPerLevel: { cooldown: 0.08 },
    },
    // Instant abilities
    regenBurst: { name: 'Regen Burst',  key: 'G', type: 'instant', baseCost: 150, costMult: 2,
      base: { healAmount: 50, cooldown: 18000 },
      pctPerLevel: { healAmount: 0.15, cooldown: 0.08 },
    },
    mine:       { name: 'Mine',         key: 'X', type: 'instant', baseCost: 150, costMult: 2,
      base: { damage: 50, cooldown: 8000 },
      pctPerLevel: { damage: 0.12, cooldown: 0.10 },
    },
  },

  MINE_RADIUS: 40,

  // ─── Domination Mode ─────────────────────────────────────
  MODE_FFA: 'ffa',
  MODE_ROUNDS: 'rounds',
  MODE_DOMINATION: 'domination',

  CAPTURE_ZONE_RADIUS: 2.5,       // tiles
  CAPTURE_RATE: 3,                 // seconds to capture
  DOMINATION_POINTS_PER_SEC: 1,   // points per second per zone held
  DOMINATION_WIN_SCORE: 300,       // points to win

  // Game settings
  TICK_RATE: 60,
  BROADCAST_RATE: 20,
  RESPAWN_TIME: 4000,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 10,

  // Match settings
  ROUNDS_TO_WIN: 7,
  FFA_LIVES: 3,

  // Death penalty modes
  DEATH_KEEP_UPGRADES: 'keep',
  DEATH_LOSE_ALL: 'lose',
};

// ─── Shared Helper Functions ─────────────────────────────────
// These compute stat/ability values from level using formulas.
// Used by both server and client.

/** Get the cost to upgrade a stat to the next level */
CONSTANTS.getStatCost = function(key, currentLevel) {
  const def = CONSTANTS.STATS[key];
  if (!def) return Infinity;
  return Math.min(999999999, Math.round(def.baseCost * Math.pow(def.costMult, currentLevel)));
};

/** Get the cost to upgrade an ability to the next level */
CONSTANTS.getAbilityCost = function(key, currentLevel) {
  const def = CONSTANTS.ABILITIES[key];
  if (!def) return Infinity;
  return Math.min(999999999, Math.round(def.baseCost * Math.pow(def.costMult, currentLevel)));
};

/** Get a stat's computed value at a given level.
 *  'increasing' stats use base * (1 + pct)^level
 *  'decreasing' stats (cooldown, armor) use base * (1 - pct)^level with a floor
 */
CONSTANTS.getStatValue = function(key, prop, level) {
  const def = CONSTANTS.STATS[key];
  if (!def || level <= 0) {
    // Return raw base defaults for level 0
    if (key === 'firepower') {
      if (prop === 'damage') return CONSTANTS.BULLET_DAMAGE;
      if (prop === 'fireCooldown') return CONSTANTS.FIRE_COOLDOWN;
      if (prop === 'bulletSpeed') return CONSTANTS.BULLET_SPEED;
    }
    if (key === 'mobility') {
      if (prop === 'moveSpeed') return CONSTANTS.TANK_SPEED;
      if (prop === 'rotationSpeed') return CONSTANTS.TANK_ROTATION_SPEED;
    }
    if (key === 'defense') {
      if (prop === 'maxHp') return CONSTANTS.TANK_MAX_HP;
      if (prop === 'armor') return 1.0;
    }
    return 0;
  }
  const base = def.base[prop];
  const pct = def.pctPerLevel[prop];
  // Decreasing props: cooldown, armor (damage mult)
  const decreasing = ['fireCooldown', 'armor'];
  if (decreasing.includes(prop)) {
    const val = base * Math.pow(1 - pct, level);
    // Floor: cooldown min 100ms, armor min 0.1
    if (prop === 'fireCooldown') return Math.max(100, Math.round(val));
    if (prop === 'armor') return Math.max(0.1, val);
    return val;
  }
  return base * Math.pow(1 + pct, level);
};

/** Get an ability's computed value at a given level */
CONSTANTS.getAbilityValue = function(key, prop, level) {
  const def = CONSTANTS.ABILITIES[key];
  if (!def || level <= 0) return 0;
  const base = def.base[prop];
  const pct = def.pctPerLevel[prop];
  if (base === undefined || pct === undefined) return 0;
  // Special: flat cooldown reduction (e.g. berserk loses 2s per level)
  if (prop === 'cooldown' && def.cooldownMode === 'flat') {
    return Math.max(1000, Math.round(base - pct * (level - 1)));
  }
  // Decreasing props: cooldown, fireRateMult
  const decreasing = ['cooldown', 'fireRateMult'];
  if (decreasing.includes(prop)) {
    const val = base * Math.pow(1 - pct, level - 1);
    if (prop === 'cooldown') return Math.max(1000, Math.round(val));
    return val;
  }
  return base * Math.pow(1 + pct, level - 1);
};

/** Generate spawn points for a given map size */
CONSTANTS.generateSpawnPoints = function(width, height, maxPlayers) {
  const points = [];
  const margin = 3;
  // Corners first
  points.push({ x: margin, y: margin });
  points.push({ x: width - margin - 1, y: height - margin - 1 });
  points.push({ x: width - margin - 1, y: margin });
  points.push({ x: margin, y: height - margin - 1 });
  // Mid-edges for 5-8 players
  points.push({ x: Math.floor(width / 2), y: margin });
  points.push({ x: Math.floor(width / 2), y: height - margin - 1 });
  points.push({ x: margin, y: Math.floor(height / 2) });
  points.push({ x: width - margin - 1, y: Math.floor(height / 2) });
  // Center-ish for 9-10
  points.push({ x: Math.floor(width * 0.33), y: Math.floor(height * 0.33) });
  points.push({ x: Math.floor(width * 0.66), y: Math.floor(height * 0.66) });
  return points;
};

/** Generate capture zones for a given map size */
CONSTANTS.generateCaptureZones = function(width, height) {
  return [
    { x: Math.floor(width / 2), y: Math.floor(height / 2), label: 'A' },
    { x: Math.floor(width * 0.25), y: Math.floor(height * 0.27), label: 'B' },
    { x: Math.floor(width * 0.75), y: Math.floor(height * 0.27), label: 'C' },
  ];
};

/** Get max credit pickups for a given player count */
CONSTANTS.getCreditMaxOnMap = function(playerCount) {
  const extra = Math.max(0, playerCount - 4);
  return Math.ceil(CONSTANTS.CREDIT_MAX_ON_MAP_BASE + extra * CONSTANTS.CREDIT_MAX_PER_EXTRA_PLAYER);
};

// ─── Math Utilities ──────────────────────────────────────────
CONSTANTS.degToRad = function(angle) {
  return (angle * Math.PI) / 180;
};

CONSTANTS.distSq = function(x1, y1, x2, y2) {
  const dx = x1 - x2, dy = y1 - y2;
  return dx * dx + dy * dy;
};

CONSTANTS.withinDist = function(x1, y1, x2, y2, dist) {
  return CONSTANTS.distSq(x1, y1, x2, y2) < dist * dist;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONSTANTS;
}
