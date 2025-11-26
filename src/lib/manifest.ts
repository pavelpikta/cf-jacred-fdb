// Runtime loader for asset-manifest.json produced at build time (when ASSET_HASH=1)
// The manifest maps original relative paths (e.g. "js/index.js") -> hashed paths (e.g. "js/index.a1b2c3d4.js").
// We fetch it lazily from the ASSETS binding and cache in-memory for the lifetime of the worker isolate.
//
// SAFETY: Global mutable state is safe here because Cloudflare Worker isolates are single-threaded.
// Each isolate handles one request at a time, so there are no race conditions. The manifest is
// identical across all requests, so isolate-level caching is both safe and efficient.
// We use promise-based deduplication to prevent redundant fetches if multiple concurrent
// requests arrive before the first load completes.

import type { EnvLike } from './constants';

interface ManifestState {
  loaded: boolean;
  loading: Promise<void> | null;
  ts: number;
  map: Record<string, string>;
}

const state: ManifestState = { loaded: false, loading: null, ts: 0, map: {} };

// Attempt to load manifest at most once per isolate. If not present (no hashing build), stays empty.
// Uses promise deduplication to prevent concurrent loads.
async function load(env: EnvLike): Promise<void> {
  if (state.loaded) return;
  if (state.loading) return state.loading;

  state.loading = (async () => {
    try {
      const resp = await env.ASSETS.fetch(new Request('https://dummy/asset-manifest.json'));
      if (resp.ok) {
        const json = (await resp.json()) as Record<string, string>;
        if (json && typeof json === 'object') {
          state.map = json;
        }
      }
    } catch {
      // Ignore – manifest absent in non-hashed builds.
    } finally {
      state.loaded = true;
      state.ts = Date.now();
      state.loading = null;
    }
  })();

  return state.loading;
}

/**
 * Resolves an asset pathname to its hashed version if available in the manifest.
 * Returns the original pathname if already hashed or not in the manifest.
 *
 * @param env - Environment object with ASSETS binding
 * @param pathname - The asset pathname to resolve (e.g., '/js/index.js')
 * @returns The hashed pathname if found, otherwise the original pathname
 * @example
 * ```ts
 * const hashed = await resolveHashedPath(env, '/js/index.js');
 * // Returns '/js/index.a1b2c3d4.js' if in manifest, or '/js/index.js' if not
 * ```
 */
export async function resolveHashedPath(env: EnvLike, pathname: string): Promise<string> {
  // Only rewrite for non-hashed requests; quickly detect hashed file names containing .<hex>{8,}.ext
  if (/[.-][a-f0-9]{8,}\.[a-z0-9]+$/i.test(pathname)) return pathname; // already hashed
  if (!state.loaded) await load(env);
  // Normalize: strip leading slash
  const key = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const hashed = state.map[key];
  if (!hashed) return pathname; // not in manifest
  // Return with leading slash to stay a proper request path
  return hashed.startsWith('/') ? hashed : '/' + hashed;
}

/**
 * Returns the number of entries in the loaded asset manifest.
 *
 * @returns Number of pathname mappings in the manifest
 */
export function manifestSize(): number {
  return Object.keys(state.map).length;
}
