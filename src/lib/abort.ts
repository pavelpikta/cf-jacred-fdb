// Utility type guard for distinguishing AbortError (from aborted fetch/timeout via AbortController)
// Centralizing this avoids repeating fragile shape checks across modules.
export function isAbortError(e: unknown): e is DOMException & { name: 'AbortError' } {
  return !!(
    e &&
    typeof e === 'object' &&
    'name' in e &&
    (e as { name?: string }).name === 'AbortError'
  );
}
