import { handleRequest } from '../server/routes.js'

/** Vercel Function: GET /api/positions. Read-only. */
export async function GET(request: Request): Promise<Response> {
  return handleRequest(request)
}

export async function HEAD(request: Request): Promise<Response> {
  return handleRequest(request)
}
