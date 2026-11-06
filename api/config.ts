import { handleRequest } from '../server/routes.js'

/** Vercel Function: GET /api/config. Read-only. */
export async function GET(request: Request): Promise<Response> {
  return handleRequest(request)
}

export async function HEAD(request: Request): Promise<Response> {
  return handleRequest(request)
}
