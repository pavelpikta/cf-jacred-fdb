export interface ApiKeyInfo {
  keyEnforced: boolean;
  suppliedKey: string | null;
  keyValid: boolean;
  allowedKeys: string[];
}

/**
 * Parses and validates API key from request URL against configured allowed keys.
 *
 * @param env - Environment object containing optional API_KEY configuration (comma-separated keys)
 * @param url - Request URL to extract apikey/api_key query parameter from
 * @returns Object containing key enforcement status, supplied key, validity, and allowed keys list
 * @example
 * ```ts
 * const info = parseApiKey({ API_KEY: 'key1,key2' }, new URL('https://example.com?apikey=key1'));
 * // { keyEnforced: true, suppliedKey: 'key1', keyValid: true, allowedKeys: ['key1', 'key2'] }
 * ```
 */
export function parseApiKey(env: { API_KEY?: string }, url: URL): ApiKeyInfo {
  const configuredKeysRaw = (env.API_KEY || '').trim();
  const keyEnforced = configuredKeysRaw.length > 0;
  const allowedKeys = configuredKeysRaw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const suppliedKey = url.searchParams.get('apikey') || url.searchParams.get('api_key');
  const keyValid = !keyEnforced || (suppliedKey !== null && allowedKeys.includes(suppliedKey));
  return { keyEnforced, suppliedKey, keyValid, allowedKeys };
}

/**
 * Removes API key query parameters from a URL object (mutates the URL).
 *
 * @param url - URL object to strip apikey/api_key parameters from
 * @returns True if any parameters were removed, false otherwise
 */
export function stripApiKeyParams(url: URL): boolean {
  let removed = false;
  if (url.searchParams.has('apikey')) {
    url.searchParams.delete('apikey');
    removed = true;
  }
  if (url.searchParams.has('api_key')) {
    url.searchParams.delete('api_key');
    removed = true;
  }
  return removed;
}
