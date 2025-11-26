import {
  getUpstreamOrigin,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  DEFAULT_TORRSERVER_TIMEOUT_MS,
} from './lib/constants';
import type { EnvLike } from './lib/constants';

export interface ResolvedConfig {
  upstreamOrigin: string;
  upstreamTimeoutMs: number;
  torrTimeoutMs: number;
}

/**
 * Parses an environment variable as an integer with validation and fallback.
 * Logs a warning when an invalid (non-numeric or non-positive) value is provided.
 *
 * @param value - Raw environment variable value
 * @param defaultValue - Default value to use if parsing fails
 * @param name - Variable name for logging purposes
 * @returns Parsed integer or default value
 */
function parseEnvInt(value: string | undefined, defaultValue: number, name: string): number {
  if (!value || value.trim() === '') return defaultValue;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.warn(`[config] Invalid ${name}="${value}", using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

export function resolveConfig(env: EnvLike): ResolvedConfig {
  return {
    upstreamOrigin: getUpstreamOrigin(env),
    upstreamTimeoutMs: parseEnvInt(
      env.UPSTREAM_TIMEOUT_MS,
      DEFAULT_UPSTREAM_TIMEOUT_MS,
      'UPSTREAM_TIMEOUT_MS'
    ),
    torrTimeoutMs: parseEnvInt(
      env.TORRSERVER_TIMEOUT_MS,
      DEFAULT_TORRSERVER_TIMEOUT_MS,
      'TORRSERVER_TIMEOUT_MS'
    ),
  };
}
