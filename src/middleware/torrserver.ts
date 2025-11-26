import { handleTorrServerAdd, handleTorrServerTest } from '../lib/torrserver';
import type { Middleware } from './types';

export const torrserver: Middleware = async (ctx) => {
  // Only relevant for /api/torrserver/... paths
  if (!ctx.pathname.startsWith('/api/torrserver/')) return;
  const add = await handleTorrServerAdd({
    request: ctx.request,
    pathname: ctx.pathname,
    torrTimeoutMs: ctx.config.torrTimeoutMs,
    env: ctx.env,
    locale: ctx.locale,
  });
  if (add) return add;
  const test = await handleTorrServerTest({
    request: ctx.request,
    pathname: ctx.pathname,
    torrTimeoutMs: ctx.config.torrTimeoutMs,
    env: ctx.env,
    locale: ctx.locale,
  });
  if (test) return test;
};
