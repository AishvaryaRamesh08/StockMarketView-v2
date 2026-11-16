import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Serves /api/* locally with the same handler the Cloudflare Pages Function uses. */
function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
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
