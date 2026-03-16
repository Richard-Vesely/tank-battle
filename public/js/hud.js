// HUD rendering
const HUD = (() => {
  let els = {};

  function init(elRefs) {
    els = elRefs;
  }

  function update(state, myId, currentMode) {
    if (!state || !state.players) return;
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    // HP
    if (els.hp) {
      const maxHp = me.maxHp || CONSTANTS.TANK_MAX_HP;
      const ratio = me.hp / maxHp;
      const color = ratio > 0.5 ? '#4CAF50' : ratio > 0.25 ? '#FF9800' : '#f44336';
      els.hp.innerHTML = `<span>HP</span>
        <div class="hp-bar-container"><div class="hp-bar-fill" style="width:${ratio*100}%;background:${color}"></div></div>
        <span>${Math.ceil(me.hp)}</span>`;
    }

    // Currency
    if (els.currency) els.currency.textContent = `${Shop.formatCost(me.currency || 0)} CR`;

    // Powerup
    if (els.powerup) {
      if (me.powerup) {
        const labels = { speed: 'SPEED', rapid: 'RAPID', shield: 'SHIELD' };
        els.powerup.textContent = labels[me.powerup] || '';
        els.powerup.style.display = 'block';
      } else {
        els.powerup.style.display = 'none';
      }
    }

    // Scores
    if (els.scores) {
      els.scores.innerHTML = state.players.map(p =>
        `<div class="score-entry">
          <div class="score-color" style="background:${CONSTANTS.TANK_COLORS[p.colorIndex] || '#888'}"></div>
          <span>${state.scores[p.id] || 0}</span>
        </div>`
      ).join('');
    }

    // Dom scores
    if (els.domScores) {
      if (currentMode === CONSTANTS.MODE_DOMINATION && state.domScores) {
        els.domScores.innerHTML = state.players.map(p =>
          `<span class="dom-entry">
            <span class="score-dot" style="background:${CONSTANTS.TANK_COLORS[p.colorIndex] || '#888'}"></span>
            ${Math.floor(state.domScores[p.id] || 0)}/${CONSTANTS.DOMINATION_WIN_SCORE}
          </span>`
        ).join('');
        els.domScores.style.display = 'flex';
      } else {
        els.domScores.style.display = 'none';
      }
    }

    // Lives (FFA)
    if (els.lives) {
      if (currentMode === CONSTANTS.MODE_FFA) {
        els.lives.textContent = `LIVES: ${me.lives}`;
        els.lives.style.display = 'block';
      } else {
        els.lives.style.display = 'none';
      }
    }

    // Abilities HUD
    if (els.abilities && me.abilities) {
      let abHtml = '';
      for (const [key, def] of Object.entries(CONSTANTS.ABILITIES)) {
        const lvl = me.abilities[key] || 0;
        if (lvl === 0) continue;
        const cd = (me.abilityCooldowns && me.abilityCooldowns[key]) || 0;
        const isActive = me.activeEffects && me.activeEffects.includes(key);
        const onCooldown = cd > 0;
        const cdText = onCooldown ? `${Math.ceil(cd / 1000)}s` : '';
        abHtml += `<span class="ability-icon ${isActive ? 'active' : ''} ${onCooldown ? 'cooldown' : ''}" title="${def.key}">
          ${def.key}:${def.name.substring(0, 4)} L${lvl}${cdText ? ' ' + cdText : ''}
        </span>`;
      }
      els.abilities.innerHTML = abHtml;
    }
  }

  return { init, update };
})();
