import { STRIP_RESPONSE_HEADERS, isDirectApiKeyExempt } from '../lib/constants';
import { mapUpstreamPath } from '../lib/routing';
import { errorResponse, badRequest } from '../lib/errors';
import { cachedFetch } from '../lib/fetching';
import { stripApiKeyParams } from '../lib/apiKey';
import { addStandardResponseHeaders } from '../lib/security';
import { isAbortError } from '../lib/abort';
import type { Middleware } from './types';

export const upstream: Middleware = async (ctx) => {
  // Only run if we haven't produced a response yet and this is API or direct path.
  if (!ctx.isApi && !ctx.direct) return; // static assets handled earlier

  // API key enforcement (non-conf paths): do not allow if invalid, allow API key exempt prefixes
  const apiKeyExempt = ctx.direct && isDirectApiKeyExempt(ctx.pathname);
  if ((ctx.isApi || ctx.direct) && !apiKeyExempt && ctx.apiKey.keyEnforced && !ctx.apiKey.keyValid)
    return errorResponse(ctx.locale, 'forbidden', 'forbidden', 403);

  // Validate path encoding
  try {
    decodeURIComponent(ctx.pathname);
  } catch {
    return badRequest(ctx.locale, 'path_decode_error');
  }

  let upstreamPath: string;
  try {
    upstreamPath = ctx.direct ? ctx.pathname : mapUpstreamPath(ctx.pathname);
  } catch {
    return badRequest(ctx.locale, 'path_map_error');
  }
  ctx.upstreamPath = upstreamPath;
  const upstreamUrl = new URL(upstreamPath, ctx.config.upstreamOrigin);
  upstreamUrl.search = ctx.url.search; // initial search (with potential api key)
  if (stripApiKeyParams(ctx.url)) upstreamUrl.search = ctx.url.search; // remove if present
  ctx.upstreamUrl = upstreamUrl;

  let upstreamResp: Response;
  try {
    upstreamResp = await cachedFetch(
      upstreamUrl.toString(),
      ctx.request,
      ctx.config.upstreamTimeoutMs
    );
  } catch (err) {
    if (isAbortError(err))
      return errorResponse(ctx.locale, 'upstream_timeout', 'upstream_timeout', 504, {
        timeoutMs: ctx.config.upstreamTimeoutMs,
      });
    return errorResponse(ctx.locale, 'upstream_fetch_failed', 'upstream_fetch_failed', 502, {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const respHeaders = new Headers();
  for (const [k, v] of upstreamResp.headers.entries()) {
    if (STRIP_RESPONSE_HEADERS.includes(k.toLowerCase())) continue;
    respHeaders.set(k, v);
  }
  if (!respHeaders.has('Cache-Control'))
    respHeaders.set(
      'Cache-Control',
      upstreamResp.ok ? 'public, max-age=60, s-maxage=300' : 'no-cache, max-age=0'
    );
  addStandardResponseHeaders(respHeaders);
  const dt = Date.now() - ctx.start;
  respHeaders.set('Server-Timing', `edge;dur=${dt}`);
  if (ctx.request.headers.get('x-debug-upstream') === '1')
    respHeaders.set('X-Upstream-URL', upstreamUrl.toString());

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: respHeaders,
  });
};
