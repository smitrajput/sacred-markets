import { healthHandler } from './handlers/health.js'
import { activityHandler, configHandler, positionsHandler, vaultHandler } from './handlers/chainApi.js'
import { methodNotAllowed, notFound, withoutBody } from './http.js'

type Handler = (request: Request) => Promise<Response> | Response

/**
 * The single route table used by Vercel functions (api/*.ts), the Vite dev server and the tests.
 * Read-only by construction: only GET (and HEAD, derived from GET) is routable. Later financial reads add entries here.
 */
export const routes: Readonly<Record<string, Handler>> = {
  '/api/health': (request) => healthHandler(request),
  '/health': (request) => healthHandler(request),
  '/api/config': (request) => configHandler(request),
  '/api/vault': (request) => vaultHandler(request),
  '/api/positions': (request) => positionsHandler(request),
  '/api/activity': (request) => activityHandler(request),
}

export const ALLOWED_METHODS = ['GET', 'HEAD'] as const

export async function handleRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url)
  const handler = routes[pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname]
  if (!handler) return notFound()
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(ALLOWED_METHODS)
  const response = await handler(request)
  return request.method === 'HEAD' ? withoutBody(response) : response
}
