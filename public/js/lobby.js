// Lobby UI management
const Lobby = (() => {
  let screens = {};
  let els = {};
  let myId = null;

  function init(screenRefs, elRefs) {
    screens = screenRefs;
    els = elRefs;
  }

  function setMyId(id) { myId = id; }

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

  function getModeLabel(mode) {
    if (mode === CONSTANTS.MODE_FFA) return 'Free For All';
    if (mode === CONSTANTS.MODE_ROUNDS) return 'Rounds';
    if (mode === CONSTANTS.MODE_DOMINATION) return 'Domination';
    return mode;
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

  function setupLobbyUI(callbacks) {
    const nameInput = document.getElementById('player-name');

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        callbacks.onModeSelect(btn.dataset.mode);
      });
    });

    document.querySelectorAll('.penalty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.penalty-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        callbacks.onPenaltySelect(btn.dataset.penalty);
      });
    });

    document.querySelectorAll('.mapsize-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mapsize-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        callbacks.onMapSizeSelect(btn.dataset.mapsize);
      });
    });

    document.getElementById('btn-quickplay').addEventListener('click', () => {
      Network.emit('quickPlay', { name: nameInput.value || 'Player' });
    });

    document.getElementById('btn-practice').addEventListener('click', () => {
      callbacks.onPractice(nameInput.value || 'Player');
    });

    document.getElementById('btn-create').addEventListener('click', () => {
      callbacks.onCreate(nameInput.value || 'Player');
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

  return {
    init, setMyId, showScreen, showMessage, showError, escapeHtml,
    getModeLabel, updatePlayerList, setupLobbyUI,
  };
})();
