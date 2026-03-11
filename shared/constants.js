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

  // ─── Currency ────────────────────────────────────────────
  KILL_CURRENCY: 100,
  ASSIST_CURRENCY: 30,
  CREDIT_SPAWN_INTERVAL: 8000,
  CREDIT_MAX_ON_MAP: 5,

  // ─── Stats (bundled, 5 levels each) ─────────────────────
  STATS: {
    firepower:  { name: 'Firepower',  maxLevel: 5, costs: [75, 150, 250, 400, 600],
      damage: [22, 25, 30, 36, 44], fireCooldown: [650, 600, 540, 470, 400], bulletSpeed: [215, 230, 250, 275, 310] },
    mobility:   { name: 'Mobility',   maxLevel: 5, costs: [75, 150, 250, 400, 600],
      moveSpeed: [85, 95, 108, 122, 140], rotationSpeed: [145, 160, 178, 198, 225] },
    defense:    { name: 'Defense',    maxLevel: 5, costs: [75, 150, 250, 400, 600],
      maxHp: [170, 195, 225, 265, 320], armor: [0.92, 0.84, 0.76, 0.67, 0.55] },
  },

  // Quick-buy key bindings (number keys 1-3)
  QUICKBUY_STATS: ['firepower', 'mobility', 'defense'],

  // ─── Abilities (purchasable + upgradeable, 3 levels) ────
  ABILITIES: {
    // Duration abilities (all 5s)
    berserk:    { name: 'Berserk',      key: 'Q', type: 'duration', maxLevel: 3, costs: [150, 250, 400],
      duration: 5000, damageMult: [1.3, 1.5, 1.75], fireRateMult: [0.75, 0.6, 0.45], cooldown: [20000, 16000, 12000] },
    speedBoost: { name: 'Speed Boost',  key: 'W', type: 'duration', maxLevel: 3, costs: [150, 250, 400],
      duration: 5000, speedMult: [1.4, 1.6, 1.85], cooldown: [18000, 14000, 10000] },
    vampire:    { name: 'Vampire',      key: 'E', type: 'duration', maxLevel: 3, costs: [200, 300, 450],
      duration: 5000, killCRMult: [2, 3, 4], healPercent: [0.15, 0.25, 0.40], cooldown: [25000, 20000, 15000] },
    hide:       { name: 'Hide',         key: 'R', type: 'duration', maxLevel: 3, costs: [200, 300, 450],
      duration: 5000, stealthZones: [1, 2, 3], cooldown: [22000, 17000, 12000] },
    shield:     { name: 'Shield',      key: 'F', type: 'duration', maxLevel: 3, costs: [200, 300, 450],
      duration: 5000, cooldown: [40000, 32000, 24000] },
    // Instant abilities
    regenBurst: { name: 'Regen Burst',  key: 'G', type: 'instant', maxLevel: 3, costs: [150, 250, 400],
      healAmount: [50, 80, 120], cooldown: [18000, 14000, 10000] },
    mine:       { name: 'Mine',         key: 'X', type: 'instant', maxLevel: 3, costs: [150, 250, 400],
      damage: [50, 75, 110], cooldown: [8000, 6000, 4000] },
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
