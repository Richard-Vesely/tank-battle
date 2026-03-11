// Keyboard input handler v2 — includes ability keys and shop toggle
const Input = (() => {
  const keys = {};
  const justPressed = {};

  function init() {
    window.addEventListener('keydown', (e) => {
      if (!keys[e.code]) justPressed[e.code] = true;
      keys[e.code] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
    });

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
      fire: keys['Space'] || false,
      // Abilities
      dash: keys['ShiftLeft'] || keys['ShiftRight'] || false,
      teleport: keys['KeyT'] || false,
      emp: keys['KeyE'] || false,
      smoke: keys['KeyQ'] || false,
      mine: keys['KeyX'] || false,
    };
  }

  function isJustPressed(code) {
    if (justPressed[code]) {
      justPressed[code] = false;
      return true;
    }
    return false;
  }

  function isKeyDown(code) {
    return keys[code] || false;
  }

  function clearJustPressed() {
    for (const key in justPressed) justPressed[key] = false;
  }

  return { init, getInput, isJustPressed, isKeyDown, clearJustPressed };
})();
