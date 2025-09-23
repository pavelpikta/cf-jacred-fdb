import { addStandardResponseHeaders } from './security';

// Match hashed filenames like main.abcdef1234.js (. or - separators)
const HASH_RE = /[.-]([a-f0-9]{8,})[.]/i;

export function assetCacheControl(pathname: string): string {
  const lower = pathname.toLowerCase();
  const hashed = HASH_RE.test(lower);
  if (lower.endsWith('.html')) return 'no-cache, must-revalidate';
  if (hashed) return 'public, max-age=31536000, immutable';
  // Match .css or .js at end (previous regex /\.css|\.js$/ was missing grouping and could mis-match)
  if (/\.(css|js)$/.test(lower)) return 'public, max-age=3600';
  if (/\.png|\.jpg|\.jpeg|\.gif|\.webp|\.avif|\.svg|\.ico|\.woff2?|\.ttf$/.test(lower))
    return 'public, max-age=604800';
  return 'public, max-age=300';
}

export function withAdjustedAssetCaching(pathname: string, resp: Response): Response {
  const h = new Headers(resp.headers);
  h.set('Cache-Control', assetCacheControl(pathname));
  addStandardResponseHeaders(h);
  return new Response(resp.body, { status: resp.status, headers: h });
}
