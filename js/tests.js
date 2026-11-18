/*
 * Boat Skills — tests.js
 * In-app test suite run from the "Run Tests" button. Tests use in-memory storage and
 * detached DOM nodes so they never touch the user's saved assessment or the live UI.
 * run(ctx) — ctx: { data: loaded hierarchy JSON, source, embedded: embedded copy or null }
 */
(function (global) {
  'use strict';
  const BS = (global.BoatSkills = global.BoatSkills || {});
  const SKIP = { skip: true };

  // ---- assertions -------------------------------------------------------------
  class AssertionError extends Error {}
  const fail = (msg) => {
    throw new AssertionError(msg);
  };
  const ok = (cond, msg) => {
    if (!cond) fail(msg || 'Expected condition to be true');
  };
  const stable = (v) => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  };
  const equal = (actual, expected, msg) => {
    if (actual !== expected) fail(`${msg || 'Values differ'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const deepEqual = (actual, expected, msg) => {
    const a = stable(actual);
    const e = stable(expected);
    if (a !== e) fail(`${msg || 'Structures differ'}: expected ${e.slice(0, 300)}, got ${a.slice(0, 300)}`);
  };
  const approx = (actual, expected, msg, eps) => {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > (eps || 1e-9)) fail(`${msg || 'Numbers differ'}: expected ≈${expected}, got ${actual}`);
  };
  const throws = (fn, pattern, msg) => {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
      if (pattern && !pattern.test(e.message)) fail(`${msg || 'Wrong error'}: "${e.message}" does not match ${pattern}`);
    }
    if (!threw) fail(msg || 'Expected function to throw');
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const codes = (result) => result.errors.map((e) => e.code);
  const hasCode = (data, code) => {
    const r = BS.Validation.validateHierarchy(data);
    ok(!r.valid, `Expected validation to fail with ${code}`);
    ok(codes(r).includes(code), `Expected error code ${code}, got ${codes(r).join(', ') || 'none'}`);
    return r;
  };

  // ---- fixtures ---------------------------------------------------------------
  //  root ─ A (w1) ─ a1 (metric), a2 (metric, w3)
  //       └ B (w2) ─ B1 ─ b1 (metric)
  //                └ b2 (metric)
  function fixture() {
    return {
      id: 'fixture',
      name: 'Fixture',
      version: 't',
      rootId: 'root',
      nodes: [
        { id: 'root', type: 'root', name: 'Root', children: ['A', 'B'] },
        { id: 'A', type: 'competency', name: 'Alpha', weight: 1, children: ['a1', 'a2'] },
        { id: 'a1', type: 'metric', name: 'Alpha One', children: [] },
        { id: 'a2', type: 'metric', name: 'Alpha Two', weight: 3, children: [] },
        { id: 'B', type: 'competency', name: 'Bravo', weight: 2, children: ['B1', 'b2'] },
        { id: 'B1', type: 'competency', name: 'Bravo Sub', children: ['b1'] },
        { id: 'b1', type: 'metric', name: 'Bravo One', children: [] },
        { id: 'b2', type: 'metric', name: 'Bravo Two', children: [] },
      ],
    };
  }
  const node = (data, id) => data.nodes.find((n) => n.id === id);
  const fixtureModel = () => BS.Model.createModel(fixture());

  // ---- suite --------------------------------------------------------------------
  function buildSuite(ctx) {
    const tests = [];
    const test = (group, name, fn) => tests.push({ group, name, fn });
    const realData = () => {
      if (!ctx || !ctx.data) fail('The hierarchy did not load, so it cannot be tested');
      return ctx.data;
    };
    let realModelCache = null;
    const realModel = () => {
      if (!realModelCache) {
        const v = BS.Validation.validateHierarchy(realData());
        if (!v.valid) fail('Hierarchy is invalid: ' + v.errors[0].message);
        realModelCache = BS.Model.createModel(realData());
      }
      return realModelCache;
    };
    const { Validation, Model, Navigation, Scoring, Storage, Radar } = BS;

    // Hierarchy validation
    const H = 'Hierarchy validation';
    test(H, 'fixture hierarchy is valid', () => {
      const r = Validation.validateHierarchy(fixture());
      ok(r.valid, 'Errors: ' + r.errors.map((e) => e.message).join('; '));
    });
    test(H, 'data/hierarchy.json is valid', () => {
      const r = Validation.validateHierarchy(realData());
      ok(r.valid, 'Errors: ' + r.errors.map((e) => e.message).join('; '));
    });
    test(H, 'hierarchy has 40–60 competencies and 150–250 metrics', () => {
      const s = Validation.validateHierarchy(realData()).stats;
      ok(s.competencies >= 40 && s.competencies <= 60, `competencies = ${s.competencies}`);
      ok(s.metrics >= 150 && s.metrics <= 250, `metrics = ${s.metrics}`);
    });
    test(H, 'root is "Boat Skills" with the six required top-level areas', () => {
      const m = realModel();
      equal(m.get(m.rootId).name, 'Boat Skills', 'Root name');
      deepEqual(m.children(m.rootId).map((n) => n.name),
        ['Boat Handling', 'Starting', 'Upwind Performance', 'Downwind Performance', 'Mark Roundings', 'Racing Strategy'], 'Top level');
    });
    test(H, 'content is boat-neutral (no jib or spinnaker specific competencies)', () => {
      realData().nodes.forEach((n) => {
        const text = `${n.name} ${n.description || ''}`;
        ok(!/\b(jib|jibs|spinnaker|spinnakers|genoa|gennaker|kite)\b/i.test(text), `Sail-specific wording in "${n.id}"`);
      });
    });
    test(H, 'rejects a non-object and a missing nodes array', () => {
      hasCode(null, 'FORMAT');
      hasCode({ rootId: 'root' }, 'FORMAT');
    });
    test(H, 'rejects a missing root', () => {
      const d = fixture();
      d.rootId = 'nope';
      hasCode(d, 'ROOT_MISSING');
    });
    test(H, 'rejects a root with the wrong type', () => {
      const d = fixture();
      node(d, 'root').type = 'competency';
      hasCode(d, 'ROOT_TYPE');
    });
    test(H, 'rejects missing child references', () => {
      const d = fixture();
      node(d, 'A').children.push('ghost');
      hasCode(d, 'MISSING_REFERENCE');
    });
    test(H, 'rejects cycles', () => {
      const d = fixture();
      node(d, 'B1').children.push('B');
      hasCode(d, 'CYCLE');
    });
    test(H, 'rejects self-references', () => {
      const d = fixture();
      node(d, 'B1').children.push('B1');
      hasCode(d, 'CYCLE');
    });
    test(H, 'rejects orphans', () => {
      const d = fixture();
      d.nodes.push({ id: 'lonely', type: 'metric', name: 'Lonely', children: [] });
      const r = hasCode(d, 'ORPHAN');
      ok(codes(r).includes('UNREACHABLE'), 'Orphan should also be unreachable');
    });
    test(H, 'rejects unreachable islands (parented but disconnected)', () => {
      const d = fixture();
      d.nodes.push({ id: 'p', type: 'competency', name: 'P', children: ['q'] });
      d.nodes.push({ id: 'q', type: 'competency', name: 'Q', children: ['p'] });
      const r = hasCode(d, 'UNREACHABLE');
      ok(!codes(r).includes('ORPHAN'), 'Island nodes have parents, so they are not orphans');
      ok(codes(r).includes('CYCLE'), 'Island cycle should be detected');
    });
    test(H, 'rejects nodes with two parents', () => {
      const d = fixture();
      node(d, 'A').children.push('b2');
      hasCode(d, 'PARENT_MAP');
    });
    test(H, 'rejects invalid node types', () => {
      const d = fixture();
      node(d, 'a1').type = 'skill';
      hasCode(d, 'NODE_TYPE');
    });
    test(H, 'rejects metrics with children', () => {
      const d = fixture();
      node(d, 'a1').children.push('a2');
      node(d, 'A').children = ['a1'];
      hasCode(d, 'NODE_TYPE');
    });
    test(H, 'rejects competencies without children', () => {
      const d = fixture();
      d.nodes.push({ id: 'C', type: 'competency', name: 'Empty', children: [] });
      node(d, 'root').children.push('C');
      hasCode(d, 'NODE_TYPE');
    });
    test(H, 'rejects metrics placed directly under the root', () => {
      const d = fixture();
      d.nodes.push({ id: 'm', type: 'metric', name: 'Loose', children: [] });
      node(d, 'root').children.push('m');
      hasCode(d, 'NODE_TYPE');
    });
    test(H, 'rejects duplicate ids', () => {
      const d = fixture();
      d.nodes.push({ id: 'a1', type: 'metric', name: 'Dup', children: [] });
      hasCode(d, 'DUPLICATE_ID');
    });
    test(H, 'rejects scores stored in the hierarchy', () => {
      const d = fixture();
      node(d, 'A').score = 5;
      hasCode(d, 'STORED_SCORE');
    });
    test(H, 'rejects invalid weights', () => {
      const d = fixture();
      node(d, 'A').weight = -1;
      hasCode(d, 'NODE_SHAPE');
    });

    // Parent map
    const P = 'Parent map';
    test(P, 'maps every child to its parent', () => {
      const { parentMap, errors } = Model.buildParentMap(fixture().nodes);
      equal(errors.length, 0, 'Errors');
      deepEqual(parentMap, { A: 'root', B: 'root', a1: 'A', a2: 'A', B1: 'B', b2: 'B', b1: 'B1' }, 'Parent map');
    });
    test(P, 'root has no parent', () => {
      ok(!Object.prototype.hasOwnProperty.call(fixtureModel().parentMap, 'root'), 'Root must not be in the parent map');
    });
    test(P, 'detects multiple parents and duplicate child entries', () => {
      const nodes = fixture().nodes;
      nodes.find((n) => n.id === 'A').children.push('b1', 'a1');
      const { errors } = Model.buildParentMap(nodes);
      ok(errors.some((e) => /multiple parents/.test(e)), 'Multiple parents not reported');
      ok(errors.some((e) => /more than once/.test(e)), 'Duplicate child not reported');
    });
    test(P, 'model parent map is frozen and consistent with children', () => {
      const m = realModel();
      ok(Object.isFrozen(m.parentMap), 'Parent map should be frozen');
      equal(Object.keys(m.parentMap).length, m.order.length - 1, 'Every non-root node has exactly one parent');
      m.order.forEach((id) => m.get(id).children.forEach((c) => equal(m.parentMap[c], id, `Parent of ${c}`)));
    });

    // Path generation
    const G = 'Path generation';
    test(G, 'path to root for a deep metric', () => {
      deepEqual(Navigation.pathToRoot(fixtureModel(), 'b1'), ['root', 'B', 'B1', 'b1'], 'Path');
    });
    test(G, 'path for the root is just the root', () => {
      deepEqual(Navigation.pathToRoot(fixtureModel(), 'root'), ['root'], 'Path');
    });
    test(G, 'unknown ids produce an empty path', () => {
      deepEqual(Navigation.pathToRoot(fixtureModel(), 'nope'), [], 'Path');
    });
    test(G, 'breadcrumbs carry names and types', () => {
      deepEqual(Navigation.breadcrumbs(fixtureModel(), 'a2'), [
        { id: 'root', name: 'Root', type: 'root' },
        { id: 'A', name: 'Alpha', type: 'competency' },
        { id: 'a2', name: 'Alpha Two', type: 'metric' },
      ], 'Breadcrumbs');
    });
    test(G, 'path generation guards against cycles', () => {
      const fake = { rootId: 'r', has: () => true, parentMap: { x: 'y', y: 'x' } };
      throws(() => Navigation.pathToRoot(fake, 'x'), /Cycle/);
    });
    test(G, 'every node in the hierarchy has a valid path to the root', () => {
      const m = realModel();
      m.order.forEach((id) => {
        const p = Navigation.pathToRoot(m, id);
        equal(p[0], m.rootId, `Path for ${id} starts at root`);
        equal(p[p.length - 1], id, `Path for ${id} ends at node`);
        equal(p.length - 1, m.depth(id), `Path length for ${id}`);
        for (let i = 1; i < p.length; i++) equal(m.parentMap[p[i]], p[i - 1], `Link ${p[i]}`);
      });
    });

    // Recursive scoring
    const S = 'Recursive scoring';
    test(S, 'weighted average across levels', () => {
      const m = fixtureModel();
      const r = Scoring.computeRollups(m, { a1: 4, a2: 8, b1: 10, b2: 2 });
      approx(r.A.score, (4 * 1 + 8 * 3) / 4, 'A');
      approx(r.B1.score, 10, 'B1');
      approx(r.B.score, 6, 'B');
      approx(r.root.score, (7 * 1 + 6 * 2) / 3, 'root');
      equal(r.root.scoredMetrics, 4, 'scored');
      equal(r.root.totalMetrics, 4, 'total');
    });
    test(S, 'unscored metrics are excluded from averages', () => {
      const r = Scoring.computeRollups(fixtureModel(), { a1: 4 });
      approx(r.A.score, 4, 'A');
      equal(r.B.score, null, 'B');
      approx(r.root.score, 4, 'root');
      equal(r.root.scoredMetrics, 1, 'scored');
    });
    test(S, 'no scores gives null everywhere', () => {
      const r = Scoring.computeRollups(fixtureModel(), {});
      ['root', 'A', 'B', 'B1', 'a1'].forEach((id) => equal(r[id].score, null, id));
    });
    test(S, 'zero is a real score, not "unscored"', () => {
      const r = Scoring.computeRollups(fixtureModel(), { a1: 0, a2: 10 });
      approx(r.A.score, 7.5, 'A');
      equal(r.A.scoredMetrics, 2, 'scored');
    });
    test(S, 'only metrics accept scores; parents cannot be stored', () => {
      const m = fixtureModel();
      throws(() => Scoring.setMetricScore(m, {}, 'A', 5), /not a metric/);
      throws(() => Scoring.setMetricScore(m, {}, 'root', 5), /not a metric/);
      throws(() => Scoring.setMetricScore(m, {}, 'zzz', 5), /Unknown/);
    });
    test(S, 'setMetricScore is immutable and clears on null', () => {
      const m = fixtureModel();
      const before = { a1: 3 };
      const after = Scoring.setMetricScore(m, before, 'a2', 9);
      deepEqual(before, { a1: 3 }, 'Input mutated');
      deepEqual(after, { a1: 3, a2: 9 }, 'Result');
      deepEqual(Scoring.setMetricScore(m, after, 'a1', null), { a2: 9 }, 'Cleared');
    });
    test(S, 'scores are normalised to integers 0–10', () => {
      equal(Scoring.normalizeScore(11), 10, '11');
      equal(Scoring.normalizeScore(-2), 0, '-2');
      equal(Scoring.normalizeScore(6.6), 7, '6.6');
      equal(Scoring.normalizeScore('5'), 5, '"5"');
      equal(Scoring.normalizeScore('abc'), null, 'abc');
      equal(Scoring.normalizeScore(null), null, 'null');
    });
    test(S, 'level labels follow the 0–10 scale', () => {
      equal(Scoring.levelFor(0), 'Not Demonstrated', '0');
      equal(Scoring.levelFor(2), 'Beginner', '2');
      equal(Scoring.levelFor(5), 'Developing', '5');
      equal(Scoring.levelFor(6.4), 'Competent', '6.4');
      equal(Scoring.levelFor(8), 'Proficient', '8');
      equal(Scoring.levelFor(10), 'Expert', '10');
      equal(Scoring.levelFor(null), 'Not assessed', 'null');
    });
    test(S, 'full hierarchy rolls up uniform scores exactly', () => {
      const m = realModel();
      [0, 6, 10].forEach((v) => {
        const scores = {};
        m.metricIds.forEach((id) => {
          scores[id] = v;
        });
        const r = Scoring.computeRollups(m, scores);
        m.order.forEach((id) => approx(r[id].score, v, `${id} with all ${v}`));
        equal(r[m.rootId].scoredMetrics, m.metricIds.length, 'All scored');
      });
    });
    test(S, 'rollups never write parent scores into the assessment', () => {
      const m = fixtureModel();
      const scores = { a1: 5, b1: 6 };
      Scoring.computeRollups(m, scores);
      deepEqual(Object.keys(scores).sort(), ['a1', 'b1'], 'Scores object changed');
    });

    // Import / export
    const I = 'Import/export';
    const sampleState = () => ({ scores: { a1: 4, a2: 8, b1: 0 }, notes: { a1: 'Late on the tack', b2: 'Practise in breeze' }, lastViewed: 'B' });
    test(I, 'export contains only metric scores and notes', () => {
      const out = Storage.exportAssessment(fixtureModel(), sampleState());
      equal(out.format, Storage.EXPORT_FORMAT, 'format');
      deepEqual(out.scores, { a1: 4, a2: 8, b1: 0 }, 'scores');
      deepEqual(out.notes, { a1: 'Late on the tack', b2: 'Practise in breeze' }, 'notes');
      ok(!('A' in out.scores) && !('root' in out.scores), 'Parent scores must not be exported');
    });
    test(I, 'export → JSON → import round-trip preserves scores and notes', () => {
      const m = fixtureModel();
      const text = JSON.stringify(Storage.exportAssessment(m, sampleState()));
      const { state, report } = Storage.importAssessment(m, text);
      deepEqual(state.scores, sampleState().scores, 'scores');
      deepEqual(state.notes, sampleState().notes, 'notes');
      equal(report.scores, 3, 'score count');
      equal(report.notes, 2, 'note count');
      equal(report.skipped.length, 0, 'skipped');
    });
    test(I, 'round-trip on the full hierarchy', () => {
      const m = realModel();
      const st = Storage.emptyState();
      m.metricIds.forEach((id, i) => {
        st.scores[id] = i % 11;
        if (i % 7 === 0) st.notes[id] = `Note ${i} — "quoted" & <tagged>`;
      });
      const { state } = Storage.importAssessment(m, JSON.stringify(Storage.exportAssessment(m, st)));
      deepEqual(state.scores, st.scores, 'scores');
      deepEqual(state.notes, st.notes, 'notes');
    });
    test(I, 'rejects invalid files', () => {
      const m = fixtureModel();
      throws(() => Storage.importAssessment(m, '{not json'), /not valid JSON/);
      throws(() => Storage.importAssessment(m, '[]'), /assessment object/);
      throws(() => Storage.importAssessment(m, '{"scores":{}}'), /Not a Boat Skills/);
      throws(() => Storage.importAssessment(m, { format: Storage.EXPORT_FORMAT, scores: [] }), /must be an object/);
      throws(() => Storage.importAssessment(m, { format: Storage.EXPORT_FORMAT, formatVersion: 99 }), /newer/);
    });
    test(I, 'skips parent scores, unknown ids and invalid values', () => {
      const m = fixtureModel();
      const { state, report } = Storage.importAssessment(m, {
        format: Storage.EXPORT_FORMAT,
        scores: { a1: 6, A: 9, root: 3, ghost: 5, a2: 11, b1: 'high', b2: 2 },
        notes: { a2: 'ok', A: 'parent note', ghost: 'x', b1: 42 },
      });
      deepEqual(state.scores, { a1: 6, b2: 2 }, 'scores');
      deepEqual(state.notes, { a2: 'ok' }, 'notes');
      equal(report.skipped.length, 8, 'skipped count');
    });
    test(I, 'import never modifies the hierarchy', () => {
      const data = fixture();
      const m = BS.Model.createModel(data);
      const snapshot = stable(m.order.map((id) => m.get(id)));
      Storage.importAssessment(m, { format: Storage.EXPORT_FORMAT, scores: { a1: 5 }, notes: { a1: 'n' } });
      equal(stable(m.order.map((id) => m.get(id))), snapshot, 'Hierarchy changed');
      ok(Object.isFrozen(m.get('a1')) && Object.isFrozen(m.nodes), 'Hierarchy nodes must be frozen');
    });
    test(I, 'LocalStorage persistence round-trip (scores, notes, last viewed)', () => {
      const m = fixtureModel();
      const store = Storage.createStore(Storage.memoryBackend(), 'test.key');
      ok(store.save(sampleState()), 'save failed');
      deepEqual(store.load(m), sampleState(), 'loaded state');
      store.clear();
      deepEqual(store.load(m), Storage.emptyState(), 'cleared state');
    });
    test(I, 'corrupted storage loads as an empty assessment', () => {
      const backend = Storage.memoryBackend();
      backend.setItem('k', '{broken');
      const store = Storage.createStore(backend, 'k');
      deepEqual(store.load(fixtureModel()), Storage.emptyState(), 'state');
      ok(store.lastError, 'error should be recorded');
    });
    test(I, 'autosaver flush saves immediately', () => {
      let saves = 0;
      const a = Storage.createAutosaver(() => {
        saves += 1;
        return true;
      }, 10000);
      a.schedule();
      ok(a.pending(), 'should be pending');
      a.flush();
      equal(saves, 1, 'saves');
      ok(!a.pending(), 'should not be pending');
    });

    test(I, 'clearing gives the next user a blank slate', () => {
      const m = fixtureModel();
      const store = Storage.createStore(Storage.memoryBackend(), 'clear.key');
      store.save(sampleState());
      const blank = Storage.clearAssessment(store);
      deepEqual(blank, Storage.emptyState(), 'returned state');
      deepEqual(store.load(m), Storage.emptyState(), 'stored state');
      const r = Scoring.computeRollups(m, blank.scores);
      equal(r.root.score, null, 'root score');
      equal(r.root.scoredMetrics, 0, 'scored metrics');
    });
    const fakeHandle = (log) => ({
      name: 'chosen-name.json',
      createWritable: async () => ({
        write: async (text) => {
          log.written = text;
        },
        close: async () => {
          log.closed = true;
        },
      }),
    });
    test(I, 'export uses the save dialog when the browser has one', async () => {
      const log = {};
      let pickerOpts = null;
      let fellBack = false;
      const data = Storage.exportAssessment(fixtureModel(), sampleState());
      const res = await Storage.saveJSON('assessment.json', data, {
        picker: async (o) => {
          pickerOpts = o;
          return fakeHandle(log);
        },
        fallback: () => {
          fellBack = true;
        },
      });
      deepEqual(res, { status: 'saved', name: 'chosen-name.json' }, 'result');
      equal(pickerOpts.suggestedName, 'assessment.json', 'suggested name');
      ok(log.closed, 'file not closed');
      deepEqual(JSON.parse(log.written), data, 'written content');
      ok(!fellBack, 'should not fall back to a download');
    });
    test(I, 'cancelling the save dialog writes nothing', async () => {
      let fellBack = false;
      const res = await Storage.saveJSON('assessment.json', {}, {
        picker: async () => {
          const e = new Error('cancelled');
          e.name = 'AbortError';
          throw e;
        },
        fallback: () => {
          fellBack = true;
        },
      });
      equal(res.status, 'cancelled', 'status');
      ok(!fellBack, 'should not download after cancel');
    });
    test(I, 'export falls back to a download without a save dialog', async () => {
      const calls = [];
      const fallback = (name) => calls.push(name);
      const none = await Storage.saveJSON('assessment.json', {}, { picker: undefined, fallback });
      equal(none.status, 'downloaded', 'no picker');
      equal(none.reason, 'unsupported', 'no picker reason');
      const blocked = await Storage.saveJSON('assessment.json', {}, {
        picker: async () => {
          const e = new Error('blocked');
          e.name = 'SecurityError';
          throw e;
        },
        fallback,
      });
      equal(blocked.status, 'downloaded', 'blocked picker');
      equal(blocked.reason, 'blocked', 'blocked reason');
      deepEqual(calls, ['assessment.json', 'assessment.json'], 'fallback calls');
    });

    test(I, 'browser detection picks the right export help', () => {
      const uas = {
        safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
        chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        edge: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        other: 'curl/8.0',
      };
      Object.keys(uas).forEach((k) => equal(Storage.browserFamily(uas[k]), k, k));
    });

    // Navigation
    const N = 'Navigation';
    test(N, 'navigator moves to valid nodes and rejects unknown ones', () => {
      const nav = Navigation.createNavigator(fixtureModel(), 'root');
      ok(nav.go('b1'), 'go b1');
      equal(nav.current(), 'b1', 'current');
      ok(!nav.go('nope'), 'unknown accepted');
      equal(nav.current(), 'b1', 'current after invalid');
    });
    test(N, 'invalid initial node falls back to the root', () => {
      equal(Navigation.createNavigator(fixtureModel(), 'nope').current(), 'root', 'current');
    });
    test(N, 'up() follows the hierarchy and stops at the root', () => {
      const nav = Navigation.createNavigator(fixtureModel(), 'b1');
      ok(nav.up(), 'up 1');
      equal(nav.current(), 'B1', 'B1');
      nav.up();
      nav.up();
      equal(nav.current(), 'root', 'root');
      ok(!nav.up(), 'cannot go above root');
    });
    test(N, 'child navigation by index', () => {
      const nav = Navigation.createNavigator(fixtureModel(), 'root');
      ok(nav.goChild(1), 'child 1');
      equal(nav.current(), 'B', 'B');
      ok(!nav.goChild(5), 'out of range');
      deepEqual(nav.children().map((n) => n.id), ['B1', 'b2'], 'children');
    });
    test(N, 'breadcrumbs come from the hierarchy, not navigation history', () => {
      const nav = Navigation.createNavigator(fixtureModel(), 'root');
      nav.go('b1');
      nav.go('B1');
      nav.go('a2');
      deepEqual(nav.breadcrumbs().map((b) => b.id), ['root', 'A', 'a2'], 'Breadcrumbs');
    });
    test(N, 'onChange fires on navigation', () => {
      const seen = [];
      const nav = Navigation.createNavigator(fixtureModel(), 'root', (id, prev) => seen.push(`${prev}>${id}`));
      nav.go('A');
      nav.go('A');
      nav.go('a1');
      deepEqual(seen, ['root>A', 'A>a1'], 'changes');
    });
    test(N, 'hash routes round-trip, including special characters', () => {
      ['root', 'boat-handling.tacking.entry-timing', 'a b/c#d&é'].forEach((id) => {
        equal(Navigation.parseHash(Navigation.formatHash(id)), id, id);
      });
      equal(Navigation.parseHash('#/other'), null, 'foreign hash');
      equal(Navigation.parseHash('#/n/%E0%A4%A'), null, 'malformed');
    });
    test(N, 'every node in the hierarchy is reachable by child navigation', () => {
      const m = realModel();
      let visited = 0;
      const walk = (id) => {
        visited += 1;
        const nav = Navigation.createNavigator(m, id);
        m.get(id).children.forEach((c, i) => {
          nav.go(id);
          ok(nav.goChild(i), `goChild ${i} from ${id}`);
          equal(nav.current(), c, `child of ${id}`);
          walk(c);
        });
      };
      walk(m.rootId);
      equal(visited, m.order.length, 'visited count');
    });

    // Radar
    const R = 'Radar';
    const hasDom = () => typeof global.document !== 'undefined' && !!global.document.createElementNS;
    test(R, 'renders any number of axes', () => {
      if (!hasDom()) return SKIP;
      [1, 2, 3, 7, 25].forEach((n) => {
        const div = global.document.createElement('div');
        const axes = Array.from({ length: n }, (_, i) => ({ id: `x${i}`, label: `Axis number ${i}`, value: i % 11 }));
        const res = Radar.render(div, { axes });
        equal(res.axisCount, n, 'axisCount');
        equal(div.querySelectorAll('.radar-sector').length, n, `sectors for ${n}`);
        equal(div.querySelectorAll('.radar-label').length, n, `labels for ${n}`);
        equal(div.querySelectorAll('.radar-dot').length, n, `dots for ${n}`);
        ok(div.querySelectorAll('.radar-ring').length === 5, 'grid rings');
        ok(div.querySelector('.radar-area'), 'score polygon');
      });
    });
    test(R, 'labels and sectors are clickable', () => {
      if (!hasDom()) return SKIP;
      const div = global.document.createElement('div');
      const picked = [];
      Radar.render(div, { axes: [{ id: 'p', label: 'P', value: 5 }, { id: 'q', label: 'Q', value: null }, { id: 'r', label: 'R', value: 10 }], onSelect: (id) => picked.push(id) });
      const click = (elx) => elx.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      click(div.querySelector('.radar-sector[data-id="q"]'));
      click(div.querySelector('.radar-label[data-id="r"] tspan'));
      deepEqual(picked, ['q', 'r'], 'selected ids');
    });
    test(R, 'score points scale with value', () => {
      const [x10, y10] = Radar.valuePoint(0, 4, 10, 10);
      approx(Math.hypot(x10, y10), Radar.RADIUS, 'max radius', 1e-6);
      const [x5, y5] = Radar.valuePoint(1, 4, 5, 10);
      approx(Math.hypot(x5, y5), Radar.RADIUS / 2, 'half radius', 1e-6);
      const [xn, yn] = Radar.valuePoint(2, 4, null, 10);
      approx(Math.hypot(xn, yn), 0, 'null at centre', 1e-6);
      approx(Radar.valuePoint(0, 4, 10, 10)[1], -Radar.RADIUS, 'first axis points up', 1e-6);
    });
    test(R, 'long labels wrap to at most three lines', () => {
      const lines = Radar.wrapLabel('Pressure Versus Shift Priority Extremely Long Label Here', 12);
      ok(lines.length <= 3, 'line count');
      lines.forEach((l) => ok(l.length <= 13, `line too long: ${l}`));
    });

    // Loading
    test('Loading', 'embedded fallback copy matches data/hierarchy.json', () => {
      if (!ctx || ctx.source !== 'data/hierarchy.json' || !ctx.embedded) return SKIP;
      deepEqual(ctx.embedded, ctx.data, 'Embedded hierarchy is out of date');
    });

    return tests;
  }

  /** Runs every test in order; async tests are awaited. Resolves to { results, summary }. */
  async function run(ctx) {
    const started = Date.now();
    const results = [];
    for (const t of buildSuite(ctx)) {
      try {
        const r = await t.fn();
        results.push({ group: t.group, name: t.name, status: r === SKIP ? 'skip' : 'pass' });
      } catch (e) {
        results.push({ group: t.group, name: t.name, status: 'fail', error: e && e.message ? e.message : String(e) });
      }
    }
    const count = (s) => results.filter((r) => r.status === s).length;
    return {
      results,
      summary: { total: results.length, pass: count('pass'), fail: count('fail'), skip: count('skip'), durationMs: Date.now() - started },
    };
  }

  BS.Tests = Object.freeze({ run });
})(typeof window !== 'undefined' ? window : globalThis);
