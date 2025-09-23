import type { ApiKeyInfo } from '../lib/apiKey';
import type { ResolvedConfig } from '../config';
import type { WorkerEnv } from '../worker';

export interface RequestContext {
  request: Request;
  env: WorkerEnv;
  url: URL;
  pathname: string;
  start: number;
  config: ResolvedConfig;
  apiKey: ApiKeyInfo;
  isApi: boolean; // path starts with /api
  direct: boolean; // direct passthrough prefixes (stats/sync etc.)
  upstreamPath?: string;
  upstreamUrl?: URL;
  state: Record<string, unknown>;
}

// Use leading underscore to satisfy no-unused-vars when implementers choose not to use the context param
export type Middleware = (_ctx: RequestContext) => Promise<Response | void> | Response | void;
