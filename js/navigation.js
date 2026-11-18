/*
 * Boat Skills — navigation.js
 * Path-to-root generation, breadcrumbs, hash routes and a navigator.
 * Breadcrumbs are always derived from the hierarchy's parent map — never from
 * navigation history.
 */
(function (global) {
  'use strict';
  const BS = (global.BoatSkills = global.BoatSkills || {});
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /** Returns node ids from the root down to `id` (inclusive). Unknown ids yield []. */
  function pathToRoot(model, id) {
    if (!model.has(id)) return [];
    const path = [id];
    const seen = new Set(path);
    let cur = id;
    while (hasOwn(model.parentMap, cur)) {
      cur = model.parentMap[cur];
      if (seen.has(cur)) throw new Error(`Cycle detected while generating the path for "${id}".`);
      seen.add(cur);
      path.push(cur);
    }
    if (cur !== model.rootId) throw new Error(`Path for "${id}" does not reach the root.`);
    return path.reverse();
  }

  function breadcrumbs(model, id) {
    return pathToRoot(model, id).map((pid) => {
      const n = model.get(pid);
      return { id: n.id, name: n.name, type: n.type };
    });
  }

  const HASH_PREFIX = '#/n/';
  function formatHash(id) {
    return HASH_PREFIX + encodeURIComponent(id);
  }
  function parseHash(hash) {
    if (typeof hash !== 'string' || hash.indexOf(HASH_PREFIX) !== 0) return null;
    try {
      const id = decodeURIComponent(hash.slice(HASH_PREFIX.length));
      return id || null;
    } catch (e) {
      return null;
    }
  }

  /** Tracks the current node. go()/up()/goChild() return true on success. */
  function createNavigator(model, initialId, onChange) {
    let current = model.has(initialId) ? initialId : model.rootId;
    const go = (id) => {
      if (!model.has(id)) return false;
      const prev = current;
      current = id;
      if (typeof onChange === 'function' && prev !== id) onChange(id, prev);
      return true;
    };
    return {
      current: () => current,
      go,
      up: () => (hasOwn(model.parentMap, current) ? go(model.parentMap[current]) : false),
      goChild: (index) => {
        const kids = model.get(current).children;
        return index >= 0 && index < kids.length ? go(kids[index]) : false;
      },
      children: () => model.children(current),
      breadcrumbs: () => breadcrumbs(model, current),
    };
  }

  BS.Navigation = Object.freeze({ pathToRoot, breadcrumbs, formatHash, parseHash, createNavigator });
})(typeof window !== 'undefined' ? window : globalThis);
