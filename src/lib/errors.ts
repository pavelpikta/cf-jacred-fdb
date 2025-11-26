import { CORS_HEADERS, ALLOWED_METHODS } from './constants';
import { getMessages, type Locale } from './i18n';

export interface ErrorEnvelope {
  error: string;
  code?: string;
  locale?: string;
  messageKey?: string; // original i18n key when available
  [k: string]: unknown;
}

/**
 * Creates a JSON Response with standard headers.
 *
 * @param data - Data to serialize as JSON
 * @param status - HTTP status code (default: 200)
 * @param extraHeaders - Additional headers to include
 * @returns JSON Response with CORS and content-type headers
 */
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

/**
 * Creates a localized error JSON Response.
 *
 * @param locale - Locale for message translation ('en' | 'ru')
 * @param code - Error code identifier
 * @param messageOrKey - Raw message string or i18n key to translate
 * @param status - HTTP status code
 * @param extra - Additional fields to include in response body
 * @param extraHeaders - Additional response headers
 * @returns JSON Response with error envelope
 */
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

/**
 * Creates a 404 Not Found error Response.
 *
 * @param locale - Locale for message translation
 * @param custom - Optional custom message or i18n key
 * @returns 404 JSON Response
 */
export function notFound(locale: Locale, custom?: string): Response {
  return errorResponse(locale, 'not_found', custom ? custom : 'not_found', 404);
}

/**
 * Creates a 400 Bad Request error Response.
 *
 * @param locale - Locale for message translation
 * @param custom - Optional custom message or i18n key
 * @returns 400 JSON Response
 */
export function badRequest(locale: Locale, custom?: string): Response {
  return errorResponse(locale, 'bad_request', custom ? custom : 'bad_request', 400);
}

/**
 * Creates a 405 Method Not Allowed error Response with Allow header.
 *
 * @param locale - Locale for message translation
 * @returns 405 JSON Response with Allow header listing permitted methods
 */
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
