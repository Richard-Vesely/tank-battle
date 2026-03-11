// Keyboard + mouse input handler — v3 stats/abilities
const Input = (() => {
  const keys = {};
  const justPressed = {};
  let mouseX = 0, mouseY = 0;
  let mouseClicked = false;

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

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    window.addEventListener('click', (e) => {
      mouseClicked = true;
    });
  }

  function getInput() {
    const shift = keys['ShiftLeft'] || keys['ShiftRight'] || false;
    return {
      up: keys['ArrowUp'] || false,
      down: keys['ArrowDown'] || false,
      left: keys['ArrowLeft'] || false,
      right: keys['ArrowRight'] || false,
      fire: keys['Space'] || false,
      // Duration abilities (suppressed when Shift held — Shift+key = buy)
      berserk: !shift && (keys['KeyQ'] || false),
      speedBoost: !shift && (keys['KeyW'] || false),
      vampire: !shift && (keys['KeyE'] || false),
      hide: !shift && (keys['KeyR'] || false),
      shield: !shift && (keys['KeyF'] || false),
      // Instant abilities
      regenBurst: !shift && (keys['KeyG'] || false),
      mine: !shift && (keys['KeyX'] || false),
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

  function getMousePosition() {
    return { x: mouseX, y: mouseY };
  }

  function consumeClick() {
    if (mouseClicked) {
      mouseClicked = false;
      return true;
    }
    return false;
  }

  return { init, getInput, isJustPressed, isKeyDown, clearJustPressed, getMousePosition, consumeClick };
})();
