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

export function resolveConfig(env: EnvLike): ResolvedConfig {
  const upstreamTimeoutMs =
    parseInt(env.UPSTREAM_TIMEOUT_MS || '', 10) || DEFAULT_UPSTREAM_TIMEOUT_MS;
  const torrTimeoutMs =
    parseInt(env.TORRSERVER_TIMEOUT_MS || '', 10) || DEFAULT_TORRSERVER_TIMEOUT_MS;
  return {
    upstreamOrigin: getUpstreamOrigin(env),
    upstreamTimeoutMs,
    torrTimeoutMs,
  };
}
