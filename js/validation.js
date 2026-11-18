/*
 * Boat Skills — validation.js
 * Runtime validation of the hierarchy. The application refuses to start (and shows
 * every error) when any rule fails.
 *
 * Rules: object shape, unique ids, root exists and is typed "root", no missing child
 * references, valid parent map (single parent, root has none), no orphans, no cycles,
 * node type rules (metrics are leaves, branches have children, metrics are not placed
 * directly under the root), no stored scores, every node reachable from the root.
 */
(function (global) {
  'use strict';
  const BS = (global.BoatSkills = global.BoatSkills || {});
  const { NODE_TYPES, buildParentMap, hasOwn } = BS.Model;

  function validateHierarchy(data) {
    const errors = [];
    const add = (code, message) => errors.push({ code, message });
    const result = (stats) => ({ valid: errors.length === 0, errors, stats: stats || null });

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      add('FORMAT', 'Hierarchy must be a JSON object.');
      return result();
    }
    if (!Array.isArray(data.nodes)) {
      add('FORMAT', 'Hierarchy must contain a "nodes" array.');
      return result();
    }

    // Node shape and unique ids.
    const byId = {};
    data.nodes.forEach((n, i) => {
      if (!n || typeof n !== 'object' || Array.isArray(n)) {
        add('NODE_SHAPE', `Node at index ${i} is not an object.`);
        return;
      }
      if (typeof n.id !== 'string' || !n.id.trim()) {
        add('NODE_SHAPE', `Node at index ${i} has no valid "id".`);
        return;
      }
      if (hasOwn(byId, n.id)) {
        add('DUPLICATE_ID', `Duplicate node id "${n.id}".`);
        return;
      }
      byId[n.id] = n;
      if (typeof n.name !== 'string' || !n.name.trim()) add('NODE_SHAPE', `Node "${n.id}" has no valid "name".`);
      if (!NODE_TYPES.includes(n.type)) add('NODE_TYPE', `Node "${n.id}" has invalid type "${n.type}" (expected ${NODE_TYPES.join(', ')}).`);
      if (!Array.isArray(n.children)) add('NODE_SHAPE', `Node "${n.id}" must have a "children" array.`);
      else if (n.children.some((c) => typeof c !== 'string')) add('NODE_SHAPE', `Node "${n.id}" has non-string child references.`);
      if (n.weight !== undefined && !(typeof n.weight === 'number' && Number.isFinite(n.weight) && n.weight > 0)) {
        add('NODE_SHAPE', `Node "${n.id}" has invalid weight "${n.weight}" (must be a positive number).`);
      }
      if (hasOwn(n, 'score')) add('STORED_SCORE', `Node "${n.id}" stores a score; the hierarchy must not contain scores.`);
    });

    const ids = Object.keys(byId);
    const kids = (id) => (Array.isArray(byId[id].children) ? byId[id].children.filter((c) => typeof c === 'string') : []);

    // Root.
    const rootId = data.rootId;
    const rootOk = typeof rootId === 'string' && hasOwn(byId, rootId);
    if (!rootOk) add('ROOT_MISSING', `Root node "${rootId}" does not exist.`);
    else if (byId[rootId].type !== 'root') add('ROOT_TYPE', `Root node "${rootId}" must have type "root".`);
    ids.forEach((id) => {
      if (byId[id].type === 'root' && id !== rootId) add('ROOT_MULTIPLE', `Node "${id}" has type "root" but is not the declared root.`);
    });

    // Missing references.
    ids.forEach((id) => {
      kids(id).forEach((c) => {
        if (!hasOwn(byId, c)) add('MISSING_REFERENCE', `Node "${id}" references missing child "${c}".`);
      });
    });

    // Parent map.
    const pm = buildParentMap(ids.map((id) => ({ id, children: kids(id) })));
    pm.errors.forEach((m) => add('PARENT_MAP', m));
    const parentMap = pm.parentMap;
    if (rootOk && hasOwn(parentMap, rootId)) add('PARENT_MAP', `Root "${rootId}" must not have a parent (referenced by "${parentMap[rootId]}").`);

    // Orphans.
    ids.forEach((id) => {
      if (id !== rootId && !hasOwn(parentMap, id)) add('ORPHAN', `Node "${id}" has no parent.`);
    });

    // Cycles (depth-first search with colouring over every node, not just the reachable ones).
    const color = {};
    const visit = (id, stack) => {
      color[id] = 1;
      stack.push(id);
      kids(id).forEach((c) => {
        if (!hasOwn(byId, c)) return;
        if (color[c] === 1) add('CYCLE', `Cycle detected: ${stack.slice(stack.indexOf(c)).concat(c).join(' → ')}.`);
        else if (!color[c]) visit(c, stack);
      });
      stack.pop();
      color[id] = 2;
    };
    ids.forEach((id) => {
      if (!color[id]) visit(id, []);
    });

    // Node type rules.
    ids.forEach((id) => {
      const n = byId[id];
      const count = kids(id).length;
      if (n.type === 'metric' && count > 0) add('NODE_TYPE', `Metric "${id}" must not have children.`);
      if ((n.type === 'competency' || n.type === 'root') && count === 0) add('NODE_TYPE', `${n.type === 'root' ? 'Root' : 'Competency'} "${id}" must have at least one child.`);
      if (n.type === 'metric' && hasOwn(parentMap, id) && parentMap[id] === rootId) add('NODE_TYPE', `Metric "${id}" must belong to a competency, not directly to the root.`);
    });

    // Reachability.
    if (rootOk) {
      const seen = new Set([rootId]);
      const queue = [rootId];
      while (queue.length) {
        const id = queue.shift();
        kids(id).forEach((c) => {
          if (hasOwn(byId, c) && !seen.has(c)) {
            seen.add(c);
            queue.push(c);
          }
        });
      }
      ids.forEach((id) => {
        if (!seen.has(id)) add('UNREACHABLE', `Node "${id}" is not reachable from the root.`);
      });
    }

    const stats = {
      total: ids.length,
      competencies: ids.filter((id) => byId[id].type === 'competency').length,
      metrics: ids.filter((id) => byId[id].type === 'metric').length,
    };
    return result(stats);
  }

  BS.Validation = Object.freeze({ validateHierarchy });
})(typeof window !== 'undefined' ? window : globalThis);
