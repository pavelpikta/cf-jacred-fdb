import { badRequest, errorResponse, json } from './errors';
import { fetchWithTimeout } from './fetching';
import { isAbortError } from './abort';
import {
  TORRSERVER_ADD_PATH,
  TORRSERVER_TEST_PATH,
  MAGNET_PREFIX,
  USER_AGENT,
} from './constants';
import type { EnvLike } from './constants';
import type { Locale } from './i18n';

interface TorrAddRequestBody {
  magnet?: string;
  url?: string;
  username?: string;
  password?: string | number;
  debug?: boolean;
  [k: string]: unknown;
}

interface TorrAddAttempt {
  type: 'json';
  status?: number;
  ok?: boolean;
  bodyBytes?: number;
  raw?: string;
  timeout?: boolean;
  timeoutMs?: number;
  networkError?: string;
}

export function encodeBasicAuth(user: string, pass: string): string {
  const creds = `${user}:${pass}`;
  return 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(creds)));
}

export function buildTorrServerHeaders({
  env,
  user,
  pass,
  jsonBody,
}: {
  env: EnvLike;
  user: string;
  pass: string;
  jsonBody: boolean;
}): { headers: Headers; cfAccessTokens: boolean } {
  const base: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    'Cache-Control': 'no-cache',
  };
  if (jsonBody) base['Content-Type'] = 'application/json; charset=utf-8';
  const headers = new Headers(base);
  if (user) headers.set('Authorization', encodeBasicAuth(user, pass));
  const id = (env.CF_ACCESS_CLIENT_ID || '').trim();
  const secret = (env.CF_ACCESS_CLIENT_SECRET || '').trim();
  if (id && secret) {
    headers.set('CF-Access-Client-Id', id);
    headers.set('CF-Access-Client-Secret', secret);
  }
  return { headers, cfAccessTokens: !!(id && secret) };
}

export function normalizeTorrServerUrl(raw: string): URL {
  const trimmed = (raw || '').trim();
  if (!trimmed) throw new Error('missing_url');
  try {
    return new URL(trimmed.replace(/\/$/, ''));
  } catch {
    throw new Error('invalid_url');
  }
}

export function detectCloudflareAccess(status: number, raw?: string, parsed?: unknown): boolean {
  if (status !== 403) return false;
  try {
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      if (
        typeof p.message === 'string' &&
        /Forbidden\. You don't have permission/i.test(p.message) &&
        'ray_id' in p &&
        'aud' in p
      )
        return true;
    }
  } catch {}
  try {
    if (typeof raw === 'string') {
      if (/Forbidden/.test(raw) && /ray_id/i.test(raw)) return true;
    }
  } catch {}
  return false;
}

interface TorrAddArgs {
  request: Request;
  pathname: string;
  torrTimeoutMs: number;
  env: EnvLike;
  locale: Locale;
}
export async function handleTorrServerAdd({
  request,
  pathname,
  torrTimeoutMs,
  env,
  locale,
}: TorrAddArgs): Promise<Response | null> {
  if (pathname !== TORRSERVER_ADD_PATH) return null;
  if (request.method !== 'POST') return badRequest(locale);
  let body: TorrAddRequestBody | undefined;
  try {
    body = (await request.json()) as TorrAddRequestBody;
  } catch {
    return badRequest(locale, 'expect_json_body');
  }
  const magnet = ((body && body.magnet) || '').trim();
  const tsUrlRaw = ((body && body.url) || '').trim();
  const user = ((body && body.username) || '').trim();
  const pass = (body && (body.password ?? '')).toString();
  const addPath = '/torrents';
  const debug = !!body.debug;
  if (!magnet || !magnet.startsWith(MAGNET_PREFIX)) return badRequest(locale, 'invalid_magnet');
  if (!tsUrlRaw) return badRequest(locale, 'missing_url');
  if ((user && !pass) || (pass && !user)) return badRequest(locale, 'auth_credentials_mismatch');
  let tsUrl: URL;
  try {
    tsUrl = normalizeTorrServerUrl(tsUrlRaw);
  } catch (err) {
    return badRequest(locale, err instanceof Error ? err.message : 'invalid_url');
  }
  const addUrl = new URL(addPath, tsUrl);
  const payloadObj = { action: 'add', link: magnet };
  const { headers: headersJson, cfAccessTokens } = buildTorrServerHeaders({
    env,
    user,
    pass,
    jsonBody: true,
  });
  const attempts: TorrAddAttempt[] = [];
  async function attemptJson() {
    let resp: Response | null,
      raw = '';
    try {
      const bodyStr = JSON.stringify(payloadObj);
      try {
        resp = await fetchWithTimeout(
          addUrl.toString(),
          { method: 'POST', headers: headersJson, body: bodyStr },
          torrTimeoutMs
        );
      } catch (err) {
        if (isAbortError(err)) {
          attempts.push({ type: 'json', timeout: true, timeoutMs: torrTimeoutMs });
          return { resp: null, raw: '', js: null, error: err };
        }
        throw err;
      }
      try {
        raw = await resp.clone().text();
      } catch {
        raw = '';
      }
      let js: unknown = null;
      try {
        js = raw ? JSON.parse(raw) : null;
      } catch {}
      attempts.push({
        type: 'json',
        status: resp.status,
        ok: resp.ok,
        bodyBytes: bodyStr.length,
        raw: debug ? raw : undefined,
      });
      return { resp, raw, js };
    } catch (err) {
      attempts.push({
        type: 'json',
        networkError: err instanceof Error ? err.message : String(err),
      });
      return { resp: null, raw: '', js: null, error: err };
    }
  }
  const first = await attemptJson();
  const respObj = first.resp as Response | null;
  if (!respObj)
    return errorResponse(
      locale,
      'torrserver_all_attempts_failed',
      'torrserver_all_attempts_failed',
      502,
      {
        attempts,
        requested: addUrl.toString(),
      }
    );
  let authHint: string | undefined = undefined;
  if (respObj.status === 401 || respObj.status === 403) authHint = 'auth_error_hint';
  const hdrs: Record<string, string> = {};
  for (const [k, v] of respObj.headers.entries()) {
    if (/^(content-type|www-authenticate|server|content-length)$/i.test(k)) hdrs[k] = v;
  }
  const cloudflareAccess = detectCloudflareAccess(
    respObj.status,
    debug ? first.raw : undefined,
    first.js
  );
  return json({
    ok: respObj.ok,
    status: respObj.status,
    authHint,
    cloudflareAccess,
    cfAccessTokens,
    torrserver: first.js || { raw: debug ? first.raw : undefined },
    headers: hdrs,
    requested: addUrl.toString(),
    attempts,
  });
}

interface TorrTestArgs {
  request: Request;
  pathname: string;
  torrTimeoutMs: number;
  env: EnvLike;
  locale: Locale;
}
export async function handleTorrServerTest({
  request,
  pathname,
  torrTimeoutMs,
  env,
  locale,
}: TorrTestArgs): Promise<Response | null> {
  if (pathname !== TORRSERVER_TEST_PATH) return null;
  if (request.method !== 'POST') return badRequest(locale);
  let body: TorrAddRequestBody | undefined;
  try {
    body = (await request.json()) as TorrAddRequestBody;
  } catch {
    return badRequest(locale, 'expect_json_body');
  }
  const tsUrlRaw = ((body && body.url) || '').trim();
  const user = ((body && body.username) || '').trim();
  const pass = (body && (body.password ?? '')).toString();
  if (!tsUrlRaw) return badRequest(locale, 'missing_url');
  let tsUrl: URL;
  try {
    tsUrl = normalizeTorrServerUrl(tsUrlRaw);
  } catch (err) {
    return badRequest(locale, err instanceof Error ? err.message : 'invalid_url');
  }
  const testUrl = new URL('/echo', tsUrl);
  const { headers, cfAccessTokens } = buildTorrServerHeaders({ env, user, pass, jsonBody: false });
  let resp: Response,
    raw = '';
  try {
    resp = await fetchWithTimeout(testUrl.toString(), { method: 'GET', headers }, torrTimeoutMs);
    try {
      raw = await resp.clone().text();
    } catch {
      raw = '';
    }
  } catch (err) {
    if (isAbortError(err))
      return errorResponse(locale, 'torrserver_timeout', 'torrserver_timeout', 504, {
        ok: false,
        timeoutMs: torrTimeoutMs,
      });
    return errorResponse(locale, 'torrserver_network', 'torrserver_network', 502, {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  const trimmed = raw.trim();
  let version: string | null = null;
  if (/^Matrix\./i.test(trimmed)) version = trimmed.substring('Matrix.'.length).trim();
  let authHint: string | undefined = undefined;
  if (resp.status === 401 || resp.status === 403) authHint = 'auth_error_hint_tokens';
  const cloudflareAccess = detectCloudflareAccess(resp.status, raw, null);
  const success = resp.ok && version !== null;
  return json({
    ok: success,
    status: resp.status,
    authHint,
    cloudflareAccess,
    version,
    raw: success ? undefined : trimmed.slice(0, 200),
    cfAccessTokens,
    headers: { 'content-type': resp.headers.get('content-type') || '' },
    requested: testUrl.toString(),
  });
}
