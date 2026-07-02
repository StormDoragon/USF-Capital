// Polls /api/portfolio and animates the dashboard's live figures and charts.
(function () {
  'use strict';

  var totalValueEl = document.getElementById('dash-total-value');
  if (!totalValueEl) return;

  var poolsMetaEl = document.getElementById('pools-meta');
  var poolsMeta = {};
  try { poolsMeta = poolsMetaEl ? JSON.parse(poolsMetaEl.textContent) : {}; } catch (e) { poolsMeta = {}; }

  function formatUsd(cents) {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function applyUpdate(data) {
    var summary = data.summary;

    totalValueEl.textContent = formatUsd(summary.totalValueCents);

    var gainEl = document.getElementById('dash-total-gain');
    if (gainEl) {
      var sign = summary.totalGainCents >= 0 ? '+' : '';
      gainEl.textContent = sign + formatUsd(summary.totalGainCents) + ' (' + sign + (summary.totalGainPct * 100).toFixed(2) + '%)';
      gainEl.className = 'stat-value ' + (summary.totalGainCents >= 0 ? 'positive' : 'negative');
    }

    var cashEl = document.getElementById('dash-cash-balance');
    if (cashEl) cashEl.textContent = formatUsd(data.cashBalanceCents);

    var unlockEl = document.getElementById('dash-next-unlock');
    if (unlockEl) {
      unlockEl.textContent = summary.nextUnlock
        ? (summary.nextUnlock.daysUntil > 0 ? summary.nextUnlock.daysUntil + ' days' : 'Matured')
        : '—';
    }

    (data.positions || []).forEach(function (p) {
      var valueEl = document.getElementById('position-value-' + p.id);
      if (valueEl) valueEl.textContent = formatUsd(p.currentValueCents);

      var gainEl2 = document.getElementById('position-gain-' + p.id);
      if (gainEl2) {
        var gainPct = p.principalCents > 0 ? (p.currentValueCents - p.principalCents) / p.principalCents : 0;
        gainEl2.textContent = (gainPct >= 0 ? '+' : '') + (gainPct * 100).toFixed(2) + '%';
        gainEl2.className = gainPct >= 0 ? 'positive' : 'negative';
      }

      var sparkCanvasId = 'position-sparkline-' + p.id;
      if (window.USFCharts && document.getElementById(sparkCanvasId)) {
        window.USFCharts.update(sparkCanvasId, {
          points: (p.sparkline || []).map(function (pt) { return { ts: pt.ts, value: pt.value_cents }; })
        });
      }
    });

    if (window.USFCharts) {
      window.USFCharts.update('dash-allocation-donut', {
        segments: (summary.allocation || []).map(function (a) {
          var meta = poolsMeta[a.poolId] || { name: 'Pool', color: '#8892a3' };
          return { label: meta.name, value: a.valueCents, color: meta.color };
        })
      });
      window.USFCharts.pushPoint('dash-combined-chart', { ts: data.serverTime, value: summary.totalValueCents }, 500);
    }
  }

  function poll() {
    fetch('/api/portfolio', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data) applyUpdate(data); })
      .catch(function () { /* transient network hiccup — try again next poll */ });
  }

  setInterval(poll, 4000);
})();
