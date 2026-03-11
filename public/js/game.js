// Main game controller v2 — upgrade shop, fog of war, abilities, domination
const Game = (() => {
  let myId = null;
  let currentRoom = null;
  let currentMode = null;
  let deathPenalty = null;
  let gameMap = null;
  let state = null;
  let explosions = [];
  let effects = []; // { type, x, y, startTime, duration }
  let shopOpen = false;
  let lastInputSent = 0;
  let lastInput = '';
  let selectedMode = CONSTANTS.MODE_DOMINATION;
  let selectedPenalty = CONSTANTS.DEATH_KEEP_UPGRADES;

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

    document.getElementById('btn-quickplay').addEventListener('click', () => {
      Network.emit('quickPlay', { name: nameInput.value || 'Player' });
    });

    document.getElementById('btn-practice').addEventListener('click', () => {
      Network.emit('startPractice', { name: nameInput.value || 'Player' });
    });

    document.getElementById('btn-create').addEventListener('click', () => {
      Network.emit('createRoom', { name: nameInput.value || 'Player', mode: selectedMode, deathPenalty: selectedPenalty });
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
        <div class="player-color" style="background:${CONSTANTS.TANK_COLORS[p.colorIndex]}"></div>
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
        if (killed && killed.visible !== false) {
          explosions.push({ x: killed.x, y: killed.y, startTime: Date.now(), duration: 800 });
        }
      }
      if (data.id === myId) showMessage('DESTROYED!', 2000);
    });

    Network.on('currencyEarned', (data) => {
      if (data.id === myId) showMessage(`+${data.amount} CREDITS`, 1500);
    });

    Network.on('upgradeSuccess', (data) => {
      showMessage(`${CONSTANTS.UPGRADES[data.key].name} LVL ${data.level}`, 1500);
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
        if (p && p.visible !== false) effects.push({ type: 'explosion', x: p.x, y: p.y, startTime: Date.now(), duration: 400 });
      }
    });

    Network.on('abilityUsed', (data) => {
      if (data.ability === 'emp') effects.push({ type: 'emp', x: data.x, y: data.y, startTime: Date.now(), duration: 600 });
      if (data.ability === 'teleport') effects.push({ type: 'teleport', x: data.x, y: data.y, startTime: Date.now(), duration: 500 });
      if (data.ability === 'dash' && data.id === myId) showMessage('DASH!', 500);
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

  // ─── Upgrade Shop ──────────────────────────────────────────
  function toggleShop() {
    shopOpen = !shopOpen;
    if (els.shop) els.shop.classList.toggle('show', shopOpen);
    if (shopOpen) renderShop();
  }

  function renderShop() {
    if (!state || !els.shopContent) return;
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    const categories = ['firepower', 'mobility', 'defense', 'utility'];
    const catLabels = { firepower: 'FIREPOWER', mobility: 'MOBILITY', defense: 'DEFENSE', utility: 'UTILITY' };

    let html = `<div class="shop-header">UPGRADES <span class="shop-currency">${me.currency || 0} CR</span></div>`;

    categories.forEach(cat => {
      html += `<div class="shop-category"><div class="shop-cat-title">${catLabels[cat]}</div>`;
      const quickSlots = CONSTANTS.QUICKBUY_SLOTS;
      for (const [key, def] of Object.entries(CONSTANTS.UPGRADES)) {
        if (def.category !== cat) continue;
        const lvl = (me.upgrades && me.upgrades[key]) || 0;
        const maxed = lvl >= def.maxLevel;
        const cost = maxed ? '-' : def.costs[lvl];
        const canBuy = !maxed && (me.currency || 0) >= cost;
        const qIdx = quickSlots.indexOf(key);
        const hotkey = qIdx >= 0 ? `[${qIdx + 1}]` : '';

        html += `<div class="shop-item ${canBuy ? 'buyable' : ''} ${maxed ? 'maxed' : ''}" data-key="${key}">
          <span class="shop-item-name">${def.name}</span>
          <span class="shop-item-level">${'\u25A0'.repeat(lvl)}${'\u25A1'.repeat(def.maxLevel - lvl)}</span>
          <span class="shop-item-cost">${maxed ? 'MAX' : cost + ' CR'}</span>
          ${hotkey ? `<span class="shop-hotkey">${hotkey}</span>` : ''}
        </div>`;
      }
      html += '</div>';
    });

    els.shopContent.innerHTML = html;

    els.shopContent.querySelectorAll('.shop-item.buyable').forEach(el => {
      el.addEventListener('click', () => Network.emit('purchaseUpgrade', { key: el.dataset.key }));
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
    if (els.currency) els.currency.textContent = `${me.currency || 0} CR`;

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
          <div class="score-color" style="background:${CONSTANTS.TANK_COLORS[p.colorIndex]}"></div>
          <span>${state.scores[p.id] || 0}</span>
        </div>`
      ).join('');
    }

    // Dom scores
    if (els.domScores) {
      if (currentMode === CONSTANTS.MODE_DOMINATION && state.domScores) {
        els.domScores.innerHTML = state.players.map(p =>
          `<span class="dom-entry">
            <span class="score-dot" style="background:${CONSTANTS.TANK_COLORS[p.colorIndex]}"></span>
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

    // Abilities
    if (els.abilities && me.upgrades) {
      let abHtml = '';
      if (me.upgrades.dash) abHtml += '<span class="ability-icon" title="Shift">DASH</span>';
      if (me.upgrades.teleport) abHtml += '<span class="ability-icon" title="T">TELE</span>';
      if (me.upgrades.emp) abHtml += '<span class="ability-icon" title="E">EMP</span>';
      if (me.upgrades.smoke) abHtml += '<span class="ability-icon" title="Q">SMK</span>';
      if (me.upgrades.mine) abHtml += '<span class="ability-icon" title="X">MINE</span>';
      els.abilities.innerHTML = abHtml;
    }
  }

  // ─── Game Loop ──────────────────────────────────────────────
  function gameLoop() {
    requestAnimationFrame(gameLoop);
    if (!screens.game.classList.contains('active') || !gameMap) return;

    const now = Date.now();
    const input = Input.getInput();

    // Escape to leave game (returns to lobby)
    if (Input.isJustPressed('Escape')) {
      location.reload();
      return;
    }

    // Shop toggle (Tab)
    if (Input.isJustPressed('Tab')) toggleShop();

    // Quick-buy keys 1-9
    for (let i = 0; i < CONSTANTS.QUICKBUY_SLOTS.length; i++) {
      if (Input.isJustPressed(`Digit${i + 1}`)) {
        Network.emit('purchaseUpgrade', { key: CONSTANTS.QUICKBUY_SLOTS[i] });
      }
    }

    // Send input (throttled) — always send, even when shop is open
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

    // Smokes
    if (state.smokes) {
      state.smokes.forEach(s => Renderer.drawSmoke(s.x, s.y, s.radius || CONSTANTS.SMOKE_RADIUS));
    }

    // Credit pickups
    if (state.creditPickups) {
      state.creditPickups.forEach(c => Renderer.drawCreditPickup(c.x, c.y, c.value));
    }

    // Tanks
    if (state.players) {
      state.players.forEach(p => {
        if (p.visible === false) return;
        Renderer.drawTank(p.x, p.y, p.angle, p.colorIndex, p.hp, p.maxHp, p.alive, p.name, p.shieldActive, p.empDisabled, p.upgrades);
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
      if (e.type === 'emp') Renderer.drawEMPBlast(e.x, e.y, progress);
      else if (e.type === 'teleport') Renderer.drawTeleportEffect(e.x, e.y, progress);
      else Renderer.drawDeathExplosion(e.x, e.y, progress);
    }

    // Fog of War (drawn last, on top of everything)
    if (state.fogCenter) {
      Renderer.drawFogOfWar(state.fogCenter.x, state.fogCenter.y, state.visionZones);
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
