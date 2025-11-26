import { CORS_HEADERS, ALLOWED_METHODS } from './constants';
import { getMessages, type Locale } from './i18n';

export interface ErrorEnvelope {
  error: string;
  code?: string;
  locale?: string;
  messageKey?: string; // original i18n key when available
  [k: string]: unknown;
}

export function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  locale: Locale,
  code: string,
  messageOrKey: string,
  status: number,
  extra: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {}
): Response {
  // Allow passing either raw message or key existing in locale pack.
  const M = getMessages(locale);
  const isKey = Object.prototype.hasOwnProperty.call(M, messageOrKey);
  const translated = isKey ? (M as Record<string, string>)[messageOrKey] : messageOrKey;
  const payload: ErrorEnvelope = {
    error: translated,
    code,
    locale,
    messageKey: isKey ? messageOrKey : code,
    ...extra,
  };
  return json(payload, status, extraHeaders);
}

export function notFound(locale: Locale, custom?: string): Response {
  return errorResponse(locale, 'not_found', custom ? custom : 'not_found', 404);
}
export function badRequest(locale: Locale, custom?: string): Response {
  return errorResponse(locale, 'bad_request', custom ? custom : 'bad_request', 400);
}
export function methodNotAllowed(locale: Locale): Response {
  return errorResponse(
    locale,
    'method_not_allowed',
    'method_not_allowed',
    405,
    {},
    {
      Allow: ALLOWED_METHODS.join(', '),
    }
  );
}
