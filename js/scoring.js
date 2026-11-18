/*
 * Boat Skills — scoring.js
 * Only metric nodes store scores. Every parent score is calculated on demand as a
 * weighted average of its children (default weight = 1) and never stored.
 *
 * Assumptions:
 *  - Scores are integers 0–10; out-of-range values are clamped and decimals rounded in
 *    the editor. Import rejects values outside 0–10 rather than clamping them.
 *  - Unscored children are excluded from a parent's average (they do not count as 0).
 *    A parent with no scored descendants has a score of null ("Not assessed").
 */
(function (global) {
  'use strict';
  const BS = (global.BoatSkills = global.BoatSkills || {});
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  const MIN = 0;
  const MAX = 10;
  const SCALE = Object.freeze([
    { value: 0, label: 'Not Demonstrated' },
    { value: 2, label: 'Beginner' },
    { value: 4, label: 'Developing' },
    { value: 6, label: 'Competent' },
    { value: 8, label: 'Proficient' },
    { value: 10, label: 'Expert' },
  ].map(Object.freeze));

  function normalizeScore(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(MAX, Math.max(MIN, Math.round(n)));
  }

  function isValidStoredScore(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= MIN && value <= MAX;
  }

  function levelFor(score) {
    if (score === null || score === undefined || !Number.isFinite(score)) return 'Not assessed';
    let label = SCALE[0].label;
    SCALE.forEach((s) => {
      if (score + 1e-9 >= s.value) label = s.label;
    });
    return label;
  }

  /** Returns { [nodeId]: { score, scoredMetrics, totalMetrics } } for every node. */
  function computeRollups(model, scores) {
    const out = {};
    const calc = (id) => {
      if (out[id]) return out[id];
      const node = model.get(id);
      if (node.type === 'metric') {
        const s = scores && hasOwn(scores, id) ? normalizeScore(scores[id]) : null;
        out[id] = { score: s, scoredMetrics: s === null ? 0 : 1, totalMetrics: 1 };
        return out[id];
      }
      let weightSum = 0;
      let sum = 0;
      let scored = 0;
      let total = 0;
      node.children.forEach((cid) => {
        const r = calc(cid);
        scored += r.scoredMetrics;
        total += r.totalMetrics;
        if (r.score !== null) {
          const w = model.get(cid).weight;
          weightSum += w;
          sum += w * r.score;
        }
      });
      out[id] = { score: weightSum > 0 ? sum / weightSum : null, scoredMetrics: scored, totalMetrics: total };
      return out[id];
    };
    calc(model.rootId);
    return out;
  }

  /** Returns a new scores object. Throws for non-metric nodes (parent scores are never stored). */
  function setMetricScore(model, scores, id, value) {
    if (!model.has(id)) throw new Error(`Unknown node "${id}".`);
    if (!model.isMetric(id)) throw new Error(`Node "${id}" is not a metric; only metrics store scores.`);
    const next = Object.assign({}, scores);
    const s = normalizeScore(value);
    if (s === null) delete next[id];
    else next[id] = s;
    return next;
  }

  function formatScore(score, isMetric) {
    if (score === null || score === undefined) return '—';
    return isMetric ? String(Math.round(score)) : (Math.round(score * 10) / 10).toFixed(1);
  }

  /** Red (0) → amber → green (10). */
  function scoreColor(score) {
    if (score === null || score === undefined) return 'var(--muted)';
    const hue = Math.round(6 + (Math.max(0, Math.min(10, score)) / 10) * 140);
    return `hsl(${hue} 62% 44%)`;
  }

  BS.Scoring = Object.freeze({ MIN, MAX, SCALE, normalizeScore, isValidStoredScore, levelFor, computeRollups, setMetricScore, formatScore, scoreColor });
})(typeof window !== 'undefined' ? window : globalThis);
