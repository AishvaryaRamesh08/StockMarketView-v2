/**
 * Cloudflare Worker entry. /api/* goes to the data API; everything else is the built site
 * in dist/, served by Cloudflare's static assets (free, and not counted as Worker requests).
 */
import { handleApi } from '../server/api.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, (p) => ctx.waitUntil(p));
    return env.ASSETS.fetch(request);
  },
};
