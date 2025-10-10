// Simple in-memory cache for aggregated strain effects.
// Avoids re-fetching when StrainCards mount/unmount rapidly due to filtering or virtualization.
// Strategy:
//  - Map: id -> { data, ts, promise }
//  - If a fetch is in-flight, return the existing promise.
//  - TTL default 5 minutes; stale entries trigger a background refetch.
//  - Failures do not poison cache: they clear the entry so next request can retry.

const _cache = new Map();
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

async function _doFetch(id) {
  const entry = _cache.get(id) || {};
  try {
    const resp = await fetch(`/strains/${id}/aggregate-effects`);
    if (!resp.ok) throw new Error('bad status ' + resp.status);
    const json = await resp.json();
    _cache.set(id, { data: json, ts: Date.now(), promise: null });
    return json;
  } catch (e) {
    // On error, clear promise but keep previous data (if any)
    if (entry.data) {
      _cache.set(id, { data: entry.data, ts: entry.ts, promise: null });
      return entry.data; // serve stale
    } else {
      _cache.delete(id);
      return null;
    }
  }
}

export function getAggregateEffects(id, { ttlMs = DEFAULT_TTL, refresh = false } = {}) {
  if (!id && id !== 0) return Promise.resolve(null);
  const existing = _cache.get(id);

  // Force refresh ignores cache but reuses stale data until new arrives.
  if (refresh) {
    if (!existing || !existing.promise) {
      const p = _doFetch(id);
      _cache.set(id, { ...(existing || {}), promise: p });
      return p;
    }
    return existing.promise;
  }

  if (existing) {
    const age = Date.now() - (existing.ts || 0);
    if (existing.data && age < ttlMs) {
      // Fresh data.
      return Promise.resolve(existing.data);
    }
    // Stale or missing data: if a promise inflight, reuse; else fetch.
    if (existing.promise) return existing.promise;
    const p = _doFetch(id);
    _cache.set(id, { ...existing, promise: p });
    return p;
  }

  const p = _doFetch(id);
  _cache.set(id, { data: null, ts: 0, promise: p });
  return p;
}

export function primeAggregateEffects(id, data) {
  if (id == null) return;
  _cache.set(id, { data, ts: Date.now(), promise: null });
}

export function clearAggregateEffects(id) {
  if (id == null) return;
  _cache.delete(id);
}

export function clearAllAggregateEffects() {
  _cache.clear();
}
