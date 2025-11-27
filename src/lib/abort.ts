/**
 * Type guard for distinguishing AbortError (from aborted fetch/timeout via AbortController).
 * Centralizes this check to avoid repeating fragile shape checks across modules.
 *
 * @param e - The unknown error to check
 * @returns True if the error is a DOMException with name 'AbortError'
 * @example
 * ```ts
 * try {
 *   await fetchWithTimeout(url, init, 5000);
 * } catch (err) {
 *   if (isAbortError(err)) {
 *     console.log('Request was aborted or timed out');
 *   }
 * }
 * ```
 */
export function isAbortError(e: unknown): e is DOMException & { name: 'AbortError' } {
  return !!(
    e &&
    typeof e === 'object' &&
    'name' in e &&
    (e as { name?: string }).name === 'AbortError'
  );
}
