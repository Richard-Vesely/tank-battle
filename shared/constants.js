// Shared constants between server and client
const CONSTANTS = {
  // Tile size in pixels
  TILE_SIZE: 32,

  // Map dimensions (in tiles)
  MAP_WIDTH: 30,
  MAP_HEIGHT: 20,

  // Tile types
  TILE_EMPTY: 0,
  TILE_WALL: 1,        // Indestructible border/wall
  TILE_BRICK: 2,       // Destructible brick
  TILE_STEEL: 3,       // Indestructible steel block

  // Tank properties
  TANK_SIZE: 24,
  TANK_SPEED: 120,           // pixels per second
  TANK_ROTATION_SPEED: 180,  // degrees per second
  TANK_MAX_HP: 100,
  TANK_COLORS: ['#4CAF50', '#2196F3', '#FF9800', '#E91E63'],
  TANK_NAMES: ['Green', 'Blue', 'Orange', 'Pink'],

  // Bullet properties
  BULLET_SPEED: 250,    // pixels per second
  BULLET_SIZE: 4,
  BULLET_DAMAGE: 25,
  BULLET_MAX_RICOCHETS: 1,
  FIRE_COOLDOWN: 500,   // ms between shots

  // Power-up types
  POWERUP_SPEED: 'speed',
  POWERUP_RAPID: 'rapid',
  POWERUP_SHIELD: 'shield',
  POWERUP_HEAL: 'heal',

  // Power-up properties
  POWERUP_SIZE: 20,
  POWERUP_DURATION: 8000,   // ms
  POWERUP_SPAWN_INTERVAL: 10000, // ms
  POWERUP_MAX_ON_MAP: 3,

  // Speed boost multiplier
  SPEED_BOOST: 1.6,
  // Rapid fire cooldown
  RAPID_FIRE_COOLDOWN: 200,

  // Game settings
  TICK_RATE: 60,            // server ticks per second
  BROADCAST_RATE: 20,       // state broadcasts per second
  RESPAWN_TIME: 3000,       // ms
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,

  // Match settings
  MODE_FFA: 'ffa',           // free-for-all last man standing
  MODE_ROUNDS: 'rounds',     // round-based with score
  ROUNDS_TO_WIN: 5,          // kills to win in rounds mode
  FFA_LIVES: 3,              // lives in FFA mode

  // Spawn points (tile coordinates)
  SPAWN_POINTS: [
    { x: 2, y: 2 },
    { x: 27, y: 17 },
    { x: 27, y: 2 },
    { x: 2, y: 17 }
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONSTANTS;
}
