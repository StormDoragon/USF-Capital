// Dependency-free, DPR-aware canvas charts: line, multi-line, donut and
// sparkline. Every plotted (non-sparkline) chart gets gridlines on clean
// 1/2/5x10^n values, a text legend paired with color, a hover crosshair
// that snaps to the nearest data point, and keyboard (arrow key) support.
(function () {
  'use strict';

  var registry = Object.create(null);
  var RESIZE_DEBOUNCE = 150;

  function formatValue(kind, raw) {
    if (kind === 'currency') return (raw / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    if (kind === 'percent') return (raw * 100).toFixed(1) + '%';
    return Number(raw).toFixed(1);
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---- "Nice" axis ticks, on clean 1/2/5 x 10^n steps ---------------------

  function niceStep(range, targetTicks) {
    if (!isFinite(range) || range <= 0) return 1;
    var roughStep = range / targetTicks;
    var mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
    var norm = roughStep / mag;
    var niceNorm = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return niceNorm * mag;
  }

  function niceTicks(min, max, targetTicks) {
    if (min === max) {
      var pad = Math.abs(min) * 0.05 || 1;
      min -= pad; max += pad;
    }
    var step = niceStep(max - min, targetTicks || 5);
    var start = Math.floor(min / step) * step;
    var end = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  // ---- Canvas setup ---------------------------------------------------

  function setupCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var cssWidth = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 320;
    var cssHeight = Number(canvas.getAttribute('height')) || 200;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.height = cssHeight + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, width: cssWidth, height: cssHeight };
  }

  function ensureSiblings(canvas) {
    var tooltip = document.getElementById(canvas.id + '-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('p');
      tooltip.id = canvas.id + '-tooltip';
      tooltip.className = 'chart-tooltip';
      tooltip.setAttribute('aria-live', 'polite');
      canvas.insertAdjacentElement('afterend', tooltip);
    }
    var legend = document.getElementById(canvas.id + '-legend');
    if (!legend) {
      legend = document.createElement('div');
      legend.id = canvas.id + '-legend';
      legend.className = 'chart-legend';
      tooltip.insertAdjacentElement('afterend', legend);
    }
    return { tooltip: tooltip, legend: legend };
  }

  function renderLegend(el, items) {
    el.innerHTML = '';
    items.forEach(function (item) {
      var row = document.createElement('span');
      row.className = 'chart-legend-item';
      var swatch = document.createElement('span');
      swatch.className = 'chart-legend-swatch';
      swatch.style.background = item.color;
      row.appendChild(swatch);
      row.appendChild(document.createTextNode(item.text));
      el.appendChild(row);
    });
  }

  // ---- Line / multi-line / sparkline -----------------------------------

  function normalizeSeries(payload) {
    if (payload.series) return payload.series;
    return [{ label: payload.label || '', color: payload.color || '#2f6fed', points: payload.points || [] }];
  }

  function nearestAtOrBefore(points, ts) {
    var best = null;
    for (var i = 0; i < points.length; i++) {
      var pts = new Date(points[i].ts).getTime();
      if (pts <= ts) best = points[i]; else break;
    }
    return best || points[0];
  }

  function uniqueSorted(arr) {
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < sorted.length; i++) {
      if (i === 0 || sorted[i] !== sorted[i - 1]) out.push(sorted[i]);
    }
    return out;
  }

  function nearestTimestamp(sortedTs, target) {
    var lo = 0, hi = sortedTs.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (sortedTs[mid] < target) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(sortedTs[lo - 1] - target) <= Math.abs(sortedTs[lo] - target)) return sortedTs[lo - 1];
    return sortedTs[lo];
  }

  function drawLineFamily(entry) {
    var ctx = entry.ctx, width = entry.width, height = entry.height, sparkline = entry.sparkline;
    ctx.clearRect(0, 0, width, height);
    var series = normalizeSeries(entry.payload).filter(function (s) { return s.points && s.points.length > 0; });

    if (series.length === 0) {
      ctx.fillStyle = '#6b7686';
      ctx.font = '13px sans-serif';
      ctx.fillText('No data yet', 8, height / 2);
      entry._allTimestamps = [];
      return;
    }

    var allTimestamps = [];
    series.forEach(function (s) { s.points.forEach(function (p) { allTimestamps.push(new Date(p.ts).getTime()); }); });
    var xMin = Math.min.apply(null, allTimestamps);
    var xMax = Math.max.apply(null, allTimestamps);

    var allValues = [];
    series.forEach(function (s) { s.points.forEach(function (p) { allValues.push(p.value); }); });
    var yMinRaw = Math.min.apply(null, allValues);
    var yMaxRaw = Math.max.apply(null, allValues);

    var padLeft = sparkline ? 3 : 62;
    var padRight = sparkline ? 3 : 16;
    var padTop = sparkline ? 3 : 16;
    var padBottom = sparkline ? 3 : 28;

    var yTicks = sparkline ? [yMinRaw, yMaxRaw] : niceTicks(yMinRaw, yMaxRaw, 5);
    var yLo = yTicks[0];
    var yHi = yTicks[yTicks.length - 1];
    if (yHi === yLo) { yHi += 1; yLo -= 1; }

    var plotW = width - padLeft - padRight;
    var plotH = height - padTop - padBottom;

    function xPix(ts) {
      if (xMax === xMin) return padLeft + plotW / 2;
      return padLeft + ((ts - xMin) / (xMax - xMin)) * plotW;
    }
    function yPix(v) {
      return padTop + plotH - ((v - yLo) / (yHi - yLo)) * plotH;
    }

    if (!sparkline) {
      ctx.strokeStyle = '#e3e8f0';
      ctx.fillStyle = '#5b6779';
      ctx.font = '11px sans-serif';
      ctx.lineWidth = 1;
      yTicks.forEach(function (t) {
        var y = yPix(t);
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();
        ctx.fillText(formatValue(entry.payload.formatValue, t), 4, y + 3);
      });

      var xTickCount = Math.min(5, allTimestamps.length);
      for (var i = 0; i < xTickCount; i++) {
        var frac = xTickCount === 1 ? 0 : i / (xTickCount - 1);
        var ts = xMin + frac * (xMax - xMin);
        var x = xPix(ts);
        var label = formatDate(ts).replace(/, \d{4}$/, '');
        ctx.fillText(label, Math.min(Math.max(x - 22, padLeft), width - padRight - 46), height - 6);
      }
    }

    series.forEach(function (s) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = sparkline ? 2 : 2.5;
      ctx.beginPath();
      s.points.forEach(function (p, idx) {
        var x = xPix(new Date(p.ts).getTime());
        var y = yPix(p.value);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    if (entry.hoverTs != null) {
      var hx = xPix(entry.hoverTs);
      ctx.strokeStyle = '#9aa7bb';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, padTop);
      ctx.lineTo(hx, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      series.forEach(function (s) {
        var pt = nearestAtOrBefore(s.points, entry.hoverTs);
        if (!pt) return;
        var y = yPix(pt.value);
        ctx.beginPath();
        ctx.arc(hx, y, sparkline ? 3 : 4, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    entry._series = series;
    entry._xMin = xMin;
    entry._xMax = xMax;
    entry._padLeft = padLeft;
    entry._padRight = padRight;
    entry._allTimestamps = uniqueSorted(allTimestamps);
  }

  function updateTooltipForLine(entry) {
    if (!entry.dom) return;
    if (entry.hoverTs == null || !entry._series || entry._series.length === 0) {
      entry.dom.tooltip.textContent = entry.sparkline ? '' : 'Move over the chart, or use the arrow keys, to explore the data.';
      return;
    }
    var parts = entry._series.map(function (s) {
      var pt = nearestAtOrBefore(s.points, entry.hoverTs);
      var label = s.label ? s.label + ': ' : '';
      return label + formatValue(entry.payload.formatValue, pt ? pt.value : 0);
    });
    entry.dom.tooltip.textContent = formatDate(entry.hoverTs) + ' — ' + parts.join(' · ');
  }

  function attachLineInteractivity(entry) {
    var canvas = entry.canvas;

    canvas.addEventListener('mousemove', function (evt) {
      if (!entry._allTimestamps || entry._allTimestamps.length === 0) return;
      var rect = canvas.getBoundingClientRect();
      var x = evt.clientX - rect.left;
      var plotW = entry.width - entry._padLeft - entry._padRight;
      var frac = Math.min(1, Math.max(0, (x - entry._padLeft) / plotW));
      var ts = entry._xMin + frac * (entry._xMax - entry._xMin);
      entry.hoverTs = nearestTimestamp(entry._allTimestamps, ts);
      drawEntry(entry);
      updateTooltipForLine(entry);
    });
    canvas.addEventListener('mouseleave', function () {
      entry.hoverTs = null;
      drawEntry(entry);
      updateTooltipForLine(entry);
    });
    canvas.addEventListener('keydown', function (evt) {
      if (!entry._allTimestamps || entry._allTimestamps.length === 0) return;
      var idx = entry._allTimestamps.indexOf(entry.hoverTs);
      if (evt.key === 'ArrowLeft') { idx = idx <= 0 ? 0 : idx - 1; evt.preventDefault(); }
      else if (evt.key === 'ArrowRight') { idx = idx < 0 ? 0 : Math.min(entry._allTimestamps.length - 1, idx + 1); evt.preventDefault(); }
      else if (evt.key === 'Home') { idx = 0; evt.preventDefault(); }
      else if (evt.key === 'End') { idx = entry._allTimestamps.length - 1; evt.preventDefault(); }
      else return;
      entry.hoverTs = entry._allTimestamps[idx];
      drawEntry(entry);
      updateTooltipForLine(entry);
    });
  }

  // ---- Donut ------------------------------------------------------------

  function drawDonut(entry) {
    var ctx = entry.ctx, width = entry.width, height = entry.height;
    ctx.clearRect(0, 0, width, height);
    var segments = (entry.payload.segments || []).filter(function (s) { return s.value > 0; });
    var total = segments.reduce(function (a, s) { return a + s.value; }, 0);

    var cx = width / 2, cy = height / 2;
    var outerR = Math.max(10, Math.min(width, height) / 2 - 10);
    var innerR = outerR * 0.6;

    if (segments.length === 0 || total <= 0) {
      ctx.fillStyle = '#6b7686';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No allocation yet', cx, cy);
      ctx.textAlign = 'left';
      entry._segments = [];
      return;
    }

    var start = -Math.PI / 2;
    var arcs = segments.map(function (s) {
      var frac = s.value / total;
      var end = start + frac * Math.PI * 2;
      var arc = { seg: s, start: start, end: end, frac: frac };
      start = end;
      return arc;
    });

    arcs.forEach(function (a, i) {
      var isHover = entry.hoverIndex === i;
      ctx.beginPath();
      ctx.arc(cx, cy, isHover ? outerR + 3 : outerR, a.start, a.end);
      ctx.arc(cx, cy, innerR, a.end, a.start, true);
      ctx.closePath();
      ctx.fillStyle = a.seg.color;
      ctx.fill();
      if (isHover) {
        ctx.strokeStyle = '#16202e';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    ctx.fillStyle = '#16202e';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatValue(entry.payload.formatValue, total), cx, cy - 2);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#5b6779';
    ctx.fillText('Total', cx, cy + 16);
    ctx.textAlign = 'left';

    entry._segments = arcs;
    entry._total = total;
    entry._cx = cx; entry._cy = cy; entry._outerR = outerR; entry._innerR = innerR;
  }

  function updateTooltipForDonut(entry) {
    if (!entry.dom) return;
    if (entry.hoverIndex == null || !entry._segments || !entry._segments[entry.hoverIndex]) {
      entry.dom.tooltip.textContent = 'Move over a slice, or use the arrow keys, to see the breakdown.';
      return;
    }
    var a = entry._segments[entry.hoverIndex];
    entry.dom.tooltip.textContent = a.seg.label + ': ' + formatValue(entry.payload.formatValue, a.seg.value) +
      ' (' + (a.frac * 100).toFixed(1) + '%)';
  }

  function attachDonutInteractivity(entry) {
    var canvas = entry.canvas;
    canvas.addEventListener('mousemove', function (evt) {
      if (!entry._segments || entry._segments.length === 0) return;
      var rect = canvas.getBoundingClientRect();
      var x = evt.clientX - rect.left - entry._cx;
      var y = evt.clientY - rect.top - entry._cy;
      var dist = Math.sqrt(x * x + y * y);
      if (dist < entry._innerR || dist > entry._outerR + 4) {
        if (entry.hoverIndex != null) { entry.hoverIndex = null; drawEntry(entry); updateTooltipForDonut(entry); }
        return;
      }
      var angle = Math.atan2(y, x);
      angle = angle < -Math.PI / 2 ? angle + Math.PI * 2 : angle;
      var found = null;
      entry._segments.forEach(function (a, i) { if (angle >= a.start && angle < a.end) found = i; });
      if (found !== entry.hoverIndex) { entry.hoverIndex = found; drawEntry(entry); updateTooltipForDonut(entry); }
    });
    canvas.addEventListener('mouseleave', function () {
      entry.hoverIndex = null; drawEntry(entry); updateTooltipForDonut(entry);
    });
    canvas.addEventListener('keydown', function (evt) {
      if (!entry._segments || entry._segments.length === 0) return;
      var idx = entry.hoverIndex == null ? -1 : entry.hoverIndex;
      if (evt.key === 'ArrowLeft' || evt.key === 'ArrowUp') { idx = idx <= 0 ? entry._segments.length - 1 : idx - 1; evt.preventDefault(); }
      else if (evt.key === 'ArrowRight' || evt.key === 'ArrowDown') { idx = idx >= entry._segments.length - 1 ? 0 : idx + 1; evt.preventDefault(); }
      else if (evt.key === 'Home') { idx = 0; evt.preventDefault(); }
      else if (evt.key === 'End') { idx = entry._segments.length - 1; evt.preventDefault(); }
      else return;
      entry.hoverIndex = idx;
      drawEntry(entry);
      updateTooltipForDonut(entry);
    });
  }

  // ---- Registry / lifecycle ---------------------------------------------

  function drawEntry(entry) {
    if (entry.type === 'donut') drawDonut(entry);
    else drawLineFamily(entry);
  }

  function refreshLegend(entry) {
    if (!entry.dom) return;
    if (entry.type === 'multiline') {
      renderLegend(entry.dom.legend, (entry.payload.series || []).map(function (s) {
        return { color: s.color, text: s.label };
      }));
    } else if (entry.type === 'donut') {
      var total = (entry.payload.segments || []).reduce(function (a, s) { return a + Math.max(0, s.value); }, 0);
      renderLegend(entry.dom.legend, (entry.payload.segments || []).filter(function (s) { return s.value > 0; }).map(function (s) {
        var pct = total > 0 ? (s.value / total * 100).toFixed(1) : '0.0';
        return { color: s.color, text: s.label + ' — ' + formatValue(entry.payload.formatValue, s.value) + ' (' + pct + '%)' };
      }));
    } else if (entry.dom.legend) {
      entry.dom.legend.innerHTML = '';
    }
  }

  function registerCanvas(canvas) {
    var type = canvas.getAttribute('data-chart-type');
    var dataEl = document.getElementById(canvas.id + '-data');
    var payload = {};
    try { payload = dataEl ? JSON.parse(dataEl.textContent) : {}; } catch (e) { payload = {}; }

    var dims = setupCanvas(canvas);
    var sparkline = type === 'sparkline';

    var entry = {
      canvas: canvas,
      ctx: dims.ctx,
      width: dims.width,
      height: dims.height,
      type: type,
      sparkline: sparkline,
      payload: payload,
      hoverTs: null,
      hoverIndex: null,
      dom: ensureSiblings(canvas)
    };

    registry[canvas.id] = entry;
    drawEntry(entry);
    if (type === 'donut') { updateTooltipForDonut(entry); attachDonutInteractivity(entry); }
    else { updateTooltipForLine(entry); attachLineInteractivity(entry); }
    refreshLegend(entry);
  }

  function resizeAll() {
    Object.keys(registry).forEach(function (id) {
      var entry = registry[id];
      var dims = setupCanvas(entry.canvas);
      entry.ctx = dims.ctx;
      entry.width = dims.width;
      entry.height = dims.height;
      drawEntry(entry);
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeAll, RESIZE_DEBOUNCE);
  });

  function init() {
    var canvases = document.querySelectorAll('canvas[data-chart-type]');
    for (var i = 0; i < canvases.length; i++) {
      if (canvases[i].id) registerCanvas(canvases[i]);
    }
  }

  function update(canvasId, patch) {
    var entry = registry[canvasId];
    if (!entry) return;
    Object.keys(patch).forEach(function (key) { entry.payload[key] = patch[key]; });
    drawEntry(entry);
    refreshLegend(entry);
    if (entry.type === 'donut') updateTooltipForDonut(entry); else updateTooltipForLine(entry);
  }

  function pushPoint(canvasId, point, maxPoints) {
    var entry = registry[canvasId];
    if (!entry) return;
    var points = (entry.payload.points || []).slice();
    points.push(point);
    if (maxPoints && points.length > maxPoints) points = points.slice(points.length - maxPoints);
    entry.payload.points = points;
    drawEntry(entry);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.USFCharts = { init: init, update: update, pushPoint: pushPoint };
})();
