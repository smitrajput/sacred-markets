import type { Plugin } from 'vite'

/**
 * Serves the same API code locally: /api/* and /health go through server/routes.ts, exactly as on Vercel.
 * Loaded through Vite's SSR loader so edits to server/ apply without a restart.
 */
export function apiDevPlugin(): Plugin {
  return {
    name: 'sacred-api-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname !== '/health' && !url.pathname.startsWith('/api/')) return next()
        const serve = async () => {
          const mod = (await server.ssrLoadModule('/server/routes.ts')) as {
            handleRequest: (request: Request) => Promise<Response>
          }
          const response = await mod.handleRequest(new Request(url, { method: req.method }))
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        }
        serve().catch(next)
      })
    },
  }
}
