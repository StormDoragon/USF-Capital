// Polls the decorative homepage FX/index ticker. Illustrative only.
(function () {
  'use strict';

  var listEl = document.getElementById('ticker-list');
  if (!listEl) return;

  function render(items) {
    listEl.innerHTML = '';
    items.forEach(function (item) {
      var li = document.createElement('li');

      var name = document.createElement('span');
      name.textContent = item.symbol;

      var price = document.createElement('span');
      price.className = item.changePct >= 0 ? 'positive' : 'negative';
      var priceText = item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
      price.textContent = priceText + '   ' + (item.changePct >= 0 ? '+' : '') + item.changePct.toFixed(2) + '%';

      li.appendChild(name);
      li.appendChild(price);
      listEl.appendChild(li);
    });
  }

  function poll() {
    fetch('/api/ticker', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data && data.items) render(data.items); })
      .catch(function () { /* transient network hiccup — try again next poll */ });
  }

  poll();
  setInterval(poll, 3000);
})();
