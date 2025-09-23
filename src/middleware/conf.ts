import { errorResponse, json } from '../lib/errors';
import { cachedFetch } from '../lib/fetching';
import { mapUpstreamPath } from '../lib/routing';
import type { Middleware } from './types';

// /api/conf endpoint merges upstream conf with local flags.
export const confEndpoint: Middleware = async (ctx) => {
  if (!ctx.isApi || !/\/conf\/?$/.test(ctx.pathname)) return;
  const { apiKey, request, config, url } = ctx; // env unused here
  if (apiKey.keyEnforced && apiKey.suppliedKey && !apiKey.keyValid)
    return errorResponse('forbidden', 'Доступ запрещен', 403, { requireApiKey: true });
  const confUrl = new URL(mapUpstreamPath('/api/conf'), config.upstreamOrigin);
  let baseConf: Record<string, unknown> = {};
  try {
    const upstreamConfResp = await cachedFetch(
      confUrl.toString(),
      request,
      config.upstreamTimeoutMs
    );
    if (upstreamConfResp.ok) {
      try {
        baseConf = await upstreamConfResp.json();
      } catch {
        /* swallow */
      }
    }
  } catch {
    /* swallow network error (return partial conf) */
  }
  return json({
    ...baseConf,
    requireApiKey: apiKey.keyEnforced,
    apikey: apiKey.keyEnforced ? (apiKey.suppliedKey ? apiKey.keyValid : undefined) : true,
    path: url.pathname,
  });
};
