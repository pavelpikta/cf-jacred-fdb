import { isStatsAssetRequest } from '../lib/constants';
import { withAdjustedAssetCaching } from '../lib/assets';
import { resolveHashedPath } from '../lib/manifest';
import type { Middleware } from './types';

// Serve /stats(.html) specially mapping to /stats.html for caching rules.
export const statsAsset: Middleware = async (ctx) => {
  if (!isStatsAssetRequest(ctx.pathname)) return;
  // Always resolve to the canonical file path first
  let path = '/stats.html';
  path = await resolveHashedPath(ctx.env, path);
  const url = new URL(path, ctx.url.origin);
  const assetResp = await ctx.env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  return withAdjustedAssetCaching(path, assetResp);
};
