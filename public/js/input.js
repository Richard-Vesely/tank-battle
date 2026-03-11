// Keyboard input handler
const Input = (() => {
  const keys = {};

  function init() {
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      // Prevent arrow key scrolling
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
    });

    // Reset keys on blur to prevent stuck keys
    window.addEventListener('blur', () => {
      for (const key in keys) keys[key] = false;
    });
  }

  function getInput() {
    return {
      up: keys['ArrowUp'] || keys['KeyW'] || false,
      down: keys['ArrowDown'] || keys['KeyS'] || false,
      left: keys['ArrowLeft'] || keys['KeyA'] || false,
      right: keys['ArrowRight'] || keys['KeyD'] || false,
      fire: keys['Space'] || false
    };
  }

  return { init, getInput };
})();
