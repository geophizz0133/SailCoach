/*
 * Boat Skills — model.js
 * Read-only hierarchy model. The hierarchy is never mutated at runtime: scores and
 * notes live in the separate assessment state managed by storage.js.
 * createModel() must only be called with data that passed validateHierarchy().
 */
(function (global) {
  'use strict';
  const BS = (global.BoatSkills = global.BoatSkills || {});

  const NODE_TYPES = Object.freeze(['root', 'competency', 'metric']);
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /**
   * Builds a child → parent map from a node list (array or id→node object).
   * Duplicate child references and multi-parent nodes are reported as errors.
   */
  function buildParentMap(nodes) {
    const list = Array.isArray(nodes) ? nodes : Object.keys(nodes).map((k) => nodes[k]);
    const parentMap = {};
    const errors = [];
    list.forEach((node) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children.forEach((childId) => {
        if (hasOwn(parentMap, childId)) {
          if (parentMap[childId] === node.id) {
            errors.push(`Node "${node.id}" lists child "${childId}" more than once.`);
          } else {
            errors.push(`Node "${childId}" has multiple parents ("${parentMap[childId]}" and "${node.id}").`);
          }
        } else {
          parentMap[childId] = node.id;
        }
      });
    });
    return { parentMap, errors };
  }

  function createModel(data) {
    const nodesById = {};
    data.nodes.forEach((raw) => {
      nodesById[raw.id] = Object.freeze({
        id: raw.id,
        type: raw.type,
        name: raw.name,
        description: typeof raw.description === 'string' ? raw.description : '',
        // Assumption: a missing weight means the default weight of 1.
        weight: typeof raw.weight === 'number' ? raw.weight : 1,
        children: Object.freeze(raw.children.slice()),
      });
    });

    const pm = buildParentMap(nodesById);
    if (pm.errors.length) throw new Error('Invalid parent map: ' + pm.errors.join(' '));
    const parentMap = Object.freeze(pm.parentMap);
    Object.freeze(nodesById);

    const order = [];
    const metricIds = [];
    const competencyIds = [];
    const depthOf = {};
    const metricCount = {};
    (function walk(id, depth) {
      const node = nodesById[id];
      order.push(id);
      depthOf[id] = depth;
      if (node.type === 'metric') metricIds.push(id);
      else if (node.type === 'competency') competencyIds.push(id);
      let count = node.type === 'metric' ? 1 : 0;
      node.children.forEach((c) => {
        walk(c, depth + 1);
        count += metricCount[c];
      });
      metricCount[id] = count;
    })(data.rootId, 0);

    const has = (id) => typeof id === 'string' && hasOwn(nodesById, id);
    const get = (id) => (has(id) ? nodesById[id] : null);

    return Object.freeze({
      rootId: data.rootId,
      meta: Object.freeze({
        id: data.id || '',
        name: data.name || 'Boat Skills',
        version: data.version || '',
        scale: Object.freeze((data.scale || []).map((s) => Object.freeze({ value: s.value, label: s.label }))),
      }),
      nodes: nodesById,
      parentMap,
      order: Object.freeze(order),
      metricIds: Object.freeze(metricIds),
      competencyIds: Object.freeze(competencyIds),
      has,
      get,
      isMetric: (id) => has(id) && nodesById[id].type === 'metric',
      children: (id) => (has(id) ? nodesById[id].children.map((c) => nodesById[c]) : []),
      parent: (id) => (has(id) && hasOwn(parentMap, id) ? nodesById[parentMap[id]] : null),
      depth: (id) => (has(id) ? depthOf[id] : -1),
      metricCount: (id) => (has(id) ? metricCount[id] : 0),
    });
  }

  BS.Model = Object.freeze({ NODE_TYPES, buildParentMap, createModel, hasOwn });
})(typeof window !== 'undefined' ? window : globalThis);
