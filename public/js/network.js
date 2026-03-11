// Network communication via Socket.IO — v3
const Network = (() => {
  let socket;
  const handlers = {};

  function init() {
    socket = io();

    const events = [
      'roomCreated', 'roomJoined', 'playerJoined', 'playerLeft',
      'playerReady', 'gameStart', 'gameState', 'gameOver',
      'returnToLobby', 'playerHit', 'playerKilled', 'bulletFired',
      'tileDestroyed', 'powerupSpawned', 'powerupCollected',
      'shieldBreak', 'error',
      // v2 events
      'currencyEarned', 'upgradeSuccess', 'abilityUsed',
      'minePlaced', 'mineExploded', 'zoneCaptured',
      'creditSpawned', 'creditCollected',
      // v3 events
      'snipeImpact', 'vampireProc'
    ];

    events.forEach(event => {
      socket.on(event, (data) => {
        if (handlers[event]) handlers[event](data);
      });
    });
  }

  function on(event, callback) { handlers[event] = callback; }
  function emit(event, data) { if (socket) socket.emit(event, data); }
  function getId() { return socket ? socket.id : null; }

  return { init, on, emit, getId };
})();
