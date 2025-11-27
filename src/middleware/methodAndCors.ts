import { ALLOWED_METHODS, CORS_HEADERS } from '../lib/constants';
import { methodNotAllowed } from '../lib/errors';
import type { Middleware } from './types';

export const methodAndCors: Middleware = (ctx) => {
  const { request } = ctx;
  if (!ALLOWED_METHODS.includes(request.method as (typeof ALLOWED_METHODS)[number]))
    return methodNotAllowed(ctx.locale);
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '600' },
    });
};
