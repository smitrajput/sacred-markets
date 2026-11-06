import { handleRequest } from '../server/routes.js'

/** Vercel Function: GET /api/health (also reachable at /health through the rewrite in vercel.json). */
export async function GET(request: Request): Promise<Response> {
  return handleRequest(request)
}

export async function HEAD(request: Request): Promise<Response> {
  return handleRequest(request)
}
