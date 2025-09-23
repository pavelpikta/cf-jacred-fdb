/// <reference types="@cloudflare/workers-types" />
import type { EnvLike } from './lib/constants';
import { parseApiKey } from './lib/apiKey';
import { flushPending } from './lib/fetching';
import { resolveConfig } from './config';
import {
  statsAsset,
  staticAsset,
  methodAndCors,
  torrserver,
  confEndpoint,
  upstream,
  type Middleware,
  type RequestContext,
} from './middleware';
import { isDirectPath, LOCAL_PREFIX } from './lib/constants';
import { initErrorLocale } from './lib/errors';

// Explicit Worker environment (with ERROR_LOCALE etc.)
export type WorkerEnv = EnvLike;

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    flushPending(ctx);
    const start = Date.now();
    const url = new URL(request.url);
    const pathname = url.pathname;
    const config = resolveConfig(env);
    // Initialize localization for error messages once per request (cheap)
    initErrorLocale({ ERROR_LOCALE: env.ERROR_LOCALE });
    const apiKey = parseApiKey(env, url);
    const isApi = pathname === LOCAL_PREFIX || pathname.startsWith(LOCAL_PREFIX + '/');
    const direct = !isApi && isDirectPath(pathname);

    const context: RequestContext = {
      request,
      env,
      url,
      pathname,
      start,
      config,
      apiKey,
      isApi,
      direct,
      state: {},
    };

    const pipeline: Middleware[] = [
      statsAsset,
      staticAsset,
      methodAndCors,
      torrserver,
      confEndpoint,
      upstream, // final network fetch
    ];

    for (const mw of pipeline) {
      const result = await mw(context);
      if (result) return result;
    }
    // Fallback (should not happen) – return generic 500.
    return new Response('Unhandled request', { status: 500 });
  },
};

// Export types for potential external tooling
export type { ApiKeyInfo } from './lib/apiKey';
