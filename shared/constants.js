// Shared constants between server and client
const CONSTANTS = {
  // Tile size in pixels
  TILE_SIZE: 32,

  // Map dimensions (in tiles)
  MAP_WIDTH: 40,
  MAP_HEIGHT: 30,

  // Tile types
  TILE_EMPTY: 0,
  TILE_WALL: 1,        // Indestructible border/wall
  TILE_BRICK: 2,       // Destructible brick
  TILE_STEEL: 3,       // Indestructible steel block
  TILE_CAPTURE: 4,     // Capture zone floor (visual marker)

  // Tank properties (slower pace)
  TANK_SIZE: 24,
  TANK_SPEED: 75,            // pixels per second (was 120)
  TANK_ROTATION_SPEED: 130,  // degrees per second (was 180)
  TANK_MAX_HP: 150,          // more HP (was 100)
  TANK_COLORS: ['#4CAF50', '#2196F3', '#FF9800', '#E91E63'],
  TANK_NAMES: ['Green', 'Blue', 'Orange', 'Pink'],

  // Bullet properties
  BULLET_SPEED: 200,    // pixels per second (was 250)
  BULLET_SIZE: 4,
  BULLET_DAMAGE: 20,    // base damage (was 25)
  BULLET_MAX_RICOCHETS: 1,
  FIRE_COOLDOWN: 700,   // ms between shots (was 500)

  // Power-up types (kept from v1 as map pickups)
  POWERUP_SPEED: 'speed',
  POWERUP_RAPID: 'rapid',
  POWERUP_SHIELD: 'shield',
  POWERUP_HEAL: 'heal',

  // Power-up properties
  POWERUP_SIZE: 20,
  POWERUP_DURATION: 8000,
  POWERUP_SPAWN_INTERVAL: 15000,  // slower spawns
  POWERUP_MAX_ON_MAP: 2,

  // Speed boost multiplier
  SPEED_BOOST: 1.5,
  RAPID_FIRE_COOLDOWN: 350,

  // ─── Upgrade System ───────────────────────────────────────
  KILL_CURRENCY: 100,       // currency earned per kill
  ASSIST_CURRENCY: 30,      // currency for assists (damage dealt)

  // Upgrade categories and costs
  UPGRADES: {
    // Firepower
    damage:      { name: 'Damage+',       category: 'firepower', maxLevel: 3, costs: [100, 200, 350], values: [25, 30, 40] },
    reload:      { name: 'Reload Speed',  category: 'firepower', maxLevel: 3, costs: [100, 200, 350], values: [600, 500, 400] },
    bulletSpeed: { name: 'Bullet Speed',  category: 'firepower', maxLevel: 2, costs: [150, 300], values: [240, 280] },
    doubleShot:  { name: 'Double Shot',   category: 'firepower', maxLevel: 1, costs: [400], values: [true] },
    ricochet:    { name: 'Ricochet+',     category: 'firepower', maxLevel: 2, costs: [150, 350], values: [2, 3] },

    // Mobility
    speed:       { name: 'Speed+',        category: 'mobility', maxLevel: 3, costs: [100, 200, 350], values: [90, 105, 120] },
    rotation:    { name: 'Turn Speed',    category: 'mobility', maxLevel: 2, costs: [100, 200], values: [160, 190] },
    dash:        { name: 'Dash',          category: 'mobility', maxLevel: 1, costs: [250], values: [true] },
    breaker:     { name: 'Brick Breaker', category: 'mobility', maxLevel: 1, costs: [200], values: [true] },

    // Defense
    maxHp:       { name: 'Max HP+',       category: 'defense', maxLevel: 3, costs: [100, 200, 350], values: [180, 210, 250] },
    armor:       { name: 'Armor',         category: 'defense', maxLevel: 3, costs: [150, 250, 400], values: [0.85, 0.7, 0.55] },
    regen:       { name: 'Regen',         category: 'defense', maxLevel: 2, costs: [200, 350], values: [2, 4] },
    mine:        { name: 'Mines',         category: 'defense', maxLevel: 1, costs: [300], values: [true] },

    // Utility
    radar:       { name: 'Radar',         category: 'utility', maxLevel: 3, costs: [150, 250, 400], values: [2, 3, 4] },
    stealth:     { name: 'Stealth',       category: 'utility', maxLevel: 3, costs: [200, 350, 500], values: [1, 2, 3] },
    teleport:    { name: 'Teleport',      category: 'utility', maxLevel: 1, costs: [350], values: [true] },
    emp:         { name: 'EMP Blast',     category: 'utility', maxLevel: 1, costs: [400], values: [true] },
    smoke:       { name: 'Smoke Screen',  category: 'utility', maxLevel: 1, costs: [200], values: [true] }
  },

  // Quick-buy key bindings (number keys 1-9)
  QUICKBUY_SLOTS: ['damage', 'reload', 'speed', 'maxHp', 'armor', 'radar', 'stealth', 'teleport', 'dash'],

  // Ability cooldowns (ms)
  DASH_COOLDOWN: 5000,
  DASH_DISTANCE: 80,
  TELEPORT_COOLDOWN: 12000,
  TELEPORT_RANGE: 200,
  EMP_COOLDOWN: 15000,
  EMP_RADIUS: 120,
  EMP_DURATION: 2000,
  SMOKE_COOLDOWN: 8000,
  SMOKE_RADIUS: 60,
  SMOKE_DURATION: 5000,
  MINE_COOLDOWN: 6000,
  MINE_DAMAGE: 50,
  MINE_RADIUS: 40,

  // ─── Fog of War ───────────────────────────────────────────
  // 4 concentric zones (in tile units from tank)
  FOG_ZONE_1: 3,    // Close - always visible
  FOG_ZONE_2: 6,    // Near
  FOG_ZONE_3: 10,   // Mid
  FOG_ZONE_4: 15,   // Far
  BASE_VISION: 3,   // Base: see zones 1-3 (radar upgrades add zone 4)

  // ─── Domination Mode ─────────────────────────────────────
  MODE_FFA: 'ffa',
  MODE_ROUNDS: 'rounds',
  MODE_DOMINATION: 'domination',

  CAPTURE_ZONE_RADIUS: 2.5,       // tiles
  CAPTURE_RATE: 3,                 // seconds to capture
  DOMINATION_POINTS_PER_SEC: 1,   // points per second per zone held
  DOMINATION_WIN_SCORE: 300,       // points to win

  // Capture zone positions (tile coords) - placed by map generator
  CAPTURE_ZONES: [
    { x: 20, y: 15, label: 'A' },
    { x: 10, y: 8, label: 'B' },
    { x: 30, y: 8, label: 'C' }
  ],

  // Game settings
  TICK_RATE: 60,
  BROADCAST_RATE: 20,
  RESPAWN_TIME: 4000,       // slightly longer (was 3000)
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,

  // Match settings
  ROUNDS_TO_WIN: 7,         // more kills needed (was 5)
  FFA_LIVES: 3,

  // Death penalty modes
  DEATH_KEEP_UPGRADES: 'keep',
  DEATH_LOSE_ALL: 'lose',

  // Spawn points (tile coordinates)
  SPAWN_POINTS: [
    { x: 3, y: 3 },
    { x: 37, y: 27 },
    { x: 37, y: 3 },
    { x: 3, y: 27 }
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONSTANTS;
}
