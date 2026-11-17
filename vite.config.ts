import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';

/** Serves /api/* locally with the same handler the Cloudflare Worker uses. */
function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      // Let the API read market data built locally (npm run data:*) before it is published.
      (globalThis as { __smvLocalData?: (name: string) => Promise<unknown> }).__smvLocalData = async (name) => {
        try {
          return JSON.parse(await readFile(new URL(`./data-out/${name}`, import.meta.url), 'utf8'));
        } catch {
          return null;
        }
      };
      // The API code isn't part of the browser's module graph, so Vite won't reload it on its
      // own: drop cached copies whenever a file under server/ changes.
      server.watcher.on('change', (file) => {
        if (/[\\/]server[\\/]/.test(file)) server.moduleGraph.invalidateAll();
      });
      server.middlewares.use('/api', async (req, res) => {
        try {
          const { handleApi } = (await server.ssrLoadModule('/server/api.ts')) as typeof import('./server/api.ts');
          const response = await handleApi(new Request(new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost')));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  build: { target: 'es2022', sourcemap: true },
});
