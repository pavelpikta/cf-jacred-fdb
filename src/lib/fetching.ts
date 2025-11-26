import { addStandardResponseHeaders } from './security';

export function ctxWaitUntilSafe(ctx: ExecutionContext, promise: Promise<unknown>): void {
  ctx.waitUntil(promise);
}

export async function fetchWithTimeout(
  resource: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export function buildCacheKey(request: Request, upstreamUrl: string): Request {
  const u = new URL(upstreamUrl);
  u.searchParams.delete('_');
  // Remove API key query params to prevent cache fragmentation per user key.
  u.searchParams.delete('apikey');
  u.searchParams.delete('api_key');
  return new Request(u.toString(), { method: 'GET' });
}

export async function fetchUpstream(
  upstreamUrl: string,
  request: Request,
  timeoutMs: number
): Promise<Response> {
  const init: RequestInit = {
    method: request.method,
    headers: new Headers(request.headers),
    redirect: 'follow',
  };
  (init.headers as Headers).delete('host');
  (init.headers as Headers).delete('cookie');
  if (request.method !== 'GET' && request.method !== 'HEAD')
    init.body = await request.arrayBuffer();
  return fetchWithTimeout(upstreamUrl, init, timeoutMs);
}

export async function cachedFetch(
  ctx: ExecutionContext,
  upstreamUrl: string,
  request: Request,
  timeoutMs: number
): Promise<Response> {
  if (request.method !== 'GET') return fetchUpstream(upstreamUrl, request, timeoutMs);
  // Cloudflare Workers augments CacheStorage with a 'default' cache. Cast to any for type compatibility.
  // Cloudflare Workers runtime provides caches.default (Cache interface)
  const cache: Cache = (caches as unknown as { default: Cache }).default;
  const cc = request.headers.get('Cache-Control') || '';
  if (/no-cache|no-store/i.test(cc)) return fetchUpstream(upstreamUrl, request, timeoutMs);
  const cacheKey = buildCacheKey(request, upstreamUrl);
  let resp = await cache.match(cacheKey);
  if (resp) {
    const h = new Headers(resp.headers);
    h.set('CF-Cache-Status', 'HIT');
    const inm = request.headers.get('If-None-Match');
    const cachedEtag = h.get('ETag');
    if (inm && cachedEtag) {
      const tokens = inm
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((t) => t.replace(/^W\//i, '').replace(/^"|"$/g, ''));
      const normalizedCached = cachedEtag.replace(/^W\//i, '').replace(/^"|"$/g, '');
      if (tokens.includes(normalizedCached) || tokens.includes('*')) {
        const h304 = new Headers();
        h304.set('ETag', cachedEtag);
        if (h.has('Cache-Control')) h304.set('Cache-Control', h.get('Cache-Control') || '');
        // Ensure Vary includes Accept and If-None-Match (helps downstream caches differentiate)
        const existingVary = h.has('Vary') ? h.get('Vary') || '' : '';
        const varyTokens = new Set(
          existingVary
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        );
        varyTokens.add('Accept');
        varyTokens.add('If-None-Match');
        h304.set('Vary', Array.from(varyTokens).join(', '));
        addStandardResponseHeaders(h304);
        h304.set('CF-Cache-Status', 'HIT');
        return new Response(null, { status: 304, headers: h304 });
      }
    }
    return new Response(resp.body, { status: resp.status, headers: h });
  }
  const upstreamResp = await fetchUpstream(upstreamUrl, request, timeoutMs);
  if (upstreamResp.ok) {
    const cacheHeaders = new Headers(upstreamResp.headers);
    cacheHeaders.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    const cacheable = new Response(upstreamResp.clone().body, {
      status: upstreamResp.status,
      headers: cacheHeaders,
    });
    ctxWaitUntilSafe(ctx, cache.put(cacheKey, cacheable));
  }
  return upstreamResp;
}
