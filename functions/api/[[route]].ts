// Cloudflare Pages Function: serves every /api/* request with the shared handler.
import { handleApi } from '../../server/api.ts';

interface PagesContext {
  request: Request;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequest = (ctx: PagesContext): Promise<Response> => handleApi(ctx.request, (p) => ctx.waitUntil(p));
