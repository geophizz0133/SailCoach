/*
 * Boat Skills — storage.js
 * LocalStorage persistence (scores, notes, last viewed node), autosave, and
 * assessment.json import/export. The hierarchy is read-only and never stored or
 * changed by import.
 *
 * Assumptions:
 *  - Notes are attached to metric nodes (the metric screen owns the notes editor).
 *  - Import replaces the current scores and notes (it does not merge); the user is
 *    asked to confirm in the UI when existing data would be replaced.
 *  - Unknown node ids, non-metric scores and invalid values in an import file are
 *    skipped and reported rather than failing the whole import.
 *  - If LocalStorage is unavailable (private mode, blocked), an in-memory store is used.
 */
(function (global) {
  'use strict';
  const BS = (global.BoatSkills = global.BoatSkills || {});
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  const STORAGE_KEY = 'boatSkills.assessment.v1';
  const EXPORT_FORMAT = 'boat-skills-assessment';
  const EXPORT_VERSION = 1;
  const MAX_NOTE_LENGTH = 20000;

  function memoryBackend() {
    const data = {};
    return {
      getItem: (k) => (hasOwn(data, k) ? data[k] : null),
      setItem: (k, v) => {
        data[k] = String(v);
      },
      removeItem: (k) => {
        delete data[k];
      },
    };
  }

  function browserBackend() {
    try {
      const ls = global.localStorage;
      const probe = '__boatSkills_probe__';
      ls.setItem(probe, probe);
      ls.removeItem(probe);
      return ls;
    } catch (e) {
      return null;
    }
  }

  const emptyState = () => ({ scores: {}, notes: {}, lastViewed: null });

  /** Keeps only valid metric scores/notes and a valid lastViewed id. */
  function sanitizeState(model, raw) {
    const state = emptyState();
    const skipped = [];
    const src = raw && typeof raw === 'object' ? raw : {};
    const scores = src.scores && typeof src.scores === 'object' && !Array.isArray(src.scores) ? src.scores : {};
    const notes = src.notes && typeof src.notes === 'object' && !Array.isArray(src.notes) ? src.notes : {};

    Object.keys(scores).forEach((id) => {
      const v = scores[id];
      if (!model.has(id)) skipped.push({ id, kind: 'score', reason: 'unknown node' });
      else if (!model.isMetric(id)) skipped.push({ id, kind: 'score', reason: 'not a metric (parent scores are calculated)' });
      else if (v === null) return;
      else if (!BS.Scoring.isValidStoredScore(v)) skipped.push({ id, kind: 'score', reason: `invalid value ${JSON.stringify(v)}` });
      else state.scores[id] = BS.Scoring.normalizeScore(v);
    });

    Object.keys(notes).forEach((id) => {
      const v = notes[id];
      if (!model.has(id)) skipped.push({ id, kind: 'note', reason: 'unknown node' });
      else if (!model.isMetric(id)) skipped.push({ id, kind: 'note', reason: 'notes belong to metrics' });
      else if (typeof v !== 'string') skipped.push({ id, kind: 'note', reason: 'not text' });
      else if (v.trim()) state.notes[id] = v.slice(0, MAX_NOTE_LENGTH);
    });

    if (typeof src.lastViewed === 'string' && model.has(src.lastViewed)) state.lastViewed = src.lastViewed;
    return { state, skipped };
  }

  function createStore(backend, key) {
    const real = backend || browserBackend();
    const store = real || memoryBackend();
    const storageKey = key || STORAGE_KEY;
    return {
      persistent: !!real,
      lastError: null,
      load(model) {
        this.lastError = null;
        let raw = null;
        try {
          const text = store.getItem(storageKey);
          raw = text ? JSON.parse(text) : null;
        } catch (e) {
          this.lastError = 'Saved assessment could not be read and was ignored: ' + e.message;
          raw = null;
        }
        return sanitizeState(model, raw).state;
      },
      save(state) {
        try {
          store.setItem(storageKey, JSON.stringify({
            version: EXPORT_VERSION,
            savedAt: new Date().toISOString(),
            scores: state.scores,
            notes: state.notes,
            lastViewed: state.lastViewed,
          }));
          this.lastError = null;
          return true;
        } catch (e) {
          this.lastError = 'Could not save: ' + e.message;
          return false;
        }
      },
      clear() {
        try {
          store.removeItem(storageKey);
        } catch (e) {
          /* nothing stored to remove */
        }
      },
    };
  }

  /** Debounced save. schedule() after each change; flush() saves immediately. */
  function createAutosaver(saveFn, delay, onSaved) {
    let timer = null;
    const flush = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const ok = saveFn();
      if (typeof onSaved === 'function') onSaved(ok);
      return ok;
    };
    return {
      schedule() {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(flush, typeof delay === 'number' ? delay : 300);
      },
      flush,
      pending: () => timer !== null,
    };
  }

  function exportAssessment(model, state) {
    const scores = {};
    const notes = {};
    model.metricIds.forEach((id) => {
      if (hasOwn(state.scores, id)) scores[id] = state.scores[id];
      if (hasOwn(state.notes, id) && state.notes[id].trim()) notes[id] = state.notes[id];
    });
    return {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_VERSION,
      hierarchy: { id: model.meta.id, name: model.meta.name, version: model.meta.version },
      exportedAt: new Date().toISOString(),
      scores,
      notes,
    };
  }

  /** Accepts a JSON string or object. Returns { state: { scores, notes }, report }. Throws on invalid files. */
  function importAssessment(model, input) {
    let obj = input;
    if (typeof input === 'string') {
      try {
        obj = JSON.parse(input);
      } catch (e) {
        throw new Error('The file is not valid JSON.');
      }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('The file does not contain an assessment object.');
    if (obj.format !== EXPORT_FORMAT) throw new Error(`Not a Boat Skills assessment file (expected format "${EXPORT_FORMAT}").`);
    if (typeof obj.formatVersion === 'number' && obj.formatVersion > EXPORT_VERSION) {
      throw new Error(`Assessment format version ${obj.formatVersion} is newer than this app supports (${EXPORT_VERSION}).`);
    }
    if (obj.scores !== undefined && (typeof obj.scores !== 'object' || obj.scores === null || Array.isArray(obj.scores))) throw new Error('"scores" must be an object.');
    if (obj.notes !== undefined && (typeof obj.notes !== 'object' || obj.notes === null || Array.isArray(obj.notes))) throw new Error('"notes" must be an object.');
    const { state, skipped } = sanitizeState(model, { scores: obj.scores || {}, notes: obj.notes || {} });
    return {
      state: { scores: state.scores, notes: state.notes },
      report: { scores: Object.keys(state.scores).length, notes: Object.keys(state.notes).length, skipped },
    };
  }

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = global.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    global.document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  /**
   * Saves JSON through the browser's standard "Save As" dialog when the File System
   * Access API is available (Chrome, Edge, Opera). Other browsers (Firefox, Safari) have
   * no save dialog API, so the file goes through a normal download instead — where it
   * lands then depends on the browser's "ask where to save" setting.
   * Resolves to { status: 'saved' | 'downloaded' | 'cancelled', name }.
   * options.picker / options.fallback exist so tests can substitute them.
   */
  async function saveJSON(filename, data, options) {
    const opts = options || {};
    const picker = Object.prototype.hasOwnProperty.call(opts, 'picker') ? opts.picker : global.showSaveFilePicker;
    const fallback = opts.fallback || downloadJSON;
    if (typeof picker !== 'function') {
      fallback(filename, data);
      return { status: 'downloaded', name: filename, reason: 'unsupported' };
    }
    let handle;
    try {
      handle = await picker.call(global, {
        suggestedName: filename,
        types: [{ description: 'Boat Skills assessment', accept: { 'application/json': ['.json'] } }],
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return { status: 'cancelled', name: null };
      // The picker exists but is blocked here (e.g. SecurityError in an embedded frame).
      fallback(filename, data);
      return { status: 'downloaded', name: filename, reason: 'blocked', error: e && e.message };
    }
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2) + '\n');
    await writable.close();
    return { status: 'saved', name: handle.name || filename };
  }

  /** Identifies the browser family so the export help can name the right setting. */
  function browserFamily(userAgent) {
    const ua = String(userAgent || '');
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Chrome\/|Chromium\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  }

  /** Wipes the stored assessment and returns a blank state for the next user. */
  function clearAssessment(store) {
    store.clear();
    return emptyState();
  }

  BS.Storage = Object.freeze({
    STORAGE_KEY, EXPORT_FORMAT, EXPORT_VERSION,
    memoryBackend, emptyState, sanitizeState, createStore, createAutosaver,
    exportAssessment, importAssessment, downloadJSON, saveJSON, clearAssessment, browserFamily,
  });
})(typeof window !== 'undefined' ? window : globalThis);
