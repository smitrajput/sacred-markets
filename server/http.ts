/** Small HTTP helpers shared by every API route. Web-standard Request/Response only, so the same code runs on Vercel and in the Vite dev server. */

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body, (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n', {
    status: init.status ?? 200,
    headers: { ...BASE_HEADERS, ...init.headers },
  })
}

export function methodNotAllowed(allowed: readonly string[]): Response {
  return json({ error: 'method_not_allowed', allowed }, { status: 405, headers: { allow: allowed.join(', ') } })
}

export function notFound(): Response {
  return json({ error: 'not_found' }, { status: 404 })
}

/** HEAD gets the GET response without a body. */
export function withoutBody(response: Response): Response {
  return new Response(null, { status: response.status, headers: response.headers })
}

/** Actionable error body: a stable code, a human message and a hint on what to do next. */
export function apiError(status: number, code: string, message: string, hint: string): Response {
  return json({ error: { code, message, hint } }, { status, headers: status === 503 ? { 'retry-after': '5' } : {} })
}
