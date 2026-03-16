// Main game controller v3 — orchestration only
const Game = (() => {
  let myId = null;
  let currentRoom = null;
  let currentMode = null;
  let deathPenalty = null;
  let gameMap = null;
  let state = null;
  let explosions = [];
  let effects = [];
  let lastInputSent = 0;
  let lastInput = '';
  let selectedMode = CONSTANTS.MODE_DOMINATION;
  let selectedPenalty = CONSTANTS.DEATH_KEEP_UPGRADES;
  let selectedMapSize = 'small';

  let screens = {};

  function init() {
    Input.init();
    Network.init();

    screens = {
      lobby: document.getElementById('lobby-screen'),
      waiting: document.getElementById('waiting-screen'),
      game: document.getElementById('game-screen'),
      gameover: document.getElementById('gameover-screen')
    };

    const els = {
      hp: document.getElementById('hud-hp'),
      currency: document.getElementById('hud-currency'),
      powerup: document.getElementById('hud-powerup'),
      scores: document.getElementById('hud-scores'),
      lives: document.getElementById('hud-lives'),
      abilities: document.getElementById('hud-abilities'),
      domScores: document.getElementById('hud-dom-scores'),
      gameMsg: document.getElementById('game-message'),
      errorMsg: document.getElementById('error-message'),
      playerList: document.getElementById('player-list'),
      roomCodeDisplay: document.getElementById('room-code-display'),
      modeDisplay: document.getElementById('room-mode-display'),
      winnerText: document.getElementById('winner-text'),
      finalScores: document.getElementById('final-scores')
    };

    Lobby.init(screens, els);
    Shop.init(document.getElementById('upgrade-shop'), document.getElementById('shop-content'));
    Shop._getMe = () => state && state.players ? state.players.find(p => p.id === myId) : null;
    HUD.init({ hp: els.hp, currency: els.currency, powerup: els.powerup, scores: els.scores, lives: els.lives, abilities: els.abilities, domScores: els.domScores });
    Renderer.init(document.getElementById('game-canvas'));

    Lobby.setupLobbyUI({
      onModeSelect: (mode) => { selectedMode = mode; },
      onPenaltySelect: (penalty) => { selectedPenalty = penalty; },
      onMapSizeSelect: (size) => { selectedMapSize = size; },
      onPractice: (name) => {
        Network.emit('startPractice', { name, deathPenalty: selectedPenalty, mapSize: selectedMapSize });
      },
      onCreate: (name) => {
        Network.emit('createRoom', { name, mode: selectedMode, deathPenalty: selectedPenalty, mapSize: selectedMapSize });
      },
    });

    setupNetworkEvents(els);
    requestAnimationFrame(gameLoop);
  }

  function setupNetworkEvents(els) {
    Network.on('roomCreated', (data) => {
      myId = data.you;
      Lobby.setMyId(myId);
      currentRoom = data.code;
      currentMode = data.mode;
      deathPenalty = data.deathPenalty;
      els.roomCodeDisplay.textContent = data.code;
      els.modeDisplay.textContent = Lobby.getModeLabel(data.mode);
      Lobby.updatePlayerList(data.players);
      Lobby.showScreen('waiting');
    });

    Network.on('roomJoined', (data) => {
      myId = data.you;
      Lobby.setMyId(myId);
      currentRoom = data.code;
      currentMode = data.mode;
      deathPenalty = data.deathPenalty;
      els.roomCodeDisplay.textContent = data.code;
      els.modeDisplay.textContent = Lobby.getModeLabel(data.mode);
      Lobby.updatePlayerList(data.players);
      Lobby.showScreen('waiting');
    });

    Network.on('playerJoined', (data) => Lobby.updatePlayerList(data.players));
    Network.on('playerLeft', (data) => Lobby.updatePlayerList(data.players));
    Network.on('playerReady', (data) => Lobby.updatePlayerList(data.players));

    Network.on('gameStart', (data) => {
      gameMap = data.map;
      currentMode = data.mode;
      deathPenalty = data.deathPenalty;
      explosions = [];
      effects = [];
      Shop.close();
      if (data.mapWidth && data.mapHeight) {
        Renderer.setMapSize(data.mapWidth, data.mapHeight);
      }
      Lobby.showScreen('game');
      Lobby.showMessage('GO!', 1500);
    });

    Network.on('gameState', (data) => { state = data; });

    Network.on('tileDestroyed', (data) => {
      if (gameMap) gameMap[data.y][data.x] = CONSTANTS.TILE_EMPTY;
      effects.push({ type: 'explosion', x: data.x * CONSTANTS.TILE_SIZE + 16, y: data.y * CONSTANTS.TILE_SIZE + 16, startTime: Date.now(), duration: 300 });
    });

    Network.on('playerHit', (data) => {
      if (data.id === myId) Lobby.showMessage(`-${data.dmg} HP`, 800);
    });

    Network.on('playerKilled', (data) => {
      if (state && state.players) {
        const killed = state.players.find(p => p.id === data.id);
        if (killed) {
          explosions.push({ x: killed.x, y: killed.y, startTime: Date.now(), duration: 800 });
        }
      }
      if (data.id === myId) Lobby.showMessage('DESTROYED!', 2000);
    });

    Network.on('currencyEarned', (data) => {
      if (data.id === myId) Lobby.showMessage(`+${data.amount} CREDITS`, 1500);
    });

    Network.on('upgradeSuccess', (data) => {
      const label = data.type === 'stat'
        ? CONSTANTS.STATS[data.key].name
        : CONSTANTS.ABILITIES[data.key].name;
      Lobby.showMessage(`${label} LVL ${data.level}`, 1500);
      if (state && state.players) {
        const me = state.players.find(p => p.id === myId);
        if (me) {
          me.currency = data.currency;
          me.stats = data.stats;
          me.abilities = data.abilities;
        }
      }
      if (Shop.isOpen()) Shop.render();
    });

    Network.on('powerupCollected', (data) => {
      if (data.id === myId) {
        const labels = { speed: 'SPEED BOOST!', rapid: 'RAPID FIRE!', shield: 'SHIELD!', heal: 'HEALTH+' };
        Lobby.showMessage(labels[data.type] || 'POWER UP!', 1500);
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
        if (data.id === myId) Lobby.showMessage('REGEN!', 500);
      }
      if (data.id === myId) {
        const durationNames = { berserk: 'BERSERK!', speedBoost: 'SPEED BOOST!', vampire: 'VAMPIRE!', hide: 'STEALTH!', shield: 'SHIELD!' };
        if (durationNames[data.ability]) Lobby.showMessage(durationNames[data.ability], 800);
      }
    });

    Network.on('vampireProc', (data) => {
      if (data.id === myId) Lobby.showMessage(`VAMPIRE: ${data.earnedCR} CR, +${data.heal} HP`, 1500);
    });

    Network.on('mineExploded', (data) => {
      effects.push({ type: 'explosion', x: data.x, y: data.y, startTime: Date.now(), duration: 600 });
    });

    Network.on('creditCollected', (data) => {
      if (data.id === myId) Lobby.showMessage(`+${data.value} CR`, 1000);
    });

    Network.on('zoneCaptured', (data) => {
      Lobby.showMessage(`ZONE ${data.label} CAPTURED!`, 2000);
    });

    Network.on('gameOver', (data) => {
      els.winnerText.textContent = data.winnerId === myId ? 'YOU WIN!' : `${data.winnerName} WINS!`;
      let html = '';
      if (state && state.players) {
        state.players.forEach(p => {
          const kills = data.scores[p.id] || 0;
          const domPts = data.domScores ? Math.floor(data.domScores[p.id] || 0) : 0;
          html += `<div class="final-score-entry">
            <span>${Lobby.escapeHtml(p.name)}</span>
            <span>${kills} kills${currentMode === CONSTANTS.MODE_DOMINATION ? ` / ${domPts} pts` : ''}</span>
          </div>`;
        });
      }
      els.finalScores.innerHTML = html;
      Lobby.showScreen('gameover');
    });

    Network.on('returnToLobby', (data) => {
      Lobby.updatePlayerList(data.players);
      Lobby.showScreen('waiting');
    });

    Network.on('error', (data) => Lobby.showError(data.message));
  }

  // ─── Game Loop ──────────────────────────────────────────────
  function gameLoop() {
    requestAnimationFrame(gameLoop);
    if (!screens.game.classList.contains('active') || !gameMap) return;

    const now = Date.now();
    const input = Input.getInput();

    if (Input.isJustPressed('Escape')) { location.reload(); return; }
    if (Input.isJustPressed('Tab')) Shop.toggle();

    for (let i = 0; i < CONSTANTS.QUICKBUY_STATS.length; i++) {
      if (Input.isJustPressed(`Digit${i + 1}`)) {
        Network.emit('purchase', { type: 'stat', key: CONSTANTS.QUICKBUY_STATS[i] });
      }
    }

    if (Input.isKeyDown('ShiftLeft') || Input.isKeyDown('ShiftRight')) {
      for (const [key, def] of Object.entries(CONSTANTS.ABILITIES)) {
        if (Input.isJustPressed('Key' + def.key)) {
          Network.emit('purchase', { type: 'ability', key });
        }
      }
    }

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

    Renderer.clear();
    Renderer.drawMap(gameMap);

    if (state.captureZones) state.captureZones.forEach(z => Renderer.drawCaptureZone(z, state.players));
    if (state.powerups) state.powerups.forEach(pu => Renderer.drawPowerup(pu.x, pu.y, pu.type));
    if (state.mines) state.mines.forEach(m => Renderer.drawMine(m.x, m.y, m.owner === myId));
    if (state.creditPickups) state.creditPickups.forEach(c => Renderer.drawCreditPickup(c.x, c.y, c.value));
    if (state.players) state.players.forEach(p => Renderer.drawTank(p.x, p.y, p.angle, p.colorIndex, p.hp, p.maxHp, p.alive, p.name, p.shieldActive, p.activeEffects));
    if (state.bullets) state.bullets.forEach(b => Renderer.drawBullet(b.x, b.y));

    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      const progress = (now - e.startTime) / e.duration;
      if (progress >= 1) { explosions.splice(i, 1); continue; }
      Renderer.drawDeathExplosion(e.x, e.y, progress);
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const progress = (now - e.startTime) / e.duration;
      if (progress >= 1) { effects.splice(i, 1); continue; }
      if (e.type === 'regenBurst') Renderer.drawRegenBurst(e.x, e.y, progress);
      else Renderer.drawDeathExplosion(e.x, e.y, progress);
    }

    HUD.update(state, myId, currentMode);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
