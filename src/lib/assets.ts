import { addStandardResponseHeaders } from './security';

// Match hashed filenames like main.abcdef1234.js (. or - separators)
const HASH_RE = /[.-]([a-f0-9]{8,})[.]/i;
const CSS_JS_RE = /\.(css|js)$/;
const MEDIA_RE = /\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf)$/;

/**
 * Determines the appropriate Cache-Control header value based on asset pathname.
 *
 * @param pathname - The asset's URL pathname
 * @returns Cache-Control header value (e.g., 'public, max-age=31536000, immutable' for hashed assets)
 */
export function assetCacheControl(pathname: string): string {
  const lower = pathname.toLowerCase();
  const hashed = HASH_RE.test(lower);
  if (lower.endsWith('.html')) return 'no-cache, must-revalidate';
  if (hashed) return 'public, max-age=31536000, immutable';
  if (CSS_JS_RE.test(lower)) return 'public, max-age=3600';
  if (MEDIA_RE.test(lower)) return 'public, max-age=604800';
  return 'public, max-age=300';
}

/**
 * Creates a new Response with adjusted caching headers and standard security headers.
 *
 * @param pathname - The asset's URL pathname (used to determine cache policy)
 * @param resp - The original Response to clone with new headers
 * @returns A new Response with appropriate Cache-Control and security headers
 */
export function withAdjustedAssetCaching(pathname: string, resp: Response): Response {
  const h = new Headers(resp.headers);
  h.set('Cache-Control', assetCacheControl(pathname));
  addStandardResponseHeaders(h);
  return new Response(resp.body, { status: resp.status, headers: h });
}
