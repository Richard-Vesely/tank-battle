// Network communication via Socket.IO
const Network = (() => {
  let socket;
  const handlers = {};

  function init() {
    socket = io();

    // Register all event handlers
    const events = [
      'roomCreated', 'roomJoined', 'playerJoined', 'playerLeft',
      'playerReady', 'gameStart', 'gameState', 'gameOver',
      'returnToLobby', 'playerHit', 'playerKilled', 'bulletFired',
      'tileDestroyed', 'powerupSpawned', 'powerupCollected',
      'shieldBreak', 'error'
    ];

    events.forEach(event => {
      socket.on(event, (data) => {
        if (handlers[event]) handlers[event](data);
      });
    });
  }

  function on(event, callback) {
    handlers[event] = callback;
  }

  function emit(event, data) {
    if (socket) socket.emit(event, data);
  }

  function getId() {
    return socket ? socket.id : null;
  }

  return { init, on, emit, getId };
})();
