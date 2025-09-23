export interface ApiKeyInfo {
  keyEnforced: boolean;
  suppliedKey: string | null;
  keyValid: boolean;
  allowedKeys: string[];
}

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
