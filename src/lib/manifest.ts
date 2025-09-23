// Runtime loader for asset-manifest.json produced at build time (when ASSET_HASH=1)
// The manifest maps original relative paths (e.g. "js/index.js") -> hashed paths (e.g. "js/index.a1b2c3d4.js").
// We fetch it lazily from the ASSETS binding and cache in-memory for the lifetime of the worker isolate.

import type { EnvLike } from './constants';

interface ManifestState {
  loaded: boolean;
  ts: number;
  map: Record<string, string>;
}

let state: ManifestState = { loaded: false, ts: 0, map: {} };

// Attempt to load manifest at most once per isolate. If not present (no hashing build), stays empty.
async function load(env: EnvLike): Promise<void> {
  if (state.loaded) return;
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
  }
}

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

export function manifestSize(): number {
  return Object.keys(state.map).length;
}
