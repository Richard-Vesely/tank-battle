// Main game controller v3 — unlimited scaling, dynamic map sizes
const Game = (() => {
  let myId = null;
  let currentRoom = null;
  let currentMode = null;
  let deathPenalty = null;
  let gameMap = null;
  let state = null;
  let explosions = [];
  let effects = [];
  let shopOpen = false;
  let lastInputSent = 0;
  let lastInput = '';
  let selectedMode = CONSTANTS.MODE_DOMINATION;
  let selectedPenalty = CONSTANTS.DEATH_KEEP_UPGRADES;
  let selectedMapSize = 'small';

  // DOM refs
  let screens = {};
  let els = {};

  function init() {
    Input.init();
    Network.init();

    screens = {
      lobby: document.getElementById('lobby-screen'),
      waiting: document.getElementById('waiting-screen'),
      game: document.getElementById('game-screen'),
      gameover: document.getElementById('gameover-screen')
    };

    els = {
      hp: document.getElementById('hud-hp'),
      currency: document.getElementById('hud-currency'),
      powerup: document.getElementById('hud-powerup'),
      scores: document.getElementById('hud-scores'),
      lives: document.getElementById('hud-lives'),
      abilities: document.getElementById('hud-abilities'),
      domScores: document.getElementById('hud-dom-scores'),
      gameMsg: document.getElementById('game-message'),
      shop: document.getElementById('upgrade-shop'),
      shopContent: document.getElementById('shop-content'),
      errorMsg: document.getElementById('error-message'),
      playerList: document.getElementById('player-list'),
      roomCodeDisplay: document.getElementById('room-code-display'),
      modeDisplay: document.getElementById('room-mode-display'),
      winnerText: document.getElementById('winner-text'),
      finalScores: document.getElementById('final-scores')
    };

    Renderer.init(document.getElementById('game-canvas'));
    setupLobbyUI();
    setupNetworkEvents();
    requestAnimationFrame(gameLoop);
  }

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function showMessage(text, duration) {
    if (!els.gameMsg) return;
    els.gameMsg.textContent = text;
    els.gameMsg.classList.add('visible');
    setTimeout(() => els.gameMsg.classList.remove('visible'), duration || 2000);
  }

  function showError(msg) {
    if (!els.errorMsg) return;
    els.errorMsg.textContent = msg;
    setTimeout(() => els.errorMsg.textContent = '', 3000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Lobby ──────────────────────────────────────────────────
  function setupLobbyUI() {
    const nameInput = document.getElementById('player-name');

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedMode = btn.dataset.mode;
      });
    });

    document.querySelectorAll('.penalty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.penalty-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedPenalty = btn.dataset.penalty;
      });
    });

    document.querySelectorAll('.mapsize-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mapsize-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedMapSize = btn.dataset.mapsize;
      });
    });

    document.getElementById('btn-quickplay').addEventListener('click', () => {
      Network.emit('quickPlay', { name: nameInput.value || 'Player' });
    });

    document.getElementById('btn-practice').addEventListener('click', () => {
      Network.emit('startPractice', { name: nameInput.value || 'Player', deathPenalty: selectedPenalty, mapSize: selectedMapSize });
    });

    document.getElementById('btn-create').addEventListener('click', () => {
      Network.emit('createRoom', { name: nameInput.value || 'Player', mode: selectedMode, deathPenalty: selectedPenalty, mapSize: selectedMapSize });
    });

    document.getElementById('btn-join').addEventListener('click', () => {
      const code = document.getElementById('room-code-input').value.toUpperCase();
      if (code.length !== 4) { showError('Enter 4-letter room code'); return; }
      Network.emit('joinRoom', { name: nameInput.value || 'Player', code });
    });

    document.getElementById('room-code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-join').click();
    });

    document.getElementById('btn-ready').addEventListener('click', () => Network.emit('toggleReady'));
    document.getElementById('btn-leave').addEventListener('click', () => location.reload());
  }

  function updatePlayerList(players) {
    if (!els.playerList) return;
    els.playerList.innerHTML = players.map(p =>
      `<div class="player-entry">
        <div class="player-color" style="background:${CONSTANTS.TANK_COLORS[p.colorIndex] || '#888'}"></div>
        <span class="player-name">${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>
        <span class="${p.ready ? 'player-ready' : 'player-waiting'}">${p.ready ? 'READY' : 'NOT READY'}</span>
      </div>`
    ).join('');
  }

  // ─── Network Events ─────────────────────────────────────────
  function setupNetworkEvents() {
    Network.on('roomCreated', (data) => {
      myId = data.you;
      currentRoom = data.code;
      currentMode = data.mode;
      deathPenalty = data.deathPenalty;
      els.roomCodeDisplay.textContent = data.code;
      els.modeDisplay.textContent = getModeLabel(data.mode);
      updatePlayerList(data.players);
      showScreen('waiting');
    });

    Network.on('roomJoined', (data) => {
      myId = data.you;
      currentRoom = data.code;
      currentMode = data.mode;
      deathPenalty = data.deathPenalty;
      els.roomCodeDisplay.textContent = data.code;
      els.modeDisplay.textContent = getModeLabel(data.mode);
      updatePlayerList(data.players);
      showScreen('waiting');
    });

    Network.on('playerJoined', (data) => updatePlayerList(data.players));
    Network.on('playerLeft', (data) => updatePlayerList(data.players));
    Network.on('playerReady', (data) => updatePlayerList(data.players));

    Network.on('gameStart', (data) => {
      gameMap = data.map;
      currentMode = data.mode;
      deathPenalty = data.deathPenalty;
      explosions = [];
      effects = [];
      shopOpen = false;
      if (els.shop) els.shop.classList.remove('show');
      // Set dynamic map size for renderer
      if (data.mapWidth && data.mapHeight) {
        Renderer.setMapSize(data.mapWidth, data.mapHeight);
      }
      showScreen('game');
      showMessage('GO!', 1500);
    });

    Network.on('gameState', (data) => { state = data; });

    Network.on('tileDestroyed', (data) => {
      if (gameMap) gameMap[data.y][data.x] = CONSTANTS.TILE_EMPTY;
      effects.push({ type: 'explosion', x: data.x * CONSTANTS.TILE_SIZE + 16, y: data.y * CONSTANTS.TILE_SIZE + 16, startTime: Date.now(), duration: 300 });
    });

    Network.on('playerHit', (data) => {
      if (data.id === myId) showMessage(`-${data.dmg} HP`, 800);
    });

    Network.on('playerKilled', (data) => {
      if (state && state.players) {
        const killed = state.players.find(p => p.id === data.id);
        if (killed) {
          explosions.push({ x: killed.x, y: killed.y, startTime: Date.now(), duration: 800 });
        }
      }
      if (data.id === myId) showMessage('DESTROYED!', 2000);
    });

    Network.on('currencyEarned', (data) => {
      if (data.id === myId) showMessage(`+${data.amount} CREDITS`, 1500);
    });

    Network.on('upgradeSuccess', (data) => {
      const label = data.type === 'stat'
        ? CONSTANTS.STATS[data.key].name
        : CONSTANTS.ABILITIES[data.key].name;
      showMessage(`${label} LVL ${data.level}`, 1500);
      if (state && state.players) {
        const me = state.players.find(p => p.id === myId);
        if (me) {
          me.currency = data.currency;
          me.stats = data.stats;
          me.abilities = data.abilities;
        }
      }
      if (shopOpen) renderShop();
    });

    Network.on('powerupCollected', (data) => {
      if (data.id === myId) {
        const labels = { speed: 'SPEED BOOST!', rapid: 'RAPID FIRE!', shield: 'SHIELD!', heal: 'HEALTH+' };
        showMessage(labels[data.type] || 'POWER UP!', 1500);
      }
    });

    Network.on('shieldBreak', (data) => {
      if (state && state.players) {
        const p = state.players.find(pl => pl.id === data.id);
        if (p) effects.push({ type: 'explosion', x: p.x, y: p.y, startTime: Date.now(), duration: 400 });
      }
    });

    Network.on('abilityUsed', (data) => {
      if (data.ability === 'regenBurst') {
        effects.push({ type: 'regenBurst', x: data.x, y: data.y, startTime: Date.now(), duration: 600 });
        if (data.id === myId) showMessage('REGEN!', 500);
      }
      if (data.id === myId) {
        const durationNames = { berserk: 'BERSERK!', speedBoost: 'SPEED BOOST!', vampire: 'VAMPIRE!', hide: 'STEALTH!', shield: 'SHIELD!' };
        if (durationNames[data.ability]) showMessage(durationNames[data.ability], 800);
      }
    });

    Network.on('vampireProc', (data) => {
      if (data.id === myId) showMessage(`VAMPIRE: ${data.earnedCR} CR, +${data.heal} HP`, 1500);
    });

    Network.on('mineExploded', (data) => {
      effects.push({ type: 'explosion', x: data.x, y: data.y, startTime: Date.now(), duration: 600 });
    });

    Network.on('creditCollected', (data) => {
      if (data.id === myId) showMessage(`+${data.value} CR`, 1000);
    });

    Network.on('zoneCaptured', (data) => {
      showMessage(`ZONE ${data.label} CAPTURED!`, 2000);
    });

    Network.on('gameOver', (data) => {
      els.winnerText.textContent = data.winnerId === myId ? 'YOU WIN!' : `${data.winnerName} WINS!`;
      let html = '';
      if (state && state.players) {
        state.players.forEach(p => {
          const kills = data.scores[p.id] || 0;
          const domPts = data.domScores ? Math.floor(data.domScores[p.id] || 0) : 0;
          html += `<div class="final-score-entry">
            <span>${escapeHtml(p.name)}</span>
            <span>${kills} kills${currentMode === CONSTANTS.MODE_DOMINATION ? ` / ${domPts} pts` : ''}</span>
          </div>`;
        });
      }
      els.finalScores.innerHTML = html;
      showScreen('gameover');
    });

    Network.on('returnToLobby', (data) => {
      updatePlayerList(data.players);
      showScreen('waiting');
    });

    Network.on('error', (data) => showError(data.message));
  }

  function getModeLabel(mode) {
    if (mode === CONSTANTS.MODE_FFA) return 'Free For All';
    if (mode === CONSTANTS.MODE_ROUNDS) return 'Rounds';
    if (mode === CONSTANTS.MODE_DOMINATION) return 'Domination';
    return mode;
  }

  // ─── Upgrade Shop (formula-based, unlimited levels) ────────
  function toggleShop() {
    shopOpen = !shopOpen;
    if (els.shop) els.shop.classList.toggle('show', shopOpen);
    if (shopOpen) renderShop();
  }

  function formatCost(cost) {
    if (cost >= 1000000) return (cost / 1000000).toFixed(1) + 'M';
    if (cost >= 1000) return (cost / 1000).toFixed(1) + 'K';
    return cost;
  }

  function renderShop() {
    if (!state || !els.shopContent) return;
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    const myCurrency = me.currency || 0;
    let html = `<div class="shop-header">SHOP <span class="shop-currency">${formatCost(myCurrency)} CR</span></div>`;

    // ─── STATS section ─────
    html += '<div class="shop-section-title">STATS</div>';
    const statKeys = CONSTANTS.QUICKBUY_STATS;
    statKeys.forEach((key, idx) => {
      const def = CONSTANTS.STATS[key];
      const lvl = (me.stats && me.stats[key]) || 0;
      const cost = CONSTANTS.getStatCost(key, lvl);
      const canBuy = myCurrency >= cost;

      html += `<div class="shop-item ${canBuy ? 'buyable' : ''}" data-type="stat" data-key="${key}">
        <span class="shop-item-name">${def.name}</span>
        <span class="shop-item-level">LVL ${lvl}</span>
        <span class="shop-item-cost">${formatCost(cost)} CR</span>
        <span class="shop-hotkey">[${idx + 1}]</span>
      </div>`;
    });

    // ─── ABILITIES section ─────
    html += '<div class="shop-section-title">ABILITIES</div>';
    for (const [key, def] of Object.entries(CONSTANTS.ABILITIES)) {
      const lvl = (me.abilities && me.abilities[key]) || 0;
      const cost = CONSTANTS.getAbilityCost(key, lvl);
      const canBuy = myCurrency >= cost;
      const label = lvl === 0 ? 'BUY' : 'UPG';

      html += `<div class="shop-item ${canBuy ? 'buyable' : ''}" data-type="ability" data-key="${key}">
        <span class="shop-item-name">[${def.key}] ${def.name}</span>
        <span class="shop-item-level">LVL ${lvl}</span>
        <span class="shop-item-cost">${formatCost(cost)} CR</span>
        <span class="shop-item-label">${label}</span>
      </div>`;
    }

    els.shopContent.innerHTML = html;

    els.shopContent.querySelectorAll('.shop-item.buyable').forEach(el => {
      el.addEventListener('click', () => {
        Network.emit('purchase', { type: el.dataset.type, key: el.dataset.key });
      });
    });
  }

  // ─── HUD ────────────────────────────────────────────────────
  function updateHUD() {
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
    if (els.currency) els.currency.textContent = `${formatCost(me.currency || 0)} CR`;

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

  // ─── Game Loop ──────────────────────────────────────────────
  function gameLoop() {
    requestAnimationFrame(gameLoop);
    if (!screens.game.classList.contains('active') || !gameMap) return;

    const now = Date.now();
    const input = Input.getInput();

    // Escape to leave game
    if (Input.isJustPressed('Escape')) {
      location.reload();
      return;
    }

    // Shop toggle (Tab)
    if (Input.isJustPressed('Tab')) toggleShop();

    // Quick-buy keys 1-3 for stats
    for (let i = 0; i < CONSTANTS.QUICKBUY_STATS.length; i++) {
      if (Input.isJustPressed(`Digit${i + 1}`)) {
        Network.emit('purchase', { type: 'stat', key: CONSTANTS.QUICKBUY_STATS[i] });
      }
    }

    // Shift + ability key to buy/upgrade abilities
    if (Input.isKeyDown('ShiftLeft') || Input.isKeyDown('ShiftRight')) {
      for (const [key, def] of Object.entries(CONSTANTS.ABILITIES)) {
        if (Input.isJustPressed('Key' + def.key)) {
          Network.emit('purchase', { type: 'ability', key });
        }
      }
    }

    // Send input (throttled)
    if (now - lastInputSent > 33) {
      const inputStr = JSON.stringify(input);
      if (inputStr !== lastInput) {
        Network.emit('input', input);
        lastInput = inputStr;
        lastInputSent = now;
      }
    }

    Input.clearJustPressed();

    if (!state) return;

    // Render
    Renderer.clear();
    Renderer.drawMap(gameMap);

    // Capture zones
    if (state.captureZones) {
      state.captureZones.forEach(z => Renderer.drawCaptureZone(z, state.players));
    }

    // Powerups
    if (state.powerups) {
      state.powerups.forEach(pu => Renderer.drawPowerup(pu.x, pu.y, pu.type));
    }

    // Mines
    if (state.mines) {
      state.mines.forEach(m => Renderer.drawMine(m.x, m.y, m.owner === myId));
    }

    // Credit pickups
    if (state.creditPickups) {
      state.creditPickups.forEach(c => Renderer.drawCreditPickup(c.x, c.y, c.value));
    }

    // Tanks
    if (state.players) {
      state.players.forEach(p => {
        Renderer.drawTank(p.x, p.y, p.angle, p.colorIndex, p.hp, p.maxHp, p.alive, p.name, p.shieldActive, p.activeEffects);
      });
    }

    // Bullets
    if (state.bullets) {
      state.bullets.forEach(b => Renderer.drawBullet(b.x, b.y));
    }

    // Explosions
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      const progress = (now - e.startTime) / e.duration;
      if (progress >= 1) { explosions.splice(i, 1); continue; }
      Renderer.drawDeathExplosion(e.x, e.y, progress);
    }

    // Effects
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const progress = (now - e.startTime) / e.duration;
      if (progress >= 1) { effects.splice(i, 1); continue; }
      if (e.type === 'regenBurst') Renderer.drawRegenBurst(e.x, e.y, progress);
      else Renderer.drawDeathExplosion(e.x, e.y, progress);
    }

    updateHUD();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
