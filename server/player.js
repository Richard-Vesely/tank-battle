const C = require('../shared/constants');

function createPlayer(name, colorIndex) {
  return {
    name: (name || 'Player').substring(0, 16),
    colorIndex,
    color: C.TANK_COLORS[colorIndex],
    ready: false,
    x: 0, y: 0, angle: 0,
    hp: C.TANK_MAX_HP,
    maxHp: C.TANK_MAX_HP,
    alive: false,
    input: {},
    lastFire: 0,
    powerup: null,
    powerupTimer: 0,
    shieldActive: false,
    lives: C.FFA_LIVES,
    respawnTimer: 0,
    currency: 0,
    stats: {},
    abilities: {},
    abilityCooldowns: {},
    activeEffects: {},
  };
}

function getStatLevel(player, key) {
  return player.stats[key] || 0;
}

function getAbilityLevel(player, key) {
  return player.abilities[key] || 0;
}

function hasAbility(player, key) {
  return getAbilityLevel(player, key) > 0;
}

function getPlayerDamage(player) {
  const lvl = getStatLevel(player, 'firepower');
  let dmg = C.getStatValue('firepower', 'damage', lvl);
  if (player.activeEffects.berserk) {
    const aLvl = getAbilityLevel(player, 'berserk');
    dmg *= C.getAbilityValue('berserk', 'damageMult', aLvl);
  }
  return Math.round(dmg);
}

function getPlayerFireCooldown(player) {
  const lvl = getStatLevel(player, 'firepower');
  if (player.powerup === C.POWERUP_RAPID) return C.RAPID_FIRE_COOLDOWN;
  let cd = C.getStatValue('firepower', 'fireCooldown', lvl);
  if (player.activeEffects.berserk) {
    const aLvl = getAbilityLevel(player, 'berserk');
    cd *= C.getAbilityValue('berserk', 'fireRateMult', aLvl);
  }
  return Math.max(100, Math.round(cd));
}

function getPlayerBulletSpeed(player) {
  const lvl = getStatLevel(player, 'firepower');
  return C.getStatValue('firepower', 'bulletSpeed', lvl);
}

function getPlayerSpeed(player) {
  const lvl = getStatLevel(player, 'mobility');
  let spd = C.getStatValue('mobility', 'moveSpeed', lvl);
  if (player.activeEffects.speedBoost) {
    const aLvl = getAbilityLevel(player, 'speedBoost');
    spd *= C.getAbilityValue('speedBoost', 'speedMult', aLvl);
  }
  if (player.powerup === C.POWERUP_SPEED) spd *= C.SPEED_BOOST;
  return spd;
}

function getPlayerRotation(player) {
  const lvl = getStatLevel(player, 'mobility');
  return C.getStatValue('mobility', 'rotationSpeed', lvl);
}

function getPlayerMaxHp(player) {
  const lvl = getStatLevel(player, 'defense');
  return Math.round(C.getStatValue('defense', 'maxHp', lvl));
}

function getPlayerArmor(player) {
  const lvl = getStatLevel(player, 'defense');
  return C.getStatValue('defense', 'armor', lvl);
}

function getCoinBoostMult(player) {
  const lvl = getStatLevel(player, 'coinBoost');
  if (lvl <= 0) return 1;
  return 1 + lvl * 0.10;
}

function getRegenRate(player) {
  const lvl = getStatLevel(player, 'regeneration');
  return lvl * 0.5; // hp per second
}

function getCooldownReduction(player) {
  const lvl = getStatLevel(player, 'fasterCooldown');
  return lvl * 1000; // ms reduction
}

module.exports = {
  createPlayer,
  getStatLevel, getAbilityLevel, hasAbility,
  getPlayerDamage, getPlayerFireCooldown, getPlayerBulletSpeed,
  getPlayerSpeed, getPlayerRotation, getPlayerMaxHp, getPlayerArmor,
  getCoinBoostMult, getRegenRate, getCooldownReduction,
};
