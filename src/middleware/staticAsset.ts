import { withAdjustedAssetCaching } from '../lib/assets';
import { resolveHashedPath } from '../lib/manifest';
import type { Middleware } from './types';

// Paths that should be served as static assets
const STATIC_ASSET_PATHS = ['/', '/index.html', '/favicon.ico', '/manifest.json'] as const;
const STATIC_ASSET_PREFIXES = ['/assets/', '/css/', '/js/', '/img/'] as const;

// Generic static asset handler (runs only for non-API, non-direct paths)
export const staticAsset: Middleware = async (ctx) => {
  if (ctx.isApi || ctx.direct) return;
  // Only handle known static asset paths; let everything else pass through
  const isStaticAsset =
    STATIC_ASSET_PATHS.includes(ctx.pathname as (typeof STATIC_ASSET_PATHS)[number]) ||
    STATIC_ASSET_PREFIXES.some((p) => ctx.pathname.startsWith(p));
  if (!isStaticAsset) return;
  // For root path ensure we fetch index.html explicitly (Pages will also handle / -> /index.html but be explicit).
  let effectivePath = ctx.pathname === '/' ? '/index.html' : ctx.pathname;
  // Attempt to rewrite to hashed path if manifest exists.
  effectivePath = await resolveHashedPath(ctx.env, effectivePath);
  // Reconstruct request preserving headers/method for GET/HEAD only.
  const reqUrl = new URL(effectivePath, ctx.url.origin);
  const fetchReq = new Request(reqUrl.toString(), {
    method: ctx.request.method,
    headers: ctx.request.headers,
  });
  const assetResp = await ctx.env.ASSETS.fetch(fetchReq);
  return withAdjustedAssetCaching(effectivePath, assetResp);
};
