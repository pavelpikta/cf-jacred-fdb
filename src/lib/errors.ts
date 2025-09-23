import { CORS_HEADERS, ALLOWED_METHODS } from './constants';
import { getMessages, resolveLocale, type Locale } from './i18n';

let activeLocale: Locale = 'ru';
let M = getMessages(activeLocale);

export function initErrorLocale(env: { ERROR_LOCALE?: string }) {
  activeLocale = resolveLocale(env?.ERROR_LOCALE);
  M = getMessages(activeLocale);
}

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
  code: string,
  messageOrKey: string,
  status: number,
  extra: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {}
): Response {
  // Allow passing either raw message or key existing in locale pack.
  const isKey = Object.prototype.hasOwnProperty.call(M, messageOrKey);
  const translated = isKey ? (M as Record<string, string>)[messageOrKey] : messageOrKey;
  const payload: ErrorEnvelope = {
    error: translated,
    code,
    locale: activeLocale,
    messageKey: isKey ? messageOrKey : code,
    ...extra,
  };
  return json(payload, status, extraHeaders);
}

export function notFound(custom?: string): Response {
  return errorResponse('not_found', custom ? custom : 'not_found', 404);
}
export function badRequest(custom?: string): Response {
  return errorResponse('bad_request', custom ? custom : 'bad_request', 400);
}
export function methodNotAllowed(): Response {
  return errorResponse(
    'method_not_allowed',
    'method_not_allowed',
    405,
    {},
    {
      Allow: ALLOWED_METHODS.join(', '),
    }
  );
}
