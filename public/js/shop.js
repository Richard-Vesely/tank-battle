// Upgrade shop overlay
const Shop = (() => {
  let shopOpen = false;
  let shopEl = null;
  let shopContentEl = null;

  function init(el, contentEl) {
    shopEl = el;
    shopContentEl = contentEl;
  }

  function isOpen() { return shopOpen; }

  function toggle() {
    shopOpen = !shopOpen;
    if (shopEl) shopEl.classList.toggle('show', shopOpen);
    if (shopOpen) render();
  }

  function close() {
    shopOpen = false;
    if (shopEl) shopEl.classList.remove('show');
  }

  function formatCost(cost) {
    if (cost >= 1000000) return (cost / 1000000).toFixed(1) + 'M';
    if (cost >= 1000) return (cost / 1000).toFixed(1) + 'K';
    return cost;
  }

  function render(me) {
    if (!shopContentEl) return;
    // Allow calling with no arg — use cached state from Game
    if (!me) { if (Shop._getMe) me = Shop._getMe(); }
    if (!me) return;

    const myCurrency = me.currency || 0;
    let html = `<div class="shop-header">SHOP <span class="shop-currency">${formatCost(myCurrency)} CR</span></div>`;

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

    shopContentEl.innerHTML = html;

    shopContentEl.querySelectorAll('.shop-item.buyable').forEach(el => {
      el.addEventListener('click', () => {
        Network.emit('purchase', { type: el.dataset.type, key: el.dataset.key });
      });
    });
  }

  return { init, isOpen, toggle, close, formatCost, render, _getMe: null };
})();
