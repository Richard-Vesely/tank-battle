// Main game controller
const Game = (() => {
  let myId = null;
  let currentRoom = null;
  let currentMode = 'ffa';
  let gameMap = null;
  let selectedMode = 'ffa';

  // Game state from server
  let state = { players: [], bullets: [], powerups: [], scores: {} };

  // Visual effects
  const explosions = []; // { x, y, startTime, duration }
  const messages = [];   // { text, endTime }

  // Input throttling
  let lastInputSent = 0;
  let lastInput = null;

  // ─── DOM References ──────────────────────────────────────────
  const screens = {
    lobby: document.getElementById('lobby-screen'),
    waiting: document.getElementById('waiting-screen'),
    game: document.getElementById('game-screen'),
    gameover: document.getElementById('gameover-screen')
  };

  const elements = {
    playerName: document.getElementById('player-name'),
    roomCode: document.getElementById('room-code'),
    roomCodeDisplay: document.getElementById('room-code-display'),
    modeDisplay: document.getElementById('mode-display'),
    playerList: document.getElementById('player-list'),
    errorMessage: document.getElementById('error-message'),
    gameMessage: document.getElementById('game-message'),
    winnerText: document.getElementById('winner-text'),
    finalScores: document.getElementById('final-scores'),
    hudHp: document.getElementById('hud-hp'),
    hudPowerup: document.getElementById('hud-powerup'),
    hudScores: document.getElementById('hud-scores'),
    hudLives: document.getElementById('hud-lives')
  };

  // ─── Screen Management ───────────────────────────────────────
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function showError(msg) {
    elements.errorMessage.textContent = msg;
    setTimeout(() => { elements.errorMessage.textContent = ''; }, 3000);
  }

  function showGameMessage(text, duration = 2000) {
    elements.gameMessage.textContent = text;
    elements.gameMessage.classList.add('visible');
    setTimeout(() => {
      elements.gameMessage.classList.remove('visible');
    }, duration);
  }

  // ─── Lobby UI ────────────────────────────────────────────────
  function setupLobbyUI() {
    // Mode selection
    document.querySelectorAll('.btn-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedMode = btn.dataset.mode;
      });
    });

    // Quick Play
    document.getElementById('btn-quick-play').addEventListener('click', () => {
      const name = elements.playerName.value.trim() || 'Player';
      Network.emit('quickPlay', { name });
    });

    // Create Room
    document.getElementById('btn-create-room').addEventListener('click', () => {
      const name = elements.playerName.value.trim() || 'Player';
      Network.emit('createRoom', { name, mode: selectedMode });
    });

    // Join Room
    document.getElementById('btn-join-room').addEventListener('click', () => {
      const name = elements.playerName.value.trim() || 'Player';
      const code = elements.roomCode.value.trim().toUpperCase();
      if (code.length !== 4) return showError('Enter a 4-character room code');
      Network.emit('joinRoom', { name, code });
    });

    // Enter key on room code input
    elements.roomCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-join-room').click();
    });

    // Ready button
    document.getElementById('btn-ready').addEventListener('click', () => {
      Network.emit('toggleReady');
    });

    // Leave button
    document.getElementById('btn-leave').addEventListener('click', () => {
      location.reload();
    });
  }

  function updatePlayerList(players) {
    elements.playerList.innerHTML = '';
    players.forEach(p => {
      const div = document.createElement('div');
      div.className = 'player-entry';
      div.innerHTML = `
        <div class="player-color" style="background:${CONSTANTS.TANK_COLORS[p.colorIndex]}"></div>
        <span class="player-name">${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>
        <span class="${p.ready ? 'player-ready' : 'player-waiting'}">${p.ready ? 'READY' : 'NOT READY'}</span>
      `;
      elements.playerList.appendChild(div);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Network Events ──────────────────────────────────────────
  function setupNetworkEvents() {
    Network.on('roomCreated', (data) => {
      myId = data.you;
      currentRoom = data.code;
      elements.roomCodeDisplay.textContent = data.code;
      elements.modeDisplay.textContent = selectedMode === 'ffa' ? 'Free For All' : 'Rounds';
      updatePlayerList(data.players);
      showScreen('waiting');
    });

    Network.on('roomJoined', (data) => {
      myId = data.you;
      currentRoom = data.code;
      currentMode = data.mode;
      elements.roomCodeDisplay.textContent = data.code;
      elements.modeDisplay.textContent = data.mode === 'ffa' ? 'Free For All' : 'Rounds';
      updatePlayerList(data.players);
      showScreen('waiting');
    });

    Network.on('playerJoined', (data) => {
      updatePlayerList(data.players);
    });

    Network.on('playerLeft', (data) => {
      updatePlayerList(data.players);
    });

    Network.on('playerReady', (data) => {
      updatePlayerList(data.players);
    });

    Network.on('error', (data) => {
      showError(data.message);
    });

    Network.on('gameStart', (data) => {
      gameMap = data.map;
      currentMode = data.mode;
      state.players = data.players;
      state.bullets = [];
      state.powerups = [];
      explosions.length = 0;
      showScreen('game');
      showGameMessage('GO!', 1500);
    });

    Network.on('gameState', (data) => {
      state = data;
    });

    Network.on('tileDestroyed', (data) => {
      if (gameMap) {
        gameMap[data.y][data.x] = CONSTANTS.TILE_EMPTY;
        // Mini explosion effect
        explosions.push({
          x: data.x * CONSTANTS.TILE_SIZE + CONSTANTS.TILE_SIZE / 2,
          y: data.y * CONSTANTS.TILE_SIZE + CONSTANTS.TILE_SIZE / 2,
          startTime: Date.now(),
          duration: 400
        });
      }
    });

    Network.on('playerHit', (data) => {
      // Could add hit flash effect here
    });

    Network.on('playerKilled', (data) => {
      const killed = state.players.find(p => p.id === data.id);
      if (killed) {
        explosions.push({
          x: killed.x,
          y: killed.y,
          startTime: Date.now(),
          duration: 800
        });
      }
      state.scores = data.scores;

      if (data.id === myId) {
        showGameMessage('YOU WERE DESTROYED!', 2000);
      }
    });

    Network.on('bulletFired', (data) => {
      // Could play sound effect here
    });

    Network.on('powerupSpawned', (data) => {
      // Server broadcasts new powerup; state will include it next tick
    });

    Network.on('powerupCollected', (data) => {
      if (data.id === myId) {
        const labels = { speed: 'SPEED BOOST!', rapid: 'RAPID FIRE!', shield: 'SHIELD!', heal: 'HEALTH+' };
        showGameMessage(labels[data.type] || 'POWER UP!', 1500);
      }
    });

    Network.on('shieldBreak', (data) => {
      const player = state.players.find(p => p.id === data.id);
      if (player) {
        explosions.push({
          x: player.x, y: player.y,
          startTime: Date.now(),
          duration: 300
        });
      }
    });

    Network.on('gameOver', (data) => {
      elements.winnerText.textContent = data.winnerId === myId ? 'YOU WIN!' : `${data.winnerName} WINS!`;

      // Build score table
      let html = '';
      const sortedScores = Object.entries(data.scores).sort((a, b) => b[1] - a[1]);
      for (const [id, score] of sortedScores) {
        const player = state.players.find(p => p.id === id);
        const name = player ? player.name : 'Unknown';
        html += `<div class="final-score-entry"><span>${escapeHtml(name)}</span><span>${score} kills</span></div>`;
      }
      elements.finalScores.innerHTML = html;
      showScreen('gameover');
    });

    Network.on('returnToLobby', (data) => {
      updatePlayerList(data.players);
      showScreen('waiting');
    });
  }

  // ─── HUD ─────────────────────────────────────────────────────
  function updateHUD() {
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    // HP bar
    const hpPercent = (me.hp / CONSTANTS.TANK_MAX_HP) * 100;
    const hpColor = hpPercent > 50 ? '#4CAF50' : hpPercent > 25 ? '#FF9800' : '#f44336';
    elements.hudHp.innerHTML = `
      <span>HP</span>
      <div class="hp-bar-container">
        <div class="hp-bar-fill" style="width:${hpPercent}%;background:${hpColor}"></div>
      </div>
      <span>${me.hp}</span>
    `;

    // Powerup
    if (me.powerup) {
      const labels = { speed: 'SPEED', rapid: 'RAPID', shield: 'SHIELD' };
      elements.hudPowerup.textContent = labels[me.powerup] || '';
    } else {
      elements.hudPowerup.textContent = '';
    }

    // Scores
    let scoresHtml = '';
    for (const p of state.players) {
      const score = state.scores[p.id] || 0;
      scoresHtml += `
        <div class="score-entry">
          <div class="score-color" style="background:${CONSTANTS.TANK_COLORS[p.colorIndex]}"></div>
          <span>${score}</span>
        </div>
      `;
    }
    elements.hudScores.innerHTML = scoresHtml;

    // Lives (FFA mode)
    if (currentMode === 'ffa' && me.lives !== undefined) {
      elements.hudLives.textContent = 'LIVES: ' + me.lives;
    } else {
      elements.hudLives.textContent = '';
    }
  }

  // ─── Game Loop ───────────────────────────────────────────────
  function gameLoop() {
    requestAnimationFrame(gameLoop);

    if (!screens.game.classList.contains('active')) return;
    if (!gameMap) return;

    // Send input
    const input = Input.getInput();
    const now = Date.now();
    if (now - lastInputSent > 33) { // ~30 times per second
      // Only send if changed
      const inputStr = JSON.stringify(input);
      if (inputStr !== lastInput) {
        Network.emit('input', input);
        lastInput = inputStr;
      }
      lastInputSent = now;
    }

    // Render
    Renderer.clear();
    Renderer.drawMap(gameMap);

    // Draw powerups
    for (const pu of state.powerups) {
      Renderer.drawPowerup(pu.x, pu.y, pu.type);
    }

    // Draw tanks
    for (const p of state.players) {
      Renderer.drawTank(p.x, p.y, p.angle, p.colorIndex, p.hp, p.alive, p.name, p.shieldActive);
    }

    // Draw bullets
    for (const b of state.bullets) {
      Renderer.drawBullet(b.x, b.y, b.angle);
    }

    // Draw explosions
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      const progress = (Date.now() - e.startTime) / e.duration;
      if (progress >= 1) {
        explosions.splice(i, 1);
      } else {
        Renderer.drawDeathExplosion(e.x, e.y, progress);
      }
    }

    // Update HUD
    updateHUD();
  }

  // ─── Init ────────────────────────────────────────────────────
  function init() {
    Input.init();
    Network.init();
    Renderer.init(document.getElementById('game-canvas'));
    setupLobbyUI();
    setupNetworkEvents();

    // Start render loop
    requestAnimationFrame(gameLoop);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
