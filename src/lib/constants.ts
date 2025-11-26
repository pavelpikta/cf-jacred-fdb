export const DEFAULT_UPSTREAM_ORIGIN = 'http://redapi.cfhttp.top';
export function getUpstreamOrigin(env: EnvLike): string {
  return env && env.UPSTREAM_ORIGIN ? env.UPSTREAM_ORIGIN : DEFAULT_UPSTREAM_ORIGIN;
}

export const LOCAL_PREFIX = '/api';
// Direct passthrough prefixes (bypass local /api mapping logic)
export const DIRECT_PREFIXES = ['/stats', '/stats/', '/sync', '/sync/', '/lastupdatedb', '/health'];
// Subset of direct prefixes that are always allowed without an API key even if API_KEY is configured.
export const DIRECT_API_KEY_EXEMPT_PREFIXES = ['/lastupdatedb', '/health'];
export const ALLOWED_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST'] as const;
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Cache-Control',
};
export const STRIP_RESPONSE_HEADERS = [
  'set-cookie',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
];
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 30000;
export const DEFAULT_TORRSERVER_TIMEOUT_MS = 15000;

export const TORRSERVER_ADD_PATH = '/api/torrserver/add';
export const TORRSERVER_TEST_PATH = '/api/torrserver/test';
export const TORRSERVER_PREFIX = '/api/torrserver/';
export const MAGNET_PREFIX = 'magnet:';
export const USER_AGENT = 'cf-jacred-worker/1.0';
export const DEFAULT_CACHE_CONTROL_OK = 'public, max-age=60, s-maxage=300';
export const DEFAULT_CACHE_CONTROL_ERROR = 'no-cache, max-age=0';

export function isDirectPath(path: string): boolean {
  return DIRECT_PREFIXES.some((p) => path === p || path.startsWith(p));
}

// Returns true if a direct path should be allowed without providing an API key
// even when API key enforcement is enabled globally.
export function isDirectApiKeyExempt(path: string): boolean {
  return DIRECT_API_KEY_EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

// Centralized helper for identifying the stats HTML (supports legacy variants)
export function isStatsAssetRequest(path: string): boolean {
  return path === '/stats' || path === '/stats/' || path === '/stats.html';
}

export interface EnvLike {
  ASSETS: { fetch(_request: Request): Promise<Response> };
  UPSTREAM_ORIGIN?: string;
  API_KEY?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  TORRSERVER_TIMEOUT_MS?: string;
  ERROR_LOCALE?: string; // 'en' | 'ru'
  [k: string]: unknown; // allow extra bindings (unknown for stronger typing)
}

// Explicit worker environment type (extendable) used across the codebase.
export type WorkerEnvLike = EnvLike;
