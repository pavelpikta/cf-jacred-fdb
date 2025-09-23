import { CORS_HEADERS } from './constants';

export function addStandardResponseHeaders(h: Headers): void {
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'DENY');
  if (!h.has('Cross-Origin-Opener-Policy')) h.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!h.has('Cross-Origin-Resource-Policy')) h.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (!h.has('Permissions-Policy'))
    h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), fullscreen=(self)');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'public, max-age=60');
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
}
