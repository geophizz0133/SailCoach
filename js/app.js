/*
 * Boat Skills — app.js
 * Startup (load → validate → model → state), routing, rendering and event wiring.
 *
 * Loading: the hierarchy is loaded dynamically from data/hierarchy.json with fetch().
 * Browsers block fetch() for pages opened directly from disk (file://), so index.html
 * also carries an embedded copy of the same JSON, used only when the fetch fails.
 * Both copies pass through the same runtime validation.
 */
(function (global) {
  'use strict';
  const BS = global.BoatSkills;
  const doc = global.document;
  const { Validation, Model, Navigation, Scoring, Radar, Storage, Tests } = BS;

  const App = (BS.App = {
    data: null,
    source: null,
    model: null,
    store: null,
    state: null,
    rollups: null,
    nav: null,
    autosave: null,
    treeRefs: {},
    metricView: null,
  });

  // ---- DOM helpers ------------------------------------------------------------------
  function h(tag, props, children) {
    const el = doc.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    [].concat(children === undefined ? [] : children).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
    });
    return el;
  }
  const $ = (id) => doc.getElementById(id);
  const isMobile = () => global.matchMedia && global.matchMedia('(max-width: 860px)').matches;

  let toastTimer = null;
  function toast(message, kind) {
    const el = $('toast');
    el.textContent = message;
    el.className = 'toast is-visible' + (kind ? ' toast--' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, 3600);
  }

  // ---- Loading ------------------------------------------------------------------------
  function readEmbedded() {
    const el = $('embedded-hierarchy');
    const text = el ? el.textContent.trim() : '';
    return text ? JSON.parse(text) : null;
  }

  async function loadHierarchy() {
    try {
      const res = await fetch('data/hierarchy.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { data: await res.json(), source: 'data/hierarchy.json' };
    } catch (err) {
      let embedded = null;
      try {
        embedded = readEmbedded();
      } catch (parseErr) {
        throw new Error(`Could not load data/hierarchy.json (${err.message}) and the embedded copy is not valid JSON (${parseErr.message}).`);
      }
      if (embedded) return { data: embedded, source: 'embedded' };
      throw new Error(`Could not load data/hierarchy.json: ${err.message}`);
    }
  }

  function showStartupError(title, messages) {
    const box = $('startup-error');
    box.textContent = '';
    box.appendChild(h('h2', { text: title }));
    box.appendChild(h('p', { text: 'Boat Skills cannot start until these problems are fixed:' }));
    box.appendChild(h('ul', null, messages.map((m) => h('li', { text: m }))));
    box.hidden = false;
    $('app').hidden = true;
    doc.body.dataset.startup = 'failed';
  }

  // ---- State changes ----------------------------------------------------------------
  function recompute() {
    App.rollups = Scoring.computeRollups(App.model, App.state.scores);
  }

  function setScore(id, value) {
    App.state.scores = Scoring.setMetricScore(App.model, App.state.scores, id, value);
    recompute();
    App.autosave.schedule();
    updateTreeScores();
    if (App.metricView && App.metricView.id === id) App.metricView.refresh();
    markSaving();
  }

  function setNote(id, text) {
    if (!App.model.isMetric(id)) return;
    const notes = Object.assign({}, App.state.notes);
    if (text.trim()) notes[id] = text;
    else delete notes[id];
    App.state.notes = notes;
    App.autosave.schedule();
    markSaving();
  }

  function markSaving() {
    const el = $('save-status');
    if (el) el.textContent = 'Saving…';
  }
  function onSaved(ok) {
    const el = $('save-status');
    if (el) el.textContent = ok ? (App.store.persistent ? 'All changes saved' : 'Saved for this session only') : 'Save failed';
    if (!ok && App.store.lastError) toast(App.store.lastError, 'error');
  }

  // ---- Routing ------------------------------------------------------------------------
  function navigateTo(id, replace) {
    if (!App.model.has(id)) {
      toast(`Unknown node "${id}"`, 'error');
      return false;
    }
    const hash = Navigation.formatHash(id);
    if (global.location.hash === hash) {
      render(id);
    } else if (replace) {
      try {
        global.history.replaceState(null, '', hash);
      } catch (e) {
        /* replaceState can be unavailable on some file:// setups; render anyway */
      }
      render(id);
    } else {
      global.location.hash = hash;
    }
    return true;
  }

  function onHashChange() {
    const id = Navigation.parseHash(global.location.hash);
    if (id && App.model.has(id)) render(id);
    else navigateTo(App.nav ? App.nav.current() : App.model.rootId, true);
  }

  // ---- Tree -----------------------------------------------------------------------------
  function buildTree() {
    const body = $('tree-body');
    body.textContent = '';
    App.treeRefs = {};
    const ul = h('ul', { class: 'tree', role: 'tree', 'aria-label': 'Competency tree' });
    ul.appendChild(buildTreeItem(App.model.rootId, 0));
    body.appendChild(ul);
    setExpanded(App.model.rootId, true);
  }

  function buildTreeItem(id, depth) {
    const node = App.model.get(id);
    const hasKids = node.children.length > 0;
    const li = h('li', { class: `tree-item tree-item--${node.type}`, role: 'treeitem', 'aria-expanded': hasKids ? 'false' : null });
    const row = h('div', { class: 'tree-row', style: `--depth:${depth}` });
    let toggle = null;
    if (hasKids) {
      toggle = h('button', { class: 'tree-toggle', type: 'button', 'aria-label': `Expand ${node.name}`, onclick: () => setExpanded(id, !App.treeRefs[id].open) },
        h('span', { class: 'chev', 'aria-hidden': 'true' }));
      row.appendChild(toggle);
    } else {
      row.appendChild(h('span', { class: 'tree-spacer', 'aria-hidden': 'true' }));
    }
    const badge = h('span', { class: 'tree-badge' });
    const link = h('a', {
      class: 'tree-link',
      href: Navigation.formatHash(id),
      onclick: () => {
        if (isMobile()) setDrawer(false);
      },
    }, [h('span', { class: 'tree-name', text: node.name }), badge]);
    row.appendChild(link);
    li.appendChild(row);
    let sub = null;
    if (hasKids) {
      sub = h('ul', { class: 'tree-children', role: 'group', hidden: true });
      node.children.forEach((c) => sub.appendChild(buildTreeItem(c, depth + 1)));
      li.appendChild(sub);
    }
    App.treeRefs[id] = { li, row, link, badge, toggle, sub, open: false };
    return li;
  }

  function setExpanded(id, open) {
    const r = App.treeRefs[id];
    if (!r || !r.sub) return;
    r.open = open;
    r.sub.hidden = !open;
    r.li.setAttribute('aria-expanded', String(open));
    r.toggle.classList.toggle('is-open', open);
    r.toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${App.model.get(id).name}`);
  }

  function setAllExpanded(open) {
    Object.keys(App.treeRefs).forEach((id) => setExpanded(id, open || id === App.model.rootId));
    if (!open && App.nav) revealInTree(App.nav.current());
  }

  function updateTreeScores() {
    Object.keys(App.treeRefs).forEach((id) => {
      const r = App.rollups[id];
      const ref = App.treeRefs[id];
      ref.badge.textContent = Scoring.formatScore(r.score, App.model.isMetric(id));
      ref.badge.style.setProperty('--score-color', Scoring.scoreColor(r.score));
      ref.badge.classList.toggle('is-empty', r.score === null);
    });
  }

  function revealInTree(id) {
    const path = Navigation.pathToRoot(App.model, id);
    path.slice(0, -1).forEach((pid) => setExpanded(pid, true));
    Object.keys(App.treeRefs).forEach((tid) => {
      const ref = App.treeRefs[tid];
      const active = tid === id;
      ref.row.classList.toggle('is-active', active);
      ref.row.classList.toggle('is-ancestor', !active && path.includes(tid));
      if (active) ref.link.setAttribute('aria-current', 'page');
      else ref.link.removeAttribute('aria-current');
    });
    const row = App.treeRefs[id] && App.treeRefs[id].row;
    if (row && row.scrollIntoView) {
      const panel = $('tree-body');
      const pr = panel.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      if (rr.top < pr.top || rr.bottom > pr.bottom) row.scrollIntoView({ block: 'nearest' });
    }
  }

  function setDrawer(open) {
    doc.body.classList.toggle('tree-open', open);
    $('tree-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      const active = doc.querySelector('.tree-row.is-active .tree-link');
      if (active) active.focus({ preventScroll: false });
    }
  }

  // ---- Rendering ----------------------------------------------------------------------
  function render(id) {
    App.nav.go(id);
    App.state.lastViewed = id;
    App.autosave.schedule();
    App.metricView = null;
    App.radar = null;

    renderBreadcrumbs(id);
    const view = $('view');
    view.textContent = '';
    const node = App.model.get(id);
    if (node.type === 'metric') renderMetric(view, node);
    else renderBranch(view, node);
    revealInTree(id);
    doc.title = id === App.model.rootId ? 'Boat Skills' : `${node.name} · Boat Skills`;
    const heading = view.querySelector('h2');
    if (heading) heading.focus({ preventScroll: true });
    $('main').scrollTop = 0;
    global.scrollTo(0, 0);
  }

  function renderBreadcrumbs(id) {
    const ol = $('breadcrumbs');
    ol.textContent = '';
    const crumbs = Navigation.breadcrumbs(App.model, id);
    crumbs.forEach((c, i) => {
      const last = i === crumbs.length - 1;
      ol.appendChild(h('li', null, last
        ? h('span', { 'aria-current': 'page', text: c.name })
        : h('a', { href: Navigation.formatHash(c.id), text: c.name })));
    });
  }

  const TYPE_LABEL = { root: 'Overview', competency: 'Competency', metric: 'Metric' };

  function scoreBar(score) {
    const bar = h('div', { class: 'bar', role: 'presentation' }, h('span', { class: 'bar-fill' }));
    bar.firstChild.style.width = `${score === null ? 0 : score * 10}%`;
    bar.firstChild.style.background = Scoring.scoreColor(score);
    return bar;
  }

  function renderBranch(view, node) {
    const roll = App.rollups[node.id];
    const kids = App.model.children(node.id);
    const allMetrics = kids.every((k) => k.type === 'metric');
    const pct = roll.totalMetrics ? Math.round((roll.scoredMetrics / roll.totalMetrics) * 100) : 0;

    view.appendChild(h('section', { class: 'card node-head' }, [
      h('div', { class: 'node-head-text' }, [
        h('span', { class: `chip chip--${node.type}`, text: TYPE_LABEL[node.type] }),
        h('h2', { tabindex: '-1', text: node.name }),
        node.description ? h('p', { class: 'muted', text: node.description }) : null,
        node.weight !== 1 ? h('p', { class: 'weight-note', text: `Weighted ×${node.weight} in its parent's score` }) : null,
      ]),
      h('div', { class: 'score-summary' }, [
        h('div', { class: 'score-big', style: `color:${Scoring.scoreColor(roll.score)}` }, [
          Scoring.formatScore(roll.score, false), h('small', { text: '/10' }),
        ]),
        h('div', { class: 'level', text: Scoring.levelFor(roll.score) }),
        h('div', { class: 'coverage' }, [
          h('div', { class: 'coverage-text', text: `${roll.scoredMetrics} of ${roll.totalMetrics} metrics assessed` }),
          h('div', { class: 'bar bar--coverage' }, h('span', { class: 'bar-fill', style: `width:${pct}%` })),
        ]),
      ]),
    ]));

    const radarBox = h('div', { class: 'radar-box' });
    view.appendChild(h('section', { class: 'card radar-card' }, [
      h('div', { class: 'card-title-row' }, [
        h('h3', { text: 'Radar' }),
        h('span', { class: 'muted small', text: `${kids.length} axes · tap a label or sector to open it` }),
      ]),
      radarBox,
    ]));
    const radarOpts = {
      title: `${node.name} radar chart`,
      axes: kids.map((k) => ({ id: k.id, label: k.name, value: App.rollups[k.id].score })),
      onSelect: (cid) => navigateTo(cid),
    };
    Radar.render(radarBox, radarOpts);
    App.radar = { box: radarBox, opts: radarOpts };

    const grid = h('div', { class: 'child-grid' });
    kids.forEach((k) => {
      const r = App.rollups[k.id];
      const isMetric = k.type === 'metric';
      const hasNote = isMetric && !!App.state.notes[k.id];
      grid.appendChild(h('a', { class: `child-card child-card--${k.type}`, href: Navigation.formatHash(k.id) }, [
        h('div', { class: 'child-card-top' }, [
          h('span', { class: 'child-name', text: k.name }),
          h('span', { class: 'child-score', style: `color:${Scoring.scoreColor(r.score)}`, text: Scoring.formatScore(r.score, isMetric) }),
        ]),
        h('p', { class: 'child-desc', text: k.description }),
        scoreBar(r.score),
        h('div', { class: 'child-meta' }, [
          h('span', { text: Scoring.levelFor(r.score) }),
          h('span', { text: isMetric ? (hasNote ? 'Has notes' : 'Metric') : `${r.scoredMetrics}/${r.totalMetrics} assessed` }),
        ]),
      ]));
    });
    view.appendChild(h('section', { class: 'children-section' }, [
      h('h3', { text: allMetrics ? 'Metrics' : 'Competencies' }),
      grid,
    ]));
  }

  function renderMetric(view, node) {
    const parent = App.model.parent(node.id);
    const idx = App.model.metricIds.indexOf(node.id);
    const prevId = idx > 0 ? App.model.metricIds[idx - 1] : null;
    const nextId = idx < App.model.metricIds.length - 1 ? App.model.metricIds[idx + 1] : null;

    view.appendChild(h('section', { class: 'card node-head node-head--metric' }, [
      h('div', { class: 'node-head-text' }, [
        h('span', { class: 'chip chip--metric', text: 'Metric' }),
        h('h2', { tabindex: '-1', text: node.name }),
        h('p', { class: 'muted', text: node.description }),
        parent ? h('p', { class: 'small' }, ['Part of ', h('a', { href: Navigation.formatHash(parent.id), text: parent.name })]) : null,
      ]),
    ]));

    // Score editor
    const output = h('output', { class: 'score-big', id: 'score-output', for: 'score-slider' });
    const level = h('span', { class: 'level-pill' });
    const slider = h('input', { type: 'range', id: 'score-slider', min: '0', max: '10', step: '1', 'aria-label': `Score for ${node.name}` });
    const ticks = h('div', { class: 'slider-ticks', 'aria-hidden': 'true' },
      Array.from({ length: 11 }, (_, i) => h('span', { class: i % 2 === 0 ? 'major' : '', text: String(i) })));
    const current = () => (Object.prototype.hasOwnProperty.call(App.state.scores, node.id) ? App.state.scores[node.id] : null);
    const step = (d) => setScore(node.id, Math.max(0, Math.min(10, (current() === null ? (d > 0 ? -1 : 1) : current()) + d)));
    const minus = h('button', { type: 'button', class: 'btn stepper', 'aria-label': 'Decrease score', onclick: () => step(-1) }, '−');
    const plus = h('button', { type: 'button', class: 'btn stepper', 'aria-label': 'Increase score', onclick: () => step(1) }, '+');
    const clear = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => setScore(node.id, null) }, 'Clear score');
    const levelButtons = Scoring.SCALE.map((s) => h('button', {
      type: 'button', class: 'level-btn', 'data-value': s.value, onclick: () => setScore(node.id, s.value),
    }, [h('strong', { text: String(s.value) }), h('span', { text: s.label })]));

    slider.addEventListener('input', () => setScore(node.id, Number(slider.value)));

    view.appendChild(h('section', { class: 'card score-editor', 'aria-label': 'Score editor' }, [
      h('div', { class: 'card-title-row' }, [h('h3', { text: 'Score' }), clear]),
      h('div', { class: 'score-readout' }, [output, h('span', { class: 'score-max', text: '/ 10' }), level]),
      h('div', { class: 'slider-row' }, [minus, h('div', { class: 'slider-wrap' }, [slider, ticks]), plus]),
      h('div', { class: 'level-buttons', role: 'group', 'aria-label': 'Set score by level' }, levelButtons),
    ]));

    // Notes
    const notes = h('textarea', { id: 'notes', rows: '6', placeholder: 'Observations, evidence, drills to practise…', 'aria-label': `Notes for ${node.name}` });
    notes.value = App.state.notes[node.id] || '';
    notes.addEventListener('input', () => setNote(node.id, notes.value));
    notes.addEventListener('blur', () => App.autosave.flush());
    view.appendChild(h('section', { class: 'card notes-card' }, [
      h('div', { class: 'card-title-row' }, [h('h3', { text: 'Notes' }), h('label', { for: 'notes', class: 'muted small', text: 'Autosaved' })]),
      notes,
    ]));

    view.appendChild(h('nav', { class: 'pager', 'aria-label': 'Metric navigation' }, [
      prevId ? h('a', { class: 'btn', href: Navigation.formatHash(prevId) }, ['← ', App.model.get(prevId).name]) : h('span'),
      nextId ? h('a', { class: 'btn', href: Navigation.formatHash(nextId) }, [App.model.get(nextId).name, ' →']) : h('span'),
    ]));

    const refresh = () => {
      const s = current();
      output.textContent = s === null ? '—' : String(s);
      output.style.color = Scoring.scoreColor(s);
      level.textContent = Scoring.levelFor(s);
      slider.value = String(s === null ? 0 : s);
      slider.classList.toggle('is-unset', s === null);
      slider.setAttribute('aria-valuetext', s === null ? 'Not assessed' : `${s} — ${Scoring.levelFor(s)}`);
      clear.disabled = s === null;
      levelButtons.forEach((b) => b.setAttribute('aria-pressed', String(s !== null && Number(b.dataset.value) === s)));
    };
    refresh();
    App.metricView = { id: node.id, refresh };
  }

  // ---- Import / export ----------------------------------------------------------------------
  async function exportFile() {
    App.autosave.flush();
    const data = Storage.exportAssessment(App.model, App.state);
    const counts = `${Object.keys(data.scores).length} scores and ${Object.keys(data.notes).length} notes`;
    try {
      // Must run straight from the click so the browser allows the save dialog.
      const result = await Storage.saveJSON('assessment.json', data);
      if (result.status === 'cancelled') return;
      if (result.status === 'saved') {
        toast(`Saved ${counts} to ${result.name}`);
      } else {
        if (result.error) console.warn('[Boat Skills] Save dialog unavailable:', result.error);
        toast(`Downloaded ${counts} as assessment.json`);
        showExportHelp(false);
      }
    } catch (e) {
      toast(`Export failed: ${e.message}`, 'error');
    }
  }

  // Safari and Firefox give web pages no save-dialog API; a download goes wherever the
  // browser's own download setting says. This explains how to make the browser ask.
  const EXPORT_HELP_KEY = 'boatSkills.hideExportHelp';
  const EXPORT_HELP = {
    safari: {
      browser: 'Safari',
      steps: ['Open Safari ▸ Settings… (⌘,) and choose the General tab.', 'Set “File download location” to “Ask for each download”.'],
    },
    firefox: {
      browser: 'Firefox',
      steps: ['Open Firefox ▸ Settings (⌘,) and stay on the General panel.', 'Under “Files and Applications ▸ Downloads”, turn on “Always ask you where to save files”.'],
    },
    chrome: {
      browser: 'Chrome',
      steps: ['Open Chrome ▸ Settings ▸ Downloads.', 'Turn on “Ask where to save each file before downloading”.'],
    },
    edge: {
      browser: 'Edge',
      steps: ['Open Edge ▸ Settings ▸ Downloads.', 'Turn on “Ask me what to do with each download”.'],
    },
    other: {
      browser: 'your browser',
      steps: ['Open your browser’s settings and find the Downloads section.', 'Turn on the option to ask where to save each file.'],
    },
  };

  function showExportHelp(force) {
    let hidden = false;
    try {
      hidden = global.localStorage.getItem(EXPORT_HELP_KEY) === '1';
    } catch (e) {
      hidden = false;
    }
    if (hidden && !force) return;
    const help = EXPORT_HELP[Storage.browserFamily(global.navigator.userAgent)];
    const body = $('export-help-body');
    body.textContent = '';
    body.appendChild(h('p', null, [
      `${help.browser} doesn’t let web pages open a Save dialog, so the file went to your browser’s download folder. `,
      `To choose the folder every time you export, change one ${help.browser} setting:`,
    ]));
    body.appendChild(h('ol', { class: 'help-steps' }, help.steps.map((s) => h('li', { text: s }))));
    body.appendChild(h('p', { class: 'muted small', text: 'After that, Export shows a Save dialog where you can pick any folder, including one on an external drive.' }));
    $('export-help-hide').checked = hidden;
    $('export-help').hidden = false;
    doc.body.classList.add('modal-open');
    $('export-help-ok').focus();
  }

  function closeExportHelp() {
    try {
      if ($('export-help-hide').checked) global.localStorage.setItem(EXPORT_HELP_KEY, '1');
      else global.localStorage.removeItem(EXPORT_HELP_KEY);
    } catch (e) {
      /* preference can't be stored; the help will show again next time */
    }
    $('export-help').hidden = true;
    doc.body.classList.remove('modal-open');
    $('btn-export').focus();
  }

  function clearAssessment() {
    const nScores = Object.keys(App.state.scores).length;
    const nNotes = Object.keys(App.state.notes).length;
    if (!nScores && !nNotes) {
      toast('The assessment is already blank.');
      return;
    }
    const ok = global.confirm(
      `Clear all ${nScores} scores and ${nNotes} notes stored in this browser?\n\n` +
      'This cannot be undone. Use Export first if you want to keep a copy.'
    );
    if (!ok) return;
    App.state = Storage.clearAssessment(App.store);
    recompute();
    updateTreeScores();
    setAllExpanded(false);
    navigateTo(App.model.rootId);
    App.autosave.flush();
    toast('Assessment cleared — ready for a new sailor.');
  }

  async function importFile(file) {
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch (e) {
      toast('Could not read the file.', 'error');
      return;
    }
    let result;
    try {
      result = Storage.importAssessment(App.model, text);
    } catch (e) {
      toast(`Import failed: ${e.message}`, 'error');
      return;
    }
    const existing = Object.keys(App.state.scores).length + Object.keys(App.state.notes).length;
    if (existing > 0 && !global.confirm(`Replace your current assessment (${Object.keys(App.state.scores).length} scores, ${Object.keys(App.state.notes).length} notes) with ${file.name}?`)) {
      return;
    }
    App.state.scores = result.state.scores;
    App.state.notes = result.state.notes;
    recompute();
    App.autosave.flush();
    updateTreeScores();
    render(App.nav.current());
    const skipped = result.report.skipped.length;
    toast(`Imported ${result.report.scores} scores and ${result.report.notes} notes${skipped ? ` · ${skipped} entries skipped` : ''}`, skipped ? 'warn' : null);
    if (skipped) console.warn('[Boat Skills] Skipped import entries:', result.report.skipped);
  }

  // ---- Tests panel ------------------------------------------------------------------------
  async function runTests() {
    let embedded = null;
    try {
      embedded = readEmbedded();
    } catch (e) {
      embedded = null;
    }
    const btn = $('btn-tests');
    btn.disabled = true;
    let outcome;
    try {
      outcome = await Tests.run({ data: App.data, source: App.source, embedded });
    } finally {
      btn.disabled = false;
    }
    const { results, summary } = outcome;
    const panel = $('tests-panel');
    const body = $('tests-body');
    body.textContent = '';
    const allPass = summary.fail === 0;
    body.appendChild(h('div', { class: `test-summary ${allPass ? 'is-pass' : 'is-fail'}`, role: 'status' }, [
      h('strong', { text: allPass ? 'All tests passed' : `${summary.fail} test${summary.fail === 1 ? '' : 's'} failed` }),
      h('span', { text: `${summary.pass} passed · ${summary.fail} failed · ${summary.skip} skipped · ${summary.total} total · ${summary.durationMs} ms` }),
    ]));
    const groups = [];
    results.forEach((r) => {
      if (!groups.includes(r.group)) groups.push(r.group);
    });
    groups.forEach((g) => {
      const rs = results.filter((r) => r.group === g);
      const failed = rs.filter((r) => r.status === 'fail').length;
      body.appendChild(h('section', { class: 'test-group' }, [
        h('h3', null, [g, h('span', { class: `test-count ${failed ? 'is-fail' : 'is-pass'}`, text: `${rs.length - failed}/${rs.length}` })]),
        h('ul', { class: 'test-list' }, rs.map((r) => h('li', { class: `test test--${r.status}` }, [
          h('span', { class: 'test-icon', 'aria-hidden': 'true', text: r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–' }),
          h('span', { class: 'test-name' }, [r.name, h('span', { class: 'sr-only', text: ` — ${r.status}` })]),
          r.error ? h('code', { class: 'test-error', text: r.error }) : null,
        ]))),
      ]));
    });
    panel.hidden = false;
    doc.body.classList.add('modal-open');
    doc.body.dataset.tests = allPass ? 'pass' : 'fail';
    $('tests-close').focus();
    console.info(`[Boat Skills tests] ${summary.pass} passed, ${summary.fail} failed, ${summary.skip} skipped`);
    results.filter((r) => r.status === 'fail').forEach((r) => console.error(`[Boat Skills tests] FAIL ${r.group} › ${r.name}: ${r.error}`));
    return summary;
  }

  function closeTests() {
    $('tests-panel').hidden = true;
    doc.body.classList.remove('modal-open');
    $('btn-tests').focus();
  }

  // ---- Startup ------------------------------------------------------------------------------
  function bindChrome() {
    $('btn-tests').addEventListener('click', runTests);
    $('tests-close').addEventListener('click', closeTests);
    $('tests-panel').addEventListener('click', (e) => {
      if (e.target === $('tests-panel')) closeTests();
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('export-help').hidden) closeExportHelp();
      else if (!$('tests-panel').hidden) closeTests();
      else if (doc.body.classList.contains('tree-open')) setDrawer(false);
    });
  }

  function bindApp() {
    $('btn-export').addEventListener('click', exportFile);
    $('btn-clear').addEventListener('click', clearAssessment);
    $('export-help-ok').addEventListener('click', closeExportHelp);
    $('export-help-close').addEventListener('click', closeExportHelp);
    $('export-help').addEventListener('click', (e) => {
      if (e.target === $('export-help')) closeExportHelp();
    });
    $('import-file').addEventListener('change', (e) => {
      importFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
    $('tree-toggle').addEventListener('click', () => setDrawer(!doc.body.classList.contains('tree-open')));
    $('tree-close').addEventListener('click', () => setDrawer(false));
    $('scrim').addEventListener('click', () => setDrawer(false));
    $('expand-all').addEventListener('click', () => setAllExpanded(true));
    $('collapse-all').addEventListener('click', () => setAllExpanded(false));
    global.addEventListener('hashchange', onHashChange);
    let resizeTimer = null;
    global.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Redraw the radar when the container crosses a label-size breakpoint.
        const r = App.radar;
        if (!r || !r.box.isConnected) return;
        const w = r.box.clientWidth;
        const boost = w < 420 ? 1.55 : w < 560 ? 1.3 : 1;
        if (boost !== r.box.__radarBoost) Radar.render(r.box, r.opts);
      }, 150);
    });
    global.addEventListener('beforeunload', () => App.autosave.flush());
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') App.autosave.flush();
    });
  }

  async function start() {
    bindChrome();
    let loaded;
    try {
      loaded = await loadHierarchy();
    } catch (e) {
      showStartupError('The hierarchy could not be loaded', [e.message]);
      return;
    }
    App.data = loaded.data;
    App.source = loaded.source;

    const validation = Validation.validateHierarchy(loaded.data);
    if (!validation.valid) {
      showStartupError('Hierarchy validation failed', validation.errors.map((e) => `[${e.code}] ${e.message}`));
      return;
    }

    App.model = Model.createModel(loaded.data);
    App.store = Storage.createStore();
    App.state = App.store.load(App.model);
    App.autosave = Storage.createAutosaver(() => App.store.save(App.state), 400, onSaved);
    recompute();

    $('app').hidden = false;
    ['btn-export', 'btn-import-label'].forEach((id) => $(id).removeAttribute('aria-disabled'));
    $('import-file').disabled = false;
    $('btn-export').disabled = false;
    $('btn-clear').disabled = false;
    $('source-note').textContent = `${validation.stats.competencies} competencies · ${validation.stats.metrics} metrics · v${App.model.meta.version}${loaded.source === 'embedded' ? ' · embedded copy (file://)' : ''}`;
    $('save-status').textContent = App.store.persistent ? 'All changes saved' : 'Browser storage unavailable — changes last for this session only';
    if (App.store.lastError) toast(App.store.lastError, 'warn');

    buildTree();
    updateTreeScores();
    bindApp();

    const fromHash = Navigation.parseHash(global.location.hash);
    const initial = fromHash && App.model.has(fromHash) ? fromHash : App.state.lastViewed || App.model.rootId;
    App.nav = Navigation.createNavigator(App.model, initial);
    navigateTo(initial, true);
    doc.body.dataset.startup = 'ok';
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
