/*
 * Boat Skills — radar.js
 * Responsive SVG radar chart with any number of axes. Labels and sectors are
 * clickable. The viewBox is fitted automatically to the labels, and font size and
 * label wrapping scale with the axis count. Values are plotted on a fixed 0–10 domain.
 */
(function (global) {
  'use strict';
  const BS = (global.BoatSkills = global.BoatSkills || {});
  const SVGNS = 'http://www.w3.org/2000/svg';

  const RADIUS = 160;
  const LABEL_GAP = 16;
  const PAD = 8;
  const RINGS = [2, 4, 6, 8, 10];

  const axisAngle = (i, n) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const polar = (r, angle) => [r * Math.cos(angle), r * Math.sin(angle)];
  const fmt = (v) => (Math.round(v * 100) / 100).toString();

  /** Point for axis i of n at the given value (null → 0) on a 0..max scale. */
  function valuePoint(i, n, value, max, radius) {
    const v = value === null || value === undefined ? 0 : Math.max(0, Math.min(max, value));
    return polar(((radius || RADIUS) * v) / max, axisAngle(i, n));
  }

  function fontSizeFor(n) {
    if (n <= 6) return 14;
    if (n <= 10) return 13;
    if (n <= 16) return 12;
    if (n <= 30) return 10.5;
    return 9;
  }
  function charsFor(n) {
    if (n <= 6) return 16;
    if (n <= 10) return 14;
    return 12;
  }

  function wrapLabel(text, maxChars) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach((w) => {
      if (!line) line = w;
      else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
      else {
        lines.push(line);
        line = w;
      }
    });
    if (line) lines.push(line);
    if (lines.length > 3) {
      const kept = lines.slice(0, 3);
      kept[2] = kept[2].slice(0, Math.max(1, maxChars - 1)) + '…';
      return kept;
    }
    return lines.length ? lines : [''];
  }

  function el(tag, attrs, parent) {
    const node = global.document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach((k) => node.setAttribute(k, String(attrs[k])));
    if (parent) parent.appendChild(node);
    return node;
  }

  function formatValue(v) {
    if (v === null || v === undefined) return '—';
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  /**
   * opts: { axes: [{ id, label, value }], max = 10, title, onSelect(id) }
   * Returns { svg, axisCount } or null when there are no axes.
   */
  function render(container, opts) {
    const axes = (opts && opts.axes) || [];
    const max = (opts && opts.max) || 10;
    const onSelect = opts && opts.onSelect;
    while (container.firstChild) container.removeChild(container.firstChild);
    const n = axes.length;
    if (!n) {
      const p = global.document.createElement('p');
      p.className = 'radar-empty';
      p.textContent = 'Nothing to chart.';
      container.appendChild(p);
      return null;
    }

    // Narrow containers shrink the whole drawing, so labels get a larger font (in
    // viewBox units) and tighter wrapping to stay legible on phones.
    const width = container.clientWidth || 640;
    const boost = width < 420 ? 1.55 : width < 560 ? 1.3 : 1;
    const R = RADIUS;
    const fs = fontSizeFor(n) * boost;
    const lh = fs * 1.18;
    const maxChars = Math.max(9, Math.round(charsFor(n) / Math.sqrt(boost)));

    const labels = axes.map((axis, i) => {
      const angle = axisAngle(i, n);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const lines = wrapLabel(axis.label, maxChars);
      const scoreText = formatValue(axis.value);
      const longest = Math.max.apply(null, lines.concat([scoreText]).map((l) => l.length));
      const width = longest * fs * 0.58;
      const height = (lines.length + 1) * lh;
      const [ax, ay] = polar(R + LABEL_GAP, angle);
      const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
      const left = anchor === 'start' ? ax : anchor === 'end' ? ax - width : ax - width / 2;
      const top = sin < -0.3 ? ay - height : sin > 0.3 ? ay : ay - height / 2;
      return { axis, i, lines, scoreText, anchor, ax, left, top, width, height };
    });

    let minX = -R;
    let maxX = R;
    let minY = -R;
    let maxY = R;
    labels.forEach((l) => {
      minX = Math.min(minX, l.left);
      maxX = Math.max(maxX, l.left + l.width);
      minY = Math.min(minY, l.top);
      maxY = Math.max(maxY, l.top + l.height);
    });
    minX -= PAD;
    minY -= PAD;
    maxX += PAD;
    maxY += PAD;

    const svg = el('svg', {
      viewBox: `${fmt(minX)} ${fmt(minY)} ${fmt(maxX - minX)} ${fmt(maxY - minY)}`,
      class: 'radar-svg',
      role: 'group',
      'aria-label': (opts && opts.title) || 'Radar chart',
      preserveAspectRatio: 'xMidYMid meet',
    });
    svg.setAttribute('data-axis-count', String(n));

    // Clickable sectors (one wedge per axis).
    const step = (2 * Math.PI) / n;
    const gSectors = el('g', { class: 'radar-sectors' }, svg);
    axes.forEach((axis, i) => {
      let shape;
      if (n === 1) {
        shape = el('circle', { cx: 0, cy: 0, r: R }, gSectors);
      } else {
        const a0 = axisAngle(i, n) - step / 2;
        const a1 = a0 + step;
        const [x0, y0] = polar(R, a0);
        const [x1, y1] = polar(R, a1);
        const large = step > Math.PI ? 1 : 0;
        shape = el('path', { d: `M0 0 L${fmt(x0)} ${fmt(y0)} A${R} ${R} 0 ${large} 1 ${fmt(x1)} ${fmt(y1)} Z` }, gSectors);
      }
      shape.setAttribute('class', 'radar-sector');
      shape.setAttribute('data-id', axis.id);
      shape.setAttribute('data-index', String(i));
      const t = el('title', null, shape);
      t.textContent = `${axis.label}: ${formatValue(axis.value)}`;
    });

    // Grid rings.
    const gGrid = el('g', { class: 'radar-grid', 'aria-hidden': 'true' }, svg);
    RINGS.forEach((v) => {
      const r = (R * v) / max;
      if (n >= 3) {
        const pts = axes.map((_, i) => polar(r, axisAngle(i, n)).map(fmt).join(',')).join(' ');
        el('polygon', { points: pts, class: 'radar-ring' }, gGrid);
      } else {
        el('circle', { cx: 0, cy: 0, r, class: 'radar-ring' }, gGrid);
      }
      const label = el('text', { x: 4, y: fmt(-r + 3), class: 'radar-ring-label', 'font-size': 10 }, gGrid);
      label.textContent = String(v);
    });
    axes.forEach((_, i) => {
      const [x, y] = polar(R, axisAngle(i, n));
      el('line', { x1: 0, y1: 0, x2: fmt(x), y2: fmt(y), class: 'radar-spoke' }, gGrid);
    });

    // Score polygon and points.
    const pts = axes.map((a, i) => valuePoint(i, n, a.value, max, R));
    el('polygon', { points: pts.map((p) => p.map(fmt).join(',')).join(' '), class: 'radar-area' }, svg);
    const gDots = el('g', { class: 'radar-dots', 'aria-hidden': 'true' }, svg);
    pts.forEach((p, i) => {
      const unscored = axes[i].value === null || axes[i].value === undefined;
      el('circle', { cx: fmt(p[0]), cy: fmt(p[1]), r: 4, class: unscored ? 'radar-dot radar-dot--empty' : 'radar-dot' }, gDots);
    });

    // Clickable labels.
    const gLabels = el('g', { class: 'radar-labels' }, svg);
    labels.forEach((l) => {
      const g = el('g', {
        class: 'radar-label',
        'data-id': l.axis.id,
        'data-index': l.i,
        tabindex: 0,
        role: 'link',
        'aria-label': `${l.axis.label}, score ${l.scoreText}`,
      }, gLabels);
      el('rect', { x: fmt(l.left - 3), y: fmt(l.top - 2), width: fmt(l.width + 6), height: fmt(l.height + 4), rx: 4, class: 'radar-label-hit' }, g);
      const text = el('text', { 'text-anchor': l.anchor, 'font-size': fs }, g);
      l.lines.concat([l.scoreText]).forEach((line, k) => {
        const ts = el('tspan', { x: fmt(l.ax), y: fmt(l.top + fs * 0.9 + k * lh) }, text);
        if (k === l.lines.length) ts.setAttribute('class', 'radar-label-score');
        ts.textContent = line;
      });
    });

    const select = (target) => {
      const hit = target && target.closest ? target.closest('[data-id]') : null;
      if (hit && typeof onSelect === 'function') onSelect(hit.getAttribute('data-id'));
    };
    svg.addEventListener('click', (e) => select(e.target));
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(e.target);
      }
    });
    const hover = (e, on) => {
      const hit = e.target && e.target.closest ? e.target.closest('[data-index]') : null;
      if (!hit) return;
      const idx = hit.getAttribute('data-index');
      svg.querySelectorAll(`[data-index="${idx}"]`).forEach((node) => node.classList.toggle('is-hover', on));
    };
    svg.addEventListener('mouseover', (e) => hover(e, true));
    svg.addEventListener('mouseout', (e) => hover(e, false));
    svg.addEventListener('focusin', (e) => hover(e, true));
    svg.addEventListener('focusout', (e) => hover(e, false));

    container.appendChild(svg);
    container.__radarBoost = boost;
    return { svg, axisCount: n, boost };
  }

  BS.Radar = Object.freeze({ render, valuePoint, axisAngle, wrapLabel, RADIUS });
})(typeof window !== 'undefined' ? window : globalThis);
